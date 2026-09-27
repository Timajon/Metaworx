package com.signalforge.terminal

import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

data class RawResponse(val status: Int, val body: String)

interface Transport {
    fun exchange(baseUrl: String, token: String, method: String, path: String, body: String?): RawResponse
}

class UrlConnectionTransport : Transport {
    override fun exchange(baseUrl: String, token: String, method: String, path: String, body: String?): RawResponse {
        val connection = (URL(baseUrl.trimEnd('/') + path).openConnection() as HttpURLConnection).apply {
            requestMethod = method
            connectTimeout = 8_000
            readTimeout = 15_000
            instanceFollowRedirects = false
            setRequestProperty("Accept", "application/json")
            if (token.isNotBlank()) setRequestProperty("Authorization", "Bearer $token")
            if (body != null) {
                doOutput = true
                setRequestProperty("Content-Type", "application/json")
            }
        }
        try {
            if (body != null) {
                connection.outputStream.use { stream -> stream.write(body.toByteArray(Charsets.UTF_8)) }
            }
            val status = connection.responseCode
            val stream = if (status >= 400) connection.errorStream else connection.inputStream
            val text = stream?.bufferedReader()?.use { reader -> reader.readText() }.orEmpty()
            return RawResponse(status, text)
        } finally {
            connection.disconnect()
        }
    }
}

class EngineApi(
    private val baseUrl: String,
    private val token: String,
    private val transport: Transport = UrlConnectionTransport(),
) {
    fun dashboard(): Dashboard {
        val response = transport.exchange(baseUrl, token, "GET", "/api/dashboard", null)
        if (response.status == 401) throw EngineException("The engine rejected the access token.")
        if (response.status !in 200..299) throw EngineException(messageFrom(response))
        return DashboardParser.parse(response.body)
    }

    fun post(path: String, fields: Map<String, Any?>): ApiResult {
        val json = JSONObject()
        for ((key, value) in fields) {
            if (value != null) json.put(key, value)
        }
        val response = transport.exchange(baseUrl, token, "POST", path, json.toString())
        if (response.status == 401) throw EngineException("The engine rejected the access token.")
        return DashboardParser.parseApiResult(response.status, response.body)
    }

    private fun messageFrom(response: RawResponse): String {
        val parsed = DashboardParser.parseApiResult(response.status, response.body)
        return parsed.error ?: "Engine request failed (${response.status})."
    }
}
