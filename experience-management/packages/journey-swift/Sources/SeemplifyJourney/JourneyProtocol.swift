import Foundation

public enum JourneyProtocol {
    public static let version = "1.0"
    public static let maximumEnvelopeBytes = 64 * 1024
    public static let maximumBatchBytes = 512 * 1024
    public static let maximumBatchEvents = 100
    public static let maximumObjectProperties = 100
    public static let maximumArrayItems = 64
    public static let maximumNestingDepth = 8
    public static let maximumPropertyNameCharacters = 128
    public static let maximumStringCharacters = 4_096
    public static let maximumIdentifierCharacters = 256
    public static let maximumEventNameCharacters = 128

    private static let prohibitedPropertyNames = Set(["__proto__", "prototype", "constructor"])

    public static func validate(_ envelope: JourneyEventEnvelope) -> Bool {
        guard envelope.protocolVersion == version,
              validUUID(envelope.eventId),
              parseDate(envelope.occurredAt) != nil,
              envelope.sentAt.map({ parseDate($0) != nil }) ?? true,
              hasSubject(envelope),
              validIdentifier(envelope.anonymousId),
              validIdentifier(envelope.userId),
              validIdentifier(envelope.accountId),
              validIdentifier(envelope.sessionId),
              validateJSON(envelope.properties),
              validateJSON(envelope.traits),
              validateContext(envelope.context),
              envelope.consent.map(validateConsentSnapshot) ?? true,
              envelope.metric.map(validateMetric) ?? true
        else { return false }

        switch envelope.call {
        case .track:
            guard validEventName(envelope.event), (envelope.eventVersion ?? 0) >= 1 else { return false }
        case .identify:
            guard validRequiredIdentifier(envelope.userId) else { return false }
        case .alias:
            guard validRequiredIdentifier(envelope.userId), validRequiredIdentifier(envelope.anonymousId) else { return false }
        case .group:
            guard validRequiredIdentifier(envelope.accountId),
                  validRequiredIdentifier(envelope.userId) || validRequiredIdentifier(envelope.anonymousId)
            else { return false }
        case .consent:
            guard envelope.consent.map(validateConsentSnapshot) == true else { return false }
        case .metric:
            guard validEventName(envelope.event), (envelope.eventVersion ?? 0) >= 1,
                  envelope.metric.map(validateMetric) == true else { return false }
        case .page, .screen:
            break
        }

        guard let data = try? encode(envelope), data.count <= maximumEnvelopeBytes else { return false }
        return true
    }

    public static func validate(_ batch: JourneyEventBatch) -> Bool {
        guard batch.protocolVersion == version,
              validUUID(batch.batchId),
              parseDate(batch.sentAt) != nil,
              !batch.events.isEmpty,
              batch.events.count <= maximumBatchEvents,
              batch.events.allSatisfy { validate($0) }
        else { return false }
        guard Set(batch.events.map(\.eventId)).count == batch.events.count,
              let data = try? encode(batch), data.count <= maximumBatchBytes
        else { return false }
        return true
    }

    public static func validate(_ result: JourneyBatchResult, expectedBatchId: String) -> Bool {
        guard result.protocolVersion == version,
              result.batchId == expectedBatchId,
              validUUID(result.batchId),
              result.results.count <= maximumBatchEvents
        else { return false }
        return result.results.allSatisfy { entry in
            guard validUUID(entry.eventId),
                  entry.index.map({ $0 >= 0 }) ?? true,
                  parseDate(entry.receivedAt) != nil,
                  entry.duplicate == (entry.status == .duplicate),
                  entry.code.map(validResultCode) ?? true,
                  entry.message.map({ !$0.isEmpty && $0.count <= 500 }) ?? true
            else { return false }
            if entry.status == .quarantined || entry.status == .rejected {
                return entry.code != nil
            }
            return true
        }
    }

    public static func encode<Value: Encodable>(_ value: Value) throws -> Data {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        return try encoder.encode(value)
    }

    public static func decode<Value: Decodable>(_ type: Value.Type, from data: Data) throws -> Value {
        try JSONDecoder().decode(type, from: data)
    }

    public static func timestamp(_ date: Date) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        formatter.timeZone = TimeZone(secondsFromGMT: 0)
        return formatter.string(from: date)
    }

    private static func parseDate(_ value: String) -> Date? {
        guard value.range(
            of: "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{1,9})?Z$",
            options: .regularExpression
        ) != nil else { return nil }
        let fractional = ISO8601DateFormatter()
        fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = fractional.date(from: value) { return date }
        let ordinary = ISO8601DateFormatter()
        ordinary.formatOptions = [.withInternetDateTime]
        return ordinary.date(from: value)
    }

    private static func validUUID(_ value: String) -> Bool {
        value.range(
            of: "^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
            options: [.regularExpression, .caseInsensitive]
        ) != nil
    }

    private static func validResultCode(_ value: String) -> Bool {
        value.range(of: "^[A-Z][A-Z0-9_]{1,63}$", options: .regularExpression) != nil
    }

    private static func hasSubject(_ envelope: JourneyEventEnvelope) -> Bool {
        [envelope.anonymousId, envelope.userId, envelope.accountId, envelope.sessionId]
            .contains(where: validRequiredIdentifier)
    }

    private static func validIdentifier(_ value: String?) -> Bool {
        value.map { !$0.isEmpty && $0.count <= maximumIdentifierCharacters } ?? true
    }

    private static func validRequiredIdentifier(_ value: String?) -> Bool {
        guard let value else { return false }
        return !value.isEmpty && value.count <= maximumIdentifierCharacters
    }

    private static func validEventName(_ value: String?) -> Bool {
        guard let value, !value.isEmpty, value.count <= maximumEventNameCharacters else { return false }
        return value.range(of: "^[a-z][a-z0-9_]*$", options: .regularExpression) != nil
    }

    static func validateConsentSnapshot(_ value: JourneyConsent) -> Bool {
        let hasPurpose = value.analytics != nil || value.personalisation != nil
            || value.researchContact != nil || value.marketing != nil
        return hasPurpose && !value.source.isEmpty && value.source.count <= 128 && parseDate(value.updatedAt) != nil
    }

    private static func validateMetric(_ value: JourneyOperationalMetric) -> Bool {
        !value.name.isEmpty && value.name.count <= 128 && value.value.isFinite
            && (value.unit.map { !$0.isEmpty && $0.count <= 64 } ?? true)
            && validateJSON(value.dimensions, startingAt: 2)
    }

    private static func validateContext(_ value: JourneyJSONObject?) -> Bool {
        guard let value else { return true }
        guard validateJSON(value), value.count <= maximumObjectProperties else { return false }
        if !validateOptionalString(value["locale"], maximum: 64) { return false }
        if !validateOptionalString(value["timezone"], maximum: 128) { return false }
        if !validatePage(value["page"]) || !validateDevice(value["device"]) || !validateLibrary(value["library"]) {
            return false
        }
        return true
    }

    private static func validatePage(_ value: JourneyJSONValue?) -> Bool {
        guard let value else { return true }
        guard case .object(let object) = value,
              Set(object.keys).isSubset(of: Set(["url", "referrer", "title"]))
        else { return false }
        return validateOptionalString(object["url"], maximum: 2_048)
            && validateOptionalString(object["referrer"], maximum: 2_048)
            && validateOptionalString(object["title"], maximum: 512)
    }

    private static func validateDevice(_ value: JourneyJSONValue?) -> Bool {
        guard let value else { return true }
        guard case .object(let object) = value,
              Set(object.keys).isSubset(of: Set(["type", "operatingSystem"])),
              validateOptionalString(object["operatingSystem"], maximum: 128)
        else { return false }
        guard let type = object["type"] else { return true }
        guard case .string(let raw) = type else { return false }
        return ["desktop", "mobile", "tablet", "server", "other"].contains(raw)
    }

    private static func validateLibrary(_ value: JourneyJSONValue?) -> Bool {
        guard let value else { return true }
        guard case .object(let object) = value,
              Set(object.keys).isSubset(of: Set(["name", "version"])),
              let name = object["name"], let version = object["version"],
              case .string(let rawName) = name, case .string(let rawVersion) = version
        else { return false }
        return !rawName.isEmpty && rawName.count <= 128 && !rawVersion.isEmpty && rawVersion.count <= 64
    }

    private static func validateOptionalString(_ value: JourneyJSONValue?, maximum: Int) -> Bool {
        guard let value else { return true }
        guard case .string(let raw) = value else { return false }
        return raw.count <= maximum
    }

    private static func validateJSON(_ value: JourneyJSONObject?, startingAt depth: Int = 1) -> Bool {
        guard let value else { return true }
        return validateJSON(.object(value), depth: depth)
    }

    private static func validateJSON(_ value: JourneyJSONValue, depth: Int) -> Bool {
        guard depth <= maximumNestingDepth else { return false }
        switch value {
        case .null, .bool:
            return true
        case .number(let number):
            return number.isFinite
        case .string(let string):
            return string.count <= maximumStringCharacters
        case .array(let values):
            return values.count <= maximumArrayItems && values.allSatisfy { validateJSON($0, depth: depth + 1) }
        case .object(let object):
            guard object.count <= maximumObjectProperties else { return false }
            return object.allSatisfy { key, entry in
                !prohibitedPropertyNames.contains(key) && key.count <= maximumPropertyNameCharacters
                    && validateJSON(entry, depth: depth + 1)
            }
        }
    }
}
