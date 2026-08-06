package com.seemplify.journey

import java.net.URI
import java.text.SimpleDateFormat
import java.time.Instant
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import kotlin.math.min
import kotlin.math.pow
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.SerializationException
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.JsonObject

private const val STORED_STATE_VERSION = 1
private const val SIZING_BATCH_ID = "00000000-0000-4000-8000-000000000000"

@Serializable
private data class QueueEntry(
    val event: JourneyEventEnvelope,
    val enqueuedAt: Long,
    val attempts: Int = 0,
    val nextAttemptAt: Long = 0,
    val purpose: String = "analytics",
)

@Serializable
private data class StoredState(
    val version: Int = STORED_STATE_VERSION,
    val protocolVersion: String = JOURNEY_PROTOCOL_VERSION,
    val anonymousId: String? = null,
    val userId: String? = null,
    val consent: ConsentSnapshot? = null,
    val entries: List<QueueEntry> = emptyList(),
)

/**
 * Private, unreleased Android/Kotlin foundation for the canonical Journey
 * Event Protocol. The client contains host failures and never logs payloads,
 * identities, endpoints, keys, response bodies, or exception text.
 */
public class JourneyClient(public val config: JourneyClientConfig) : AutoCloseable {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private val stateMutex = Mutex()
    private val flushMutex = Mutex()
    private val subscriptions = mutableListOf<JourneySubscription>()
    private val queue = mutableListOf<QueueEntry>()
    private val buffered = mutableListOf<QueueEntry>()
    private val queueOptions = boundedQueue(config.queue)
    private val batchOptions = boundedBatch(config.batch)
    private val retryOptions = boundedRetry(config.retry)
    private val batchEndpoint = batchEndpoint(config.endpoint)
    private val credentialEnvironment = publicWriteKeyEnvironment(config.writeKey)

    @Volatile private var enabledState: Boolean = credentialEnvironment != null
        && (config.environment == null || config.environment == credentialEnvironment)
        && batchEndpoint != null
    @Volatile private var closed: Boolean = false
    private var currentConsent: ConsentSnapshot? = config.consent
    private var anonymousId: String? = null
    private var userId: String? = null
    @Volatile private var appState: JourneyAppState = config.lifecycle?.currentState() ?: JourneyAppState.FOREGROUND
    @Volatile private var online: Boolean = config.network?.isOnline() ?: true

    private val initialisation = scope.async {
        initialise()
    }

    init {
        if (credentialEnvironment == null) diagnostic("PUBLIC_WRITE_KEY_INVALID")
        if (credentialEnvironment != null && config.environment != null && config.environment != credentialEnvironment) {
            diagnostic("CREDENTIAL_ENVIRONMENT_MISMATCH")
        }
        if (batchEndpoint == null) diagnostic("ENDPOINT_INVALID")
        attachHostHooks()
    }

    public val enabled: Boolean get() = enabledState && !closed

    public suspend fun track(
        event: String,
        properties: Map<String, Any?>? = null,
        options: EventOptions = EventOptions(),
    ): EnqueueResult = enqueue("track", event, properties, null, options)

    public suspend fun metric(
        event: String,
        name: String,
        value: Double,
        unit: String? = null,
        dimensions: Map<String, Any?>? = null,
        options: EventOptions = EventOptions(),
    ): EnqueueResult {
        val safeDimensions = sanitiseProperties(dimensions, config.privacy)
        if ((safeDimensions?.removed ?: 0) > 0) diagnostic("PROPERTIES_MINIMISED", count = safeDimensions?.removed)
        return enqueue(
            call = "metric",
            event = event,
            properties = null,
            traits = null,
            options = options,
            metric = OperationalMetric(name.take(128), value, unit?.take(64), safeDimensions?.value),
        )
    }

    public suspend fun identify(
        identifiedUserId: String,
        traits: Map<String, Any?>? = null,
        options: EventOptions = EventOptions(),
    ): EnqueueResult = enqueue("identify", null, null, traits, options.copy(userId = identifiedUserId))

    public suspend fun alias(
        identifiedUserId: String,
        aliasedAnonymousId: String? = null,
        options: EventOptions = EventOptions(),
    ): EnqueueResult {
        awaitReady()
        return stateMutex.withLock {
            val resolved = aliasedAnonymousId ?: options.anonymousId ?: anonymousId
            enqueueLocked("alias", null, null, null, options.copy(userId = identifiedUserId, anonymousId = resolved))
        }
    }

    public suspend fun group(
        accountId: String,
        traits: Map<String, Any?>? = null,
        options: EventOptions = EventOptions(),
    ): EnqueueResult = enqueue("group", null, null, traits, options.copy(accountId = accountId))

    public suspend fun page(
        name: String? = null,
        properties: Map<String, Any?>? = null,
        options: EventOptions = EventOptions(),
    ): EnqueueResult = enqueue("page", null, namedProperties(name, properties), null, options)

    public suspend fun screen(
        name: String? = null,
        properties: Map<String, Any?>? = null,
        options: EventOptions = EventOptions(),
    ): EnqueueResult = enqueue("screen", null, namedProperties(name, properties), null, options)

    public suspend fun consent(
        input: ConsentInput,
        options: EventOptions = EventOptions(),
    ): EnqueueResult {
        awaitReady()
        return stateMutex.withLock {
            if (!enabled) return@withLock disabledResult()
            var priorAnonymousId = options.anonymousId ?: anonymousId
            val priorUserId = options.userId ?: userId
            val snapshot = ConsentSnapshot(
                analytics = input.analytics,
                personalisation = input.personalisation,
                researchContact = input.researchContact,
                marketing = input.marketing,
                source = input.source,
                updatedAt = input.updatedAt ?: timestamp(config.clock.nowMillis()),
            )
            if (priorAnonymousId == null && priorUserId == null && options.accountId == null && options.sessionId == null) {
                priorAnonymousId = newIdOrNull()
                    ?: return@withLock invalid("EVENT_ID_GENERATION_FAILED", null)
            }
            val eventId = options.eventId ?: newIdOrNull()
                ?: return@withLock invalid("EVENT_ID_GENERATION_FAILED", null)
            val preparedOptions = options.copy(
                eventId = eventId,
                anonymousId = priorAnonymousId,
                userId = priorUserId,
            )
            val preview = JourneyEventEnvelope(
                eventId = eventId,
                call = "consent",
                occurredAt = preparedOptions.occurredAt ?: timestamp(config.clock.nowMillis()),
                anonymousId = priorAnonymousId,
                userId = priorUserId,
                accountId = preparedOptions.accountId,
                sessionId = preparedOptions.sessionId,
                context = sanitiseContext(preparedOptions.context, config.privacy),
                consent = snapshot,
            )
            preview.validationCode()?.let { return@withLock invalid(it, eventId) }
            val duplicate = (queue + buffered).firstOrNull { it.event.eventId == eventId }
            if (duplicate != null) {
                return@withLock if (journeyJson.encodeToString(duplicate.event) == journeyJson.encodeToString(preview)) {
                    EnqueueResult("queued", "ALREADY_QUEUED", eventId)
                } else invalid("EVENT_ID_CONFLICT", eventId)
            }

            currentConsent = snapshot
            // Only the latest unsent consent snapshot is authoritative. Keeping
            // an older pending grant beside a newer denial could let the server
            // observe stale consent after the application has already revoked it.
            queue.removeAll { it.event.call == "consent" }
            val bufferedCopy = if (snapshot.analytics == ConsentState.GRANTED) buffered.toList() else emptyList()
            if (snapshot.analytics == ConsentState.DENIED) {
                queue.removeAll { it.purpose == "analytics" }
                buffered.clear()
                anonymousId = null
                userId = null
            } else if (snapshot.analytics == ConsentState.GRANTED) {
                buffered.clear()
            }
            val result = enqueueLocked(
                call = "consent",
                event = null,
                properties = null,
                traits = null,
                options = preparedOptions,
                consentOverride = snapshot,
                purpose = "control",
                updateIdentity = snapshot.analytics != ConsentState.DENIED,
            )
            if (result.status == "queued" && bufferedCopy.isNotEmpty()) {
                bufferedCopy.forEach { entry ->
                    addToQueueLocked(entry.copy(event = entry.event.copy(consent = snapshot)))
                }
                if (!persistLocked()) return@withLock EnqueueResult("dropped", "SECURE_STORAGE_COMMIT_FAILED", eventId)
            }
            result
        }
    }

    public suspend fun flush(): FlushResult {
        awaitReady()
        if (!enabled) return FlushResult("disabled", 0, 0, queue.size)
        if (!online) return FlushResult("offline", 0, 0, status().queued)
        return flushMutex.withLock { flushOnce(batchOptions.maxBytes) }
    }

    public suspend fun reset() {
        awaitReady()
        stateMutex.withLock {
            queue.clear()
            buffered.clear()
            anonymousId = null
            userId = null
            currentConsent = config.consent
            if (config.storage != null) {
                try {
                    config.storage.remove()
                } catch (_: Throwable) {
                    disableForStorageLocked("SECURE_STORAGE_REMOVE_FAILED")
                }
            }
            outcome("reset", "RESET_COMPLETE")
        }
    }

    public suspend fun status(): JourneyClientStatus {
        awaitReady()
        return stateMutex.withLock {
            JourneyClientStatus(
                enabled = enabled,
                queued = queue.size,
                buffered = buffered.size,
                online = online,
                appState = appState,
                persistence = when {
                    config.storage == null -> "memory"
                    enabledState -> "secure"
                    else -> "unavailable"
                },
            )
        }
    }

    override fun close() {
        if (closed) return
        closed = true
        subscriptions.toList().forEach { subscription -> runCatching { subscription.close() } }
        subscriptions.clear()
        scope.cancel()
    }

    private suspend fun enqueue(
        call: String,
        event: String?,
        properties: Map<String, Any?>?,
        traits: Map<String, Any?>?,
        options: EventOptions,
        metric: OperationalMetric? = null,
    ): EnqueueResult {
        awaitReady()
        return stateMutex.withLock { enqueueLocked(call, event, properties, traits, options, metric = metric) }
    }

    private suspend fun enqueueLocked(
        call: String,
        event: String?,
        properties: Map<String, Any?>?,
        traits: Map<String, Any?>?,
        options: EventOptions,
        consentOverride: ConsentSnapshot? = currentConsent,
        purpose: String = "analytics",
        metric: OperationalMetric? = null,
        updateIdentity: Boolean = true,
    ): EnqueueResult {
        if (!enabled) return disabledResult()
        pruneExpiredLocked()

        val safeProperties = sanitiseProperties(properties, config.privacy)
        val safeTraits = sanitiseProperties(traits, config.privacy)
        val removed = (safeProperties?.removed ?: 0) + (safeTraits?.removed ?: 0)
        if (removed > 0) diagnostic("PROPERTIES_MINIMISED", count = removed)

        var resolvedAnonymous = options.anonymousId ?: anonymousId
        val resolvedUser = options.userId ?: userId
        val resolvedAccount = options.accountId
        if (resolvedAnonymous == null && resolvedUser == null && resolvedAccount == null && options.sessionId == null) {
            resolvedAnonymous = newIdOrNull()
        }
        val eventId = options.eventId ?: newIdOrNull()
            ?: return invalid("EVENT_ID_GENERATION_FAILED", null)
        val envelope = JourneyEventEnvelope(
            eventId = eventId,
            call = call,
            occurredAt = options.occurredAt ?: timestamp(config.clock.nowMillis()),
            anonymousId = resolvedAnonymous,
            userId = resolvedUser,
            accountId = resolvedAccount,
            sessionId = options.sessionId,
            event = event,
            eventVersion = if (call in setOf("track", "metric")) options.eventVersion else null,
            properties = safeProperties?.value,
            traits = safeTraits?.value,
            context = sanitiseContext(options.context, config.privacy),
            consent = consentOverride,
            metric = metric,
        )
        envelope.validationCode()?.let { return invalid(it, eventId) }

        val duplicate = (queue + buffered).firstOrNull { it.event.eventId == eventId }
        if (duplicate != null) {
            return if (journeyJson.encodeToString(duplicate.event) == journeyJson.encodeToString(envelope)) {
                EnqueueResult("queued", "ALREADY_QUEUED", eventId)
            } else invalid("EVENT_ID_CONFLICT", eventId)
        }

        if (purpose == "analytics" && currentConsent?.analytics != ConsentState.GRANTED) {
            val explicitlyDenied = currentConsent?.analytics == ConsentState.DENIED
            if (explicitlyDenied || config.beforeConsent != PreConsentBehaviour.BUFFER_MEMORY) {
                outcome("dropped", "ANALYTICS_CONSENT_NOT_GRANTED", eventId)
                return EnqueueResult("dropped", "ANALYTICS_CONSENT_NOT_GRANTED", eventId)
            }
            val entry = QueueEntry(envelope, config.clock.nowMillis(), purpose = purpose)
            val added = addToBufferLocked(entry)
            if (added) {
                anonymousId = resolvedAnonymous
                if (call == "identify") userId = resolvedUser
                outcome("buffered", "BUFFERED_BEFORE_CONSENT", eventId)
                return EnqueueResult("buffered", "BUFFERED_BEFORE_CONSENT", eventId)
            }
            return EnqueueResult("dropped", "PRECONSENT_BUFFER_FULL", eventId)
        }

        val entry = QueueEntry(envelope, config.clock.nowMillis(), purpose = purpose)
        if (!addToQueueLocked(entry, prioritise = purpose == "control")) return EnqueueResult("dropped", "QUEUE_LIMIT_REACHED", eventId)
        if (updateIdentity) {
            anonymousId = resolvedAnonymous
            if (call == "identify" || call == "alias") userId = resolvedUser
        }
        if (!persistLocked()) return EnqueueResult("dropped", "SECURE_STORAGE_COMMIT_FAILED", eventId)
        outcome("queued", "QUEUED", eventId)
        return EnqueueResult("queued", "QUEUED", eventId)
    }

    private fun addToBufferLocked(entry: QueueEntry): Boolean {
        val bytes = encodedBytes(entry.event)
        if (bytes > queueOptions.maxBytes || bytes > batchOptions.maxBytes) return false
        while (buffered.size >= queueOptions.maxEvents || totalBytes(buffered) + bytes > queueOptions.maxBytes) {
            if (config.queue.overflow == QueueOverflowBehaviour.DROP_NEWEST || buffered.isEmpty()) return false
            val removed = buffered.removeAt(0)
            outcome("dropped", "PRECONSENT_BUFFER_OVERFLOW", removed.event.eventId)
        }
        buffered += entry
        return true
    }

    private fun addToQueueLocked(entry: QueueEntry, prioritise: Boolean = false): Boolean {
        val bytes = encodedBytes(entry.event)
        if (bytes > queueOptions.maxBytes || bytes > batchOptions.maxBytes) {
            outcome("dropped", "EVENT_EXCEEDS_QUEUE_OR_BATCH_BYTES", entry.event.eventId)
            return false
        }
        while (queue.size >= queueOptions.maxEvents || totalBytes(queue) + bytes > queueOptions.maxBytes) {
            if ((!prioritise && queueOptions.overflow == QueueOverflowBehaviour.DROP_NEWEST) || queue.isEmpty()) {
                outcome("dropped", "QUEUE_LIMIT_REACHED", entry.event.eventId)
                return false
            }
            val analyticsIndex = queue.indexOfFirst { it.purpose == "analytics" }
            if (!prioritise && analyticsIndex < 0) {
                outcome("dropped", "QUEUE_LIMIT_REACHED", entry.event.eventId)
                return false
            }
            val removableIndex = analyticsIndex.takeIf { it >= 0 } ?: 0
            val removed = queue.removeAt(removableIndex)
            outcome("dropped", "QUEUE_OVERFLOW", removed.event.eventId)
        }
        queue += entry
        return true
    }

    private suspend fun flushOnce(maximumBytes: Int): FlushResult {
        val now = config.clock.nowMillis()
        var expired = 0
        val selection = stateMutex.withLock {
            expired = pruneExpiredLocked()
            val selected = mutableListOf<QueueEntry>()
            for (entry in queue) {
                if (entry.nextAttemptAt > now) continue
                val candidate = selected + entry
                if (candidate.size > batchOptions.maxEvents) break
                val batch = JourneyEventBatch(
                    batchId = SIZING_BATCH_ID,
                    sentAt = timestamp(now),
                    events = candidate.map { it.event },
                )
                if (journeyJson.encodeToString(batch).encodeToByteArray().size > min(maximumBytes, batchOptions.maxBytes)) break
                selected += entry
            }
            if (expired > 0) persistLocked()
            selected
        }
        if (selection.isEmpty()) {
            val retained = stateMutex.withLock { queue.size }
            return FlushResult(if (retained > 0) "deferred" else "empty", 0, expired, retained)
        }

        val batchId = newIdOrNull() ?: return retrySelection(selection, null, "BATCH_ID_GENERATION_FAILED", expired)
        val sentAt = timestamp(config.clock.nowMillis())
        val batch = JourneyEventBatch(batchId = batchId, sentAt = sentAt, events = selection.map { it.event })
        val body = journeyJson.encodeToString(batch).encodeToByteArray()
        val response = try {
            config.http.post(
                url = batchEndpoint!!,
                headers = mapOf(
                    "authorization" to "Bearer ${config.writeKey}",
                    "content-type" to "application/json",
                    "accept" to "application/json",
                    "user-agent" to "$JOURNEY_KOTLIN_SDK_NAME/$JOURNEY_KOTLIN_SDK_VERSION",
                ),
                body = body,
            )
        } catch (_: Throwable) {
            return retrySelection(selection, null, "TRANSPORT_FAILED", expired)
        }

        if (response.status !in setOf(200, 202, 207)) {
            val retryable = response.status == 408 || response.status == 429 || response.status >= 500
            return if (retryable) {
                retrySelection(selection, retryAfterMs(response.header("retry-after"), now), "HTTP_RETRYABLE", expired, response.status)
            } else {
                dropSelection(selection, "HTTP_REJECTED", expired, response.status)
            }
        }

        val result = try {
            journeyJson.decodeFromString(BatchIngestResult.serializer(), response.body.decodeToString())
        } catch (_: Throwable) {
            return retrySelection(selection, null, "RESPONSE_INVALID", expired, response.status)
        }
        if (result.protocolVersion != JOURNEY_PROTOCOL_VERSION || result.batchId != batchId ||
            result.results.map { it.eventId }.distinct().size != result.results.size
        ) {
            return retrySelection(selection, null, "RESPONSE_CONTRACT_INVALID", expired, response.status)
        }

        var accepted = 0
        var dropped = expired
        var scheduled = 0
        stateMutex.withLock {
            val resultById = result.results.associateBy { it.eventId }
            selection.forEach { selected ->
                val currentIndex = queue.indexOfFirst { it.event.eventId == selected.event.eventId }
                if (currentIndex < 0) return@forEach
                val receipt = resultById[selected.event.eventId]
                when {
                    receipt != null && receipt.status in setOf("accepted", "duplicate") -> {
                        queue.removeAt(currentIndex)
                        accepted += 1
                    }
                    receipt != null && !receipt.retryable -> {
                        queue.removeAt(currentIndex)
                        dropped += 1
                        outcome("dropped", receipt.code ?: "EVENT_REJECTED", selected.event.eventId)
                    }
                    else -> {
                        val updated = scheduleEntry(queue[currentIndex], null)
                        if (updated == null) {
                            queue.removeAt(currentIndex)
                            dropped += 1
                        } else {
                            queue[currentIndex] = updated
                            scheduled += 1
                        }
                    }
                }
            }
            persistLocked()
        }
        return FlushResult(
            status = if (scheduled > 0) "retry_scheduled" else "sent",
            accepted = accepted,
            dropped = dropped,
            retained = stateMutex.withLock { queue.size },
        )
    }

    private suspend fun retrySelection(
        selection: List<QueueEntry>,
        retryAfter: Long?,
        code: String,
        alreadyDropped: Int,
        status: Int? = null,
    ): FlushResult {
        var dropped = alreadyDropped
        var scheduled = 0
        var maximumDelay = 0L
        stateMutex.withLock {
            selection.forEach { selected ->
                val index = queue.indexOfFirst { it.event.eventId == selected.event.eventId }
                if (index < 0) return@forEach
                val updated = scheduleEntry(queue[index], retryAfter)
                if (updated == null) {
                    queue.removeAt(index)
                    dropped += 1
                    outcome("dropped", "RETRY_EXHAUSTED", selected.event.eventId)
                } else {
                    maximumDelay = maxOf(maximumDelay, updated.nextAttemptAt - config.clock.nowMillis())
                    queue[index] = updated
                    scheduled += 1
                }
            }
            persistLocked()
        }
        diagnostic(code, count = selection.size, status = status, delayMs = maximumDelay.takeIf { scheduled > 0 })
        return FlushResult(
            status = if (scheduled > 0) "retry_scheduled" else "sent",
            accepted = 0,
            dropped = dropped,
            retained = stateMutex.withLock { queue.size },
        )
    }

    private suspend fun dropSelection(
        selection: List<QueueEntry>,
        code: String,
        alreadyDropped: Int,
        status: Int,
    ): FlushResult {
        var dropped = alreadyDropped
        stateMutex.withLock {
            val ids = selection.map { it.event.eventId }.toSet()
            val before = queue.size
            queue.removeAll { it.event.eventId in ids }
            dropped += before - queue.size
            persistLocked()
        }
        diagnostic(code, count = selection.size, status = status)
        return FlushResult("sent", 0, dropped, stateMutex.withLock { queue.size })
    }

    private fun scheduleEntry(entry: QueueEntry, retryAfter: Long?): QueueEntry? {
        val attempts = entry.attempts + 1
        if (attempts >= retryOptions.maxAttempts) return null
        val base = min(retryOptions.maxDelayMs.toDouble(), retryOptions.baseDelayMs * 2.0.pow((attempts - 1).toDouble()))
        val jitter = base * retryOptions.jitterRatio * ((config.random.nextDouble().coerceIn(0.0, 1.0) * 2) - 1)
        val calculated = (base + jitter).toLong().coerceIn(0, retryOptions.maxDelayMs)
        val delay = maxOf(calculated, retryAfter ?: 0).coerceAtMost(retryOptions.maxDelayMs)
        return entry.copy(attempts = attempts, nextAttemptAt = config.clock.nowMillis() + delay)
    }

    private suspend fun initialise() {
        if (!enabledState) return
        val storage = config.storage ?: return
        val guarantees = runCatching { storage.guarantees }.getOrNull()
        if (guarantees?.encryptedAtRest != true || guarantees.atomicCommit != true || guarantees.crashSafe != true) {
            stateMutex.withLock { disableForStorageLocked("SECURE_STORAGE_CONTRACT_INVALID") }
            return
        }
        val raw = try {
            storage.read()
        } catch (_: Throwable) {
            stateMutex.withLock { disableForStorageLocked("SECURE_STORAGE_READ_FAILED") }
            return
        } ?: return

        val restored = try {
            journeyJson.decodeFromString(StoredState.serializer(), raw)
        } catch (_: SerializationException) {
            clearCorruptStore(storage, "SECURE_STORAGE_CORRUPT")
            return
        } catch (_: Throwable) {
            stateMutex.withLock { disableForStorageLocked("SECURE_STORAGE_READ_FAILED") }
            return
        }
        if (restored.version != STORED_STATE_VERSION || restored.protocolVersion != JOURNEY_PROTOCOL_VERSION) {
            clearCorruptStore(storage, "SECURE_STORAGE_VERSION_UNSUPPORTED")
            return
        }
        if (restored.entries.any { it.event.validationCode() != null || it.purpose !in setOf("analytics", "control") }) {
            clearCorruptStore(storage, "SECURE_STORAGE_STATE_INVALID")
            return
        }
        stateMutex.withLock {
            anonymousId = restored.anonymousId
            userId = restored.userId
            currentConsent = config.consent ?: restored.consent
            queue += restored.entries
            pruneExpiredLocked()
            if (currentConsent?.analytics == ConsentState.DENIED) queue.removeAll { it.purpose == "analytics" }
            persistLocked()
        }
    }

    private suspend fun clearCorruptStore(storage: SecureJourneyQueueStore, code: String) {
        try {
            storage.remove()
            diagnostic(code)
        } catch (_: Throwable) {
            stateMutex.withLock { disableForStorageLocked("SECURE_STORAGE_REMOVE_FAILED") }
        }
    }

    private suspend fun persistLocked(): Boolean {
        val storage = config.storage ?: return true
        val state = StoredState(
            anonymousId = anonymousId,
            userId = userId,
            consent = currentConsent,
            entries = queue.toList(),
        )
        return try {
            storage.commit(journeyJson.encodeToString(state))
            true
        } catch (_: Throwable) {
            disableForStorageLocked("SECURE_STORAGE_COMMIT_FAILED")
            false
        }
    }

    private suspend fun disableForStorageLocked(code: String) {
        enabledState = false
        queue.clear()
        buffered.clear()
        anonymousId = null
        userId = null
        diagnostic(code)
        runCatching { config.storage?.remove() }
    }

    private fun pruneExpiredLocked(): Int {
        val cutoff = config.clock.nowMillis() - queueOptions.maxAgeMs
        val before = queue.size
        queue.removeAll { it.enqueuedAt <= cutoff }
        val bufferBefore = buffered.size
        buffered.removeAll { it.enqueuedAt <= cutoff }
        val removed = (before - queue.size) + (bufferBefore - buffered.size)
        if (removed > 0) diagnostic("QUEUE_ENTRIES_EXPIRED", count = removed)
        return removed
    }

    private fun attachHostHooks() {
        config.lifecycle?.let { lifecycle ->
            runCatching {
                subscriptions += lifecycle.subscribe { state ->
                    appState = state
                    val shouldFlush = (state == JourneyAppState.BACKGROUND && config.delivery.flushOnBackground) ||
                        (state == JourneyAppState.FOREGROUND && config.delivery.flushOnForeground)
                    if (shouldFlush) scope.launch {
                        runCatching {
                            awaitReady()
                            flushMutex.withLock { flushOnce(if (state == JourneyAppState.BACKGROUND) config.delivery.backgroundBatchBytes else batchOptions.maxBytes) }
                        }.onFailure { diagnostic("LIFECYCLE_FLUSH_FAILED") }
                    }
                }
            }.onFailure { diagnostic("LIFECYCLE_ADAPTER_FAILED") }
        }
        config.network?.let { network ->
            runCatching {
                subscriptions += network.subscribe { connected ->
                    val reconnected = !online && connected
                    online = connected
                    if (reconnected && config.delivery.flushOnNetworkReconnect) scope.launch {
                        runCatching { flush() }.onFailure { diagnostic("NETWORK_FLUSH_FAILED") }
                    }
                }
            }.onFailure { diagnostic("NETWORK_ADAPTER_FAILED") }
        }
    }

    private suspend fun awaitReady() {
        runCatching { initialisation.await() }.onFailure {
            stateMutex.withLock { disableForStorageLocked("INITIALISATION_FAILED") }
        }
    }

    private fun newIdOrNull(): String? = runCatching { config.ids.nextId() }
        .getOrNull()?.takeIf { canonicalUuid.matches(it) }

    private fun invalid(code: String, eventId: String?): EnqueueResult {
        diagnostic(code)
        outcome("invalid", code, eventId)
        return EnqueueResult("invalid", code, eventId)
    }

    private fun disabledResult(): EnqueueResult = EnqueueResult("disabled", if (closed) "CLIENT_CLOSED" else "CLIENT_DISABLED")

    private fun diagnostic(code: String, count: Int? = null, status: Int? = null, delayMs: Long? = null) {
        val callback = config.diagnostics ?: return
        runCatching { callback.onDiagnostic(JourneyDiagnostic(code, count, status, delayMs)) }
    }

    private fun outcome(kind: String, code: String, eventId: String? = null, count: Int? = null) {
        val callback = config.diagnostics ?: return
        runCatching { callback.onOutcome(JourneyOutcome(kind, code, eventId, count)) }
    }

    private fun encodedBytes(event: JourneyEventEnvelope): Int = journeyJson.encodeToString(event).encodeToByteArray().size
    private fun totalBytes(entries: List<QueueEntry>): Int = entries.sumOf { encodedBytes(it.event) }
}

private fun namedProperties(name: String?, properties: Map<String, Any?>?): Map<String, Any?>? {
    if (name == null) return properties
    return linkedMapOf<String, Any?>("name" to name).apply { if (properties != null) putAll(properties) }
}

private fun publicWriteKeyEnvironment(value: String): JourneyEnvironment? {
    val match = Regex("^jpk_(dev|stg|live)\\.([A-Za-z0-9][A-Za-z0-9_:-]{0,127})\\.([A-Za-z0-9_-]{32,256})$")
        .matchEntire(value) ?: return null
    return when (match.groupValues[1]) {
        "live" -> JourneyEnvironment.PRODUCTION
        "stg" -> JourneyEnvironment.STAGING
        else -> JourneyEnvironment.DEVELOPMENT
    }
}

private fun batchEndpoint(value: String): String? = runCatching {
    val uri = URI(value)
    val loopback = uri.host in setOf("127.0.0.1", "localhost", "::1")
    require(uri.scheme == "https" || (uri.scheme == "http" && loopback))
    require(uri.userInfo == null && uri.query == null && uri.fragment == null && !uri.host.isNullOrBlank())
    if (uri.path.endsWith("/v1/batch")) uri.toASCIIString() else value.trimEnd('/') + "/v1/batch"
}.getOrNull()

private fun boundedQueue(input: QueueOptions): QueueOptions = input.copy(
    maxEvents = input.maxEvents.coerceIn(1, 20_000),
    maxBytes = input.maxBytes.coerceIn(1_024, 20 * 1024 * 1024),
    maxAgeMs = input.maxAgeMs.coerceIn(1_000, 30L * 24 * 60 * 60 * 1_000),
)

private fun boundedBatch(input: BatchOptions): BatchOptions = input.copy(
    maxEvents = input.maxEvents.coerceIn(1, MAX_BATCH_EVENTS),
    maxBytes = input.maxBytes.coerceIn(1_024, MAX_BATCH_BYTES),
)

private fun boundedRetry(input: RetryOptions): RetryOptions = input.copy(
    maxAttempts = input.maxAttempts.coerceIn(1, 20),
    baseDelayMs = input.baseDelayMs.coerceIn(10, 60_000),
    maxDelayMs = input.maxDelayMs.coerceIn(100, 60 * 60 * 1_000),
    jitterRatio = input.jitterRatio.coerceIn(0.0, 1.0),
)

private fun timestamp(milliseconds: Long): String = Instant.ofEpochMilli(milliseconds).toString()

private fun retryAfterMs(value: String?, now: Long): Long? {
    if (value == null) return null
    value.trim().toLongOrNull()?.let { return (it.coerceAtLeast(0) * 1_000).coerceAtMost(60 * 60 * 1_000) }
    val format = SimpleDateFormat("EEE, dd MMM yyyy HH:mm:ss zzz", Locale.US).apply {
        timeZone = TimeZone.getTimeZone("GMT")
        isLenient = false
    }
    return runCatching { (format.parse(value)?.time ?: return null) - now }
        .getOrNull()?.coerceIn(0, 60 * 60 * 1_000)
}
