package com.seemplify.journey

import java.security.SecureRandom
import java.util.UUID
import kotlinx.coroutines.delay as coroutineDelay

public fun interface JourneyClock {
    public fun nowMillis(): Long
}

public fun interface JourneyIdGenerator {
    public fun nextId(): String
}

public fun interface JourneyRandom {
    public fun nextDouble(): Double
}

public fun interface JourneyDelay {
    public suspend fun wait(milliseconds: Long)
}

public fun interface JourneyHttpClient {
    public suspend fun post(
        url: String,
        headers: Map<String, String>,
        body: ByteArray,
    ): JourneyHttpResponse
}

public data class JourneyHttpResponse(
    val status: Int,
    val headers: Map<String, String> = emptyMap(),
    val body: ByteArray = byteArrayOf(),
) {
    public fun header(name: String): String? = headers.entries.firstOrNull {
        it.key.equals(name, ignoreCase = true)
    }?.value
}

public data class StorageGuarantees(
    val encryptedAtRest: Boolean,
    val atomicCommit: Boolean,
    val crashSafe: Boolean,
)

public interface SecureJourneyQueueStore {
    public val guarantees: StorageGuarantees
    public suspend fun read(): String?
    public suspend fun commit(value: String)
    public suspend fun remove()
}

public enum class JourneyAppState { FOREGROUND, BACKGROUND }

public fun interface JourneySubscription {
    public fun close()
}

public interface JourneyLifecycle {
    public fun currentState(): JourneyAppState
    public fun subscribe(listener: (JourneyAppState) -> Unit): JourneySubscription
}

public interface JourneyNetwork {
    public fun isOnline(): Boolean
    public fun subscribe(listener: (Boolean) -> Unit): JourneySubscription
}

public interface JourneyDiagnostics {
    /** Metadata only. Implementations must not receive payloads, IDs, keys, URLs, or exceptions. */
    public fun onDiagnostic(diagnostic: JourneyDiagnostic)
    public fun onOutcome(outcome: JourneyOutcome) {}
}

public data class JourneyDiagnostic(
    val code: String,
    val count: Int? = null,
    val status: Int? = null,
    val delayMs: Long? = null,
)

public data class JourneyOutcome(
    val kind: String,
    val code: String,
    val eventId: String? = null,
    val count: Int? = null,
)

public enum class PreConsentBehaviour { DROP, BUFFER_MEMORY }
public enum class QueueOverflowBehaviour { DROP_OLDEST, DROP_NEWEST }
public enum class JourneyEnvironment { DEVELOPMENT, STAGING, PRODUCTION }

public data class QueueOptions(
    val maxEvents: Int = 2_000,
    val maxBytes: Int = 2 * 1024 * 1024,
    val maxAgeMs: Long = 24 * 60 * 60 * 1_000L,
    val overflow: QueueOverflowBehaviour = QueueOverflowBehaviour.DROP_OLDEST,
)

public data class BatchOptions(
    val maxEvents: Int = 50,
    val maxBytes: Int = 256 * 1024,
)

public data class RetryOptions(
    val maxAttempts: Int = 5,
    val baseDelayMs: Long = 1_000,
    val maxDelayMs: Long = 60_000,
    val jitterRatio: Double = 0.2,
)

public data class DeliveryOptions(
    val flushOnBackground: Boolean = true,
    val flushOnForeground: Boolean = true,
    val flushOnNetworkReconnect: Boolean = true,
    val backgroundBatchBytes: Int = 60_000,
)

public data class PrivacyOptions(
    val deniedPropertyNames: Set<String> = emptySet(),
    val allowedUrlQueryParameters: Set<String> = emptySet(),
)

public data class JourneyClientConfig(
    /** Public write-only key. Values resembling server secrets are rejected. */
    val writeKey: String,
    val endpoint: String,
    /** When supplied, this must match the environment encoded in writeKey. */
    val environment: JourneyEnvironment? = null,
    val consent: ConsentSnapshot? = null,
    val beforeConsent: PreConsentBehaviour = PreConsentBehaviour.DROP,
    val storage: SecureJourneyQueueStore? = null,
    val queue: QueueOptions = QueueOptions(),
    val batch: BatchOptions = BatchOptions(),
    val retry: RetryOptions = RetryOptions(),
    val delivery: DeliveryOptions = DeliveryOptions(),
    val privacy: PrivacyOptions = PrivacyOptions(),
    val http: JourneyHttpClient,
    val clock: JourneyClock = JourneyClock { System.currentTimeMillis() },
    val ids: JourneyIdGenerator = JourneyIdGenerator { UUID.randomUUID().toString() },
    val random: JourneyRandom = secureJourneyRandom(),
    val delay: JourneyDelay = JourneyDelay { coroutineDelay(it) },
    val lifecycle: JourneyLifecycle? = null,
    val network: JourneyNetwork? = null,
    val diagnostics: JourneyDiagnostics? = null,
)

private fun secureJourneyRandom(): JourneyRandom {
    val source = SecureRandom()
    return JourneyRandom { source.nextDouble() }
}

public data class EventOptions(
    val eventId: String? = null,
    val occurredAt: String? = null,
    val anonymousId: String? = null,
    val userId: String? = null,
    val accountId: String? = null,
    val sessionId: String? = null,
    val context: JourneyContext? = null,
    val eventVersion: Int = 1,
)

public data class ConsentInput(
    val analytics: ConsentState? = null,
    val personalisation: ConsentState? = null,
    val researchContact: ConsentState? = null,
    val marketing: ConsentState? = null,
    val source: String,
    val updatedAt: String? = null,
)

public data class EnqueueResult(
    val status: String,
    val code: String,
    val eventId: String? = null,
)

public data class FlushResult(
    val status: String,
    val accepted: Int,
    val dropped: Int,
    val retained: Int,
)

public data class JourneyClientStatus(
    val enabled: Boolean,
    val queued: Int,
    val buffered: Int,
    val online: Boolean,
    val appState: JourneyAppState,
    val persistence: String,
)
