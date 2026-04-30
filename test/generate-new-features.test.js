// test/generate.test.js — continued: tests for anyOf, inline structs, JSONValue,
// and name collision detection/disambiguation
//
// Run with: node --test test/generate-new-features.test.js

const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const { generate, generateResult, readGenerated, generatedFileExists, listGeneratedSwiftFiles, swiftBuild } = require('./helpers');

// ─────────────────────────────────────────────────────────────────────────────
// anyOf nullable patterns, inline anonymous objects, and JSONValue
// ─────────────────────────────────────────────────────────────────────────────

describe('anyof-inline spec (anyOf, inline objects, JSONValue)', () => {
  let out;

  before(() => {
    out = generate('anyof-inline.asyncapi.yaml', { server: 'local' });
  });

  // ── File structure ──

  it('generates all expected Swift source files', () => {
    const files = listGeneratedSwiftFiles(out);
    assert.ok(files.includes('Models.swift'), 'missing Models.swift');
    assert.ok(files.includes('MessageEnums.swift'), 'missing MessageEnums.swift');
  });

  // ── Inline struct generation ──

  describe('Models.swift — inline structs', () => {
    let models;
    before(() => { models = readGenerated(out, 'Sources/Models.swift'); });

    it('generates Quantity inline struct from anyOf anonymous object', () => {
      assert.ok(models.includes('public struct Quantity: Codable, Sendable'));
    });

    it('Quantity has correct properties', () => {
      const start = models.indexOf('public struct Quantity:');
      const end = models.indexOf('\n}', start) + 2;
      const block = models.slice(start, end);
      assert.ok(block.includes('public let value: Double'));
      assert.ok(block.includes('public let unit: String'));
    });

    it('generates Fills inline struct from array items', () => {
      assert.ok(models.includes('public struct Fills: Codable, Sendable'));
    });

    it('Fills has correct properties', () => {
      const start = models.indexOf('public struct Fills:');
      const end = models.indexOf('\n}', start) + 2;
      const block = models.slice(start, end);
      assert.ok(block.includes('public let price: Double'));
      assert.ok(block.includes('public let size: Double'));
      assert.ok(block.includes('public let timestamp: Int'));
    });

    it('inline structs appear before the message structs that use them', () => {
      const quantityPos = models.indexOf('public struct Quantity:');
      const fillsPos = models.indexOf('public struct Fills:');
      const placeOrderPos = models.indexOf('public struct PlaceOrder:');
      const orderStatusPos = models.indexOf('public struct OrderStatus:');
      assert.ok(quantityPos < placeOrderPos, 'Quantity should appear before PlaceOrder');
      assert.ok(fillsPos < orderStatusPos, 'Fills should appear before OrderStatus');
    });
  });

  // ── anyOf nullable (single type + null = optional) ──

  describe('Models.swift — anyOf nullable pattern', () => {
    let models;
    before(() => { models = readGenerated(out, 'Sources/Models.swift'); });

    it('maps anyOf [object, null] to optional type', () => {
      assert.ok(models.includes('public let quantity: Quantity?'));
    });

    it('quantity has nil default in init', () => {
      const placeStart = models.indexOf('public struct PlaceOrder:');
      const initStart = models.indexOf('public init(', placeStart);
      const initEnd = models.indexOf('}', initStart) + 1;
      const initBlock = models.slice(initStart, initEnd);
      assert.ok(initBlock.includes('quantity: Quantity? = nil'));
    });
  });

  // ── anyOf multi-type → JSONValue fallback ──

  describe('Models.swift — multi-type anyOf fallback', () => {
    let models;
    before(() => { models = readGenerated(out, 'Sources/Models.swift'); });

    it('maps multi-type anyOf to JSONValue?', () => {
      assert.ok(models.includes('public let metadata: JSONValue?'));
    });
  });

  // ── JSONValue generation ──

  describe('Models.swift — JSONValue enum', () => {
    let models;
    before(() => { models = readGenerated(out, 'Sources/Models.swift'); });

    it('generates JSONValue enum', () => {
      assert.ok(models.includes('public enum JSONValue: Codable, Sendable, Hashable'));
    });

    it('JSONValue has all expected cases', () => {
      assert.ok(models.includes('case string(String)'));
      assert.ok(models.includes('case int(Int)'));
      assert.ok(models.includes('case double(Double)'));
      assert.ok(models.includes('case bool(Bool)'));
      assert.ok(models.includes('case object([String: JSONValue])'));
      assert.ok(models.includes('case array([JSONValue])'));
      assert.ok(models.includes('case null'));
    });

    it('JSONValue has custom Decodable init', () => {
      assert.ok(models.includes('public init(from decoder: Decoder) throws'));
    });

    it('JSONValue has custom Encodable encode', () => {
      assert.ok(models.includes('public func encode(to encoder: Encoder) throws'));
    });
  });

  // ── Untyped object → [String: JSONValue] ──

  describe('Models.swift — untyped object property', () => {
    let models;
    before(() => { models = readGenerated(out, 'Sources/Models.swift'); });

    it('maps untyped object to [String: JSONValue]', () => {
      assert.ok(models.includes('public let extra: [String: JSONValue]?'));
    });
  });

  // ── Array of inline objects ──

  describe('Models.swift — array of inline objects', () => {
    let models;
    before(() => { models = readGenerated(out, 'Sources/Models.swift'); });

    it('uses inline struct name in array type', () => {
      assert.ok(models.includes('public let fills: [Fills]?'));
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// anyof-inline with typePrefix
// ─────────────────────────────────────────────────────────────────────────────

describe('anyof-inline with typePrefix=AOI', () => {
  let out;

  before(() => {
    out = generate('anyof-inline.asyncapi.yaml', { server: 'local', typePrefix: 'AOI' });
  });

  describe('Models.swift', () => {
    let models;
    before(() => { models = readGenerated(out, 'Sources/Models.swift'); });

    it('prefixes inline struct names', () => {
      assert.ok(models.includes('public struct AOIQuantity: Codable, Sendable'));
      assert.ok(models.includes('public struct AOIFills: Codable, Sendable'));
    });

    it('prefixes message struct names', () => {
      assert.ok(models.includes('public struct AOIPlaceOrder:'));
      assert.ok(models.includes('public struct AOIOrderStatus:'));
      assert.ok(models.includes('public struct AOISnapshot:'));
    });

    it('uses prefixed inline types in properties', () => {
      assert.ok(models.includes(': AOIQuantity?'));
      assert.ok(models.includes(': [AOIFills]?'));
    });

    it('prefixes JSONValue enum', () => {
      assert.ok(models.includes('public enum AOIJSONValue: Codable, Sendable, Hashable'));
    });

    it('uses prefixed JSONValue in properties', () => {
      assert.ok(models.includes(': AOIJSONValue?'));
      assert.ok(models.includes(': [String: AOIJSONValue]?'));
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// JSONValue is NOT generated when not needed
// ─────────────────────────────────────────────────────────────────────────────

describe('basic spec — no JSONValue when not needed', () => {
  let out;

  before(() => {
    out = generate('basic.asyncapi.yaml', { server: 'local' });
  });

  it('does not generate JSONValue when no anyOf/untyped objects exist', () => {
    const models = readGenerated(out, 'Sources/Models.swift');
    assert.ok(!models.includes('enum JSONValue'));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Name collision — error by default
// ─────────────────────────────────────────────────────────────────────────────

describe('name collision — error by default', () => {
  it('fails generation when two messages share the same name', () => {
    const result = generateResult('name-collision.asyncapi.yaml', { server: 'local' });
    assert.ok(!result.success, 'generation should have failed');
    assert.ok(result.error.includes('Message name collision'), 'error should mention collision');
    assert.ok(result.error.includes('submit_order'), 'error should include the colliding name');
    assert.ok(result.error.includes('allowNameCollisions'), 'error should suggest the bypass flag');
  });

  it('error message mentions both message component keys', () => {
    const result = generateResult('name-collision.asyncapi.yaml', { server: 'local' });
    assert.ok(result.error.includes('submitOrder'), 'should mention first message key');
    assert.ok(result.error.includes('submitOrderResponse'), 'should mention second message key');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Name collision — allowNameCollisions bypass
// ─────────────────────────────────────────────────────────────────────────────

describe('name collision — allowNameCollisions=true bypass', () => {
  let out;

  before(() => {
    out = generate('name-collision.asyncapi.yaml', {
      server: 'local',
      allowNameCollisions: 'true',
    });
  });

  describe('Models.swift — disambiguated struct names', () => {
    let models;
    before(() => { models = readGenerated(out, 'Sources/Models.swift'); });

    it('generates the first message struct with original name', () => {
      assert.ok(models.includes('public struct SubmitOrder: Codable, Sendable'));
    });

    it('generates the second message struct with disambiguated name', () => {
      assert.ok(models.includes('public struct SubmitOrderResponse: Codable, Sendable'));
    });

    it('both structs have different const type values', () => {
      // SubmitOrder uses "submit_order"
      const soStart = models.indexOf('public struct SubmitOrder:');
      const soEnd = models.indexOf('\n}\n', soStart);
      const soBlock = models.slice(soStart, soEnd);
      assert.ok(soBlock.includes('self.`type` = "submit_order"'));

      // SubmitOrderResponse uses "submit_order_ack"
      const sorStart = models.indexOf('public struct SubmitOrderResponse:');
      const sorEnd = models.indexOf('\n}\n', sorStart);
      const sorBlock = models.slice(sorStart, sorEnd);
      assert.ok(sorBlock.includes('self.`type` = "submit_order_ack"'));
    });
  });

  describe('MessageEnums.swift — disambiguated cases', () => {
    let msgEnums;
    before(() => { msgEnums = readGenerated(out, 'Sources/MessageEnums.swift'); });

    it('OutgoingMessage has the first message', () => {
      assert.ok(msgEnums.includes('case submitOrder(SubmitOrder)'));
    });

    it('IncomingMessage has the disambiguated message', () => {
      assert.ok(msgEnums.includes('case submitOrderResponse(SubmitOrderResponse)'));
    });

    it('IncomingMessage decodes the disambiguated type correctly', () => {
      assert.ok(msgEnums.includes('case "submit_order_ack":'));
      assert.ok(msgEnums.includes('SubmitOrderResponse(from: decoder)'));
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Name collision — bypass with typePrefix
// ─────────────────────────────────────────────────────────────────────────────

describe('name collision bypass with typePrefix=COL', () => {
  let out;

  before(() => {
    out = generate('name-collision.asyncapi.yaml', {
      server: 'local',
      allowNameCollisions: 'true',
      typePrefix: 'COL',
    });
  });

  describe('Models.swift', () => {
    let models;
    before(() => { models = readGenerated(out, 'Sources/Models.swift'); });

    it('prefixes both disambiguated struct names', () => {
      assert.ok(models.includes('public struct COLSubmitOrder:'));
      assert.ok(models.includes('public struct COLSubmitOrderResponse:'));
    });
  });

  describe('MessageEnums.swift', () => {
    let msgEnums;
    before(() => { msgEnums = readGenerated(out, 'Sources/MessageEnums.swift'); });

    it('prefixes both enum types', () => {
      assert.ok(msgEnums.includes('public enum COLOutgoingMessage:'));
      assert.ok(msgEnums.includes('public enum COLIncomingMessage:'));
    });

    it('uses prefixed types in cases', () => {
      assert.ok(msgEnums.includes('case submitOrder(COLSubmitOrder)'));
      assert.ok(msgEnums.includes('case submitOrderResponse(COLSubmitOrderResponse)'));
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Specs without collisions are unaffected by default
// ─────────────────────────────────────────────────────────────────────────────

describe('basic spec — no collision, no error', () => {
  it('generates successfully without allowNameCollisions', () => {
    const result = generateResult('basic.asyncapi.yaml', { server: 'local' });
    assert.ok(result.success, 'basic spec should generate without error');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Swift compilation — new fixtures
// ─────────────────────────────────────────────────────────────────────────────

describe('swift compilation — anyof-inline spec', () => {
  let out;
  before(() => { out = generate('anyof-inline.asyncapi.yaml', { server: 'local' }); });

  it('compiles without errors', () => {
    const result = swiftBuild(out);
    assert.ok(result.success, `swift build failed:\n${result.stdout}\n${result.stderr}`);
  });
});

describe('swift compilation — anyof-inline with typePrefix', () => {
  let out;
  before(() => { out = generate('anyof-inline.asyncapi.yaml', { server: 'local', typePrefix: 'AOI' }); });

  it('compiles without errors', () => {
    const result = swiftBuild(out);
    assert.ok(result.success, `swift build failed:\n${result.stdout}\n${result.stderr}`);
  });
});

describe('swift compilation — name-collision with bypass', () => {
  let out;
  before(() => { out = generate('name-collision.asyncapi.yaml', { server: 'local', allowNameCollisions: 'true' }); });

  it('compiles without errors', () => {
    const result = swiftBuild(out);
    assert.ok(result.success, `swift build failed:\n${result.stdout}\n${result.stderr}`);
  });
});

describe('swift compilation — name-collision with bypass + prefix', () => {
  let out;
  before(() => { out = generate('name-collision.asyncapi.yaml', { server: 'local', allowNameCollisions: 'true', typePrefix: 'COL' }); });

  it('compiles without errors', () => {
    const result = swiftBuild(out);
    assert.ok(result.success, `swift build failed:\n${result.stdout}\n${result.stderr}`);
  });
});
