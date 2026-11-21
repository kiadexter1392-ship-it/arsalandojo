package com.example.ai

import android.content.Context
import android.util.Log
import com.example.R
import com.example.util.isCurrentlyConnected
import com.google.firebase.Firebase
import com.google.firebase.ai.ai
import com.google.firebase.ai.type.APINotConfiguredException
import com.google.firebase.ai.type.ContentBlockedException
import com.google.firebase.ai.type.InvalidAPIKeyException
import com.google.firebase.ai.type.PermissionMissingException
import com.google.firebase.ai.type.PromptBlockedException
import com.google.firebase.ai.type.QuotaExceededException
import com.google.firebase.ai.type.RequestTimeoutException
import com.google.firebase.ai.type.Schema
import com.google.firebase.ai.type.ServerException
import com.google.firebase.ai.type.ServiceConnectionHandshakeFailedException
import com.google.firebase.ai.type.ServiceDisabledException
import com.google.firebase.ai.type.UnsupportedUserLocationException
import com.google.firebase.ai.type.generationConfig
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.withTimeout
import org.json.JSONObject
import java.io.IOException
import java.net.ConnectException
import java.net.SocketTimeoutException
import java.net.UnknownHostException

private const val TAG = "GeminiAiClient"
private const val DEFAULT_TIMEOUT_MS = 60_000L
private const val PRIMARY_MODEL = "gemini-3.8-flash"
private const val FALLBACK_MODEL = "gemini-3.5-flash-lite"

sealed interface AiResponseState {
    data object Idle : AiResponseState
    data object Loading : AiResponseState
    data class Streaming(val text: String) : AiResponseState
    data class Success(val text: String) : AiResponseState
    data class Error(val message: String) : AiResponseState
}

class GeminiAiClient(
    context: Context,
    private val modelName: String = PRIMARY_MODEL,
    private val fallbackModelName: String = FALLBACK_MODEL
) {
    private val appContext = context.applicationContext

    private val model by lazy {
        Firebase.ai.generativeModel(modelName)
    }

    private val fallbackModel by lazy {
        Firebase.ai.generativeModel(fallbackModelName)
    }

    private val mealPlanSchema by lazy {
        Schema.obj(
            properties = mapOf(
                "planTitle" to Schema.string(description = "Title of the personalized Persian meal plan"),
                "summary" to Schema.string(description = "Brief 1-2 sentence overview in Persian tailored to the user's goal"),
                "dailyCalories" to Schema.integer(description = "Estimated total daily calories in kcal"),
                "proteinTarget" to Schema.string(description = "Daily protein target in Persian, e.g. 140 گرم"),
                "carbsTarget" to Schema.string(description = "Daily carbs target in Persian, e.g. 220 گرم"),
                "fatTarget" to Schema.string(description = "Daily fat target in Persian, e.g. 60 گرم"),
                "hydrationTip" to Schema.string(description = "Practical daily hydration guidance in Persian"),
                "coachTip" to Schema.string(description = "Practical nutrition and training timing tip in Persian"),
                "meals" to Schema.array(
                    items = Schema.obj(
                        properties = mapOf(
                            "mealTitle" to Schema.string(description = "Meal name in Persian e.g. صبحانه، ناهار، شام"),
                            "timeRange" to Schema.string(description = "Suggested time window in Persian e.g. ۷:۳۰ تا ۸:۳۰"),
                            "foods" to Schema.array(
                                items = Schema.string(),
                                description = "List of foods with exact practical portions in Persian"
                            ),
                            "calories" to Schema.integer(description = "Meal calories in kcal"),
                            "proteinGrams" to Schema.integer(description = "Estimated protein grams"),
                            "carbsGrams" to Schema.integer(description = "Estimated carbs grams"),
                            "fatGrams" to Schema.integer(description = "Estimated fat grams"),
                            "notes" to Schema.string(description = "Short preparation or substitution tip in Persian")
                        ),
                        optionalProperties = listOf("notes")
                    ),
                    description = "Ordered list of daily meals matching the requested meal count"
                )
            ),
            optionalProperties = listOf("hydrationTip", "coachTip")
        )
    }

    private val mealPlanModel by lazy {
        Firebase.ai.generativeModel(
            modelName = modelName,
            generationConfig = generationConfig {
                responseMimeType = "application/json"
                responseSchema = mealPlanSchema
            }
        )
    }

    private val fallbackMealPlanModel by lazy {
        Firebase.ai.generativeModel(
            modelName = fallbackModelName,
            generationConfig = generationConfig {
                responseMimeType = "application/json"
                responseSchema = mealPlanSchema
            }
        )
    }

    suspend fun generateMealPlan(request: MealPlanRequest): MealPlanUiState {
        if (!isCurrentlyConnected(appContext)) {
            return MealPlanUiState.Error(appContext.getString(R.string.error_gemini_offline))
        }
        val prompt = buildMealPlanPrompt(request)
        return try {
            val response = try {
                withTimeout(DEFAULT_TIMEOUT_MS) {
                    mealPlanModel.generateContent(prompt)
                }
            } catch (primaryError: Exception) {
                if (shouldRetryWithFallbackModel(primaryError) && fallbackModelName != modelName) {
                    Log.w(TAG, "Primary model $modelName failed; retrying with $fallbackModelName", primaryError)
                    withTimeout(DEFAULT_TIMEOUT_MS) {
                        fallbackMealPlanModel.generateContent(prompt)
                    }
                } else {
                    throw primaryError
                }
            }
            val jsonText = response.text
                ?: return MealPlanUiState.Error(appContext.getString(R.string.error_gemini_generic))
            val parsed = parseMealPlanJson(jsonText)
            if (parsed.meals.isEmpty()) {
                return MealPlanUiState.Error(appContext.getString(R.string.error_gemini_generic))
            }
            MealPlanUiState.Success(parsed)
        } catch (e: TimeoutCancellationException) {
            Log.e(TAG, "Meal plan generation timed out", e)
            MealPlanUiState.Error(appContext.getString(R.string.error_gemini_timeout))
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            Log.e(TAG, "Meal plan generation failed", e)
            MealPlanUiState.Error(toUserFriendlyMessage(e))
        }
    }

    private fun buildMealPlanPrompt(request: MealPlanRequest): String = buildString {
        appendLine("تو یک متخصص تغذیه ورزشی و مربی حرفه‌ای باشگاه ارسلان دوجو هستی.")
        appendLine("کاربر از تو می‌خواهد خودت به صورت کامل و حرفه‌ای غذاها را انتخاب کنی و یک برنامه غذایی روزانه دقیق، عملی، خوش‌خوراک و کاملاً فارسی بر اساس هدف و مشخصات زیر برایش بچینی.")
        appendLine("قوانین مهم:")
        appendLine("1. دقیقاً ${request.mealCount} وعده غذایی طراحی کن.")
        appendLine("2. خودت بهترین و متنوع‌ترین غذاهای سالم، در دسترس و متناسب با سفره ایرانی و تغذیه ورزشی را برای هر وعده انتخاب کن (مثل ترکیب متعادل پروتئین، کربوهیدرات پیچیده، چربی مفید و فیبر).")
        appendLine("3. اندازه‌ها را با واحدهای واقعی و ملموس (گرم، قاشق، لیوان، عدد، کف دست) بنویس.")
        appendLine("4. اگر کاربر مشخصات بدنی یا سبک برنامه را وارد کرده، کالری و نوع غذاها را دقیقاً متناسب با آن تنظیم کن.")
        appendLine("5. مقادیر عددی proteinGrams، carbsGrams، fatGrams و calories را برای هر وعده دقیق و واقعی (بزرگ‌تر از صفر) محاسبه و پر کن تا مجموع آن‌ها با اهداف روزانه هم‌خوانی داشته باشد.")
        appendLine()
        appendLine("هدف کاربر: ${request.goal}")
        if (request.bodyStats.isNotBlank()) {
            appendLine("مشخصات بدنی و سطح فعالیت: ${request.bodyStats.trim()}")
        }
        if (request.extraNotes.isNotBlank()) {
            appendLine("سبک و نکته تکمیلی برنامه: ${request.extraNotes.trim()}")
        }
    }

    private fun parseMealPlanJson(jsonString: String): MealPlanResult {
        val cleanJson = jsonString.trim()
            .removePrefix("```json")
            .removePrefix("```")
            .removeSuffix("```")
            .trim()
        val json = JSONObject(cleanJson)
        val mealsJson = json.optJSONArray("meals")
        val meals = if (mealsJson != null) {
            (0 until mealsJson.length()).mapNotNull { idx ->
                val obj = mealsJson.optJSONObject(idx) ?: return@mapNotNull null
                val foodsArray = obj.optJSONArray("foods")
                val foods = if (foodsArray != null) {
                    (0 until foodsArray.length()).mapNotNull { fIdx ->
                        foodsArray.optString(fIdx, "").takeIf { it.isNotBlank() }
                    }
                } else {
                    emptyList()
                }
                MealItem(
                    mealTitle = obj.optString("mealTitle", "").ifBlank { "وعده ${idx + 1}" },
                    timeRange = obj.optString("timeRange", ""),
                    foods = foods,
                    calories = obj.optInt("calories", 0),
                    proteinGrams = obj.optInt("proteinGrams", 0),
                    carbsGrams = obj.optInt("carbsGrams", 0),
                    fatGrams = obj.optInt("fatGrams", 0),
                    notes = obj.optString("notes", "")
                )
            }
        } else {
            emptyList()
        }
        return MealPlanResult(
            planTitle = json.optString("planTitle", "").ifBlank { "برنامه غذایی هوشمند" },
            summary = json.optString("summary", ""),
            dailyCalories = json.optInt("dailyCalories", 0),
            proteinTarget = json.optString("proteinTarget", ""),
            carbsTarget = json.optString("carbsTarget", ""),
            fatTarget = json.optString("fatTarget", ""),
            hydrationTip = json.optString("hydrationTip", ""),
            coachTip = json.optString("coachTip", ""),
            meals = meals
        )
    }

    suspend fun generateText(prompt: String): AiResponseState {
        if (!isCurrentlyConnected(appContext)) {
            return AiResponseState.Error(appContext.getString(R.string.error_gemini_offline))
        }
        return try {
            val response = try {
                withTimeout(DEFAULT_TIMEOUT_MS) {
                    model.generateContent(prompt)
                }
            } catch (primaryError: Exception) {
                if (shouldRetryWithFallbackModel(primaryError) && fallbackModelName != modelName) {
                    Log.w(TAG, "Primary model $modelName failed; retrying with $fallbackModelName", primaryError)
                    withTimeout(DEFAULT_TIMEOUT_MS) {
                        fallbackModel.generateContent(prompt)
                    }
                } else {
                    throw primaryError
                }
            }
            val text = response.text
            if (!text.isNullOrBlank()) {
                AiResponseState.Success(text)
            } else {
                AiResponseState.Error(appContext.getString(R.string.error_gemini_generic))
            }
        } catch (e: TimeoutCancellationException) {
            Log.e(TAG, "Generation timed out", e)
            AiResponseState.Error(appContext.getString(R.string.error_gemini_timeout))
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            Log.e(TAG, "Firebase AI generation failed", e)
            AiResponseState.Error(toUserFriendlyMessage(e))
        }
    }

    fun streamText(prompt: String): Flow<AiResponseState> = flow {
        if (!isCurrentlyConnected(appContext)) {
            emit(AiResponseState.Error(appContext.getString(R.string.error_gemini_offline)))
            return@flow
        }
        emit(AiResponseState.Loading)
        val accumulated = StringBuilder()
        withTimeout(DEFAULT_TIMEOUT_MS) {
            model.generateContentStream(prompt).collect { chunk ->
                val chunkText = chunk.text.orEmpty()
                if (chunkText.isNotEmpty()) {
                    accumulated.append(chunkText)
                    emit(AiResponseState.Streaming(accumulated.toString()))
                }
            }
        }
        if (accumulated.isNotBlank()) {
            emit(AiResponseState.Success(accumulated.toString()))
        } else {
            emit(AiResponseState.Error(appContext.getString(R.string.error_gemini_generic)))
        }
    }.catch { e ->
        when (e) {
            is CancellationException -> throw e
            is TimeoutCancellationException -> {
                Log.e(TAG, "Streaming timed out", e)
                emit(AiResponseState.Error(appContext.getString(R.string.error_gemini_timeout)))
            }
            else -> {
                Log.e(TAG, "Streaming generation failed", e)
                emit(AiResponseState.Error(toUserFriendlyMessage(e)))
            }
        }
    }

    private fun shouldRetryWithFallbackModel(error: Throwable): Boolean {
        val chain = generateSequence(error) { it.cause }.toList()
        if (chain.any {
                it is CancellationException ||
                    it is TimeoutCancellationException ||
                    it is UnsupportedUserLocationException ||
                    it is QuotaExceededException ||
                    it is UnknownHostException ||
                    it is ConnectException
            }
        ) {
            return false
        }
        val combinedMsg = chain.mapNotNull { it.message }.joinToString(" ").lowercase()
        if (combinedMsg.contains("location is not supported") ||
            combinedMsg.contains("429") ||
            combinedMsg.contains("quota")
        ) {
            return false
        }
        return true
    }

    private fun toUserFriendlyMessage(error: Throwable): String {
        if (!isCurrentlyConnected(appContext)) {
            return appContext.getString(R.string.error_gemini_offline)
        }
        val chain = generateSequence(error) { it.cause }.toList()
        val combinedMsg = chain.mapNotNull { it.message }.joinToString(" | ")
        val lower = combinedMsg.lowercase()
        val codeTag = chain.firstOrNull()?.let { it::class.simpleName } ?: "Unknown"

        return when {
            chain.any { it is UnsupportedUserLocationException } ||
                lower.contains("location is not supported") ||
                lower.contains("user location") ||
                lower.contains("country") ||
                lower.contains("region") -> {
                appContext.getString(R.string.error_gemini_location)
            }
            chain.any { it is UnknownHostException || it is ConnectException } ||
                lower.contains("unable to resolve host") ||
                lower.contains("failed to connect") -> {
                appContext.getString(R.string.error_gemini_offline)
            }
            chain.any { it is SocketTimeoutException || it is RequestTimeoutException } ||
                lower.contains("timeout") ||
                lower.contains("timed out") -> {
                appContext.getString(R.string.error_gemini_timeout)
            }
            chain.any { it is QuotaExceededException } ||
                lower.contains("429") ||
                lower.contains("quota") ||
                lower.contains("resource_exhausted") -> {
                appContext.getString(R.string.error_gemini_quota)
            }
            chain.any {
                it is ServiceConnectionHandshakeFailedException ||
                    it is APINotConfiguredException ||
                    it is ServiceDisabledException ||
                    it is PermissionMissingException ||
                    it is InvalidAPIKeyException
            } ||
                lower.contains("app check") ||
                lower.contains("appcheck") ||
                lower.contains("attestation") ||
                lower.contains("recaptcha") ||
                lower.contains("403") -> {
                appContext.getString(R.string.error_gemini_app_check, codeTag)
            }
            chain.any { it is IOException } -> {
                appContext.getString(R.string.error_gemini_connection_reset, codeTag)
            }
            chain.any { it is ServerException || it is PromptBlockedException || it is ContentBlockedException } ||
                lower.contains("unavailable") ||
                lower.contains("503") -> {
                appContext.getString(R.string.error_gemini_unavailable_detail, codeTag)
            }
            else -> {
                appContext.getString(R.string.error_gemini_generic_detail, codeTag)
            }
        }
    }
}
