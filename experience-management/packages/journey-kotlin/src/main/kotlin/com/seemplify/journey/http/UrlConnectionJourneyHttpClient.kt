package com.seemplify.journey.http

import com.seemplify.journey.JourneyHttpClient
import com.seemplify.journey.JourneyHttpResponse
import java.net.HttpURLConnection
import java.net.URL
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * Small Android/JVM transport with bounded response bodies and redirects off.
 * The Journey client converts every transport failure to a content-free result.
 */
public class UrlConnectionJourneyHttpClient(
    private val connectTimeoutMs: Int = 10_000,
    private val readTimeoutMs: Int = 10_000,
    private val maximumResponseBytes: Int = 512 * 1024,
) : JourneyHttpClient {
    init {
        require(connectTimeoutMs in 100..120_000)
        require(readTimeoutMs in 100..120_000)
        require(maximumResponseBytes in 1_024..(2 * 1024 * 1024))
    }

    override suspend fun post(
        url: String,
        headers: Map<String, String>,
        body: ByteArray,
    ): JourneyHttpResponse = withContext(Dispatchers.IO) {
        val connection = URL(url).openConnection() as HttpURLConnection
        try {
            connection.requestMethod = "POST"
            connection.instanceFollowRedirects = false
            connection.connectTimeout = connectTimeoutMs
            connection.readTimeout = readTimeoutMs
            connection.doOutput = true
            connection.useCaches = false
            connection.setFixedLengthStreamingMode(body.size)
            headers.forEach { (name, value) -> connection.setRequestProperty(name, value) }
            connection.outputStream.use { it.write(body) }
            val status = connection.responseCode
            val responseHeaders = connection.headerFields.entries
                .filter { it.key != null && !it.value.isNullOrEmpty() }
                .associate { it.key to it.value.joinToString(",") }
            val stream = if (status >= 400) connection.errorStream else connection.inputStream
            val response = stream?.use { input ->
                val buffer = ByteArray(8 * 1024)
                val output = java.io.ByteArrayOutputStream()
                while (true) {
                    val read = input.read(buffer)
                    if (read < 0) break
                    if (output.size() + read > maximumResponseBytes) throw IllegalStateException("Response body limit exceeded")
                    output.write(buffer, 0, read)
                }
                output.toByteArray()
            } ?: byteArrayOf()
            JourneyHttpResponse(status, responseHeaders, response)
        } finally {
            connection.disconnect()
        }
    }
}

