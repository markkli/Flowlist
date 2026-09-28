// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "Flowlist",
    platforms: [.macOS(.v14)],
    products: [.executable(name: "Flowlist", targets: ["FlowlistMac"])],
    targets: [
        .target(name: "FlowlistCore"),
        // Copy preserves WebUI's directories and hashed asset names. Build the
        // web resources with scripts/build-web.sh before a direct SwiftPM run.
        .executableTarget(name: "FlowlistMac", dependencies: ["FlowlistCore"], resources: [.copy("Resources")]),
        .testTarget(name: "FlowlistCoreTests", dependencies: ["FlowlistCore"]),
        .testTarget(name: "FlowlistMacTests", dependencies: ["FlowlistMac", "FlowlistCore"])
    ]
)
