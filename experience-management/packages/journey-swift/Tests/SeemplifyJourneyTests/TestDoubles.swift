import Foundation
@testable import SeemplifyJourney

enum TestFailure: Error { case requested }

final class TestClock: JourneyClock, @unchecked Sendable {
    private let lock = NSLock()
    private var value: Date
    init(_ value: Date) { self.value = value }
    func now() -> Date { lock.testWithLock { value } }
    func advance(_ seconds: TimeInterval) { lock.testWithLock { value.addTimeInterval(seconds) } }
    func sleep(for interval: TimeInterval) async throws { throw CancellationError() }
}

struct FixedRandom: JourneyRandomSource { let value: Double; func unitInterval() -> Double { value } }
struct FixedID: JourneyIDGenerator { let value: String; func makeID() -> String { value } }

enum TestTransportAction: Sendable {
    case acceptAll
    case duplicateAll
    case partial
    case http(Int, retryAfter: String?)
    case failure
}

actor TestTransport: JourneyTransport {
    private var actions: [TestTransportAction]
    private var requests: [JourneyTransportRequest] = []

    init(_ actions: [TestTransportAction]) { self.actions = actions }

    func send(_ request: JourneyTransportRequest) async throws -> JourneyTransportResponse {
        requests.append(request)
        let action = actions.isEmpty ? .acceptAll : actions.removeFirst()
        if case .failure = action { throw TestFailure.requested }
        if case .http(let status, let retryAfter) = action {
            return JourneyTransportResponse(
                statusCode: status,
                headers: retryAfter.map { ["retry-after": $0] } ?? [:],
                body: Data()
            )
        }
        let batch = try JourneyProtocol.decode(JourneyEventBatch.self, from: request.body)
        let results: [JourneyEventResult]
        switch action {
        case .acceptAll:
            results = batch.events.enumerated().map { receipt($0.element, index: $0.offset, status: .accepted) }
        case .duplicateAll:
            results = batch.events.enumerated().map { receipt($0.element, index: $0.offset, status: .duplicate) }
        case .partial:
            results = batch.events.enumerated().compactMap { index, event in
                if index == 0 { return receipt(event, index: index, status: .accepted) }
                if index == 1 {
                    return JourneyEventResult(
                        eventId: event.eventId,
                        index: index,
                        status: .rejected,
                        duplicate: false,
                        retryable: false,
                        receivedAt: "2026-08-04T12:00:01.000Z",
                        code: "TEST_REJECTED"
                    )
                }
                return nil
            }
        case .failure, .http:
            results = []
        }
        return JourneyTransportResponse(
            statusCode: results.count == batch.events.count ? 202 : 207,
            body: try JourneyProtocol.encode(JourneyBatchResult(
                protocolVersion: JourneyProtocol.version,
                batchId: batch.batchId,
                results: results
            ))
        )
    }

    func recordedRequests() -> [JourneyTransportRequest] { requests }

    private func receipt(
        _ event: JourneyEventEnvelope,
        index: Int,
        status: JourneyIngestStatus
    ) -> JourneyEventResult {
        JourneyEventResult(
            eventId: event.eventId,
            index: index,
            status: status,
            duplicate: status == .duplicate,
            retryable: false,
            receivedAt: "2026-08-04T12:00:01.000Z"
        )
    }
}

actor TestSecureStore: JourneySecureStore {
    nonisolated let guarantees: JourneySecureStoreGuarantees
    private(set) var data: Data?
    private(set) var reads = 0
    private(set) var replacements = 0
    private(set) var removals = 0
    var failRead = false
    var failReplace = false
    var failRemove = false

    init(
        data: Data? = nil,
        guarantees: JourneySecureStoreGuarantees = .init(encryptedAtRest: true, atomicReplacement: true)
    ) {
        self.data = data
        self.guarantees = guarantees
    }

    func read(key: String) async throws -> Data? {
        reads += 1
        if failRead { throw TestFailure.requested }
        return data
    }

    func replace(key: String, with data: Data) async throws {
        replacements += 1
        if failReplace { throw TestFailure.requested }
        self.data = data
    }

    func remove(key: String) async throws {
        removals += 1
        if failRemove { throw TestFailure.requested }
        data = nil
    }

    func setFailReplace(_ value: Bool) { failReplace = value }
    func snapshot() -> (Data?, Int, Int, Int) { (data, reads, replacements, removals) }
}

final class TestObservation: JourneyObservation, @unchecked Sendable {
    private let cancelHandler: @Sendable () -> Void
    init(_ cancelHandler: @escaping @Sendable () -> Void) { self.cancelHandler = cancelHandler }
    func cancel() { cancelHandler() }
}

final class TestNetwork: JourneyNetworkSource, @unchecked Sendable {
    private let lock = NSLock()
    private var online: Bool
    private var handlers: [UUID: @Sendable (Bool) -> Void] = [:]
    init(online: Bool) { self.online = online }
    func isOnline() throws -> Bool { lock.testWithLock { online } }
    func observe(_ handler: @escaping @Sendable (Bool) -> Void) throws -> any JourneyObservation {
        let id = UUID()
        lock.testWithLock { handlers[id] = handler }
        return TestObservation { [weak self] in
            guard let self else { return }
            self.lock.testWithLock { _ = self.handlers.removeValue(forKey: id) }
        }
    }
    func emit(_ value: Bool) {
        let callbacks = lock.testWithLock { () -> [@Sendable (Bool) -> Void] in
            online = value
            return Array(handlers.values)
        }
        callbacks.forEach { $0(value) }
    }
}

final class ThrowingLifecycle: JourneyLifecycleSource, @unchecked Sendable {
    func currentState() throws -> JourneyAppState { throw TestFailure.requested }
    func observe(_ handler: @escaping @Sendable (JourneyAppState) -> Void) throws -> any JourneyObservation {
        throw TestFailure.requested
    }
}

extension NSLock {
    func testWithLock<Value>(_ action: () -> Value) -> Value {
        lock()
        defer { unlock() }
        return action()
    }
}
