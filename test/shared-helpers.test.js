// test/shared-helpers.test.js — Shared helpers (`helpersModule`) and the unknown-value rule.
//
// Run with: node --test test/shared-helpers.test.js
//
// Uses the library (lib/), so it runs on any Node version. The compile test needs Swift and
// fetches msgpack-swift.

const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const { execSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Parser, fromFile } = require('@asyncapi/parser');
const { generate, generateHelpers, generateMessagePackHelpers } = require('../lib');

const FIXTURES = path.join(__dirname, 'fixtures');

async function parse(fixture) {
  const { document, diagnostics } = await fromFile(new Parser(), path.join(FIXTURES, fixture)).parse();
  assert.ok(document, diagnostics.map((d) => d.message).join('; '));
  return document;
}

const byPath = (files) => Object.fromEntries(files.map((f) => [f.path, f.content]));

describe('unknown values', () => {
  it('keeps `unknown(raw)` as the fallback and renames a spec value named unknown', async () => {
    const files = byPath(generate(await parse('unknown-value.asyncapi.yaml'), { server: 'local', openEnums: 'true' }));
    const enums = files['Sources/Enums.swift'];
    assert.match(enums, /case unknownValue\n/);
    assert.match(enums, /case unknown\(String\)/);
    assert.match(enums, /case "unknown": self = \.unknownValue/);
    assert.match(enums, /default: self = \.unknown\(rawValue\)/);
  });
});

describe('shared helpers: a spec module', () => {
  let json;
  let msgpack;
  before(async () => {
    json = byPath(generate(await parse('client-perspective.asyncapi.yaml'), {
      server: 'local', perspective: 'client', openEnums: 'true', typePrefix: 'CP', helpersModule: 'Helpers',
    }));
    msgpack = byPath(generate(await parse('msgpack.asyncapi.yaml'), {
      server: 'local', serialization: 'msgpack', openEnums: 'true', typePrefix: 'MP',
      helpersModule: 'Helpers', messagePackHelpersModule: 'HelpersMessagePack',
    }));
  });

  it('generates Sources/ only', () => {
    for (const files of [json, msgpack]) {
      assert.ok(Object.keys(files).every((p) => p.startsWith('Sources/')), Object.keys(files).join(', '));
    }
  });

  it('keeps its old names as aliases of the shared types', () => {
    const client = json['Sources/WebSocketClient.swift'];
    assert.match(client, /import Helpers\n/);
    assert.match(client, /public typealias CPWebSocketClient = WebSocketClient<CPIncomingMessage, CPOutgoingMessage>/);
    assert.match(client, /public typealias CPClientConfiguration = WebSocketClientConfiguration<CPIncomingMessage, CPOutgoingMessage>/);
    assert.match(client, /public typealias CPExponentialBackoffPolicy = ExponentialBackoffPolicy/);
    assert.doesNotMatch(client, /public actor/);
    assert.match(json['Sources/MessageSerializer.swift'], /public typealias CPUnknownEnumValue = UnknownEnumValue/);
  });

  it('gives its configuration the spec\'s serializer', () => {
    assert.match(json['Sources/WebSocketClient.swift'], /serializer: JSONMessageSerializer\(\)/);
    assert.match(msgpack['Sources/WebSocketClient.swift'], /import HelpersMessagePack/);
    assert.match(msgpack['Sources/WebSocketClient.swift'], /serializer: MessagePackSerializer\(\)/);
  });

  it('reports unknown values through the shared type', async () => {
    const files = byPath(generate(await parse('unknown-value.asyncapi.yaml'), { server: 'local', openEnums: 'true', typePrefix: 'UV', helpersModule: 'Helpers' }));
    const enums = files['Sources/Enums.swift'];
    assert.match(enums, /import Helpers\n/);
    assert.doesNotMatch(enums, /public struct UVUnknownEnumValue/);
    assert.match(enums, /UnknownEnumValue\.report\(type: "UVState"/);
  });

  it('lets the shared client keep undecodable messages', () => {
    assert.match(json['Sources/MessageEnums.swift'], /extension CPIncomingMessage: IncomingWebSocketMessage \{\n    public static func message\(undecodable data: Data, error: any Error\) -> Self\? \{\n        \.undecodable\(data, error\)/);
  });

  it('needs the MessagePack helpers module for MessagePack', async () => {
    await assert.rejects(async () => generate(await parse('msgpack.asyncapi.yaml'), { server: 'local', serialization: 'msgpack', helpersModule: 'Helpers' }), /messagePackHelpersModule/);
  });
});

describe('shared helpers: the helpers module', () => {
  it('has the generic client, the serializers and UnknownEnumValue', () => {
    const files = byPath(generateHelpers());
    assert.match(files['Sources/WebSocketClient.swift'], /public actor WebSocketClient<IncomingMessage: IncomingWebSocketMessage, OutgoingMessage: Encodable & Sendable>/);
    assert.match(files['Sources/WebSocketClient.swift'], /try await task\.send\(configuration\.serializer\.frame\(for: data\)\)/);
    assert.match(files['Sources/MessageSerializer.swift'], /func frame\(for data: Data\) -> URLSessionWebSocketTask\.Message/);
    assert.match(files['Sources/UnknownEnumValue.swift'], /public static func report/);
    assert.equal(byPath(generateHelpers({ unknownEnumValue: false }))['Sources/UnknownEnumValue.swift'], undefined);
    const messagePack = generateMessagePackHelpers('Helpers')[0].content;
    assert.match(messagePack, /import Helpers\n/);
    assert.match(messagePack, /public func frame\(for data: Data\) -> URLSessionWebSocketTask\.Message \{\n        \.data\(data\)/);
  });
});

describe('shared helpers: compilation', () => {
  it('compiles the helpers with a JSON and a MessagePack client, with no warnings', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shared-helpers-'));
    const write = (target, files) => {
      for (const file of files) {
        const out = path.join(dir, 'Sources', target, file.path.replace(/^Sources\//, ''));
        fs.mkdirSync(path.dirname(out), { recursive: true });
        fs.writeFileSync(out, file.content);
      }
    };
    write('Helpers', generateHelpers());
    write('HelpersMessagePack', generateMessagePackHelpers('Helpers'));
    write('CPClient', generate(await parse('client-perspective.asyncapi.yaml'), {
      server: 'local', perspective: 'client', openEnums: 'true', typePrefix: 'CP', helpersModule: 'Helpers',
    }));
    write('MPClient', generate(await parse('msgpack.asyncapi.yaml'), {
      server: 'local', serialization: 'msgpack', openEnums: 'true', typePrefix: 'MP',
      helpersModule: 'Helpers', messagePackHelpersModule: 'HelpersMessagePack',
    }));
    write('UseSites', [{ path: 'UseSites.swift', content: `import Foundation
import Helpers
import CPClient
import MPClient

// Old names, spec defaults and the shared types work together.
func makeClients() -> (CPWebSocketClient, MPWebSocketClient) {
    let json = CPWebSocketClient(configuration: CPClientConfiguration(
        url: URL(string: "ws://localhost:9000")!,
        reconnectionPolicy: CPExponentialBackoffPolicy(base: 1.0, maxAttempts: 3)
    ))
    let msgpack = MPWebSocketClient(configuration: MPClientConfiguration(
        url: URL(string: "ws://localhost:9001")!,
        serializer: JSONMessageSerializer()
    ))
    return (json, msgpack)
}
` }]);
    fs.writeFileSync(path.join(dir, 'Package.swift'), `// swift-tools-version: 6.0
import PackageDescription
let package = Package(
    name: "SharedHelpersCheck",
    platforms: [.iOS(.v18), .macOS(.v15)],
    dependencies: [.package(url: "https://github.com/fumoboy007/msgpack-swift.git", from: "2.0.0")],
    targets: [
        .target(name: "Helpers"),
        .target(name: "HelpersMessagePack", dependencies: ["Helpers", .product(name: "DMMessagePack", package: "msgpack-swift")]),
        .target(name: "CPClient", dependencies: ["Helpers"]),
        .target(name: "MPClient", dependencies: ["Helpers", "HelpersMessagePack", .product(name: "DMMessagePack", package: "msgpack-swift")]),
        .target(name: "UseSites", dependencies: ["Helpers", "CPClient", "MPClient"]),
    ],
    swiftLanguageModes: [.v6]
)
`);
    let output = '';
    try {
      output = execSync('swift build 2>&1', { cwd: dir, timeout: 300000, stdio: 'pipe' }).toString();
    } catch (err) {
      assert.fail(`swift build failed:\n${err.stdout}`);
    }
    const warnings = (output.match(/warning:/gi) || []).length;
    assert.equal(warnings, 0, `expected 0 warnings:\n${output}`);
  });
});

describe('the incoming discriminator', () => {
  it('is the constant that tells every message apart, not a shared member\'s', async () => {
    const files = byPath(generate(await parse('allof-shared-const.asyncapi.yaml'), { server: 'local' }));
    const messages = Object.entries(files).find(([p]) => /MessageEnums|Messages/.test(p))?.[1] ?? Object.values(files).join('\n');
    assert.match(messages, /case "portfolio_snapshot":/);
    assert.match(messages, /case "portfolio_update":/);
    assert.match(messages, /case "heartbeat":/);
    assert.doesNotMatch(messages, /case "USD":/);
  });

  it('fails generation when two messages would share a value', async () => {
    const document = await parse('duplicate-discriminator.asyncapi.yaml');
    assert.throws(() => generate(document, { server: 'local' }), /"snapshot" and "update" would both decode on type = "portfolio_snapshot"/);
  });
});
