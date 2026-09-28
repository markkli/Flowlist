// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "Flowlist",
    platforms: [.macOS(.v14)],
    products: [.executable(name: "Flowlist", targets: ["FlowlistMac"])],
    targets: [
        .target(name: "FlowlistCore"),
        .executableTarget(name: "FlowlistMac", dependencies: ["FlowlistCore"], resources: [.copy("Resources")]),
        .testTarget(name: "FlowlistCoreTests", dependencies: ["FlowlistCore"]),
        .testTarget(name: "FlowlistMacTests", dependencies: ["FlowlistMac", "FlowlistCore"])
    ]
)
