// test/unions-and-nesting.test.js — 1.4.0 schema handling: open enums, unions, tuples,
// deep inline extraction, null enum members, allOf merging, message/schema name collisions
//
// Run with: node --test test/unions-and-nesting.test.js

const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const { generate, generateResult, readGenerated, swiftBuild } = require('./helpers');

const FIXTURE = 'unions-and-nesting.asyncapi.yaml';

function block(source, declaration) {
  const start = source.indexOf(declaration);
  assert.ok(start >= 0, `missing ${declaration}`);
  return source.slice(start, source.indexOf('\n}', start) + 2);
}

describe('unions-and-nesting — default (closed enums)', () => {
  let models, enums, serializer;

  before(() => {
    const out = generate(FIXTURE, { server: 'local' });
    models = readGenerated(out, 'Sources/Models.swift');
    enums = readGenerated(out, 'Sources/Enums.swift');
    serializer = readGenerated(out, 'Sources/MessageSerializer.swift');
  });

  it('never falls back to JSONValue', () => {
    assert.ok(!models.includes('JSONValue'), 'no JSONValue references expected');
  });

  it('drops null from enum cases and makes the property optional', () => {
    const status = block(enums, 'public enum Status:');
    assert.ok(!status.includes('"null"'), 'null must not become a case');
    assert.ok(status.includes('case settling'));
    assert.ok(models.includes('public let status: Status?'));
  });

  it('types arrays of enums with the enum', () => {
    assert.ok(enums.includes('public enum Tags: String, Codable, Sendable'));
    assert.ok(models.includes('public let tags: [Tags]?'));
  });

  it('extracts inline objects nested inside array items', () => {
    assert.ok(models.includes('public let legs: [Legs]'));
    assert.ok(block(models, 'public struct Legs:').includes('public let liquidity: Liquidity'));
  });

  it('models a primitive oneOf as an enum named after its schema', () => {
    const union = block(models, 'public enum U128stringOrInteger:');
    assert.ok(union.includes('case int(Int)'));
    assert.ok(union.includes('case string(String)'));
    assert.ok(union.indexOf('decode(Int.self)') < union.indexOf('decode(String.self)'), 'Int is tried before String');
  });

  it('models a discriminated oneOf as a tagged enum with unknown', () => {
    const union = block(models, 'public enum GatewayEvent:');
    assert.ok(union.includes('case orderFilled(OrderFilled)'));
    assert.ok(union.includes('case orderCancelled(OrderCancelled)'));
    assert.ok(union.includes('case unknown(String)'));
    assert.ok(union.includes('case discriminator = "type"'));
    assert.ok(models.includes('public let events: [GatewayEvent]'));
  });

  it('collapses a oneOf of one JSON type to that type', () => {
    assert.ok(block(models, 'public struct PlaceOrder:').includes('public let channel: String?'));
  });

  it('generates a positional tuple struct with labelled elements', () => {
    const tuple = block(models, 'public struct SubId:');
    assert.ok(tuple.includes('public let underlyingId: Int'));
    assert.ok(tuple.includes('public let expiryTs: Int'));
    assert.ok(tuple.includes('public let strike: String'), 'title names the element');
    assert.ok(tuple.includes('public let right: Right'), 'enum element uses the enum');
    assert.ok(tuple.includes('decoder.unkeyedContainer()'));
  });

  it('merges allOf array items into one inline struct', () => {
    const entries = block(models, 'public struct Entries:');
    assert.ok(entries.includes('public let eventId: String'));
    assert.ok(entries.includes('public let source: String'));
  });

  it('resolves a single-member allOf to its member', () => {
    assert.ok(models.includes('public let balance: String?'));
  });

  it('renames a message struct that collides with a component schema', () => {
    assert.ok(block(models, 'public struct Fill:').includes('public let executionId: String'));
    assert.ok(block(models, 'public struct FillMessage:').includes('public let fill: Fill'));
  });

  it('keeps closed enums and the plain serializer init', () => {
    assert.ok(enums.includes('public enum Side: String, Codable, Sendable'));
    assert.ok(!enums.includes('UnknownEnumValue'));
    assert.ok(serializer.includes('public init() {}'));
  });

  it('compiles', () => {
    const result = swiftBuild(generate(FIXTURE, { server: 'local' }));
    assert.ok(result.success, `swift build failed:\n${result.stdout}\n${result.stderr}`);
  });
});

describe('unions-and-nesting — openEnums=true', () => {
  let out, enums, serializer;

  before(() => {
    out = generate(FIXTURE, { server: 'local', openEnums: 'true' });
    enums = readGenerated(out, 'Sources/Enums.swift');
    serializer = readGenerated(out, 'Sources/MessageSerializer.swift');
  });

  it('adds an unknown case carrying the raw value', () => {
    const side = block(enums, 'public enum Side:');
    assert.ok(side.includes('RawRepresentable, CaseIterable, Codable, Sendable, Hashable'));
    assert.ok(side.includes('case unknown(String)'));
    assert.ok(side.includes('default: self = .unknown(rawValue)'));
    assert.ok(side.includes('public static let allCases: [Side] = [.buy, .sell]'));
  });

  it('reports unknown values through the decoder userInfo', () => {
    assert.ok(enums.includes('public struct UnknownEnumValue: Sendable, Hashable'));
    assert.ok(block(enums, 'public enum Side:').includes('UnknownEnumValue.report(type: "Side"'));
  });

  it('lets the serializer take a handler', () => {
    assert.ok(serializer.includes('public init(unknownEnumValueHandler: UnknownEnumValue.Handler? = nil)'));
  });

  it('compiles', () => {
    const result = swiftBuild(out);
    assert.ok(result.success, `swift build failed:\n${result.stdout}\n${result.stderr}`);
  });

  it('compiles with msgpack and a type prefix', () => {
    const msgpack = generate(FIXTURE, { server: 'local', openEnums: 'true', serialization: 'msgpack', typePrefix: 'UN' });
    const source = readGenerated(msgpack, 'Sources/MessageSerializer.swift');
    assert.ok(source.includes('decoder.userInfo[UNUnknownEnumValue.handlerKey]'));
    const result = swiftBuild(msgpack);
    assert.ok(result.success, `swift build failed:\n${result.stdout}\n${result.stderr}`);
  });
});

describe('unions-and-nesting — msgpack array format', () => {
  it('falls back to JSONValue for object unions, which need keyed containers', () => {
    const result = generateResult(FIXTURE, { server: 'local', serialization: 'msgpack', msgpackFormat: 'array' });
    assert.ok(result.success, result.error);
    const models = readGenerated(result.outputDir, 'Sources/Models.swift');
    assert.ok(!models.includes('public enum GatewayEvent:'));
    assert.ok(models.includes('public let events: [JSONValue]'));
  });
});
