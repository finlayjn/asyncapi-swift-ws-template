// lib/PackageSwift.js — Generates Package.swift for the SPM package

const { derivePackageName } = require('../helpers/swift');

function PackageSwift({ asyncapi, params }) {
  // With shared helpers the host package owns its manifest; only Sources/ is generated.
  if (params?.helpersModule) return null;
  const title = asyncapi.info().title() || 'GeneratedWSClient';
  const packageName = params.packageName || derivePackageName(title);
  const useMsgpack = params.serialization === 'msgpack';

  const msgpackDep = useMsgpack
    ? `\n        .package(url: "https://github.com/fumoboy007/msgpack-swift.git", from: "2.0.0"),`
    : '';
  const msgpackTarget = useMsgpack
    ? `\n                .product(name: "DMMessagePack", package: "msgpack-swift"),`
    : '';

  return { path: 'Package.swift', content: (`// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "${packageName}",
    platforms: [
        .iOS(.v16),
        .macOS(.v13),
        .tvOS(.v16),
        .watchOS(.v9),
    ],
    products: [
        .library(
            name: "${packageName}",
            targets: ["${packageName}"]
        ),
    ],
    dependencies: [${msgpackDep}
    ],
    targets: [
        .target(
            name: "${packageName}",
            dependencies: [${msgpackTarget}
            ],
            path: "Sources"
        ),
    ],
    swiftLanguageModes: [.v6]
)`) + '\n' };
}

module.exports = PackageSwift;
