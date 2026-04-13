// test/compile.test.js — Tests that generated Swift code compiles under Swift 6
//
// Run with: node --test test/compile.test.js
//
// These tests are slower since they invoke `swift build` for each configuration.
// They verify that the generated code actually compiles, not just that it looks right.

const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const { generate, swiftBuild } = require('./helpers');

describe('swift compilation — basic spec (JSON + reconnect)', () => {
  let out;
  before(() => { out = generate('basic.asyncapi.yaml', { server: 'local' }); });

  it('compiles without errors', () => {
    const result = swiftBuild(out);
    assert.ok(result.success, `swift build failed:\n${result.stdout}\n${result.stderr}`);
  });

  it('compiles with zero warnings', () => {
    const result = swiftBuild(out);
    const warnings = (result.stdout.match(/warning:/gi) || []).length;
    assert.equal(warnings, 0, `expected 0 warnings, got ${warnings}:\n${result.stdout}`);
  });
});

describe('swift compilation — basic spec (no reconnect)', () => {
  let out;
  before(() => { out = generate('basic.asyncapi.yaml', { server: 'local', reconnect: 'false' }); });

  it('compiles without errors', () => {
    const result = swiftBuild(out);
    assert.ok(result.success, `swift build failed:\n${result.stdout}\n${result.stderr}`);
  });
});

describe('swift compilation — enums-and-refs spec', () => {
  let out;
  before(() => { out = generate('enums-and-refs.asyncapi.yaml', { server: 'local' }); });

  it('compiles without errors', () => {
    const result = swiftBuild(out);
    assert.ok(result.success, `swift build failed:\n${result.stdout}\n${result.stderr}`);
  });
});

describe('swift compilation — enums-and-refs with typePrefix', () => {
  let out;
  before(() => { out = generate('enums-and-refs.asyncapi.yaml', { server: 'local', typePrefix: 'TST' }); });

  it('compiles without errors', () => {
    const result = swiftBuild(out);
    assert.ok(result.success, `swift build failed:\n${result.stdout}\n${result.stderr}`);
  });
});

describe('swift compilation — msgpack spec', () => {
  let out;
  before(() => { out = generate('msgpack.asyncapi.yaml', { server: 'local', serialization: 'msgpack' }); });

  it('compiles without errors', () => {
    const result = swiftBuild(out);
    assert.ok(result.success, `swift build failed:\n${result.stdout}\n${result.stderr}`);
  });
});

describe('swift compilation — combined (msgpack + prefix + no reconnect)', () => {
  let out;
  before(() => {
    out = generate('msgpack.asyncapi.yaml', {
      server: 'local',
      serialization: 'msgpack',
      typePrefix: 'XYZ',
      reconnect: 'false',
    });
  });

  it('compiles without errors', () => {
    const result = swiftBuild(out);
    assert.ok(result.success, `swift build failed:\n${result.stdout}\n${result.stderr}`);
  });
});

describe('swift compilation — mixed-payloads spec (int enums + plain string messages)', () => {
  let out;
  before(() => { out = generate('mixed-payloads.asyncapi.yaml', { server: 'local' }); });

  it('compiles without errors', () => {
    const result = swiftBuild(out);
    assert.ok(result.success, `swift build failed:\n${result.stdout}\n${result.stderr}`);
  });
});

describe('swift compilation — mixed-payloads with typePrefix', () => {
  let out;
  before(() => { out = generate('mixed-payloads.asyncapi.yaml', { server: 'local', typePrefix: 'MIX' }); });

  it('compiles without errors', () => {
    const result = swiftBuild(out);
    assert.ok(result.success, `swift build failed:\n${result.stdout}\n${result.stderr}`);
  });
});

describe('swift compilation — custom-discriminator spec (event_type key)', () => {
  let out;
  before(() => { out = generate('custom-discriminator.asyncapi.yaml', { server: 'production' }); });

  it('compiles without errors', () => {
    const result = swiftBuild(out);
    assert.ok(result.success, `swift build failed:\n${result.stdout}\n${result.stderr}`);
  });
});

describe('swift compilation — custom-discriminator with typePrefix', () => {
  let out;
  before(() => { out = generate('custom-discriminator.asyncapi.yaml', { server: 'production', typePrefix: 'CD' }); });

  it('compiles without errors', () => {
    const result = swiftBuild(out);
    assert.ok(result.success, `swift build failed:\n${result.stdout}\n${result.stderr}`);
  });
});
