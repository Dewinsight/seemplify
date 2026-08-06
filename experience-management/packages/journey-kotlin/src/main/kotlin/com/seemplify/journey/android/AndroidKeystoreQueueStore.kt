package com.seemplify.journey.android

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.AtomicFile
import com.seemplify.journey.SecureJourneyQueueStore
import com.seemplify.journey.StorageGuarantees
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.DataInputStream
import java.io.DataOutputStream
import java.io.File
import java.nio.charset.StandardCharsets
import java.security.KeyStore
import java.security.MessageDigest
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

private const val STORAGE_FORMAT_VERSION = 1
private const val MAXIMUM_ENCRYPTED_BYTES = 24 * 1024 * 1024

/**
 * Non-exportable Android Keystore AES-GCM plus AtomicFile replacement.
 * No plaintext persistence or fallback implementation exists in this package.
 */
public class AndroidKeystoreQueueStore(
    context: Context,
    namespace: String = "default",
) : SecureJourneyQueueStore {
    override val guarantees: StorageGuarantees = StorageGuarantees(
        encryptedAtRest = true,
        atomicCommit = true,
        crashSafe = true,
    )

    private val stableNamespace = namespaceDigest(namespace)
    private val alias = "com.seemplify.journey.queue.$stableNamespace"
    private val file = AtomicFile(File(context.applicationContext.noBackupFilesDir, "seemplify-journey-$stableNamespace.bin"))

    init {
        require(namespace.isNotBlank() && namespace.length <= 128)
    }

    override suspend fun read(): String? = withContext(Dispatchers.IO) {
        if (!file.baseFile.exists()) return@withContext null
        val encoded = file.openRead().use { input ->
            val output = ByteArrayOutputStream()
            val buffer = ByteArray(8 * 1024)
            while (true) {
                val read = input.read(buffer)
                if (read < 0) break
                if (output.size() + read > MAXIMUM_ENCRYPTED_BYTES) throw SecurityException("Encrypted queue exceeds its bound")
                output.write(buffer, 0, read)
            }
            output.toByteArray()
        }
        val plaintext = decrypt(encoded)
        try {
            plaintext.toString(StandardCharsets.UTF_8)
        } finally {
            plaintext.fill(0)
        }
    }

    override suspend fun commit(value: String): Unit = withContext(Dispatchers.IO) {
        val plaintext = value.toByteArray(StandardCharsets.UTF_8)
        require(plaintext.size <= MAXIMUM_ENCRYPTED_BYTES) { "Queue state exceeds the encrypted storage bound" }
        val encoded = encrypt(plaintext)
        val stream = file.startWrite()
        try {
            stream.write(encoded)
            stream.fd.sync()
            file.finishWrite(stream)
        } catch (failure: Throwable) {
            file.failWrite(stream)
            throw failure
        } finally {
            plaintext.fill(0)
        }
    }

    override suspend fun remove(): Unit = withContext(Dispatchers.IO) {
        file.delete()
    }

    internal fun storageFileForTest(): File = file.baseFile

    private fun encrypt(plaintext: ByteArray): ByteArray {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, secretKey())
        val ciphertext = cipher.doFinal(plaintext)
        return ByteArrayOutputStream().use { output ->
            DataOutputStream(output).use { data ->
                data.writeInt(STORAGE_FORMAT_VERSION)
                data.writeInt(cipher.iv.size)
                data.write(cipher.iv)
                data.writeInt(ciphertext.size)
                data.write(ciphertext)
            }
            output.toByteArray()
        }
    }

    private fun decrypt(encoded: ByteArray): ByteArray {
        if (encoded.size > MAXIMUM_ENCRYPTED_BYTES) throw SecurityException("Encrypted queue exceeds its bound")
        val input = DataInputStream(ByteArrayInputStream(encoded))
        val version = input.readInt()
        if (version != STORAGE_FORMAT_VERSION) throw SecurityException("Encrypted queue version is unsupported")
        val ivSize = input.readInt()
        if (ivSize !in 12..32) throw SecurityException("Encrypted queue IV is invalid")
        val iv = ByteArray(ivSize).also { input.readFully(it) }
        val ciphertextSize = input.readInt()
        if (ciphertextSize <= 0 || ciphertextSize > MAXIMUM_ENCRYPTED_BYTES || ciphertextSize != input.available()) {
            throw SecurityException("Encrypted queue payload is invalid")
        }
        val ciphertext = ByteArray(ciphertextSize).also { input.readFully(it) }
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, secretKey(), GCMParameterSpec(128, iv))
        return cipher.doFinal(ciphertext)
    }

    private fun secretKey(): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (store.getKey(alias, null) as? SecretKey)?.let { return it }
        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        generator.init(
            KeyGenParameterSpec.Builder(
                alias,
                KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
            )
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setRandomizedEncryptionRequired(true)
                .build(),
        )
        return generator.generateKey()
    }
}

private fun namespaceDigest(value: String): String = MessageDigest.getInstance("SHA-256")
    .digest(value.toByteArray(StandardCharsets.UTF_8))
    .take(12)
    .joinToString("") { byte -> "%02x".format(byte) }
