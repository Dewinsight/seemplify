import Foundation
import XCTest
@testable import SeemplifyJourney

final class JourneyClientTests: XCTestCase {
    private let now = Date(timeIntervalSince1970: 1_775_563_200)
    private let batchID = "00000000-0000-4000-8000-000000000999"

    func testCanonicalFixturesDecodeValidateAndRoundTrip() throws {
        let batchData = try fixture("batch")
        let resultData = try fixture("batch-result")
        let batch = try JourneyProtocol.decode(JourneyEventBatch.self, from: batchData)
        let result = try JourneyProtocol.decode(JourneyBatchResult.self, from: resultData)
        XCTAssertTrue(JourneyProtocol.validate(batch))
        XCTAssertTrue(JourneyProtocol.validate(result, expectedBatchId: batch.batchId))
        XCTAssertEqual(
            Set(JourneyEventCall.allCases.map(\.rawValue)),
            Set(["track", "identify", "alias", "group", "page", "screen", "consent", "metric"])
        )
        XCTAssertEqual(try jsonObject(batchData), try jsonObject(JourneyProtocol.encode(batch)))
        XCTAssertEqual(try jsonObject(resultData), try jsonObject(JourneyProtocol.encode(result)))
        for name in JourneyEventCall.allCases.map(\.rawValue) {
            let data = try fixture(name)
            let envelope = try JourneyProtocol.decode(JourneyEventEnvelope.self, from: data)
            XCTAssertTrue(JourneyProtocol.validate(envelope), "invalid canonical fixture: \(name)")
            XCTAssertEqual(try jsonObject(data), try jsonObject(JourneyProtocol.encode(envelope)))
        }
    }

    func testPublicKeyOnlyAndAllRequestedCallsUseCanonicalWireNames() async throws {
        let invalid = JourneyClient(configuration: configuration(
            key: "jsk_live.server.secret",
            transport: TestTransport([]),
            consent: grantedConsent()
        ))
        let invalidStatus = await invalid.status()
        XCTAssertFalse(invalidStatus.enabled)

        let legacy = JourneyClient(configuration: configuration(
            key: "sp_test_legacy",
            transport: TestTransport([]),
            consent: grantedConsent()
        ))
        let legacyStatus = await legacy.status()
        XCTAssertFalse(legacyStatus.enabled)

        var mismatchConfiguration = configuration(transport: TestTransport([]), consent: grantedConsent())
        mismatchConfiguration.environment = .production
        let mismatch = JourneyClient(configuration: mismatchConfiguration)
        let mismatchStatus = await mismatch.status()
        XCTAssertFalse(mismatchStatus.enabled)

        let transport = TestTransport([.acceptAll])
        let client = JourneyClient(configuration: configuration(transport: transport, consent: grantedConsent()))
        let anon = "anon_swift"
        _ = await client.track("mobile_started", properties: [
            "safe": .bool(true), "password": .string("remove")
        ], options: options(1, anonymousId: anon))
        _ = await client.identify(userId: "user_1", traits: ["role": .string("owner")], options: options(2, anonymousId: anon))
        _ = await client.alias(userId: "user_1", anonymousId: anon, options: options(3, anonymousId: anon))
        _ = await client.group(accountId: "account_1", traits: ["plan": .string("team")], options: options(4, anonymousId: anon, userId: "user_1"))
        _ = await client.page("Welcome", options: options(5, anonymousId: anon, context: pageContext()))
        _ = await client.screen("Setup", options: options(6, anonymousId: anon))
        _ = await client.consent(analytics: .granted, marketing: .denied, source: "settings", options: options(7, anonymousId: anon))
        _ = await client.metric(
            "workspace_activation_seconds",
            name: "time_to_activation",
            value: 183.5,
            unit: "seconds",
            dimensions: ["plan": .string("team"), "password": .string("remove")],
            options: options(8, anonymousId: anon, userId: "user_1")
        )
        let flush = await client.flush()
        XCTAssertEqual(flush, JourneyFlushResult(status: .sent, accepted: 8, dropped: 0, retained: 0))

        let recorded = await transport.recordedRequests()
        let request = try XCTUnwrap(recorded.first)
        let batch = try JourneyProtocol.decode(JourneyEventBatch.self, from: request.body)
        XCTAssertEqual(batch.events.map(\.call), [.track, .identify, .alias, .group, .page, .screen, .consent, .metric])
        XCTAssertEqual(batch.events.first?.properties, ["safe": .bool(true)])
        XCTAssertEqual(batch.events.last?.metric?.dimensions, ["plan": .string("team")])
        guard case .object(let page)? = batch.events[4].context?["page"] else { return XCTFail("missing page") }
        XCTAssertEqual(page["url"], .string("https://example.test/mobile?campaign=welcome"))
        XCTAssertEqual(request.headers["authorization"], "Bearer jpk_stg.swift_key_01.aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")
    }

    func testConsentGatesPersistenceAndTransportThenResetPurgesState() async throws {
        let transport = TestTransport([.acceptAll])
        let store = TestSecureStore()
        var config = configuration(transport: transport, consent: nil, store: store)
        config.beforeConsent = .bufferMemory
        let client = JourneyClient(configuration: config)
        let buffered = await client.track("before_consent", options: options(10, anonymousId: "anon_1"))
        XCTAssertEqual(buffered.status, .buffered)
        let beforeGrantStore = await store.snapshot()
        XCTAssertEqual(beforeGrantStore.2, 0)
        let beforeGrantFlush = await client.flush()
        XCTAssertEqual(beforeGrantFlush.status, .empty)
        let beforeGrantRequests = await transport.recordedRequests()
        XCTAssertTrue(beforeGrantRequests.isEmpty)

        let granted = await client.consent(
            analytics: .granted,
            source: "cmp",
            options: options(11, anonymousId: "anon_1")
        )
        XCTAssertEqual(granted.status, .queued)
        let afterGrantStore = await store.snapshot()
        XCTAssertNotNil(afterGrantStore.0)
        let afterGrantFlush = await client.flush()
        XCTAssertEqual(afterGrantFlush.accepted, 2)
        await client.reset()
        let resetStore = await store.snapshot()
        let resetStatus = await client.status()
        XCTAssertNil(resetStore.0)
        XCTAssertEqual(resetStatus.queued, 0)
    }

    func testConsentSupersedesPendingGrantAndWithdrawalRetainsOnlyRevocationSubject() async throws {
        let transport = TestTransport([.acceptAll])
        let store = TestSecureStore()
        let client = JourneyClient(configuration: configuration(
            transport: transport,
            consent: nil,
            store: store
        ))
        let granted = await client.consent(
            analytics: .granted,
            source: "cmp",
            options: options(12, anonymousId: "anon_withdrawal")
        )
        XCTAssertEqual(granted.status, .queued)
        let denied = await client.consent(
            analytics: .denied,
            source: "cmp",
            options: options(13, anonymousId: "anon_withdrawal")
        )
        XCTAssertEqual(denied.status, .queued)
        let beforeFlushStore = await store.snapshot()
        XCTAssertNil(beforeFlushStore.0)

        let flush = await client.flush()
        XCTAssertEqual(flush.accepted, 1)
        let requests = await transport.recordedRequests()
        let request = try XCTUnwrap(requests.first)
        let batch = try JourneyProtocol.decode(JourneyEventBatch.self, from: request.body)
        XCTAssertEqual(batch.events.count, 1)
        XCTAssertEqual(batch.events.first?.call, .consent)
        XCTAssertEqual(batch.events.first?.consent?.analytics, .denied)
        XCTAssertEqual(batch.events.first?.anonymousId, "anon_withdrawal")
        let status = await client.status()
        XCTAssertEqual(status.queued, 0)
    }

    func testOfflineReconnectFlushesThroughInjectedNetworkHook() async throws {
        let network = TestNetwork(online: false)
        let transport = TestTransport([.acceptAll])
        var config = configuration(transport: transport, consent: grantedConsent())
        config.network = network
        let client = JourneyClient(configuration: config)
        _ = await client.track("offline_event", options: options(20, anonymousId: "anon_1"))
        let offline = await client.flush()
        XCTAssertEqual(offline.status, .offline)
        network.emit(true)
        for _ in 0..<10 {
            if !(await transport.recordedRequests()).isEmpty { break }
            await Task.yield()
        }
        let requests = await transport.recordedRequests()
        let status = await client.status()
        XCTAssertEqual(requests.count, 1)
        XCTAssertEqual(status.queued, 0)
    }

    func testPartialResultsRetryOnlyMissingStableEventAndAcceptDuplicate() async throws {
        let clock = TestClock(now)
        let transport = TestTransport([.partial, .duplicateAll])
        let client = JourneyClient(configuration: configuration(
            transport: transport,
            consent: grantedConsent(),
            clock: clock
        ))
        for number in 30...32 {
            _ = await client.track("partial_\(number)", options: options(number, anonymousId: "anon_1"))
        }
        let partial = await client.flush()
        XCTAssertEqual(partial, JourneyFlushResult(status: .retryScheduled, accepted: 1, dropped: 1, retained: 1))
        clock.advance(1)
        let duplicate = await client.flush()
        XCTAssertEqual(duplicate.accepted, 1)
        let requests = await transport.recordedRequests()
        let first = try JourneyProtocol.decode(JourneyEventBatch.self, from: requests[0].body)
        let second = try JourneyProtocol.decode(JourneyEventBatch.self, from: requests[1].body)
        XCTAssertEqual(first.events.map(\.eventId), [eventID(30), eventID(31), eventID(32)])
        XCTAssertEqual(second.events.map(\.eventId), [eventID(32)])
    }

    func testRetryAfterIsBoundedAndPreservesMessageID() async throws {
        let clock = TestClock(now)
        let transport = TestTransport([.http(429, retryAfter: "2"), .duplicateAll])
        let client = JourneyClient(configuration: configuration(
            transport: transport,
            consent: grantedConsent(),
            clock: clock
        ))
        _ = await client.track("rate_limited", options: options(40, anonymousId: "anon_1"))
        let first = await client.flush()
        XCTAssertEqual(first.status, .retryScheduled)
        clock.advance(1)
        let waiting = await client.flush()
        XCTAssertEqual(waiting.status, .retryScheduled)
        clock.advance(1)
        let duplicate = await client.flush()
        XCTAssertEqual(duplicate.accepted, 1)
        let requests = await transport.recordedRequests()
        XCTAssertEqual(requests.count, 2)
        for request in requests {
            let batch = try JourneyProtocol.decode(JourneyEventBatch.self, from: request.body)
            XCTAssertEqual(batch.events.first?.eventId, eventID(40))
        }
    }

    func testCorruptAndUnsupportedStoredStateAreRemovedAtUpgradeBoundary() async throws {
        for data in [Data("not-json".utf8), try JourneyProtocol.encode([
            "storageVersion": JourneyJSONValue.number(99),
            "protocolVersion": .string(JourneyProtocol.version),
            "entries": .array([])
        ])] {
            let store = TestSecureStore(data: data)
            let client = JourneyClient(configuration: configuration(
                transport: TestTransport([]), consent: grantedConsent(), store: store
            ))
            let status = await client.status()
            let snapshot = await store.snapshot()
            XCTAssertTrue(status.enabled)
            XCTAssertNil(snapshot.0)
            XCTAssertGreaterThanOrEqual(snapshot.3, 1)
        }
    }

    func testFailingSecureStoreAndUnverifiedStoreDisableWithoutMemoryFallback() async throws {
        let invalid = TestSecureStore(guarantees: .init(encryptedAtRest: true, atomicReplacement: false))
        let invalidClient = JourneyClient(configuration: configuration(
            transport: TestTransport([]), consent: grantedConsent(), store: invalid
        ))
        let invalidStatus = await invalidClient.status()
        XCTAssertFalse(invalidStatus.enabled)
        XCTAssertEqual(invalidStatus.persistence, .unavailable)

        let failing = TestSecureStore()
        await failing.setFailReplace(true)
        let client = JourneyClient(configuration: configuration(
            transport: TestTransport([]), consent: grantedConsent(), store: failing
        ))
        let failedTrack = await client.track("cannot_persist", options: options(50, anonymousId: "anon_1"))
        let failedStatus = await client.status()
        XCTAssertEqual(failedTrack.status, .dropped)
        XCTAssertFalse(failedStatus.enabled)
        XCTAssertEqual(failedStatus.queued, 0)
    }

    func testHostLifecycleAndTransportFailuresRemainContainedWithSafeDiagnostics() async throws {
        let diagnostics = DiagnosticRecorder()
        var config = configuration(
            transport: TestTransport([.failure]),
            consent: grantedConsent(),
            retry: JourneyRetryConfiguration(maximumAttempts: 1)
        )
        config.lifecycle = ThrowingLifecycle()
        config.debug = true
        config.environment = .staging
        config.diagnosticHandler = { diagnostics.append($0) }
        let client = JourneyClient(configuration: config)
        _ = await client.track("host_failure", properties: ["secret": .string("remove")], options: options(60, anonymousId: "anon_1"))
        let flush = await client.flush()
        let status = await client.status()
        XCTAssertEqual(flush.dropped, 1)
        XCTAssertTrue(status.enabled)
        let encoded = String(describing: diagnostics.values())
        XCTAssertFalse(encoded.contains("host_failure"))
        XCTAssertFalse(encoded.contains("remove"))
    }

    private func configuration(
        key: String = "jpk_stg.swift_key_01.aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        transport: any JourneyTransport,
        consent: JourneyConsent?,
        store: (any JourneySecureStore)? = nil,
        clock: any JourneyClock? = nil,
        retry: JourneyRetryConfiguration = .init(baseDelay: 1, maximumDelay: 10, jitterRatio: 0)
    ) -> JourneyClientConfiguration {
        JourneyClientConfiguration(
            writeKey: key,
            endpoint: URL(string: "https://ingest.example.test")!,
            environment: .staging,
            initialConsent: consent,
            secureStore: store,
            retry: retry,
            delivery: .init(foregroundFlushInterval: nil),
            privacy: .init(allowedURLQueryParameters: ["campaign"]),
            transport: transport,
            clock: clock ?? TestClock(now),
            idGenerator: FixedID(value: batchID),
            randomSource: FixedRandom(value: 0.5)
        )
    }

    private func grantedConsent() -> JourneyConsent {
        JourneyConsent(
            analytics: .granted,
            source: "test",
            updatedAt: "2026-08-04T12:00:00.000Z"
        )
    }

    private func options(
        _ number: Int,
        anonymousId: String,
        userId: String? = nil,
        context: JourneyJSONObject? = nil
    ) -> JourneyEventOptions {
        JourneyEventOptions(
            eventId: eventID(number),
            occurredAt: now,
            anonymousId: anonymousId,
            userId: userId,
            context: context
        )
    }

    private func eventID(_ number: Int) -> String {
        "00000000-0000-4000-8000-\(String(format: "%012d", number))"
    }

    private func pageContext() -> JourneyJSONObject {
        ["page": .object([
            "url": .string("https://user:password@example.test/mobile?campaign=welcome&token=remove#private")
        ])]
    }

    private func fixture(_ name: String) throws -> Data {
        let url = Bundle.module.url(forResource: name, withExtension: "json", subdirectory: "Fixtures")
            ?? Bundle.module.url(forResource: name, withExtension: "json")
        return try Data(contentsOf: XCTUnwrap(url))
    }

    private func jsonObject(_ data: Data) throws -> NSDictionary {
        try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? NSDictionary)
    }
}

final class DiagnosticRecorder: @unchecked Sendable {
    private let lock = NSLock()
    private var entries: [JourneyDiagnostic] = []
    func append(_ value: JourneyDiagnostic) { lock.testWithLock { entries.append(value) } }
    func values() -> [JourneyDiagnostic] { lock.testWithLock { entries } }
}
