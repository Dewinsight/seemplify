import Foundation

public struct JourneySecureStoreGuarantees: Sendable, Equatable {
    public let encryptedAtRest: Bool
    public let atomicReplacement: Bool

    public init(encryptedAtRest: Bool, atomicReplacement: Bool) {
        self.encryptedAtRest = encryptedAtRest
        self.atomicReplacement = atomicReplacement
    }
}

public protocol JourneySecureStore: Sendable {
    var guarantees: JourneySecureStoreGuarantees { get }
    func read(key: String) async throws -> Data?
    func replace(key: String, with data: Data) async throws
    func remove(key: String) async throws
}

enum JourneyStoredPurpose: String, Codable, Sendable, Equatable { case analytics, control }

struct JourneyStoredEntry: Codable, Sendable {
    var event: JourneyEventEnvelope
    var enqueuedAt: TimeInterval
    var attempts: Int
    var nextAttemptAt: TimeInterval
    var purpose: JourneyStoredPurpose
}

struct JourneyStoredState: Codable, Sendable {
    static let version = 1
    var storageVersion: Int
    var protocolVersion: String
    var anonymousId: String?
    var entries: [JourneyStoredEntry]
}
