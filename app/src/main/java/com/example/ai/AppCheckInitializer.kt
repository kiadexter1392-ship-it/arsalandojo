package com.example.ai

import android.content.Context
import android.content.Intent
import android.util.Log
import com.example.BuildConfig
import com.google.android.gms.tasks.Task
import com.google.firebase.FirebaseApp
import com.google.firebase.appcheck.AppCheckToken
import com.google.firebase.appcheck.FirebaseAppCheck
import com.google.firebase.appcheck.debug.DebugAppCheckProviderFactory
import com.google.firebase.appcheck.recaptcha.RecaptchaAppCheckProviderFactory
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withTimeout
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

private const val TAG = "AppCheckInit"

private const val DEBUG_TOKEN_EXTRA = "FIREBASE_APPCHECK_DEBUG_TOKEN"
private const val DEBUG_STORE_PREFIX = "com.google.firebase.appcheck.debug.store."
private const val DEBUG_SECRET_KEY = "com.google.firebase.appcheck.debug.DEBUG_SECRET"
private const val RECAPTCHA_SITE_KEY_RES = "recaptcha_site_key"
private const val APP_CHECK_PREFLIGHT_TIMEOUT_MS = 15_000L

sealed interface AppCheckPreflightResult {
    data class Ready(val tokenLength: Int) : AppCheckPreflightResult
    data class Failed(val diagnostic: String, val underlyingError: Throwable?) : AppCheckPreflightResult
}

fun configureAppCheck(context: Context, intent: Intent?) {
    try {
        if (FirebaseApp.getApps(context).isEmpty()) {
            FirebaseApp.initializeApp(context)
        }

        if (BuildConfig.DEBUG) {
            val debugToken = intent?.getStringExtra(DEBUG_TOKEN_EXTRA)

            if (!debugToken.isNullOrEmpty()) {
                val persistenceKey = FirebaseApp.getInstance().persistenceKey
                val prefs = context.getSharedPreferences(
                    "$DEBUG_STORE_PREFIX$persistenceKey",
                    Context.MODE_PRIVATE
                )
                // Synchronous commit() ensures the debug token is persisted before factory setup.
                prefs.edit()
                    .putString(DEBUG_SECRET_KEY, debugToken)
                    .commit()
                Log.d(TAG, "App Check debug secret configured successfully.")
            } else {
                Log.w(TAG, "No debug token found in Intent extra.")
            }

            FirebaseAppCheck.getInstance().installAppCheckProviderFactory(
                DebugAppCheckProviderFactory.getInstance()
            )
            Log.d(TAG, "DebugAppCheckProviderFactory installed.")
        } else {
            val resId = context.resources.getIdentifier(
                RECAPTCHA_SITE_KEY_RES,
                "string",
                context.packageName
            )
            if (resId != 0) {
                val siteKey = context.getString(resId)
                if (siteKey.isNotBlank()) {
                    FirebaseAppCheck.getInstance().installAppCheckProviderFactory(
                        RecaptchaAppCheckProviderFactory.getInstance(siteKey)
                    )
                    Log.d(TAG, "RecaptchaAppCheckProviderFactory installed.")
                } else {
                    Log.e(TAG, "recaptcha_site_key resource string is blank.")
                }
            } else {
                Log.e(TAG, "recaptcha_site_key string resource not found in package.")
            }
        }
    } catch (e: Exception) {
        Log.e(TAG, "Failed to initialize Firebase App Check", e)
    }
}

suspend fun ensureValidAppCheckToken(context: Context): AppCheckPreflightResult {
    val appContext = context.applicationContext
    try {
        if (FirebaseApp.getApps(appContext).isEmpty()) {
            FirebaseApp.initializeApp(appContext)
        }
        val appCheck = FirebaseAppCheck.getInstance()
        val cachedOrFresh = try {
            withTimeout(APP_CHECK_PREFLIGHT_TIMEOUT_MS) {
                awaitTask(appCheck.getAppCheckToken(false))
            }
        } catch (firstError: Exception) {
            if (firstError is CancellationException) throw firstError
            Log.w(TAG, "Initial App Check token request failed; attempting recovery", firstError)
            recoverStuckRecaptchaProviderIfNeeded(appContext)
            withTimeout(APP_CHECK_PREFLIGHT_TIMEOUT_MS) {
                awaitTask(appCheck.getAppCheckToken(true))
            }
        }
        val token = cachedOrFresh.token
        return if (token.isNotBlank()) {
            AppCheckPreflightResult.Ready(token.length)
        } else {
            AppCheckPreflightResult.Failed(
                diagnostic = "AppCheck: empty token returned",
                underlyingError = IllegalStateException("Empty App Check token")
            )
        }
    } catch (e: CancellationException) {
        throw e
    } catch (e: Exception) {
        Log.e(TAG, "App Check token retrieval failed after recovery", e)
        val root = generateSequence<Throwable>(e) { it.cause }.lastOrNull() ?: e
        val msg = sanitizeAppCheckDiagnostic(root.message ?: e.message)
        val diag = if (msg.isNotBlank()) {
            "${root::class.simpleName}: $msg"
        } else {
            root::class.simpleName ?: "AppCheckError"
        }
        return AppCheckPreflightResult.Failed(diagnostic = diag, underlyingError = e)
    }
}

/**
 * RecaptchaAppCheckProvider caches `recaptchaTasksClientTask` permanently on first initialization.
 * If the user opened the app offline or before connecting VPN, that Task fails once and stays
 * failed forever unless cleared and re-initialized.
 */
private fun recoverStuckRecaptchaProviderIfNeeded(context: Context) {
    if (BuildConfig.DEBUG) return
    runCatching {
        val resId = context.resources.getIdentifier(
            RECAPTCHA_SITE_KEY_RES,
            "string",
            context.packageName
        )
        if (resId == 0) return@runCatching
        val siteKey = context.getString(resId)
        if (siteKey.isBlank()) return@runCatching

        val app = FirebaseApp.getInstance()
        val factory = RecaptchaAppCheckProviderFactory.getInstance(siteKey)
        val provider = factory.create(app)
        val field = provider.javaClass.getDeclaredField("recaptchaTasksClientTask").apply {
            isAccessible = true
        }
        val existingTask = field.get(provider) as? Task<*>
        if (existingTask == null || (existingTask.isComplete && !existingTask.isSuccessful)) {
            Log.w(TAG, "Clearing failed RecaptchaTasksClient task and re-initializing")
            field.set(provider, null)
            val initMethod = provider.javaClass.getDeclaredMethod("initializeRecaptchaClient")
            initMethod.invoke(provider)
            FirebaseAppCheck.getInstance().installAppCheckProviderFactory(factory)
        }
    }.onFailure { err ->
        Log.w(TAG, "Unable to reset RecaptchaAppCheckProvider task", err)
    }
}

private suspend fun awaitTask(task: Task<AppCheckToken>): AppCheckToken =
    suspendCancellableCoroutine { cont ->
        task.addOnCompleteListener { completed ->
            if (!cont.isActive) return@addOnCompleteListener
            val ex = completed.exception
            if (ex != null) {
                cont.resumeWithException(ex)
            } else if (completed.isCanceled) {
                cont.cancel()
            } else {
                cont.resume(completed.result)
            }
        }
    }

private fun sanitizeAppCheckDiagnostic(raw: String?): String {
    if (raw.isNullOrBlank()) return ""
    return raw
        .replace(Regex("<[^>]*>"), " ")
        .replace(Regex("https?://\\S+"), "")
        .replace(Regex("\\s+"), " ")
        .trim()
        .take(120)
}

