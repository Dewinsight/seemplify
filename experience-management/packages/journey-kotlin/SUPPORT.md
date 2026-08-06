# Kotlin/Android support status

This package is an unreleased foundation and has no externally supported
runtime matrix.

Locally targeted build contract:

- Java 17
- Gradle 8.10.2 wrapper
- Android Gradle Plugin 8.7.3
- Kotlin 2.0.21
- compile SDK 35
- minimum Android API 23

These versions describe the build, not a production support promise. Before
release, the programme must ratify and test:

- the current local evidence is 12/12 JVM tests, zero-finding lint, release
  artifact/metadata assembly, and 2/2 instrumentation tests on one Android
  15/API 35 emulator;

- supported Gradle, Kotlin, Android Gradle Plugin, Java, and Android Studio
  combinations;
- physical/emulated API levels, manufacturers, process death, background
  restrictions, doze, storage pressure, backup/restore, reinstall, key
  invalidation, and OS upgrade;
- historical installed-artifact queue upgrades and rollback policy;
- network stacks, TLS policy, proxies/captive portals, and strict-mode behavior;
- lifecycle integration in Application, Activity, service, and multi-process
  hosts; and
- security response, deprecation, compatibility, and support ownership.

The current API and state format may change before any external release.
