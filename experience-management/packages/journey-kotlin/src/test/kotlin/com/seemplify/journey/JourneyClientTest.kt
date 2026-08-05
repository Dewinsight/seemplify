package com.seemplify.journey

import java.util.concurrent.CopyOnWriteArraySet
import java.util.concurrent.atomic.AtomicInteger
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.jsonObject
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

private const val BASE_TIME = 1_785_844_096_123L

private class TestClock(var value: Long = BASE_TIME) : JourneyClock {
    override fun nowMillis(): Long = value
}

private class TestIds(start: Int = 1) : JourneyIdGenerator {
    private val initial = start
    private val next = AtomicInteger(start)
    val calls: Int get() = next.get() - initial
    override fun nextId(): String = "00000000-0000-4000-8000-${next.getAndIncrement().toString().padStart(12, '0')}"
}

private class TestStore(
    override val guarantees: StorageGuarantees = StorageGuarantees(true, true, true),
) : SecureJourneyQueueStore {
    var value: String? = null
    var commits = 0
    var removals = 0
    var failRead = false
    var failCommit = false
    var failRemove = false

    override suspend fun read(): String? {
        if (failRead) error("host read failed with private content")
        return value
    }

    override suspend fun commit(value: String) {
        if (failCommit) error("host commit failed with private content")
        this.value = value
        commits += 1
    }

    override suspend fun remove() {
        if (failRemove) error("host remove failed with private content")
        value = null
        removals += 1
    }
}

private class TestNetwork(var online: Boolean = true) : JourneyNetwork {
    private val listeners = CopyOnWriteArraySet<(Boolean) -> Unit>()
    override fun isOnline(): Boolean = online
    override fun subscribe(listener: (Boolean) -> Unit): JourneySubscription {
        listeners += listener
        return JourneySubscription { listeners -= listener }
    }
    fun emit(value: Boolean) {
        online = value
        listeners.forEach { it(value) }
    }
}

private class TestLifecycle(var state: JourneyAppState = JourneyAppState.FOREGROUND) : JourneyLifecycle {
    private val listeners = CopyOnWriteArraySet<(JourneyAppState) -> Unit>()
    override fun currentState(): JourneyAppState = state
    override fun subscribe(listener: (JourneyAppState) -> Unit): JourneySubscription {
        listeners += listener
        return JourneySubscription { listeners -= listener }
    }
    fun emit(value: JourneyAppState) {
        state = value
        listeners.forEach { it(value) }
    }
}

private class Diagnostics : JourneyDiagnostics {
    val diagnostics = mutableListOf<JourneyDiagnostic>()
    val outcomes = mutableListOf<JourneyOutcome>()
    var throwFromHost = false
    override fun onDiagnostic(diagnostic: JourneyDiagnostic) {
        diagnostics += diagnostic
        if (throwFromHost) error("host callback secret")
    }
    override fun onOutcome(outcome: JourneyOutcome) {
        outcomes += outcome
        if (throwFromHost) error("host callback secret")
    }
}

private fun accepted(batch: JourneyEventBatch, statuses: List<String> = batch.events.map { "accepted" }): JourneyHttpResponse {
    val result = BatchIngestResult(
        protocolVersion = JOURNEY_PROTOCOL_VERSION,
        batchId = batch.batchId,
        results = batch.events.mapIndexed { index, event ->
            EventIngestResult(
                eventId = event.eventId,
                index = index,
                status = statuses.getOrElse(index) { "accepted" },
                duplicate = statuses.getOrElse(index) { "accepted" } == "duplicate",
                retryable = false,
                receivedAt = "2026-08-04T12:34:57.000Z",
            )
        },
    )
    return JourneyHttpResponse(202, body = journeyJson.encodeToString(result).encodeToByteArray())
}

private fun config(
    http: JourneyHttpClient,
    clock: TestClock = TestClock(),
    ids: TestIds = TestIds(),
    storage: SecureJourneyQueueStore? = null,
    consent: ConsentSnapshot? = ConsentSnapshot(
        analytics = ConsentState.GRANTED,
        source = "test",
        updatedAt = "2026-08-04T12:30:00.000Z",
    ),
    network: JourneyNetwork? = null,
    lifecycle: JourneyLifecycle? = null,
    diagnostics: JourneyDiagnostics? = null,
    beforeConsent: PreConsentBehaviour = PreConsentBehaviour.DROP,
    queue: QueueOptions = QueueOptions(),
    batch: BatchOptions = BatchOptions(),
    retry: RetryOptions = RetryOptions(),
): JourneyClientConfig = JourneyClientConfig(
    writeKey = "jpk_stg.kotlin_key_01.aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    endpoint = "https://ingest.example.test",
    environment = JourneyEnvironment.STAGING,
    http = http,
    clock = clock,
    ids = ids,
    random = JourneyRandom { 0.5 },
    storage = storage,
    consent = consent,
    network = network,
    lifecycle = lifecycle,
    diagnostics = diagnostics,
    beforeConsent = beforeConsent,
    queue = queue,
    batch = batch,
    retry = retry,
)

class JourneyClientTest {
    @Test
    fun `rejects non-public keys remote plaintext and invalid secure storage without leaking diagnostics`() = runBlocking {
        val diagnostics = Diagnostics()
        val http = JourneyHttpClient { _, _, _ -> error("must not send") }
        val invalidKey = JourneyClient(config(http, diagnostics = diagnostics).copy(writeKey = "sk_live_server_secret"))
        assertFalse(invalidKey.enabled)
        assertEquals("disabled", invalidKey.track("must_not_send", options = EventOptions(userId = "user_1")).status)

        val legacyKey = JourneyClient(config(http).copy(writeKey = "sp_test_legacy"))
        assertFalse(legacyKey.enabled)

        val mismatchedEnvironment = JourneyClient(config(http).copy(environment = JourneyEnvironment.PRODUCTION))
        assertFalse(mismatchedEnvironment.enabled)

        val plaintext = JourneyClient(config(http).copy(endpoint = "http://example.test"))
        assertFalse(plaintext.enabled)

        val invalidStore = TestStore(StorageGuarantees(encryptedAtRest = true, atomicCommit = false, crashSafe = true))
        val stored = JourneyClient(config(http, storage = invalidStore, diagnostics = diagnostics))
        assertEquals("disabled", stored.track("must_not_persist", options = EventOptions(userId = "user_1")).status)
        assertEquals("unavailable", stored.status().persistence)
        val rendered = diagnostics.diagnostics.joinToString()
        assertFalse(rendered.contains("server_secret"))
        assertFalse(rendered.contains("must_not_persist"))
    }

    @Test
    fun `emits every canonical call with exact wire names minimised data and public-key auth`() = runBlocking {
        val requests = mutableListOf<Triple<String, Map<String, String>, JourneyEventBatch>>()
        val http = JourneyHttpClient { url, headers, body ->
            val batch = journeyJson.decodeFromString(JourneyEventBatch.serializer(), body.decodeToString())
            requests += Triple(url, headers, batch)
            accepted(batch)
        }
        val client = JourneyClient(config(http, ids = TestIds(10)))
        assertEquals("queued", client.track(
            "workspace_created",
            mapOf("safe" to true, "password" to "remove", "nested" to mapOf("device_id" to "remove", "kept" to "yes")),
            EventOptions(eventId = "018f4d85-4f31-7a1d-9f11-4d4ac3f10f48"),
        ).status)
        client.identify("customer_123", mapOf("plan" to "team"))
        client.alias("customer_123")
        client.group("company_456", mapOf("role" to "owner"))
        client.page(
            "Onboarding",
            options = EventOptions(
                context = JourneyContext(page = PageContext("https://u:p@example.test/path?campaign=hello&token=remove#secret")),
            ),
        )
        client.screen("Workspace setup")
        client.metric("workspace_activation_seconds", "time_to_activation", 183.5, "seconds", mapOf("plan" to "team"))
        client.consent(ConsentInput(marketing = ConsentState.DENIED, source = "settings"))
        val result = client.flush()
        assertEquals(8, result.accepted)
        val (url, headers, batch) = requests.single()
        assertEquals("https://ingest.example.test/v1/batch", url)
        assertEquals("Bearer jpk_stg.kotlin_key_01.aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", headers["authorization"])
        assertEquals(listOf("track", "identify", "alias", "group", "page", "screen", "metric", "consent"), batch.events.map { it.call })
        assertEquals("yes", batch.events.first().properties?.get("nested")?.toString()?.substringAfter("kept\":\"")?.substringBefore('"'))
        assertNull(batch.events.first().properties?.get("password"))
        assertEquals(JOURNEY_KOTLIN_SDK_NAME, batch.events.first().context?.library?.name)
        assertEquals("https://example.test/path", batch.events[4].context?.page?.url)
        assertEquals(183.5, batch.events[6].metric?.value)
        assertEquals(8, batch.events.map { it.eventId }.distinct().size)
    }

    @Test
    fun `buffers before consent only in memory then persists on grant and purges on denial and reset`() = runBlocking {
        val store = TestStore()
        val batches = mutableListOf<JourneyEventBatch>()
        val http = JourneyHttpClient { _, _, body ->
            val batch = journeyJson.decodeFromString(JourneyEventBatch.serializer(), body.decodeToString())
            batches += batch
            accepted(batch)
        }
        val client = JourneyClient(config(
            http = http,
            storage = store,
            consent = null,
            beforeConsent = PreConsentBehaviour.BUFFER_MEMORY,
        ))
        assertEquals("buffered", client.track("before_consent").status)
        assertEquals(0, store.commits)
        assertNull(store.value)
        assertEquals(1, client.status().buffered)

        client.consent(ConsentInput(analytics = ConsentState.GRANTED, source = "cmp"))
        assertTrue(store.commits > 0)
        assertEquals(0, client.status().buffered)
        assertEquals(2, client.status().queued)
        client.track("queued_private_fact")
        client.consent(ConsentInput(analytics = ConsentState.DENIED, source = "cmp"))
        assertEquals(1, client.status().queued)
        assertEquals("dropped", client.track("after_denial").status)
        val storedAfterDenial = journeyJson.parseToJsonElement(requireNotNull(store.value)).jsonObject
        assertNull(storedAfterDenial["anonymousId"])
        assertNull(storedAfterDenial["userId"])
        client.flush()
        assertEquals(listOf("consent"), batches.single().events.map { it.call })
        client.reset()
        assertNull(store.value)
        assertTrue(store.removals > 0)
    }

    @Test
    fun `invalid consent cannot mutate consent queue buffer or identity state`() = runBlocking {
        val store = TestStore()
        val http = JourneyHttpClient { _, _, body ->
            accepted(journeyJson.decodeFromString(JourneyEventBatch.serializer(), body.decodeToString()))
        }
        val client = JourneyClient(config(http, storage = store))
        client.track("before_invalid_consent", options = EventOptions(userId = "user_1"))

        val invalid = client.consent(ConsentInput(analytics = ConsentState.DENIED, source = ""))
        assertEquals("invalid", invalid.status)
        assertEquals("CONSENT_SOURCE_INVALID", invalid.code)
        assertEquals(1, client.status().queued)
        assertEquals("queued", client.track("after_invalid_consent", options = EventOptions(userId = "user_1")).status)
        assertEquals(2, client.status().queued)
    }

    @Test
    fun `batch sizing does not consume real IDs`() = runBlocking {
        val ids = TestIds(500)
        val http = JourneyHttpClient { _, _, body ->
            accepted(journeyJson.decodeFromString(JourneyEventBatch.serializer(), body.decodeToString()))
        }
        val client = JourneyClient(config(http, ids = ids))
        client.track(
            "single_event",
            options = EventOptions(
                eventId = "00000000-0000-4000-8000-000000000499",
                userId = "user_1",
            ),
        )
        assertEquals(1, client.flush().accepted)
        assertEquals(1, ids.calls)
    }

    @Test
    fun `preserves IDs through partial receipts exponential retry and Retry-After`() = runBlocking {
        val clock = TestClock()
        val sent = mutableListOf<List<String>>()
        var attempt = 0
        val http = JourneyHttpClient { _, _, body ->
            val batch = journeyJson.decodeFromString(JourneyEventBatch.serializer(), body.decodeToString())
            sent += batch.events.map { it.eventId }
            attempt += 1
            when (attempt) {
                1 -> {
                    val partial = BatchIngestResult(
                        JOURNEY_PROTOCOL_VERSION,
                        batch.batchId,
                        listOf(EventIngestResult(batch.events.first().eventId, 0, "accepted", false, false, "2026-08-04T12:34:57.000Z")),
                    )
                    JourneyHttpResponse(207, body = journeyJson.encodeToString(partial).encodeToByteArray())
                }
                2 -> JourneyHttpResponse(429, mapOf("Retry-After" to "2"))
                else -> accepted(batch, batch.events.map { "duplicate" })
            }
        }
        val client = JourneyClient(config(http, clock = clock, retry = RetryOptions(baseDelayMs = 100, maxDelayMs = 5_000, jitterRatio = 0.0)))
        val firstId = "00000000-0000-4000-8000-000000000101"
        val secondId = "00000000-0000-4000-8000-000000000102"
        client.track("first", options = EventOptions(eventId = firstId))
        client.track("second", options = EventOptions(eventId = secondId))
        assertEquals("retry_scheduled", client.flush().status)
        assertEquals(listOf(firstId, secondId), sent[0])
        clock.value += 100
        assertEquals("retry_scheduled", client.flush().status)
        assertEquals(listOf(secondId), sent[1])
        clock.value += 1_999
        assertEquals("deferred", client.flush().status)
        clock.value += 1
        assertEquals(1, client.flush().accepted)
        assertEquals(listOf(secondId), sent[2])
    }

    @Test
    fun `bounds duplicate queue count bytes and age deterministically`() = runBlocking {
        val clock = TestClock()
        var requests = 0
        val http = JourneyHttpClient { _, _, body ->
            requests += 1
            accepted(journeyJson.decodeFromString(JourneyEventBatch.serializer(), body.decodeToString()))
        }
        val client = JourneyClient(config(
            http = http,
            clock = clock,
            queue = QueueOptions(maxEvents = 2, maxBytes = 1_024, maxAgeMs = 1_000, overflow = QueueOverflowBehaviour.DROP_OLDEST),
            batch = BatchOptions(maxEvents = 2, maxBytes = 1_024),
        ))
        val id = "00000000-0000-4000-8000-000000000201"
        assertEquals("QUEUED", client.track("one", options = EventOptions(eventId = id)).code)
        assertEquals("ALREADY_QUEUED", client.track("one", options = EventOptions(eventId = id)).code)
        assertEquals("EVENT_ID_CONFLICT", client.track("changed", options = EventOptions(eventId = id)).code)
        client.track("two")
        client.track("three")
        assertEquals(2, client.status().queued)
        val oversized = client.track("oversized", mapOf("body" to "x".repeat(2_000)))
        assertEquals("dropped", oversized.status)
        clock.value += 1_000
        assertEquals("empty", client.flush().status)
        assertEquals(0, requests)
    }

    @Test
    fun `hydrates secure state and handles corruption upgrade and host storage failure without plaintext fallback`() = runBlocking {
        val http = JourneyHttpClient { _, _, body -> accepted(journeyJson.decodeFromString(JourneyEventBatch.serializer(), body.decodeToString())) }
        val store = TestStore()
        val first = JourneyClient(config(http, storage = store))
        first.track("persisted_event", options = EventOptions(userId = "user_1"))
        assertTrue(store.value?.contains("persisted_event") == true) // Test double is not the Android encrypted adapter.
        first.close()
        val restarted = JourneyClient(config(http, storage = store, ids = TestIds(100)))
        assertEquals(1, restarted.status().queued)
        assertEquals(1, restarted.flush().accepted)

        for (raw in listOf("not-json", "{\"version\":99,\"protocolVersion\":\"1.0\",\"entries\":[]}")) {
            val damaged = TestStore().apply { value = raw }
            val client = JourneyClient(config(http, storage = damaged))
            assertTrue(client.status().enabled)
            assertNull(damaged.value)
        }

        val failing = TestStore().apply { failCommit = true }
        val disabled = JourneyClient(config(http, storage = failing))
        assertEquals("dropped", disabled.track("cannot_commit", options = EventOptions(userId = "user_1")).status)
        assertFalse(disabled.status().enabled)
        assertEquals("unavailable", disabled.status().persistence)
    }

    @Test
    fun `contains transport adapter lifecycle network and diagnostic host failures`() = runBlocking {
        val network = TestNetwork(false)
        val lifecycle = TestLifecycle()
        val diagnostics = Diagnostics().apply { throwFromHost = true }
        var requests = 0
        var failTransport = true
        val http = JourneyHttpClient { _, _, body ->
            requests += 1
            if (failTransport) error("transport private response")
            accepted(journeyJson.decodeFromString(JourneyEventBatch.serializer(), body.decodeToString()))
        }
        val client = JourneyClient(config(http, network = network, lifecycle = lifecycle, diagnostics = diagnostics, retry = RetryOptions(baseDelayMs = 10, jitterRatio = 0.0)))
        client.track("host_failure_safe")
        assertEquals("offline", client.flush().status)
        network.emit(true)
        delay(50)
        assertEquals(1, requests)
        failTransport = false
        val clockField = client.config.clock as TestClock
        clockField.value += 10
        lifecycle.emit(JourneyAppState.BACKGROUND)
        delay(100)
        assertTrue(requests >= 2)
        assertEquals(0, client.status().queued)
        assertFalse(diagnostics.diagnostics.joinToString().contains("private"))
        client.close()
    }

    @Test
    fun `request body bytes remain stable across an immediate duplicate receipt`() = runBlocking {
        val bodies = mutableListOf<ByteArray>()
        val http = JourneyHttpClient { _, _, body ->
            bodies += body
            val batch = journeyJson.decodeFromString(JourneyEventBatch.serializer(), body.decodeToString())
            accepted(batch, listOf(if (bodies.size == 1) "accepted" else "duplicate"))
        }
        val client = JourneyClient(config(http))
        val id = "00000000-0000-4000-8000-000000000301"
        client.track("duplicate_safe", options = EventOptions(eventId = id))
        assertEquals(1, client.flush().accepted)
        client.track("duplicate_safe", options = EventOptions(eventId = id))
        assertEquals(1, client.flush().accepted)
        val first = journeyJson.decodeFromString(JourneyEventBatch.serializer(), bodies[0].decodeToString()).events.single()
        val second = journeyJson.decodeFromString(JourneyEventBatch.serializer(), bodies[1].decodeToString()).events.single()
        assertEquals(first, second)
        assertArrayEquals(journeyJson.encodeToString(first).encodeToByteArray(), journeyJson.encodeToString(second).encodeToByteArray())
    }
}
