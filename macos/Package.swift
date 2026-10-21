// swift-tools-version:5.9
// Commentable のデスクトップアプリ（配信者用オーバーレイ）の Swift ネイティブ版
// ビルドは build.sh を使う（.app にまとめて効果音・画像を同梱する）

import PackageDescription

let package = Package(
    name: "Commentable",
    platforms: [.macOS(.v12)],
    targets: [
        .executableTarget(
            name: "Commentable",
            path: "Sources/Commentable",
            linkerSettings: [
                .linkedFramework("AppKit"),
                .linkedFramework("AVFoundation"),
                .linkedFramework("Vision"),
                .linkedFramework("CoreImage"),
                .linkedFramework("Carbon"),
                .linkedFramework("ScreenCaptureKit"),
            ]
        )
    ]
)
