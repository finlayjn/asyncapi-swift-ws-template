// test/allof-outgoing.test.js — Tests for allOf composition in outgoing messages
//
// Run with: node --test test/allof-outgoing.test.js
//
// Verifies that allOf-composed outgoing messages generate typed structs
// (not raw String cases) and encode correctly without double-encoding.

const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const { generate, readGenerated, generatedFileExists, swiftBuild } = require('./helpers');

// ─────────────────────────────────────────────────────────────────────────────
// allOf composition for outgoing messages
// ─────────────────────────────────────────────────────────────────────────────

describe('allof-outgoing spec (allOf composition)', () => {
  let out;

  before(() => {
    out = generate('allof-outgoing.asyncapi.yaml', { server: 'local' });
  });

  // ── Models.swift — allOf structs ──

  describe('Models.swift — allOf flattened structs', () => {
    let models;
    before(() => { models = readGenerated(out, 'Sources/Models.swift'); });

    it('generates OrderPreviewSubscribe struct from allOf composition', () => {
      assert.ok(
        models.includes('public struct OrderPreviewSubscribe: Codable, Sendable'),
        'should generate OrderPreviewSubscribe struct'
      );
    });

    it('generates PlaceOrder struct from allOf composition', () => {
      assert.ok(
        models.includes('public struct PlaceOrder: Codable, Sendable'),
        'should generate PlaceOrder struct'
      );
    });

    it('OrderPreviewSubscribe has properties from both allOf schemas', () => {
      const start = models.indexOf('public struct OrderPreviewSubscribe:');
      const end = models.indexOf('\n}\n', start) + 3;
      const block = models.slice(start, end);

      // From OrderInput ($ref)
      assert.ok(block.includes('assetId'), 'should have assetId from OrderInput');
      assert.ok(block.includes('amount'), 'should have amount from OrderInput');

      // From the inline schema
      assert.ok(block.includes('previewId'), 'should have previewId from inline schema');
      assert.ok(block.includes('`type`: String') || block.includes('type: String'), 'should have type const field');
    });

    it('PlaceOrder has properties from both allOf schemas', () => {
      const start = models.indexOf('public struct PlaceOrder:');
      const end = models.indexOf('\n}\n', start) + 3;
      const block = models.slice(start, end);

      // From OrderInput ($ref)
      assert.ok(block.includes('assetId'), 'should have assetId from OrderInput');
      assert.ok(block.includes('amount'), 'should have amount from OrderInput');

      // From the inline schema
      assert.ok(block.includes('orderId'), 'should have orderId from inline schema');
      assert.ok(block.includes('`type`: String') || block.includes('type: String'), 'should have type const field');
    });

    it('allOf struct has CodingKeys for snake_case properties', () => {
      const start = models.indexOf('public struct OrderPreviewSubscribe:');
      const end = models.indexOf('\n}\n', start) + 3;
      const block = models.slice(start, end);
      assert.ok(block.includes('case previewId = "preview_id"'), 'should have preview_id CodingKey');
      assert.ok(block.includes('case assetId = "asset_id"'), 'should have asset_id CodingKey');
    });

    it('allOf struct has const auto-assignment in init', () => {
      const start = models.indexOf('public struct OrderPreviewSubscribe:');
      const end = models.indexOf('\n}\n', start) + 3;
      const block = models.slice(start, end);
      assert.ok(
        block.includes('self.`type` = "order_preview_subscribe"') ||
        block.includes('self.type = "order_preview_subscribe"'),
        'should auto-assign const type value'
      );
    });

    it('allOf struct init excludes const fields from parameters', () => {
      const start = models.indexOf('public struct OrderPreviewSubscribe:');
      const initStart = models.indexOf('public init(', start);
      const initEnd = models.indexOf('}', initStart) + 1;
      const initBlock = models.slice(initStart, initEnd);
      // type should NOT be a parameter (it's a const)
      assert.ok(!initBlock.includes('type: String'), 'const type should not be an init parameter');
      // previewId should be a parameter
      assert.ok(initBlock.includes('previewId: String'), 'previewId should be an init parameter');
    });

    it('resolves $ref types in allOf flattened properties', () => {
      const start = models.indexOf('public struct OrderPreviewSubscribe:');
      const end = models.indexOf('\n}\n', start) + 3;
      const block = models.slice(start, end);
      assert.ok(block.includes('OrderAmount'), 'should reference OrderAmount type from $ref');
    });

    it('still generates normal (non-allOf) outgoing struct', () => {
      assert.ok(
        models.includes('public struct CancelOrder: Codable, Sendable'),
        'non-allOf CancelOrder should still generate'
      );
    });
  });

  // ── MessageEnums.swift — typed outgoing cases ──

  describe('MessageEnums.swift — allOf typed outgoing cases', () => {
    let enums;
    before(() => { enums = readGenerated(out, 'Sources/MessageEnums.swift'); });

    it('uses typed case for allOf outgoing message (not String)', () => {
      assert.ok(
        enums.includes('case orderPreviewSubscribe(OrderPreviewSubscribe)'),
        'should have typed case for orderPreviewSubscribe'
      );
      assert.ok(
        !enums.includes('case orderPreviewSubscribe(String)'),
        'should NOT have String case for orderPreviewSubscribe'
      );
    });

    it('uses typed case for PlaceOrder allOf message', () => {
      assert.ok(
        enums.includes('case placeOrder(PlaceOrder)'),
        'should have typed case for placeOrder'
      );
      assert.ok(
        !enums.includes('case placeOrder(String)'),
        'should NOT have String case for placeOrder'
      );
    });

    it('encodes allOf messages using value.encode(to:) not singleValueContainer', () => {
      // Find the encode method for orderPreviewSubscribe
      const encodeStart = enums.indexOf('case .orderPreviewSubscribe(let value):');
      assert.ok(encodeStart !== -1, 'should have encode case for orderPreviewSubscribe');
      // Next line should be try value.encode(to: encoder)
      const nextLine = enums.indexOf('\n', encodeStart) + 1;
      const encodeLine = enums.slice(nextLine, enums.indexOf('\n', nextLine)).trim();
      assert.ok(
        encodeLine.includes('try value.encode(to: encoder)'),
        `expected 'try value.encode(to: encoder)' but got '${encodeLine}'`
      );
    });

    it('still uses typed case for non-allOf outgoing message', () => {
      assert.ok(
        enums.includes('case cancelOrder(CancelOrder)'),
        'should have typed case for cancelOrder'
      );
    });
  });

  // ── Enums.swift — enum extraction from allOf schemas ──

  describe('Enums.swift — enums from allOf schemas', () => {
    let enums;
    before(() => { enums = readGenerated(out, 'Sources/Enums.swift'); });

    it('extracts Side enum from allOf-referenced OrderInput', () => {
      assert.ok(enums.includes('case buy'), 'should have buy case');
      assert.ok(enums.includes('case sell'), 'should have sell case');
    });

    it('extracts OrderType enum from allOf-referenced OrderInput', () => {
      assert.ok(enums.includes('case gtc'), 'should have GTC case (lowered)');
      assert.ok(enums.includes('case fok'), 'should have FOK case (lowered)');
    });
  });

  // ── Compilation ──

  describe('Swift compilation', () => {
    it('compiles without errors', () => {
      const result = swiftBuild(out);
      assert.ok(result.success, `swift build failed:\n${result.stdout}\n${result.stderr}`);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// allOf with typePrefix
// ─────────────────────────────────────────────────────────────────────────────

describe('allof-outgoing spec with typePrefix', () => {
  let out;

  before(() => {
    out = generate('allof-outgoing.asyncapi.yaml', { server: 'local', typePrefix: 'PTLD' });
  });

  describe('Models.swift — prefixed allOf structs', () => {
    let models;
    before(() => { models = readGenerated(out, 'Sources/Models.swift'); });

    it('generates prefixed struct for allOf message', () => {
      assert.ok(
        models.includes('public struct PTLDOrderPreviewSubscribe: Codable, Sendable'),
        'should generate PTLDOrderPreviewSubscribe'
      );
    });

    it('generates prefixed struct for second allOf message', () => {
      assert.ok(
        models.includes('public struct PTLDPlaceOrder: Codable, Sendable'),
        'should generate PTLDPlaceOrder'
      );
    });

    it('references prefixed enum types in allOf struct', () => {
      const start = models.indexOf('public struct PTLDOrderPreviewSubscribe:');
      const end = models.indexOf('\n}\n', start) + 3;
      const block = models.slice(start, end);
      assert.ok(block.includes('PTLDSide') || block.includes('PTLD'), 'should use prefixed enum types');
    });
  });

  describe('MessageEnums.swift — prefixed typed outgoing cases', () => {
    let enums;
    before(() => { enums = readGenerated(out, 'Sources/MessageEnums.swift'); });

    it('uses prefixed typed case for allOf outgoing message', () => {
      assert.ok(
        enums.includes('case orderPreviewSubscribe(PTLDOrderPreviewSubscribe)'),
        'should have prefixed typed case'
      );
    });
  });

  describe('Swift compilation with prefix', () => {
    it('compiles without errors', () => {
      const result = swiftBuild(out);
      assert.ok(result.success, `swift build failed:\n${result.stdout}\n${result.stderr}`);
    });
  });
});
