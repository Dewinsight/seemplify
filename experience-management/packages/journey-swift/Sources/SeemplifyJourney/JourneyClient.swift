import Foundation

private struct JourneyQueueEntry: Sendable, Equatable {
    var event: JourneyEventEnvelope
    var enqueuedAt: TimeInterval
    var attempts: Int
    var nextAttemptAt: TimeInterval
    var purpose: JourneyStoredPurpose
    var persistable: Bool
    var bytes: Int
}

public actor JourneyClient {
    public static let libraryName = "com.seemplify.journey-swift"
    public static let libraryVersion = "0.1.0"

    private let configuration: JourneyClientConfiguration
    private let endpoint: URL?
    private let configured: Bool
    private let debugEnabled: Bool
    private var initialized = false
    private var storageHealthy: Bool
    private var queue: [JourneyQueueEntry] = []
    private var consentBuffer: [JourneyQueueEntry] = []
    private var consent: JourneyConsent?
    private var anonymousId: String?
    private var persistedAnonymousId: String?
    private var userId: String?
    private var accountId: String?
    private var sessionId: String?
    private var online = true
    private var appState: JourneyAppState = .active
    private var destroyed = false
    private var observations: [any JourneyObservation] = []
    private var scheduledFlush: Task<Void, Never>?
    private var flushTask: Task<JourneyFlushResult, Never>?

    public init(configuration: JourneyClientConfiguration) {
        self.configuration = configuration
        self.endpoint = Self.resolveEndpoint(configuration.endpoint)
        self.configured = Self.publicWriteKeyEnvironment(configuration.writeKey) == configuration.environment
            && Self.resolveEndpoint(configuration.endpoint) != nil
        self.debugEnabled = configuration.debug && configuration.environment != .production
        if let store = configuration.secureStore {
            self.storageHealthy = store.guarantees.encryptedAtRest && store.guarantees.atomicReplacement
        } else {
            self.storageHealthy = true
        }
        self.consent = configuration.initialConsent.flatMap {
            JourneyProtocol.validateConsentSnapshot($0) ? $0 : nil
        }
    }

    public func status() async -> JourneyClientStatus {
        await initializeIfNeeded()
        return JourneyClientStatus(
            enabled: isEnabled,
            queued: queue.count,
            buffered: consentBuffer.count,
            online: online,
            appState: appState,
            persistence: configuration.secureStore == nil ? .memory : (storageHealthy ? .secure : .unavailable)
        )
    }

    public func track(
        _ event: String,
        properties: JourneyJSONObject? = nil,
        options: JourneyEventOptions = .init()
    ) async -> JourneyEnqueueResult {
        await invoke {
            var envelope = baseEnvelope(call: .track, options: options)
            envelope.event = event
            envelope.eventVersion = options.eventVersion
            envelope.properties = JourneyPrivacy.sanitize(properties, options: configuration.privacy)
            return envelope
        }
    }

    public func metric(
        _ event: String,
        name: String,
        value: Double,
        unit: String? = nil,
        dimensions: JourneyJSONObject? = nil,
        options: JourneyEventOptions = .init()
    ) async -> JourneyEnqueueResult {
        await invoke {
            var envelope = baseEnvelope(call: .metric, options: options)
            envelope.event = event
            envelope.eventVersion = options.eventVersion
            envelope.metric = JourneyOperationalMetric(
                name: name,
                value: value,
                unit: unit,
                dimensions: JourneyPrivacy.sanitize(dimensions, options: configuration.privacy)
            )
            return envelope
        }
    }

    public func identify(
        userId: String,
        traits: JourneyJSONObject? = nil,
        options: JourneyEventOptions = .init()
    ) async -> JourneyEnqueueResult {
        var supplied = options
        supplied.userId = userId
        let result = await invoke {
            var envelope = baseEnvelope(call: .identify, options: supplied)
            envelope.userId = userId
            envelope.traits = JourneyPrivacy.sanitize(traits, options: configuration.privacy)
            return envelope
        }
        if result.status == .queued || result.status == .buffered { self.userId = userId }
        return result
    }

    public func alias(
        userId: String,
        anonymousId: String? = nil,
        options: JourneyEventOptions = .init()
    ) async -> JourneyEnqueueResult {
        let prior = anonymousId ?? options.anonymousId ?? ensureAnonymousId()
        var supplied = options
        supplied.userId = userId
        supplied.anonymousId = prior
        let result = await invoke {
            var envelope = baseEnvelope(call: .alias, options: supplied)
            envelope.userId = userId
            envelope.anonymousId = prior
            return envelope
        }
        if result.status == .queued || result.status == .buffered { self.userId = userId }
        return result
    }

    public func group(
        accountId: String,
        traits: JourneyJSONObject? = nil,
        options: JourneyEventOptions = .init()
    ) async -> JourneyEnqueueResult {
        var supplied = options
        supplied.accountId = accountId
        let result = await invoke {
            var envelope = baseEnvelope(call: .group, options: supplied)
            envelope.accountId = accountId
            envelope.traits = JourneyPrivacy.sanitize(traits, options: configuration.privacy)
            return envelope
        }
        if result.status == .queued || result.status == .buffered { self.accountId = accountId }
        return result
    }

    public func page(
        _ name: String? = nil,
        properties: JourneyJSONObject? = nil,
        options: JourneyEventOptions = .init()
    ) async -> JourneyEnqueueResult {
        await invoke {
            var envelope = baseEnvelope(call: .page, options: options)
            envelope.properties = namedProperties(name, properties)
            return envelope
        }
    }

    public func screen(
        _ name: String? = nil,
        properties: JourneyJSONObject? = nil,
        options: JourneyEventOptions = .init()
    ) async -> JourneyEnqueueResult {
        await invoke {
            var envelope = baseEnvelope(call: .screen, options: options)
            envelope.properties = namedProperties(name, properties)
            return envelope
        }
    }

    public func updateConsent(
        _ input: JourneyConsent,
        options: JourneyEventOptions = .init()
    ) async -> JourneyEnqueueResult {
        await initializeIfNeeded()
        guard !destroyed else { return enqueueResult(.destroyed, "SDK_DESTROYED") }
        guard isEnabled else { return enqueueResult(.disabled, "SDK_DISABLED") }
        let snapshot = mergeConsent(input)
        guard JourneyProtocol.validateConsentSnapshot(snapshot) else {
            return enqueueResult(.invalid, "CONSENT_INVALID")
        }
        var envelope = baseEnvelope(call: .consent, options: options)
        envelope.consent = snapshot
        guard JourneyProtocol.validate(envelope) else {
            return enqueueResult(.invalid, "PROTOCOL_VALIDATION_FAILED", eventId: envelope.eventId)
        }
        if let existing = queue.first(where: { $0.event.eventId == envelope.eventId }),
           existing.event != envelope {
            return enqueueResult(.invalid, "EVENT_ID_CONFLICT", eventId: envelope.eventId)
        }
        supersedePendingConsent(exceptEventId: envelope.eventId)
        consent = snapshot
        if snapshot.analytics == .denied {
            guard await purgeForDeniedConsent() else {
                return enqueueResult(.dropped, "SECURE_STORAGE_REMOVE_FAILED", eventId: envelope.eventId)
            }
            let result = await enqueue(envelope, purpose: .control, persistable: false)
            clearIdentity()
            scheduleFlush(after: 0, reason: "consent_denied")
            return result
        }
        let result = await enqueue(envelope, purpose: .control, persistable: snapshot.analytics == .granted)
        guard result.status == .queued else { return result }
        if snapshot.analytics == .granted {
            _ = ensureAnonymousId()
            let promoted = consentBuffer
            consentBuffer = []
            for var entry in promoted {
                entry.persistable = true
                entry.event.consent = snapshot
                entry.bytes = encodedBytes(entry.event)
                queue.append(entry)
            }
            enforceQueueBounds(code: "CONSENT_PROMOTION_OVERFLOW")
            if !(await persist()) {
                return enqueueResult(.dropped, "SECURE_STORAGE_COMMIT_FAILED", eventId: envelope.eventId)
            }
        }
        return result
    }

    public func consent(
        analytics: JourneyConsentState? = nil,
        personalisation: JourneyConsentState? = nil,
        researchContact: JourneyConsentState? = nil,
        marketing: JourneyConsentState? = nil,
        source: String,
        updatedAt: Date? = nil,
        options: JourneyEventOptions = .init()
    ) async -> JourneyEnqueueResult {
        await updateConsent(
            JourneyConsent(
                analytics: analytics,
                personalisation: personalisation,
                researchContact: researchContact,
                marketing: marketing,
                source: source,
                updatedAt: JourneyProtocol.timestamp(updatedAt ?? configuration.clock.now())
            ),
            options: options
        )
    }

    public func flush() async -> JourneyFlushResult {
        await startFlush(reason: "explicit", explicit: true)
    }

    public func reset() async {
        await initializeIfNeeded()
        scheduledFlush?.cancel()
        scheduledFlush = nil
        let removed = queue.count + consentBuffer.count
        queue = []
        consentBuffer = []
        consent = nil
        clearIdentity()
        if let store = configuration.secureStore {
            do {
                try await store.remove(key: configuration.storageKey)
                storageHealthy = store.guarantees.encryptedAtRest && store.guarantees.atomicReplacement
            } catch {
                failStorage(code: "SECURE_STORAGE_RESET_FAILED")
            }
        }
        if removed > 0 { diagnostic("RESET_PURGE", count: removed) }
        scheduleForegroundInterval()
    }

    public func shutdown() async -> JourneyFlushResult {
        if destroyed { return emptyFlush(.destroyed) }
        let result = await startFlush(reason: "shutdown", explicit: true)
        destroyed = true
        scheduledFlush?.cancel()
        scheduledFlush = nil
        observations.forEach { $0.cancel() }
        observations = []
        return result
    }

    private var isEnabled: Bool { configured && storageHealthy && !destroyed }

    private func initializeIfNeeded() async {
        guard !initialized else { return }
        initialized = true
        if endpoint == nil { diagnostic("ENDPOINT_INVALID") }
        if Self.publicWriteKeyEnvironment(configuration.writeKey) == nil { diagnostic("PUBLIC_WRITE_KEY_INVALID") }
        if let environment = Self.publicWriteKeyEnvironment(configuration.writeKey),
           environment != configuration.environment { diagnostic("CREDENTIAL_ENVIRONMENT_MISMATCH") }
        if configuration.initialConsent != nil && consent == nil { diagnostic("INITIAL_CONSENT_INVALID") }
        if let store = configuration.secureStore,
           (!store.guarantees.encryptedAtRest || !store.guarantees.atomicReplacement) {
            storageHealthy = false
            diagnostic("SECURE_STORAGE_CONTRACT_INVALID")
        }
        guard isEnabled else { return }
        readHostState()
        await loadStoredState()
        if analyticsConsent == .denied { _ = await purgeForDeniedConsent() }
        guard isEnabled else { return }
        bindHostTransitions()
        scheduleForegroundInterval()
    }

    private func readHostState() {
        if let lifecycle = configuration.lifecycle {
            do { appState = try lifecycle.currentState() }
            catch { appState = .inactive; diagnostic("LIFECYCLE_STATE_FAILED") }
        }
        if let network = configuration.network {
            do { online = try network.isOnline() }
            catch { online = false; diagnostic("NETWORK_STATE_FAILED") }
        }
    }

    private func bindHostTransitions() {
        if let lifecycle = configuration.lifecycle {
            do {
                observations.append(try lifecycle.observe { [weak self] state in
                    Task { await self?.handleLifecycle(state) }
                })
            } catch { diagnostic("LIFECYCLE_SUBSCRIBE_FAILED") }
        }
        if let network = configuration.network {
            do {
                observations.append(try network.observe { [weak self] online in
                    Task { await self?.handleNetwork(online) }
                })
            } catch { diagnostic("NETWORK_SUBSCRIBE_FAILED") }
        }
    }

    private func handleLifecycle(_ state: JourneyAppState) async {
        let previous = appState
        appState = state
        if state == .background {
            scheduledFlush?.cancel()
            scheduledFlush = nil
            if configuration.delivery.flushOnBackground {
                _ = await startFlush(reason: "background", explicit: false)
            }
        } else if state == .active {
            scheduleForegroundInterval()
            if previous != .active && configuration.delivery.flushOnForeground {
                _ = await startFlush(reason: "foreground", explicit: false)
            }
        }
    }

    private func handleNetwork(_ value: Bool) async {
        let reconnected = !online && value
        online = value
        if reconnected && configuration.delivery.flushOnNetworkReconnect {
            _ = await startFlush(reason: "network_reconnect", explicit: false)
        }
    }

    private var analyticsConsent: JourneyConsentState { consent?.analytics ?? .unknown }

    private func invoke(_ builder: () -> JourneyEventEnvelope) async -> JourneyEnqueueResult {
        await initializeIfNeeded()
        guard !destroyed else { return enqueueResult(.destroyed, "SDK_DESTROYED") }
        guard isEnabled else { return enqueueResult(.disabled, "SDK_DISABLED") }
        let envelope = builder()
        return await enqueue(envelope, purpose: .analytics, persistable: true)
    }

    private func baseEnvelope(call: JourneyEventCall, options: JourneyEventOptions) -> JourneyEventEnvelope {
        var context = configuration.automaticContext ? configuration.contextProvider?() ?? [:] : [:]
        options.context?.forEach { context[$0.key] = $0.value }
        context = JourneyPrivacy.sanitizeContext(context, options: configuration.privacy) ?? [:]
        context["library"] = .object([
            "name": .string(Self.libraryName),
            "version": .string(Self.libraryVersion)
        ])
        return JourneyEventEnvelope(
            eventId: options.eventId ?? configuration.idGenerator.makeID(),
            call: call,
            occurredAt: JourneyProtocol.timestamp(options.occurredAt ?? configuration.clock.now()),
            anonymousId: options.anonymousId ?? anonymousId ?? ensureAnonymousId(),
            userId: options.userId ?? userId,
            accountId: options.accountId ?? accountId,
            sessionId: options.sessionId ?? sessionId,
            context: context,
            consent: consent
        )
    }

    private func namedProperties(_ name: String?, _ properties: JourneyJSONObject?) -> JourneyJSONObject? {
        var result = properties ?? [:]
        if let name { result["name"] = .string(name) }
        return JourneyPrivacy.sanitize(result, options: configuration.privacy)
    }

    private func ensureAnonymousId() -> String {
        if let anonymousId { return anonymousId }
        let generated = persistedAnonymousId ?? "anon_\(configuration.idGenerator.makeID())"
        anonymousId = generated
        return generated
    }

    private func clearIdentity() {
        anonymousId = nil
        persistedAnonymousId = nil
        userId = nil
        accountId = nil
        sessionId = nil
    }

    private func mergeConsent(_ input: JourneyConsent) -> JourneyConsent {
        JourneyConsent(
            analytics: input.analytics ?? consent?.analytics,
            personalisation: input.personalisation ?? consent?.personalisation,
            researchContact: input.researchContact ?? consent?.researchContact,
            marketing: input.marketing ?? consent?.marketing,
            source: input.source,
            updatedAt: input.updatedAt
        )
    }

    private func supersedePendingConsent(exceptEventId: String) {
        let previous = queue.count
        queue.removeAll {
            $0.event.call == .consent && $0.event.eventId != exceptEventId
        }
        let removed = previous - queue.count
        if removed > 0 { diagnostic("CONSENT_SUPERSEDED", count: removed) }
    }

    private func enqueue(
        _ envelope: JourneyEventEnvelope,
        purpose: JourneyStoredPurpose,
        persistable: Bool
    ) async -> JourneyEnqueueResult {
        guard JourneyProtocol.validate(envelope) else {
            diagnostic("PROTOCOL_VALIDATION_FAILED")
            return enqueueResult(.invalid, "PROTOCOL_VALIDATION_FAILED", eventId: envelope.eventId)
        }
        let bytes = encodedBytes(envelope)
        guard bytes > 0, bytes <= configuration.queue.maximumBytes else {
            return enqueueResult(.dropped, "EVENT_EXCEEDS_QUEUE_BYTES", eventId: envelope.eventId)
        }
        guard bytes + 256 <= configuration.batch.maximumBytes else {
            return enqueueResult(.dropped, "EVENT_EXCEEDS_BATCH_BYTES", eventId: envelope.eventId)
        }
        if let existing = (queue + consentBuffer).first(where: { $0.event.eventId == envelope.eventId }) {
            guard existing.event == envelope else {
                return enqueueResult(.invalid, "EVENT_ID_CONFLICT", eventId: envelope.eventId)
            }
            return enqueueResult(
                consentBuffer.contains(existing) ? .buffered : .queued,
                "ALREADY_QUEUED",
                eventId: envelope.eventId
            )
        }
        let entry = JourneyQueueEntry(
            event: envelope,
            enqueuedAt: configuration.clock.now().timeIntervalSince1970,
            attempts: 0,
            nextAttemptAt: 0,
            purpose: purpose,
            persistable: persistable,
            bytes: bytes
        )
        if purpose == .analytics && analyticsConsent != .granted {
            guard analyticsConsent == .unknown && configuration.beforeConsent == .bufferMemory else {
                return enqueueResult(.dropped, "ANALYTICS_CONSENT_NOT_GRANTED", eventId: envelope.eventId)
            }
            if configuration.queue.overflow == .dropNewest,
               consentBuffer.count >= configuration.queue.maximumEvents
                || consentBufferBytes + bytes > configuration.queue.maximumBytes {
                return enqueueResult(.dropped, "CONSENT_BUFFER_OVERFLOW", eventId: envelope.eventId)
            }
            consentBuffer.append(entry)
            enforceConsentBounds()
            return enqueueResult(.buffered, "WAITING_FOR_CONSENT", eventId: envelope.eventId)
        }
        if configuration.queue.overflow == .dropNewest,
           queue.count >= configuration.queue.maximumEvents || queueBytes + bytes > configuration.queue.maximumBytes {
            return enqueueResult(.dropped, "QUEUE_OVERFLOW_NEWEST", eventId: envelope.eventId)
        }
        queue.append(entry)
        expireOldEntries()
        enforceQueueBounds(code: "QUEUE_OVERFLOW_OLDEST")
        guard queue.contains(entry) else {
            return enqueueResult(.dropped, "QUEUE_OVERFLOW_OLDEST", eventId: envelope.eventId)
        }
        guard await persist() else {
            return enqueueResult(.dropped, "SECURE_STORAGE_COMMIT_FAILED", eventId: envelope.eventId)
        }
        if queue.count >= configuration.batch.maximumEvents {
            scheduleFlush(after: 0, reason: "batch_threshold")
        }
        return enqueueResult(.queued, "QUEUED", eventId: envelope.eventId)
    }

    private func encodedBytes<T: Encodable>(_ value: T) -> Int {
        (try? JourneyProtocol.encode(value).count) ?? Int.max
    }

    private var queueBytes: Int { queue.reduce(0) { $0 + $1.bytes } }
    private var consentBufferBytes: Int { consentBuffer.reduce(0) { $0 + $1.bytes } }

    private func enforceConsentBounds() {
        while consentBuffer.count > configuration.queue.maximumEvents
            || consentBufferBytes > configuration.queue.maximumBytes {
            if configuration.queue.overflow == .dropNewest { consentBuffer.removeLast() }
            else { consentBuffer.removeFirst() }
        }
    }

    @discardableResult
    private func enforceQueueBounds(code: String) -> Int {
        var dropped = 0
        while queue.count > configuration.queue.maximumEvents || queueBytes > configuration.queue.maximumBytes {
            if configuration.queue.overflow == .dropNewest { queue.removeLast() }
            else { queue.removeFirst() }
            dropped += 1
        }
        if dropped > 0 { diagnostic(code, count: dropped) }
        return dropped
    }

    @discardableResult
    private func expireOldEntries() -> Int {
        let cutoff = configuration.clock.now().timeIntervalSince1970 - configuration.queue.maximumAge
        let prior = queue.count + consentBuffer.count
        queue.removeAll { $0.enqueuedAt <= cutoff }
        consentBuffer.removeAll { $0.enqueuedAt <= cutoff }
        let dropped = prior - queue.count - consentBuffer.count
        if dropped > 0 { diagnostic("QUEUE_EXPIRED", count: dropped) }
        return dropped
    }

    private func loadStoredState() async {
        guard let store = configuration.secureStore else { return }
        do {
            guard let data = try await store.read(key: configuration.storageKey) else { return }
            guard data.count <= configuration.queue.maximumBytes + 1_024 * 1_024 else {
                try await store.remove(key: configuration.storageKey)
                diagnostic("SECURE_STORAGE_CORRUPT")
                return
            }
            let state = try JourneyProtocol.decode(JourneyStoredState.self, from: data)
            guard state.storageVersion == JourneyStoredState.version,
                  state.protocolVersion == JourneyProtocol.version,
                  state.entries.count <= configuration.queue.maximumEvents * 2,
                  state.anonymousId.map({ !$0.isEmpty && $0.count <= JourneyProtocol.maximumIdentifierCharacters }) ?? true
            else {
                try await store.remove(key: configuration.storageKey)
                diagnostic("SECURE_STORAGE_VERSION_UNSUPPORTED")
                return
            }
            persistedAnonymousId = state.anonymousId
            if analyticsConsent == .granted { anonymousId = state.anonymousId }
            let now = configuration.clock.now().timeIntervalSince1970
            var seen = Set<String>()
            var discarded = false
            for stored in state.entries {
                let bytes = encodedBytes(stored.event)
                guard now - stored.enqueuedAt < configuration.queue.maximumAge,
                      !seen.contains(stored.event.eventId),
                      JourneyProtocol.validate(stored.event),
                      bytes <= configuration.queue.maximumBytes,
                      stored.attempts >= 0
                else { discarded = true; continue }
                seen.insert(stored.event.eventId)
                queue.append(JourneyQueueEntry(
                    event: stored.event,
                    enqueuedAt: stored.enqueuedAt,
                    attempts: stored.attempts,
                    nextAttemptAt: stored.nextAttemptAt,
                    purpose: stored.purpose,
                    persistable: true,
                    bytes: bytes
                ))
            }
            let overflow = enforceQueueBounds(code: "SECURE_STORAGE_LOAD_OVERFLOW")
            if discarded || overflow > 0 { _ = await persist() }
        } catch {
            do {
                try await store.remove(key: configuration.storageKey)
                diagnostic("SECURE_STORAGE_CORRUPT")
            } catch {
                failStorage(code: "SECURE_STORAGE_READ_FAILED")
            }
        }
    }

    private func persist() async -> Bool {
        guard let store = configuration.secureStore else { return true }
        guard storageHealthy else { return false }
        do {
            if analyticsConsent == .denied {
                try await store.remove(key: configuration.storageKey)
                return true
            }
            let entries = queue.filter(\.persistable).map {
                JourneyStoredEntry(
                    event: $0.event,
                    enqueuedAt: $0.enqueuedAt,
                    attempts: $0.attempts,
                    nextAttemptAt: $0.nextAttemptAt,
                    purpose: $0.purpose
                )
            }
            let storedAnonymousId = analyticsConsent == .granted
                ? anonymousId ?? persistedAnonymousId : persistedAnonymousId
            if entries.isEmpty && storedAnonymousId == nil {
                try await store.remove(key: configuration.storageKey)
                return true
            }
            let state = JourneyStoredState(
                storageVersion: JourneyStoredState.version,
                protocolVersion: JourneyProtocol.version,
                anonymousId: storedAnonymousId,
                entries: entries
            )
            try await store.replace(key: configuration.storageKey, with: JourneyProtocol.encode(state))
            persistedAnonymousId = storedAnonymousId
            return true
        } catch {
            failStorage(code: "SECURE_STORAGE_COMMIT_FAILED")
            return false
        }
    }

    private func failStorage(code: String) {
        let removed = queue.count + consentBuffer.count
        storageHealthy = false
        queue = []
        consentBuffer = []
        clearIdentity()
        if removed > 0 { diagnostic("SECURE_STORAGE_FAIL_CLOSED", count: removed) }
        diagnostic(code)
    }

    private func purgeForDeniedConsent() async -> Bool {
        let prior = queue.count + consentBuffer.count
        queue.removeAll { $0.purpose == .analytics }
        consentBuffer = []
        anonymousId = nil
        persistedAnonymousId = nil
        let removed = prior - queue.count
        if removed > 0 { diagnostic("CONSENT_WITHDRAWN_PURGE", count: removed) }
        return await persist()
    }

    private func startFlush(reason: String, explicit: Bool) async -> JourneyFlushResult {
        await initializeIfNeeded()
        if let flushTask { return await flushTask.value }
        let task = Task { [weak self] in
            guard let self else {
                return JourneyFlushResult(status: .destroyed, accepted: 0, dropped: 0, retained: 0)
            }
            return await self.performFlush(reason: reason, explicit: explicit)
        }
        flushTask = task
        let result = await task.value
        flushTask = nil
        return result
    }

    private func performFlush(reason: String, explicit: Bool) async -> JourneyFlushResult {
        _ = explicit
        guard !destroyed else { return emptyFlush(.destroyed) }
        guard isEnabled, let endpoint else { return emptyFlush(.disabled) }
        let expired = expireOldEntries()
        if expired > 0 && !(await persist()) { return emptyFlush(.disabled, dropped: expired) }
        guard online else { return emptyFlush(.offline, dropped: expired) }
        let now = configuration.clock.now().timeIntervalSince1970
        let maximumBytes = reason == "background"
            ? min(configuration.batch.maximumBytes, configuration.delivery.backgroundMaximumBytes)
            : configuration.batch.maximumBytes
        var entries = eligibleEntries(now: now, maximumBytes: maximumBytes)
        guard !entries.isEmpty else {
            let waiting = queue.contains { $0.nextAttemptAt > now }
            return emptyFlush(waiting ? .retryScheduled : .empty, dropped: expired)
        }
        let batchId = configuration.idGenerator.makeID()
        let sentAt = JourneyProtocol.timestamp(configuration.clock.now())
        var batch: JourneyEventBatch?
        var body: Data?
        while !entries.isEmpty {
            let candidate = JourneyEventBatch(
                protocolVersion: JourneyProtocol.version,
                batchId: batchId,
                sentAt: sentAt,
                events: entries.map { entry in
                    var event = entry.event
                    event.sentAt = sentAt
                    return event
                }
            )
            if JourneyProtocol.validate(candidate), let encoded = try? JourneyProtocol.encode(candidate),
               encoded.count <= maximumBytes {
                batch = candidate
                body = encoded
                break
            }
            if entries.count == 1 {
                remove(entries[0], code: "LOCAL_BATCH_VALIDATION_FAILED")
                _ = await persist()
                return emptyFlush(.sent, dropped: expired + 1)
            }
            entries.removeLast()
        }
        guard let batch, let body else { return emptyFlush(.empty, dropped: expired) }
        do {
            let response = try await configuration.transport.send(JourneyTransportRequest(
                url: endpoint,
                headers: [
                    "authorization": "Bearer \(configuration.writeKey)",
                    "content-type": "application/json"
                ],
                body: body,
                timeout: configuration.requestTimeout
            ))
            let retryAfter = retryAfterSeconds(response.header("retry-after"))
            if [408, 425, 429].contains(response.statusCode) || response.statusCode >= 500 {
                let dropped = await retry(entries, httpStatus: response.statusCode, serverDelay: retryAfter)
                return JourneyFlushResult(
                    status: dropped == entries.count ? .sent : .retryScheduled,
                    accepted: 0,
                    dropped: dropped + expired,
                    retained: queue.count
                )
            }
            guard (200..<300).contains(response.statusCode) || response.statusCode == 207 else {
                entries.forEach { remove($0, code: "HTTP_\(response.statusCode)") }
                _ = await persist()
                return JourneyFlushResult(status: .sent, accepted: 0, dropped: entries.count + expired, retained: queue.count)
            }
            guard let result = try? JourneyProtocol.decode(JourneyBatchResult.self, from: response.body),
                  JourneyProtocol.validate(result, expectedBatchId: batch.batchId)
            else {
                let dropped = await retry(entries, httpStatus: response.statusCode, serverDelay: retryAfter)
                diagnostic("INVALID_INGEST_RESPONSE", httpStatus: response.statusCode)
                return JourneyFlushResult(
                    status: dropped == entries.count ? .sent : .retryScheduled,
                    accepted: 0,
                    dropped: dropped + expired,
                    retained: queue.count
                )
            }
            return await apply(result: result, to: entries, alreadyDropped: expired)
        } catch {
            let dropped = await retry(entries, httpStatus: nil, serverDelay: 0)
            diagnostic("TRANSPORT_UNAVAILABLE")
            return JourneyFlushResult(
                status: dropped == entries.count ? .sent : .retryScheduled,
                accepted: 0,
                dropped: dropped + expired,
                retained: queue.count
            )
        }
    }

    private func eligibleEntries(now: TimeInterval, maximumBytes: Int) -> [JourneyQueueEntry] {
        var result: [JourneyQueueEntry] = []
        var bytes = 256
        for entry in queue {
            if entry.nextAttemptAt > now { continue }
            if entry.purpose == .analytics && analyticsConsent != .granted { continue }
            if result.count >= configuration.batch.maximumEvents { break }
            if bytes + entry.bytes > maximumBytes { continue }
            result.append(entry)
            bytes += entry.bytes
        }
        return result
    }

    private func apply(
        result: JourneyBatchResult,
        to entries: [JourneyQueueEntry],
        alreadyDropped: Int
    ) async -> JourneyFlushResult {
        var accepted = 0
        var dropped = alreadyDropped
        var pending: [JourneyQueueEntry] = []
        let byId = Dictionary(result.results.map { ($0.eventId, $0) }, uniquingKeysWith: { first, _ in first })
        for entry in entries {
            guard let receipt = byId[entry.event.eventId] else { pending.append(entry); continue }
            if receipt.status == .accepted || receipt.status == .duplicate || receipt.status == .quarantined {
                remove(entry, code: receipt.status == .duplicate ? "DUPLICATE_ACCEPTED" : receipt.status.rawValue.uppercased())
                accepted += 1
            } else if receipt.retryable {
                pending.append(entry)
            } else {
                remove(entry, code: receipt.code ?? "INGEST_REJECTED")
                dropped += 1
            }
        }
        let retryDropped = pending.isEmpty ? 0 : await retry(pending, httpStatus: 207, serverDelay: 0)
        dropped += retryDropped
        if pending.isEmpty { _ = await persist() }
        return JourneyFlushResult(
            status: pending.count > retryDropped ? .retryScheduled : .sent,
            accepted: accepted,
            dropped: dropped,
            retained: queue.count
        )
    }

    private func retry(
        _ entries: [JourneyQueueEntry],
        httpStatus: Int?,
        serverDelay: TimeInterval
    ) async -> Int {
        var dropped = 0
        var shortest = configuration.retry.maximumDelay
        for original in entries {
            guard let index = queue.firstIndex(where: { $0.event.eventId == original.event.eventId }) else { continue }
            queue[index].attempts += 1
            if queue[index].attempts >= configuration.retry.maximumAttempts {
                let removed = queue.remove(at: index)
                diagnostic("RETRY_LIMIT_REACHED", count: 1)
                _ = removed
                dropped += 1
                continue
            }
            let exponential = min(
                configuration.retry.maximumDelay,
                configuration.retry.baseDelay * pow(2, Double(max(0, queue[index].attempts - 1)))
            )
            let rawRandom = configuration.randomSource.unitInterval()
            let random = rawRandom.isFinite ? min(max(rawRandom, 0), 0.999_999_999) : 0.5
            let jitter = 1 - configuration.retry.jitterRatio + random * 2 * configuration.retry.jitterRatio
            let delay = min(configuration.retry.maximumDelay, max(serverDelay, exponential * jitter))
            queue[index].nextAttemptAt = configuration.clock.now().timeIntervalSince1970 + delay
            shortest = min(shortest, delay)
            diagnostic("RETRY_SCHEDULED", delay: delay, httpStatus: httpStatus)
        }
        if !(await persist()) { return entries.count }
        if entries.count > dropped { scheduleFlush(after: shortest, reason: "retry") }
        return dropped
    }

    private func remove(_ entry: JourneyQueueEntry, code: String) {
        queue.removeAll { $0.event.eventId == entry.event.eventId }
        diagnostic(code, count: 1)
    }

    private func scheduleForegroundInterval() {
        guard appState == .active, let interval = configuration.delivery.foregroundFlushInterval else { return }
        scheduleFlush(after: interval, reason: "interval")
    }

    private func scheduleFlush(after delay: TimeInterval, reason: String) {
        guard isEnabled, appState == .active else { return }
        scheduledFlush?.cancel()
        let clock = configuration.clock
        scheduledFlush = Task { [weak self] in
            do { try await clock.sleep(for: max(0, delay)) }
            catch { return }
            guard !Task.isCancelled else { return }
            await self?.scheduledFlushFired(reason: reason)
        }
    }

    private func scheduledFlushFired(reason: String) async {
        scheduledFlush = nil
        _ = await startFlush(reason: reason, explicit: false)
        scheduleForegroundInterval()
    }

    private func retryAfterSeconds(_ raw: String?) -> TimeInterval {
        guard let raw else { return 0 }
        if let seconds = Double(raw), seconds.isFinite, seconds >= 0 {
            return min(seconds, configuration.retry.maximumDelay)
        }
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(secondsFromGMT: 0)
        formatter.dateFormat = "EEE',' dd MMM yyyy HH':'mm':'ss z"
        guard let date = formatter.date(from: raw) else { return 0 }
        return min(max(0, date.timeIntervalSince(configuration.clock.now())), configuration.retry.maximumDelay)
    }

    private func emptyFlush(_ status: JourneyFlushStatus, dropped: Int = 0) -> JourneyFlushResult {
        JourneyFlushResult(status: status, accepted: 0, dropped: dropped, retained: queue.count)
    }

    private func enqueueResult(
        _ status: JourneyEnqueueStatus,
        _ code: String,
        eventId: String? = nil
    ) -> JourneyEnqueueResult {
        JourneyEnqueueResult(status: status, code: code, eventId: eventId)
    }

    private func diagnostic(
        _ code: String,
        count: Int? = nil,
        delay: TimeInterval? = nil,
        httpStatus: Int? = nil
    ) {
        guard debugEnabled, let handler = configuration.diagnosticHandler else { return }
        handler(JourneyDiagnostic(
            code: code,
            count: count,
            delayMilliseconds: delay.map { Int($0 * 1_000) },
            httpStatus: httpStatus
        ))
    }

    private static func publicWriteKeyEnvironment(_ value: String) -> JourneyEnvironment? {
        guard value.count <= 512,
              value.range(
                of: "^jpk_(dev|stg|live)\\.[A-Za-z0-9][A-Za-z0-9_:-]{0,127}\\.[A-Za-z0-9_-]{32,256}$",
                options: .regularExpression
              ) != nil
        else { return nil }
        if value.hasPrefix("jpk_live.") { return .production }
        if value.hasPrefix("jpk_stg.") { return .staging }
        return .development
    }

    private static func resolveEndpoint(_ raw: URL) -> URL? {
        guard var components = URLComponents(url: raw, resolvingAgainstBaseURL: false),
              let scheme = components.scheme?.lowercased(), let host = components.host?.lowercased(),
              components.user == nil, components.password == nil,
              components.query == nil, components.fragment == nil
        else { return nil }
        let loopback = ["localhost", "127.0.0.1", "::1"].contains(host)
        guard scheme == "https" || (scheme == "http" && loopback) else { return nil }
        var path = components.path
        while path.hasSuffix("/") { path.removeLast() }
        if !path.hasSuffix("/v1/batch") { path += "/v1/batch" }
        if !path.hasPrefix("/") { path = "/" + path }
        components.path = path
        return components.url
    }
}
