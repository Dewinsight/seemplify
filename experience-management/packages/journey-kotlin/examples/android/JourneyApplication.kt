package example

import android.app.Application
import com.seemplify.journey.ConsentSnapshot
import com.seemplify.journey.ConsentState
import com.seemplify.journey.JourneyClient
import com.seemplify.journey.JourneyClientConfig
import com.seemplify.journey.JourneyEnvironment
import com.seemplify.journey.PrivacyOptions
import com.seemplify.journey.android.AndroidJourneyNetwork
import com.seemplify.journey.android.AndroidKeystoreQueueStore
import com.seemplify.journey.android.AndroidProcessLifecycle
import com.seemplify.journey.http.UrlConnectionJourneyHttpClient

/** Documentation-only sample. Replace the placeholder only after source provisioning exists. */
class JourneyApplication : Application() {
    lateinit var journey: JourneyClient
        private set
    private lateinit var lifecycle: AndroidProcessLifecycle
    private lateinit var network: AndroidJourneyNetwork

    override fun onCreate() {
        super.onCreate()
        lifecycle = AndroidProcessLifecycle()
        network = AndroidJourneyNetwork(this)
        journey = JourneyClient(
            JourneyClientConfig(
                writeKey = "jpk_dev.replace_me.00000000000000000000000000000000",
                environment = JourneyEnvironment.DEVELOPMENT,
                endpoint = "https://ingest.example.com",
                consent = ConsentSnapshot(
                    analytics = ConsentState.GRANTED,
                    source = "application_privacy_settings",
                    updatedAt = "2026-08-04T12:30:00.000Z",
                ),
                storage = AndroidKeystoreQueueStore(this, "development"),
                http = UrlConnectionJourneyHttpClient(),
                lifecycle = lifecycle,
                network = network,
                privacy = PrivacyOptions(
                    deniedPropertyNames = setOf("email_body", "survey_answer", "ai_prompt"),
                ),
            ),
        )
    }

    override fun onTerminate() {
        journey.close()
        lifecycle.close()
        network.close()
        super.onTerminate()
    }
}
