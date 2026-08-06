package com.seemplify.journey.android

import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import java.util.UUID
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class AndroidKeystoreQueueStoreInstrumentedTest {
    @Test
    fun encryptsAndAtomicallyReplacesWithoutPlaintextFallback() = runBlocking {
        val namespace = "instrumented-${UUID.randomUUID()}"
        val store = AndroidKeystoreQueueStore(ApplicationProvider.getApplicationContext(), namespace)
        val sensitive = "{\"event\":\"sensitive_plaintext_marker\"}"
        store.remove()
        store.commit(sensitive)
        assertEquals(sensitive, store.read())
        val disk = store.storageFileForTest().readBytes().decodeToString()
        assertFalse(disk.contains("sensitive_plaintext_marker"))
        assertTrue(store.guarantees.encryptedAtRest)
        assertTrue(store.guarantees.atomicCommit)
        assertTrue(store.guarantees.crashSafe)
        store.remove()
        assertNull(store.read())
    }

    @Test
    fun rejectsCorruptCiphertextInsteadOfReturningPlaintext() = runBlocking {
        val store = AndroidKeystoreQueueStore(
            ApplicationProvider.getApplicationContext(),
            "corrupt-${UUID.randomUUID()}",
        )
        store.storageFileForTest().writeBytes("not encrypted state".encodeToByteArray())
        val result = runCatching { store.read() }
        assertTrue(result.isFailure)
        store.remove()
    }
}

