// test/edge-cases.test.js — Specs and parameters at the edges: messages no property tells apart,
// one-direction specs, constants that need escaping, boolean parameters, and shared helpers
// without a type prefix.
//
// Run with: node --test test/edge-cases.test.js
//
// Mostly uses the library (lib/); one test runs the CLI, and the compile tests need Swift.

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { execSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Parser, fromFile } = require('@asyncapi/parser');
const { generate, generateHelpers } = require('../lib');
const cli = require('./helpers');

const FIXTURES = path.join(__dirname, 'fixtures');

async function parse(fixture) {
  const { document, diagnostics } = await fromFile(new Parser(), path.join(FIXTURES, fixture)).parse();
  assert.ok(document, diagnostics.map((d) => d.message).join('; '));
  return document;
}

const byPath = (files) => Object.fromEntries(files.map((f) => [f.path, f.content]));

/** Writes targets into a new package and builds it; returns the build output. */
function swiftBuild(name, targets, packageTargets) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `${name}-`));
  for (const [target, files] of Object.entries(targets)) {
    for (const file of files) {
      const out = path.join(dir, 'Sources', target, file.path.replace(/^Sources\//, ''));
      fs.mkdirSync(path.dirname(out), { recursive: true });
      fs.writeFileSync(out, file.content);
    }
  }
  fs.writeFileSync(path.join(dir, 'Package.swift'), `// swift-tools-version: 6.0
import PackageDescription
let package = Package(
    name: "${name}",
    platforms: [.iOS(.v18), .macOS(.v15)],
    targets: [
${packageTargets.map((t) => `        ${t},`).join('\n')}
    ],
    swiftLanguageModes: [.v6]
)
`);
  try {
    return execSync('swift build 2>&1', { cwd: dir, timeout: 300000, stdio: 'pipe' }).toString();
  } catch (err) {
    assert.fail(`swift build failed:\n${err.stdout}`);
  }
}

describe('the incoming discriminator at the edges', () => {
  it('fails generation when messages share the only property every message has', async () => {
    // `event` tells the two orders apart, but trade and heartbeat don't have it.
    const document = await parse('partial-discriminator.asyncapi.yaml');
    assert.throws(
      () => generate(document, { server: 'local' }),
      /"order_new" and "order_cancel" would both decode on type = "order"/
    );
  });

  it('fails generation when no property has a constant in every message', async () => {
    const document = await parse('no-common-discriminator.asyncapi.yaml');
    assert.throws(
      () => generate(document, { server: 'local' }),
      /no property has a constant in every incoming message \("status", "tick"\)/
    );
  });

  it('escapes constants and keys in the generated Swift', async () => {
    const messages = byPath(generate(await parse('one-direction.asyncapi.yaml'), { server: 'local' }))['Sources/MessageEnums.swift'];
    assert.match(messages, /case "say \\"hi\\"":/);
    assert.match(messages, /case "back\\\\slash":/);
    assert.match(messages, /case eventType = "event-type"/);
  });
});

describe('parameters', () => {
  it('accepts booleans from a library caller', async () => {
    const basic = byPath(generate(await parse('basic.asyncapi.yaml'), { server: 'local', reconnect: false }));
    assert.doesNotMatch(basic['Sources/WebSocketClient.swift'], /ReconnectionPolicy/);
    const open = byPath(generate(await parse('unknown-value.asyncapi.yaml'), { server: 'local', openEnums: true }));
    assert.match(open['Sources/Enums.swift'], /case unknown\(String\)/);
  });

  it('makes reconnect=false the spec\'s default policy with shared helpers', async () => {
    const files = byPath(generate(await parse('basic.asyncapi.yaml'), { server: 'local', reconnect: 'false', helpersModule: 'Helpers' }));
    assert.match(files['Sources/WebSocketClient.swift'], /reconnectionPolicy: ReconnectionPolicy = NoReconnectionPolicy\(\)/);
  });

  it('needs the MessagePack helpers module through the CLI too', () => {
    assert.throws(
      () => cli.generate('msgpack.asyncapi.yaml', { server: 'local', serialization: 'msgpack', helpersModule: 'Helpers' }),
      /messagePackHelpersModule/
    );
  });
});

describe('compilation at the edges', () => {
  it('compiles one-direction specs inline, with no warnings', async () => {
    const document = await parse('one-direction.asyncapi.yaml');
    for (const [name, params] of [['ReceiveOnly', {}], ['SendOnly', { perspective: 'client' }]]) {
      const files = generate(document, { server: 'local', typePrefix: name, ...params }).filter((f) => f.path.startsWith('Sources/'));
      const output = swiftBuild(`${name}Inline`, { [name]: files }, [`.target(name: "${name}")`]);
      assert.equal((output.match(/warning:/gi) || []).length, 0, `expected 0 warnings:\n${output}`);
    }
  });

  it('compiles shared-helper clients without a prefix or in one direction, with no warnings', async () => {
    const oneDirection = await parse('one-direction.asyncapi.yaml');
    const output = swiftBuild('EdgeHelpers', {
      Helpers: generateHelpers(),
      Unprefixed: generate(await parse('basic.asyncapi.yaml'), { server: 'local', helpersModule: 'Helpers' }),
      ReceiveOnly: generate(oneDirection, { server: 'local', typePrefix: 'RO', helpersModule: 'Helpers' }),
      SendOnly: generate(oneDirection, { server: 'local', typePrefix: 'SO', perspective: 'client', helpersModule: 'Helpers' }),
      UseSites: [{ path: 'UseSites.swift', content: `import Foundation
import Unprefixed

// Without a prefix, the old names are the shared types, and WebSocketClient has the spec's messages.
func makeClient() -> WebSocketClient {
    WebSocketClient(configuration: ClientConfiguration(
        url: URL(string: "ws://localhost:9000")!,
        reconnectionPolicy: ExponentialBackoffPolicy(base: 1.0, maxAttempts: 3)
    ))
}

func send(_ client: WebSocketClient) async throws {
    try await client.send(.echo(Echo(message: "hi")))
}
` }],
    }, [
      '.target(name: "Helpers")',
      '.target(name: "Unprefixed", dependencies: ["Helpers"])',
      '.target(name: "ReceiveOnly", dependencies: ["Helpers"])',
      '.target(name: "SendOnly", dependencies: ["Helpers"])',
      '.target(name: "UseSites", dependencies: ["Unprefixed"])',
    ]);
    assert.equal((output.match(/warning:/gi) || []).length, 0, `expected 0 warnings:\n${output}`);
  });
});
