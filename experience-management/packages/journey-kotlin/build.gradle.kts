import com.android.build.api.dsl.LibraryExtension
import org.gradle.api.publish.maven.MavenPublication
import org.gradle.api.publish.tasks.GenerateModuleMetadata
import org.gradle.api.publish.maven.tasks.AbstractPublishToMaven
import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    id("com.android.library") version "8.7.3"
    id("org.jetbrains.kotlin.android") version "2.0.21"
    id("org.jetbrains.kotlin.plugin.serialization") version "2.0.21"
    id("maven-publish")
}

group = "com.seemplify"
version = "0.1.0-foundation"

android {
    namespace = "com.seemplify.journey"
    compileSdk = 35

    defaultConfig {
        minSdk = 23
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        consumerProguardFiles("consumer-rules.pro")
    }

    buildFeatures {
        buildConfig = false
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
        isCoreLibraryDesugaringEnabled = true
    }

    kotlin {
        compilerOptions {
            jvmTarget = JvmTarget.JVM_17
            allWarningsAsErrors = true
            freeCompilerArgs.add("-Xjsr305=strict")
        }
    }

    testOptions {
        unitTests.isReturnDefaultValues = false
    }

    lint {
        abortOnError = true
        checkDependencies = true
        warningsAsErrors = true
        disable += setOf("AndroidGradlePluginVersion", "GradleDependency", "NewerVersionAvailable")
    }

    publishing {
        singleVariant("release") {
            withSourcesJar()
        }
    }
}

dependencies {
    coreLibraryDesugaring("com.android.tools:desugar_jdk_libs:2.1.4")

    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-core:1.9.0")
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.7.3")
    implementation("androidx.core:core-ktx:1.15.0")
    implementation("androidx.lifecycle:lifecycle-process:2.8.7")

    testImplementation("junit:junit:4.13.2")
    testImplementation("org.jetbrains.kotlinx:kotlinx-coroutines-test:1.9.0")

    androidTestImplementation("androidx.test.ext:junit:1.2.1")
    androidTestImplementation("androidx.test:core:1.6.1")
    androidTestImplementation("androidx.test:runner:1.6.2")
}

afterEvaluate {
    publishing {
        publications {
            create<MavenPublication>("release") {
                from(components["release"])
                groupId = "com.seemplify"
                artifactId = "journey-kotlin"
                version = project.version.toString()
                pom {
                    name.set("Seemplify Journey Kotlin/Android SDK")
                    description.set("Unreleased foundation for the canonical Seemplify Journey Event Protocol.")
                    url.set("https://github.com/seemplify")
                    scm {
                        connection.set("scm:git:https://github.com/seemplify/seemplify.git")
                        url.set("https://github.com/seemplify/seemplify")
                    }
                }
            }
        }
    }
}

// This package is deliberately unreleased. Metadata can be generated and
// inspected, but every Gradle publication task is disabled until governance,
// security, support, signing, and durable-ingestion gates are approved.
tasks.withType<AbstractPublishToMaven>().configureEach {
    enabled = false
}

tasks.withType<GenerateModuleMetadata>().configureEach {
    suppressedValidationErrors.add("enforced-platform")
}

val verifyUnreleased by tasks.registering {
    group = "verification"
    description = "Fails if this foundation is accidentally made publishable."
    doLast {
        check(project.version.toString().endsWith("-foundation")) {
            "The Kotlin SDK must retain its unreleased -foundation version."
        }
        val enabledPublishTasks = tasks.withType<AbstractPublishToMaven>().filter { it.enabled }
        check(enabledPublishTasks.isEmpty()) {
            "Publishing must remain disabled: ${enabledPublishTasks.joinToString { it.name }}"
        }
    }
}

val verifyCanonicalFixtures by tasks.registering {
    group = "verification"
    description = "Checks the Kotlin fixtures against the canonical protocol package."
    doLast {
        val canonical = rootDir.resolve("../journey-event-protocol/fixtures/v1/valid").canonicalFile
        val local = rootDir.resolve("src/test/resources/protocol/v1/valid").canonicalFile
        val names = listOf(
            "track.json", "identify.json", "alias.json", "group.json", "page.json", "screen.json", "consent.json", "metric.json",
            "batch.json", "batch-result.json"
        )
        check(canonical.isDirectory) { "Canonical protocol fixtures are unavailable at $canonical" }
        names.forEach { name ->
            val localText = local.resolve(name).readText().replace("\r\n", "\n").trim()
            val canonicalText = canonical.resolve(name).readText().replace("\r\n", "\n").trim()
            check(localText == canonicalText) {
                "Kotlin fixture $name drifted from the canonical protocol fixture."
            }
        }
    }
}

tasks.named("check") {
    dependsOn(verifyUnreleased, verifyCanonicalFixtures)
}
