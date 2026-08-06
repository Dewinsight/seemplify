import Foundation

public struct JourneyPrivacyOptions: Sendable, Equatable {
    public var deniedPropertyNames: Set<String>
    public var allowedURLQueryParameters: Set<String>

    public init(
        deniedPropertyNames: Set<String> = [],
        allowedURLQueryParameters: Set<String> = []
    ) {
        self.deniedPropertyNames = deniedPropertyNames
        self.allowedURLQueryParameters = allowedURLQueryParameters
    }
}

enum JourneyPrivacy {
    private static let builtInDeniedNames = Set([
        "authorization", "cookie", "set-cookie", "password", "passcode", "secret", "token",
        "access_token", "refresh_token", "api_key", "apikey", "card_number", "cardnumber",
        "credit_card", "creditcard", "cvv", "cvc", "security_code", "ssn", "advertising_id",
        "advertisingid", "device_id", "deviceid", "idfa", "gaid", "imei", "mac_address"
    ])

    static func sanitize(_ object: JourneyJSONObject?, options: JourneyPrivacyOptions) -> JourneyJSONObject? {
        guard let object else { return nil }
        let denied = builtInDeniedNames.union(options.deniedPropertyNames.map(normalize))
        guard case .object(let result) = sanitize(.object(object), denied: denied) else { return nil }
        return result
    }

    static func sanitizeContext(_ object: JourneyJSONObject?, options: JourneyPrivacyOptions) -> JourneyJSONObject? {
        guard var result = sanitize(object, options: options) else { return nil }
        if case .object(var page)? = result["page"] {
            for key in ["url", "referrer"] {
                if case .string(let raw)? = page[key],
                   let minimized = minimizeURL(raw, allowedParameters: options.allowedURLQueryParameters) {
                    page[key] = .string(minimized)
                } else {
                    page.removeValue(forKey: key)
                }
            }
            result["page"] = .object(page)
        }
        return result
    }

    private static func sanitize(_ value: JourneyJSONValue, denied: Set<String>) -> JourneyJSONValue {
        switch value {
        case .array(let values):
            return .array(values.map { sanitize($0, denied: denied) })
        case .object(let object):
            return .object(object.reduce(into: [:]) { result, pair in
                guard !denied.contains(normalize(pair.key)) else { return }
                result[pair.key] = sanitize(pair.value, denied: denied)
            })
        default:
            return value
        }
    }

    private static func normalize(_ value: String) -> String {
        value.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    }

    private static func minimizeURL(_ raw: String, allowedParameters: Set<String>) -> String? {
        guard var components = URLComponents(string: raw),
              let scheme = components.scheme?.lowercased(),
              scheme == "https" || scheme == "http",
              components.host != nil
        else { return nil }
        components.user = nil
        components.password = nil
        components.fragment = nil
        components.queryItems = components.queryItems?.filter { allowedParameters.contains($0.name) }
        if components.queryItems?.isEmpty == true { components.queryItems = nil }
        return components.string
    }
}
