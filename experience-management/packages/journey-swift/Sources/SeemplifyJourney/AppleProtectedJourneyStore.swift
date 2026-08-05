import Foundation
import CryptoKit
import Security

/// Apple-platform queue storage using a Keychain-held AES-256 key and an
/// atomically replaced encrypted file. There is deliberately no unprotected
/// storage mode or fallback.
public actor AppleProtectedJourneyStore: JourneySecureStore {
    public nonisolated let guarantees = JourneySecureStoreGuarantees(
        encryptedAtRest: true,
        atomicReplacement: true
    )

    private let directory: URL
    private let keychainService: String
    private let keychainAccount: String

    public init(
        directory: URL? = nil,
        keychainService: String = "com.seemplify.journey.swift",
        keychainAccount: String = "queue-encryption-key-v1"
    ) throws {
        guard !keychainService.isEmpty, !keychainAccount.isEmpty else {
            throw AppleProtectedJourneyStoreError.invalidConfiguration
        }
        let resolvedDirectory: URL
        if let directory {
            resolvedDirectory = directory
        } else {
            guard let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first else {
                throw AppleProtectedJourneyStoreError.applicationSupportUnavailable
            }
            resolvedDirectory = base.appendingPathComponent("SeemplifyJourney", isDirectory: true)
        }
        try FileManager.default.createDirectory(at: resolvedDirectory, withIntermediateDirectories: true)
        self.directory = resolvedDirectory
        self.keychainService = keychainService
        self.keychainAccount = keychainAccount
    }

    public func read(key: String) async throws -> Data? {
        let url = fileURL(for: key)
        guard FileManager.default.fileExists(atPath: url.path) else { return nil }
        let ciphertext = try Data(contentsOf: url, options: [.mappedIfSafe])
        let sealed = try AES.GCM.SealedBox(combined: ciphertext)
        return try AES.GCM.open(sealed, using: loadOrCreateKey())
    }

    public func replace(key: String, with data: Data) async throws {
        let sealed = try AES.GCM.seal(data, using: loadOrCreateKey())
        guard let ciphertext = sealed.combined else { throw AppleProtectedJourneyStoreError.encryptionFailed }
#if os(iOS)
        try ciphertext.write(
            to: fileURL(for: key),
            options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication]
        )
#else
        try ciphertext.write(to: fileURL(for: key), options: [.atomic])
#endif
    }

    public func remove(key: String) async throws {
        let url = fileURL(for: key)
        guard FileManager.default.fileExists(atPath: url.path) else { return }
        try FileManager.default.removeItem(at: url)
    }

    private func fileURL(for key: String) -> URL {
        let digest = SHA256.hash(data: Data(key.utf8)).map { String(format: "%02x", $0) }.joined()
        return directory.appendingPathComponent("queue-\(digest).sealed", isDirectory: false)
    }

    private func loadOrCreateKey() throws -> SymmetricKey {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: keychainService,
            kSecAttrAccount as String: keychainAccount,
            kSecMatchLimit as String: kSecMatchLimitOne,
            kSecReturnData as String: true
        ]
        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        if status == errSecSuccess, let data = item as? Data, data.count == 32 {
            return SymmetricKey(data: data)
        }
        guard status == errSecItemNotFound else {
            throw AppleProtectedJourneyStoreError.keychain(status)
        }

        let key = SymmetricKey(size: .bits256)
        let data = key.withUnsafeBytes { Data($0) }
        let add: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: keychainService,
            kSecAttrAccount as String: keychainAccount,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
            kSecValueData as String: data
        ]
        let addStatus = SecItemAdd(add as CFDictionary, nil)
        guard addStatus == errSecSuccess else { throw AppleProtectedJourneyStoreError.keychain(addStatus) }
        return key
    }
}

public enum AppleProtectedJourneyStoreError: Error {
    case invalidConfiguration
    case applicationSupportUnavailable
    case encryptionFailed
    case keychain(OSStatus)
}
