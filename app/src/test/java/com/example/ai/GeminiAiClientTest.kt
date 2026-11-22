package com.example.ai

import com.google.firebase.ai.type.APINotConfiguredException
import com.google.firebase.ai.type.QuotaExceededException
import com.google.firebase.ai.type.ServerException
import com.google.firebase.ai.type.UnsupportedUserLocationException
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.net.SocketTimeoutException
import java.net.UnknownHostException

class GeminiAiClientTest {

    private fun serverException(msg: String): ServerException =
        ServerException::class.java
            .getDeclaredConstructor(String::class.java, Throwable::class.java)
            .apply { isAccessible = true }
            .newInstance(msg, null)

    private fun quotaExceededException(msg: String): QuotaExceededException =
        QuotaExceededException::class.java
            .getDeclaredConstructor(String::class.java, Throwable::class.java)
            .apply { isAccessible = true }
            .newInstance(msg, null)

    private fun apiNotConfiguredException(msg: String): APINotConfiguredException =
        APINotConfiguredException::class.java
            .getDeclaredConstructor(String::class.java, Throwable::class.java)
            .apply { isAccessible = true }
            .newInstance(msg, null)

    private fun unsupportedLocationException(): UnsupportedUserLocationException =
        UnsupportedUserLocationException::class.java
            .getDeclaredConstructor(Throwable::class.java)
            .apply { isAccessible = true }
            .newInstance(null)

    @Test
    fun classifyGeminiError_detectsAppCheckAnd403ServerException() {
        val err = serverException(
            "PERMISSION_DENIED: To access this model, you must enforce Firebase App Check. Learn more: https://firebase.google.com/docs/ai-logic/app-check"
        )
        assertEquals(GeminiErrorCategory.APP_CHECK, classifyGeminiError(err))
        assertFalse(shouldRetryWithFallbackModel(err))

        val diag = buildDiagnosticTag(err, appCheckDiagnostic = "RecaptchaException: Network Error")
        assertTrue(diag.contains("ServerException"))
        assertTrue(diag.contains("To access this model, you must enforce Firebase App Check"))
        assertTrue(diag.contains("AppCheck: RecaptchaException: Network Error"))
        assertFalse(diag.contains("https://"))
    }

    @Test
    fun classifyGeminiError_stripsHtmlAndTruncatesLongUnexpected403() {
        val html403 = serverException(
            "Unexpected Response:\n<html><head><title>403 Forbidden</title></head><body>Access denied from region edge</body></html>"
        )
        assertEquals(GeminiErrorCategory.APP_CHECK, classifyGeminiError(html403))
        assertFalse(shouldRetryWithFallbackModel(html403))

        val diag = buildDiagnosticTag(html403)
        assertTrue(diag.contains("403 Forbidden"))
        assertFalse(diag.contains("<html>"))
    }

    @Test
    fun classifyGeminiError_handlesLocationQuotaAndOffline() {
        val loc = unsupportedLocationException()
        assertEquals(GeminiErrorCategory.LOCATION, classifyGeminiError(loc))
        assertFalse(shouldRetryWithFallbackModel(loc))

        val quota = quotaExceededException("Quota exceeded")
        assertEquals(GeminiErrorCategory.QUOTA, classifyGeminiError(quota))
        assertFalse(shouldRetryWithFallbackModel(quota))

        val dns = UnknownHostException("Unable to resolve host")
        assertEquals(GeminiErrorCategory.OFFLINE, classifyGeminiError(dns))
        assertTrue(isImmediateNetworkOrTimeout(dns))
        assertFalse(shouldRetryWithFallbackModel(dns))
    }

    @Test
    fun classifyGeminiError_handlesApiConfigAndTimeout() {
        val apiCfg = apiNotConfiguredException("API not enabled")
        assertEquals(GeminiErrorCategory.APP_CHECK, classifyGeminiError(apiCfg))
        assertFalse(shouldRetryWithFallbackModel(apiCfg))

        val timeout = SocketTimeoutException("Read timed out")
        assertEquals(GeminiErrorCategory.TIMEOUT, classifyGeminiError(timeout))
        assertTrue(isImmediateNetworkOrTimeout(timeout))
    }

    @Test
    fun shouldRetryWithFallbackModel_allowsTransientServer503() {
        val unavailable = serverException("Service temporarily unavailable (503)")
        assertEquals(GeminiErrorCategory.UNAVAILABLE, classifyGeminiError(unavailable))
        assertTrue(shouldRetryWithFallbackModel(unavailable))
    }
}
