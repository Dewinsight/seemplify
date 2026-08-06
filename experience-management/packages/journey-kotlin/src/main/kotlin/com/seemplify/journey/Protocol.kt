package com.seemplify.journey

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject

public const val JOURNEY_PROTOCOL_VERSION: String = "1.0"
public const val JOURNEY_KOTLIN_SDK_NAME: String = "com.seemplify:journey-kotlin"
public const val JOURNEY_KOTLIN_SDK_VERSION: String = "0.1.0-foundation"

internal const val MAX_ENVELOPE_BYTES: Int = 64 * 1024
internal const val MAX_BATCH_BYTES: Int = 512 * 1024
internal const val MAX_BATCH_EVENTS: Int = 100

@Serializable
public enum class ConsentState {
    @SerialName("granted") GRANTED,
    @SerialName("denied") DENIED,
    @SerialName("unknown") UNKNOWN,
}

@Serializable
public data class ConsentSnapshot(
    val analytics: ConsentState? = null,
    val personalisation: ConsentState? = null,
    val researchContact: ConsentState? = null,
    val marketing: ConsentState? = null,
    val source: String,
    val updatedAt: String,
)

@Serializable
public data class PageContext(
    val url: String? = null,
    val referrer: String? = null,
    val title: String? = null,
)

@Serializable
public data class DeviceContext(
    val type: String? = null,
    val operatingSystem: String? = null,
)

@Serializable
public data class LibraryContext(
    val name: String = JOURNEY_KOTLIN_SDK_NAME,
    val version: String = JOURNEY_KOTLIN_SDK_VERSION,
)

@Serializable
public data class AppContext(
    val name: String? = null,
    val version: String? = null,
    val build: String? = null,
)

@Serializable
public data class JourneyContext(
    val locale: String? = null,
    val timezone: String? = null,
    val page: PageContext? = null,
    val device: DeviceContext? = null,
    val library: LibraryContext = LibraryContext(),
    val app: AppContext? = null,
)

@Serializable
public data class OperationalMetric(
    val name: String,
    val value: Double,
    val unit: String? = null,
    val dimensions: JsonObject? = null,
)

@Serializable
public data class JourneyEventEnvelope(
    val protocolVersion: String = JOURNEY_PROTOCOL_VERSION,
    val eventId: String,
    val call: String,
    val occurredAt: String,
    val sentAt: String? = null,
    val anonymousId: String? = null,
    val userId: String? = null,
    val accountId: String? = null,
    val sessionId: String? = null,
    val event: String? = null,
    val eventVersion: Int? = null,
    val properties: JsonObject? = null,
    val traits: JsonObject? = null,
    val context: JourneyContext? = null,
    val consent: ConsentSnapshot? = null,
    val metric: OperationalMetric? = null,
)

@Serializable
internal data class JourneyEventBatch(
    val protocolVersion: String = JOURNEY_PROTOCOL_VERSION,
    val batchId: String,
    val sentAt: String,
    val events: List<JourneyEventEnvelope>,
)

@Serializable
internal data class EventIngestResult(
    val eventId: String,
    val index: Int? = null,
    val status: String,
    val duplicate: Boolean,
    val retryable: Boolean,
    val receivedAt: String,
    val code: String? = null,
)

@Serializable
internal data class BatchIngestResult(
    val protocolVersion: String,
    val batchId: String,
    val results: List<EventIngestResult>,
)

internal val journeyJson: Json = Json {
    encodeDefaults = true
    explicitNulls = false
    ignoreUnknownKeys = false
}

internal val canonicalUuid = Regex("^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$", RegexOption.IGNORE_CASE)
internal val canonicalEventName = Regex("^[a-z][a-z0-9_]*$")

internal fun JourneyEventEnvelope.validationCode(): String? {
    if (protocolVersion != JOURNEY_PROTOCOL_VERSION) return "PROTOCOL_VERSION_INVALID"
    if (!canonicalUuid.matches(eventId)) return "EVENT_ID_INVALID"
    if (call !in setOf("track", "identify", "alias", "group", "page", "screen", "consent", "metric")) return "CALL_INVALID"
    if (!isUtcTimestamp(occurredAt)) return "OCCURRED_AT_INVALID"
    if (listOf(anonymousId, userId, accountId, sessionId).none { !it.isNullOrBlank() }) return "SUBJECT_REQUIRED"
    if (listOfNotNull(anonymousId, userId, accountId, sessionId).any { it.length > 256 }) return "IDENTIFIER_TOO_LONG"
    if (call in setOf("track", "metric") && (event == null || eventVersion == null || eventVersion < 1)) return "EVENT_FIELDS_REQUIRED"
    if (event != null && (event.length > 128 || !canonicalEventName.matches(event))) return "EVENT_NAME_INVALID"
    if (call == "identify" && userId.isNullOrBlank()) return "IDENTIFY_USER_REQUIRED"
    if (call == "alias" && (userId.isNullOrBlank() || anonymousId.isNullOrBlank())) return "ALIAS_IDS_REQUIRED"
    if (call == "group" && accountId.isNullOrBlank()) return "GROUP_ACCOUNT_REQUIRED"
    if (call == "consent" && consent == null) return "CONSENT_REQUIRED"
    if (call == "metric" && (metric == null || metric.name.isBlank() || metric.name.length > 128 || !metric.value.isFinite())) {
        return "METRIC_INVALID"
    }
    if (consent != null && consent.validationCode() != null) return consent.validationCode()
    if (journeyJson.encodeToString(JourneyEventEnvelope.serializer(), this).encodeToByteArray().size > MAX_ENVELOPE_BYTES) return "EVENT_TOO_LARGE"
    return null
}

private fun ConsentSnapshot.validationCode(): String? {
    if (source.isBlank() || source.length > 128) return "CONSENT_SOURCE_INVALID"
    if (!isUtcTimestamp(updatedAt)) return "CONSENT_TIMESTAMP_INVALID"
    if (analytics == null && personalisation == null && researchContact == null && marketing == null) return "CONSENT_PURPOSE_REQUIRED"
    return null
}

internal fun isUtcTimestamp(value: String): Boolean =
    Regex("^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{1,9})?Z$").matches(value) &&
        runCatching { java.time.Instant.parse(value) }.isSuccess
