import Foundation

public enum JourneyJSONValue: Codable, Sendable, Equatable {
    case null
    case bool(Bool)
    case number(Double)
    case string(String)
    case array([JourneyJSONValue])
    case object([String: JourneyJSONValue])

    public init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if container.decodeNil() { self = .null }
        else if let value = try? container.decode(Bool.self) { self = .bool(value) }
        else if let value = try? container.decode(Double.self) { self = .number(value) }
        else if let value = try? container.decode(String.self) { self = .string(value) }
        else if let value = try? container.decode([JourneyJSONValue].self) { self = .array(value) }
        else if let value = try? container.decode([String: JourneyJSONValue].self) { self = .object(value) }
        else {
            throw DecodingError.dataCorruptedError(in: container, debugDescription: "Unsupported JSON value")
        }
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case .null: try container.encodeNil()
        case .bool(let value): try container.encode(value)
        case .number(let value): try container.encode(value)
        case .string(let value): try container.encode(value)
        case .array(let value): try container.encode(value)
        case .object(let value): try container.encode(value)
        }
    }
}

public typealias JourneyJSONObject = [String: JourneyJSONValue]

public enum JourneyEventCall: String, Codable, CaseIterable, Sendable, Equatable {
    case track, identify, alias, group, page, screen, consent, metric
}

public enum JourneyConsentState: String, Codable, Sendable, Equatable {
    case granted, denied, unknown
}

public struct JourneyConsent: Codable, Sendable, Equatable {
    public var analytics: JourneyConsentState?
    public var personalisation: JourneyConsentState?
    public var researchContact: JourneyConsentState?
    public var marketing: JourneyConsentState?
    public var source: String
    public var updatedAt: String

    public init(
        analytics: JourneyConsentState? = nil,
        personalisation: JourneyConsentState? = nil,
        researchContact: JourneyConsentState? = nil,
        marketing: JourneyConsentState? = nil,
        source: String,
        updatedAt: String
    ) {
        self.analytics = analytics
        self.personalisation = personalisation
        self.researchContact = researchContact
        self.marketing = marketing
        self.source = source
        self.updatedAt = updatedAt
    }
}

public struct JourneyOperationalMetric: Codable, Sendable, Equatable {
    public var name: String
    public var value: Double
    public var unit: String?
    public var dimensions: JourneyJSONObject?

    public init(
        name: String,
        value: Double,
        unit: String? = nil,
        dimensions: JourneyJSONObject? = nil
    ) {
        self.name = name
        self.value = value
        self.unit = unit
        self.dimensions = dimensions
    }
}

public struct JourneyEventEnvelope: Codable, Sendable, Equatable {
    public var protocolVersion: String
    public var eventId: String
    public var call: JourneyEventCall
    public var occurredAt: String
    public var sentAt: String?
    public var anonymousId: String?
    public var userId: String?
    public var accountId: String?
    public var sessionId: String?
    public var event: String?
    public var eventVersion: Int?
    public var properties: JourneyJSONObject?
    public var traits: JourneyJSONObject?
    public var context: JourneyJSONObject?
    public var consent: JourneyConsent?
    public var metric: JourneyOperationalMetric?

    public init(
        protocolVersion: String = JourneyProtocol.version,
        eventId: String,
        call: JourneyEventCall,
        occurredAt: String,
        sentAt: String? = nil,
        anonymousId: String? = nil,
        userId: String? = nil,
        accountId: String? = nil,
        sessionId: String? = nil,
        event: String? = nil,
        eventVersion: Int? = nil,
        properties: JourneyJSONObject? = nil,
        traits: JourneyJSONObject? = nil,
        context: JourneyJSONObject? = nil,
        consent: JourneyConsent? = nil,
        metric: JourneyOperationalMetric? = nil
    ) {
        self.protocolVersion = protocolVersion
        self.eventId = eventId
        self.call = call
        self.occurredAt = occurredAt
        self.sentAt = sentAt
        self.anonymousId = anonymousId
        self.userId = userId
        self.accountId = accountId
        self.sessionId = sessionId
        self.event = event
        self.eventVersion = eventVersion
        self.properties = properties
        self.traits = traits
        self.context = context
        self.consent = consent
        self.metric = metric
    }
}

public struct JourneyEventBatch: Codable, Sendable, Equatable {
    public var protocolVersion: String
    public var batchId: String
    public var sentAt: String
    public var events: [JourneyEventEnvelope]
}

public enum JourneyIngestStatus: String, Codable, Sendable, Equatable {
    case accepted, duplicate, quarantined, rejected
}

public struct JourneyEventResult: Codable, Sendable, Equatable {
    public var eventId: String
    public var index: Int?
    public var status: JourneyIngestStatus
    public var duplicate: Bool
    public var retryable: Bool
    public var receivedAt: String
    public var code: String?
    public var message: String?
}

public struct JourneyBatchResult: Codable, Sendable, Equatable {
    public var protocolVersion: String
    public var batchId: String
    public var results: [JourneyEventResult]
}

public struct JourneyEventOptions: Sendable, Equatable {
    public var eventId: String?
    public var occurredAt: Date?
    public var anonymousId: String?
    public var userId: String?
    public var accountId: String?
    public var sessionId: String?
    public var context: JourneyJSONObject?
    public var eventVersion: Int

    public init(
        eventId: String? = nil,
        occurredAt: Date? = nil,
        anonymousId: String? = nil,
        userId: String? = nil,
        accountId: String? = nil,
        sessionId: String? = nil,
        context: JourneyJSONObject? = nil,
        eventVersion: Int = 1
    ) {
        self.eventId = eventId
        self.occurredAt = occurredAt
        self.anonymousId = anonymousId
        self.userId = userId
        self.accountId = accountId
        self.sessionId = sessionId
        self.context = context
        self.eventVersion = eventVersion
    }
}

public enum JourneyEnqueueStatus: String, Sendable, Equatable {
    case queued, buffered, dropped, invalid, disabled, destroyed
}

public struct JourneyEnqueueResult: Sendable, Equatable {
    public var status: JourneyEnqueueStatus
    public var code: String
    public var eventId: String?
}

public enum JourneyFlushStatus: String, Sendable, Equatable {
    case sent, empty, offline, deferred, retryScheduled, disabled, destroyed
}

public struct JourneyFlushResult: Sendable, Equatable {
    public var status: JourneyFlushStatus
    public var accepted: Int
    public var dropped: Int
    public var retained: Int
}

public struct JourneyDiagnostic: Sendable, Equatable {
    public var code: String
    public var count: Int?
    public var delayMilliseconds: Int?
    public var httpStatus: Int?

    public init(code: String, count: Int? = nil, delayMilliseconds: Int? = nil, httpStatus: Int? = nil) {
        self.code = code
        self.count = count
        self.delayMilliseconds = delayMilliseconds
        self.httpStatus = httpStatus
    }
}

public enum JourneyPersistenceStatus: String, Sendable, Equatable {
    case secure, memory, unavailable
}

public enum JourneyAppState: String, Sendable, Equatable {
    case active, inactive, background
}

public struct JourneyClientStatus: Sendable, Equatable {
    public var enabled: Bool
    public var queued: Int
    public var buffered: Int
    public var online: Bool
    public var appState: JourneyAppState
    public var persistence: JourneyPersistenceStatus
}
