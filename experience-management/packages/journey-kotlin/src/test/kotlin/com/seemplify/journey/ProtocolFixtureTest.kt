package com.seemplify.journey

import kotlinx.serialization.decodeFromString
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class ProtocolFixtureTest {
    @Test
    fun `canonical protocol fixtures decode and validate without Kotlin-specific wire fields`() {
        val names = listOf("track", "identify", "alias", "group", "page", "screen", "consent", "metric")
        names.forEach { name ->
            val resource = requireNotNull(javaClass.getResource("/protocol/v1/valid/$name.json"))
            val raw = resource.openStream().bufferedReader().use { it.readText() }
            val event = journeyJson.decodeFromString<JourneyEventEnvelope>(raw)
            assertEquals(name, event.call)
            assertNull("$name fixture: ${event.validationCode()}", event.validationCode())
        }
    }

    @Test
    fun `canonical batch and partial result fixtures decode exactly`() {
        val batchRaw = fixture("batch")
        val resultRaw = fixture("batch-result")
        val batch = journeyJson.decodeFromString<JourneyEventBatch>(batchRaw)
        val result = journeyJson.decodeFromString<BatchIngestResult>(resultRaw)

        assertEquals("018f4d85-4f31-7a1d-8f11-4d4ac3f10f60", batch.batchId)
        assertEquals(2, batch.events.size)
        assertEquals(batch.batchId, result.batchId)
        assertEquals(listOf("accepted", "duplicate"), result.results.map { it.status })
        assertEquals(batch.events.map { it.eventId }, result.results.map { it.eventId })
    }

    private fun fixture(name: String): String {
        val resource = requireNotNull(javaClass.getResource("/protocol/v1/valid/$name.json"))
        return resource.openStream().bufferedReader().use { it.readText() }
    }
}
