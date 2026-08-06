import Foundation
import SeemplifyJourney

@main
struct BasicJourneyExample {
    static func main() async throws {
        let store = try AppleProtectedJourneyStore()
        let consent = JourneyConsent(
            analytics: .granted,
            source: "example-cmp",
            updatedAt: JourneyProtocol.timestamp(Date())
        )
        let client = JourneyClient(configuration: JourneyClientConfiguration(
            writeKey: "jpk_dev.replace_me.00000000000000000000000000000000",
            endpoint: URL(string: "https://journey-ingest.example.com")!,
            environment: .development,
            initialConsent: consent,
            secureStore: store
        ))

        _ = await client.track(
            "onboarding_started",
            properties: ["entry_point": .string("welcome")]
        )
        _ = await client.metric(
            "workspace_activation_seconds",
            name: "time_to_activation",
            value: 183.5,
            unit: "seconds",
            dimensions: ["plan": .string("team")]
        )
        _ = await client.flush()
        _ = await client.shutdown()
    }
}
