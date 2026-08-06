// swift-tools-version: 5.10
import PackageDescription

let package = Package(
    name: "SeemplifyJourney",
    platforms: [
        .iOS(.v15),
        .macOS(.v12)
    ],
    products: [
        .library(name: "SeemplifyJourney", targets: ["SeemplifyJourney"])
    ],
    targets: [
        .target(name: "SeemplifyJourney"),
        .testTarget(
            name: "SeemplifyJourneyTests",
            dependencies: ["SeemplifyJourney"],
            resources: [.copy("Fixtures")]
        )
    ]
)
