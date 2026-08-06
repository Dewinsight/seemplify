package com.seemplify.journey.android

import android.app.Application
import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import android.os.Build
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.ProcessLifecycleOwner
import com.seemplify.journey.AppContext
import com.seemplify.journey.DeviceContext
import com.seemplify.journey.JourneyAppState
import com.seemplify.journey.JourneyContext
import com.seemplify.journey.JourneyLifecycle
import com.seemplify.journey.JourneyNetwork
import com.seemplify.journey.JourneySubscription
import java.util.Locale
import java.util.TimeZone
import java.util.concurrent.CopyOnWriteArraySet

/** Process-wide foreground/background bridge. The host owns its lifetime. */
public class AndroidProcessLifecycle : JourneyLifecycle, DefaultLifecycleObserver, AutoCloseable {
    private val listeners = CopyOnWriteArraySet<(JourneyAppState) -> Unit>()
    @Volatile private var state = if (ProcessLifecycleOwner.get().lifecycle.currentState.isAtLeast(androidx.lifecycle.Lifecycle.State.STARTED)) {
        JourneyAppState.FOREGROUND
    } else JourneyAppState.BACKGROUND

    init {
        ProcessLifecycleOwner.get().lifecycle.addObserver(this)
    }

    override fun currentState(): JourneyAppState = state

    override fun subscribe(listener: (JourneyAppState) -> Unit): JourneySubscription {
        listeners += listener
        return JourneySubscription { listeners -= listener }
    }

    override fun onStart(owner: LifecycleOwner) {
        state = JourneyAppState.FOREGROUND
        listeners.forEach { listener -> runCatching { listener(state) } }
    }

    override fun onStop(owner: LifecycleOwner) {
        state = JourneyAppState.BACKGROUND
        listeners.forEach { listener -> runCatching { listener(state) } }
    }

    override fun close() {
        ProcessLifecycleOwner.get().lifecycle.removeObserver(this)
        listeners.clear()
    }
}

/** Connectivity bridge using Android's default-network callback. */
public class AndroidJourneyNetwork(context: Context) : JourneyNetwork, AutoCloseable {
    private val connectivity = context.applicationContext.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
    private val listeners = CopyOnWriteArraySet<(Boolean) -> Unit>()
    @Volatile private var online = connected()
    private val callback = object : ConnectivityManager.NetworkCallback() {
        override fun onAvailable(network: Network) = update(connected())
        override fun onLost(network: Network) = update(connected())
        override fun onCapabilitiesChanged(network: Network, capabilities: NetworkCapabilities) = update(
            capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) &&
                capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED),
        )
    }

    init {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            connectivity.registerDefaultNetworkCallback(callback)
        } else {
            connectivity.registerNetworkCallback(
                NetworkRequest.Builder().addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET).build(),
                callback,
            )
        }
    }

    override fun isOnline(): Boolean = online

    override fun subscribe(listener: (Boolean) -> Unit): JourneySubscription {
        listeners += listener
        return JourneySubscription { listeners -= listener }
    }

    override fun close() {
        runCatching { connectivity.unregisterNetworkCallback(callback) }
        listeners.clear()
    }

    private fun connected(): Boolean {
        val network = connectivity.activeNetwork ?: return false
        val capabilities = connectivity.getNetworkCapabilities(network) ?: return false
        return capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) &&
            capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED)
    }

    private fun update(value: Boolean) {
        if (online == value) return
        online = value
        listeners.forEach { listener -> runCatching { listener(value) } }
    }
}

/** Opt-in, minimised app/OS context. No device, advertising, installation, IP, email, or phone ID is collected. */
public fun androidJourneyContext(application: Application): JourneyContext {
    val packageManager = application.packageManager
    val packageName = application.packageName
    val packageInfo = packageManager.getPackageInfo(packageName, 0)
    val label = runCatching { packageManager.getApplicationLabel(application.applicationInfo).toString() }.getOrNull()
    val versionCode = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) packageInfo.longVersionCode else {
        @Suppress("DEPRECATION") packageInfo.versionCode.toLong()
    }
    return JourneyContext(
        locale = Locale.getDefault().toLanguageTag().take(64),
        timezone = TimeZone.getDefault().id.take(128),
        device = DeviceContext(type = "mobile", operatingSystem = "Android"),
        app = AppContext(
            name = label?.take(128),
            version = packageInfo.versionName?.take(64),
            build = versionCode.toString().take(64),
        ),
    )
}
