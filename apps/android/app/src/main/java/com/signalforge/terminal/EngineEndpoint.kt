package com.signalforge.terminal

import java.net.URI

object EngineEndpoint {
    fun normalize(raw: String): String = raw.trim().trimEnd('/')

    /**
     * Returns a user-facing error, or null when the origin and token are acceptable.
     * Luno and xAI keys are never accepted here. The token is only the engine access token.
     */
    fun validate(rawUrl: String, token: String): String? {
        val text = normalize(rawUrl)
        if (text.isEmpty()) return "Enter the engine URL."
        val uri = try {
            URI(text)
        } catch (_: Exception) {
            return "Enter a full engine URL, including http:// or https://."
        }
        val scheme = uri.scheme?.lowercase()
        if (scheme != "http" && scheme != "https") {
            return "Use an http or https engine URL."
        }
        if (!uri.userInfo.isNullOrBlank()) {
            return "Put the access token in the token field, not in the URL."
        }
        val host = uri.host?.lowercase().orEmpty()
        if (host.isEmpty()) return "The engine URL needs a host."
        val path = uri.path.orEmpty()
        if (path.isNotEmpty() && path != "/") {
            return "Use the engine origin only, for example http://192.168.1.20:8787."
        }
        if (!uri.query.isNullOrBlank() || !uri.fragment.isNullOrBlank()) {
            return "The engine URL cannot include a query or fragment."
        }
        if (scheme == "http" && !isPrivateOrLocal(host)) {
            return "Public engines must use HTTPS. HTTP is limited to this device and private LAN addresses."
        }
        if (!isLoopback(host) && token.isBlank()) {
            return "This engine is not on this device. Enter the SIGNALFORGE_ACCESS_TOKEN."
        }
        return null
    }

    fun isLoopback(host: String): Boolean {
        val normalized = host.lowercase()
        return normalized == "localhost" || normalized == "127.0.0.1" || normalized == "::1"
    }

    fun isPrivateOrLocal(host: String): Boolean {
        val normalized = host.lowercase()
        if (isLoopback(normalized) || normalized == "10.0.2.2" || normalized.endsWith(".local")) return true
        val parts = normalized.split('.')
        if (parts.size != 4) return false
        val numbers = parts.map { part -> part.toIntOrNull() ?: return false }
        if (numbers.any { it !in 0..255 }) return false
        val first = numbers[0]
        val second = numbers[1]
        return first == 10 || (first == 192 && second == 168) || (first == 172 && second in 16..31)
    }
}
