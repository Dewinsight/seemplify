package com.seemplify.journey

import java.net.URI
import java.net.URLDecoder
import java.net.URLEncoder
import java.nio.charset.StandardCharsets
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

private val builtInDeniedNames = setOf(
    "__proto__", "prototype", "constructor", "authorization", "cookie", "set-cookie",
    "password", "passcode", "secret", "token", "access_token", "refresh_token", "api_key",
    "apikey", "card_number", "cardnumber", "credit_card", "creditcard", "cvv", "cvc",
    "security_code", "ssn", "advertising_id", "advertisingid", "device_id", "deviceid",
    "idfa", "gaid", "imei", "mac_address", "email_body", "survey_answer", "ai_prompt",
)

internal data class SanitisedJson(val value: JsonObject, val removed: Int)

internal fun sanitiseProperties(input: Map<String, Any?>?, options: PrivacyOptions): SanitisedJson? {
    if (input == null) return null
    val denied = (builtInDeniedNames + options.deniedPropertyNames.map { it.lowercase() }).toSet()
    var removed = 0

    fun convert(value: Any?, depth: Int): JsonElement? {
        if (depth > 8) {
            removed += 1
            return null
        }
        return when (value) {
            null -> JsonNull
            is Boolean -> JsonPrimitive(value)
            is Byte, is Short, is Int, is Long -> JsonPrimitive((value as Number).toLong())
            is Float, is Double -> {
                val number = (value as Number).toDouble()
                if (number.isFinite()) JsonPrimitive(number) else null.also { removed += 1 }
            }
            is String -> JsonPrimitive(value.take(4_096))
            is Char -> JsonPrimitive(value.toString())
            is Map<*, *> -> {
                val entries = linkedMapOf<String, JsonElement>()
                value.entries.take(100).forEach { (rawKey, rawValue) ->
                    val key = rawKey as? String
                    if (key == null || key.isBlank() || key.length > 128 || key.lowercase() in denied) {
                        removed += 1
                    } else {
                        convert(rawValue, depth + 1)?.let { entries[key] = it }
                    }
                }
                if (value.size > 100) removed += value.size - 100
                JsonObject(entries)
            }
            is Iterable<*> -> JsonArray(value.take(64).mapNotNull { convert(it, depth + 1) })
            is Array<*> -> JsonArray(value.take(64).mapNotNull { convert(it, depth + 1) })
            else -> null.also { removed += 1 }
        }
    }

    val converted = convert(input, 0) as? JsonObject ?: JsonObject(emptyMap())
    return SanitisedJson(converted, removed)
}

internal fun sanitiseContext(context: JourneyContext?, options: PrivacyOptions): JourneyContext {
    val page = context?.page
    return JourneyContext(
        locale = context?.locale?.take(64),
        timezone = context?.timezone?.take(128),
        page = page?.let {
            PageContext(
                url = minimiseUrl(it.url, options.allowedUrlQueryParameters),
                referrer = minimiseUrl(it.referrer, options.allowedUrlQueryParameters),
                title = it.title?.take(512),
            )
        },
        device = context?.device?.let {
            DeviceContext(type = it.type?.take(16), operatingSystem = it.operatingSystem?.take(128))
        },
        library = LibraryContext(),
        app = context?.app?.let {
            AppContext(name = it.name?.take(128), version = it.version?.take(64), build = it.build?.take(64))
        },
    )
}

private fun minimiseUrl(raw: String?, allowedQuery: Set<String>): String? {
    if (raw == null) return null
    return runCatching {
        val uri = URI(raw)
        if (uri.scheme !in setOf("http", "https") || uri.host.isNullOrBlank()) return null
        val retained = uri.rawQuery.orEmpty().split('&').filter { it.isNotBlank() }.mapNotNull { pair ->
            val key = pair.substringBefore('=')
            val decoded = URLDecoder.decode(key, StandardCharsets.UTF_8.name())
            if (decoded in allowedQuery) {
                val value = pair.substringAfter('=', "")
                "${URLEncoder.encode(decoded, StandardCharsets.UTF_8.name())}=${value}"
            } else null
        }.joinToString("&")
        URI(uri.scheme, null, uri.host, uri.port, uri.path.ifBlank { "/" }, retained.ifBlank { null }, null).toASCIIString()
    }.getOrNull()
}
