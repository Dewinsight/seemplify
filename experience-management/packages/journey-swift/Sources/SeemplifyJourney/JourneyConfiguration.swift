import Foundation

public enum JourneyEnvironment: String, Sendable, Equatable { case development, staging, production }
public enum JourneyBeforeConsent: String, Sendable, Equatable { case drop, bufferMemory }
public enum JourneyQueueOverflow: String, Sendable, Equatable { case dropOldest, dropNewest }

public struct JourneyQueueConfiguration: Sendable, Equatable {
    public var maximumEvents: Int
    public var maximumBytes: Int
    public var maximumAge: TimeInterval
    public var overflow: JourneyQueueOverflow

    public init(
        maximumEvents: Int = 2_000,
        maximumBytes: Int = 2 * 1_024 * 1_024,
        maximumAge: TimeInterval = 24 * 60 * 60,
        overflow: JourneyQueueOverflow = .dropOldest
    ) {
        self.maximumEvents = min(max(maximumEvents, 1), 20_000)
        self.maximumBytes = min(max(maximumBytes, 1_024), 20 * 1_024 * 1_024)
        self.maximumAge = maximumAge.isFinite
            ? min(max(maximumAge, 1), 30 * 24 * 60 * 60)
            : 24 * 60 * 60
        self.overflow = overflow
    }
}

public struct JourneyBatchConfiguration: Sendable, Equatable {
    public var maximumEvents: Int
    public var maximumBytes: Int

    public init(maximumEvents: Int = 50, maximumBytes: Int = 256 * 1_024) {
        self.maximumEvents = min(max(maximumEvents, 1), JourneyProtocol.maximumBatchEvents)
        self.maximumBytes = min(max(maximumBytes, 1_024), JourneyProtocol.maximumBatchBytes)
    }
}

public struct JourneyRetryConfiguration: Sendable, Equatable {
    public var maximumAttempts: Int
    public var baseDelay: TimeInterval
    public var maximumDelay: TimeInterval
    public var jitterRatio: Double

    public init(
        maximumAttempts: Int = 5,
        baseDelay: TimeInterval = 1,
        maximumDelay: TimeInterval = 60,
        jitterRatio: Double = 0.2
    ) {
        self.maximumAttempts = min(max(maximumAttempts, 1), 20)
        self.baseDelay = baseDelay.isFinite ? min(max(baseDelay, 0.01), 60) : 1
        self.maximumDelay = maximumDelay.isFinite ? min(max(maximumDelay, 0.1), 3_600) : 60
        self.jitterRatio = jitterRatio.isFinite ? min(max(jitterRatio, 0), 1) : 0.2
    }
}

public struct JourneyDeliveryConfiguration: Sendable, Equatable {
    public var foregroundFlushInterval: TimeInterval?
    public var flushOnBackground: Bool
    public var flushOnForeground: Bool
    public var flushOnNetworkReconnect: Bool
    public var backgroundMaximumBytes: Int

    public init(
        foregroundFlushInterval: TimeInterval? = 30,
        flushOnBackground: Bool = true,
        flushOnForeground: Bool = true,
        flushOnNetworkReconnect: Bool = true,
        backgroundMaximumBytes: Int = 60_000
    ) {
        self.foregroundFlushInterval = foregroundFlushInterval.map {
            $0.isFinite ? min(max($0, 1), 1_800) : 30
        }
        self.flushOnBackground = flushOnBackground
        self.flushOnForeground = flushOnForeground
        self.flushOnNetworkReconnect = flushOnNetworkReconnect
        self.backgroundMaximumBytes = min(max(backgroundMaximumBytes, 1_024), JourneyProtocol.maximumBatchBytes)
    }
}

public struct JourneyClientConfiguration: Sendable {
    public var writeKey: String
    public var endpoint: URL
    public var environment: JourneyEnvironment
    public var initialConsent: JourneyConsent?
    public var beforeConsent: JourneyBeforeConsent
    public var secureStore: (any JourneySecureStore)?
    public var storageKey: String
    public var queue: JourneyQueueConfiguration
    public var batch: JourneyBatchConfiguration
    public var retry: JourneyRetryConfiguration
    public var delivery: JourneyDeliveryConfiguration
    public var requestTimeout: TimeInterval
    public var privacy: JourneyPrivacyOptions
    public var automaticContext: Bool
    public var contextProvider: (@Sendable () -> JourneyJSONObject?)?
    public var diagnosticHandler: (@Sendable (JourneyDiagnostic) -> Void)?
    public var debug: Bool
    public var transport: any JourneyTransport
    public var clock: any JourneyClock
    public var idGenerator: any JourneyIDGenerator
    public var randomSource: any JourneyRandomSource
    public var lifecycle: (any JourneyLifecycleSource)?
    public var network: (any JourneyNetworkSource)?

    public init(
        writeKey: String,
        endpoint: URL,
        environment: JourneyEnvironment = .production,
        initialConsent: JourneyConsent? = nil,
        beforeConsent: JourneyBeforeConsent = .drop,
        secureStore: (any JourneySecureStore)? = nil,
        storageKey: String = "seemplify.journey.swift.queue.v1",
        queue: JourneyQueueConfiguration = .init(),
        batch: JourneyBatchConfiguration = .init(),
        retry: JourneyRetryConfiguration = .init(),
        delivery: JourneyDeliveryConfiguration = .init(),
        requestTimeout: TimeInterval = 10,
        privacy: JourneyPrivacyOptions = .init(),
        automaticContext: Bool = false,
        contextProvider: (@Sendable () -> JourneyJSONObject?)? = nil,
        diagnosticHandler: (@Sendable (JourneyDiagnostic) -> Void)? = nil,
        debug: Bool = false,
        transport: any JourneyTransport = URLSessionJourneyTransport(),
        clock: any JourneyClock = SystemJourneyClock(),
        idGenerator: any JourneyIDGenerator = SystemJourneyIDGenerator(),
        randomSource: any JourneyRandomSource = SystemJourneyRandomSource(),
        lifecycle: (any JourneyLifecycleSource)? = nil,
        network: (any JourneyNetworkSource)? = nil
    ) {
        self.writeKey = writeKey
        self.endpoint = endpoint
        self.environment = environment
        self.initialConsent = initialConsent
        self.beforeConsent = beforeConsent
        self.secureStore = secureStore
        self.storageKey = String(storageKey.prefix(200))
        self.queue = queue
        self.batch = batch
        self.retry = retry
        self.delivery = delivery
        self.requestTimeout = requestTimeout.isFinite ? min(max(requestTimeout, 0.1), 120) : 10
        self.privacy = privacy
        self.automaticContext = automaticContext
        self.contextProvider = contextProvider
        self.diagnosticHandler = diagnosticHandler
        self.debug = debug
        self.transport = transport
        self.clock = clock
        self.idGenerator = idGenerator
        self.randomSource = randomSource
        self.lifecycle = lifecycle
        self.network = network
    }
}
