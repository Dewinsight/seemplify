import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

public struct JourneyTransportRequest: Sendable {
    public var url: URL
    public var headers: [String: String]
    public var body: Data
    public var timeout: TimeInterval
}

public struct JourneyTransportResponse: Sendable {
    public var statusCode: Int
    public var headers: [String: String]
    public var body: Data

    public init(statusCode: Int, headers: [String: String] = [:], body: Data) {
        self.statusCode = statusCode
        self.headers = headers.reduce(into: [:]) { result, entry in
            result[entry.key.lowercased()] = entry.value
        }
        self.body = body
    }

    public func header(_ name: String) -> String? { headers[name.lowercased()] }
}

public protocol JourneyTransport: Sendable {
    func send(_ request: JourneyTransportRequest) async throws -> JourneyTransportResponse
}

public final class URLSessionJourneyTransport: JourneyTransport, @unchecked Sendable {
    private let session: URLSession

    public init(session: URLSession = .shared) { self.session = session }

    public func send(_ request: JourneyTransportRequest) async throws -> JourneyTransportResponse {
        var value = URLRequest(url: request.url, timeoutInterval: request.timeout)
        value.httpMethod = "POST"
        value.httpBody = request.body
        request.headers.forEach { value.setValue($0.value, forHTTPHeaderField: $0.key) }
        let (data, response) = try await session.data(for: value)
        guard let http = response as? HTTPURLResponse else { throw JourneyRuntimeError.invalidResponse }
        let headers = http.allHeaderFields.reduce(into: [String: String]()) { result, pair in
            result[String(describing: pair.key).lowercased()] = String(describing: pair.value)
        }
        return JourneyTransportResponse(statusCode: http.statusCode, headers: headers, body: data)
    }
}

public protocol JourneyClock: Sendable {
    func now() -> Date
    func sleep(for interval: TimeInterval) async throws
}

public struct SystemJourneyClock: JourneyClock {
    public init() {}
    public func now() -> Date { Date() }
    public func sleep(for interval: TimeInterval) async throws {
        let bounded = interval.isFinite ? max(0, min(interval, 86_400)) : 0
        try await Task.sleep(nanoseconds: UInt64(bounded * 1_000_000_000))
    }
}

public protocol JourneyIDGenerator: Sendable { func makeID() -> String }
public struct SystemJourneyIDGenerator: JourneyIDGenerator {
    public init() {}
    public func makeID() -> String { UUID().uuidString.lowercased() }
}

public protocol JourneyRandomSource: Sendable { func unitInterval() -> Double }
public struct SystemJourneyRandomSource: JourneyRandomSource {
    public init() {}
    public func unitInterval() -> Double { Double.random(in: 0..<1) }
}

public protocol JourneyObservation: AnyObject, Sendable { func cancel() }

public protocol JourneyLifecycleSource: Sendable {
    func currentState() throws -> JourneyAppState
    func observe(_ handler: @escaping @Sendable (JourneyAppState) -> Void) throws -> any JourneyObservation
}

public protocol JourneyNetworkSource: Sendable {
    func isOnline() throws -> Bool
    func observe(_ handler: @escaping @Sendable (Bool) -> Void) throws -> any JourneyObservation
}

public enum JourneyRuntimeError: Error { case invalidResponse }
