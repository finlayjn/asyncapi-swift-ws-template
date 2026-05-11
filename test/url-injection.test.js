// test/url-injection.test.js — Tests for server URL injection prevention
//
// Run with: node --test test/url-injection.test.js
//
// Verifies that malicious server URLs (containing quotes, backslashes, newlines,
// or other injection characters) are rejected by the generator, and that
// swiftStringEscape properly neutralises dangerous characters.

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { generateResult } = require('./helpers');
const { swiftStringEscape } = require('../helpers/swift');

// ─────────────────────────────────────────────────────────────────────────────
// Unit tests for swiftStringEscape
// ─────────────────────────────────────────────────────────────────────────────

describe('swiftStringEscape', () => {
  it('passes through a clean URL unchanged', () => {
    assert.equal(swiftStringEscape('wss://example.com:443/path'), 'wss://example.com:443/path');
  });

  it('escapes double quotes', () => {
    assert.equal(swiftStringEscape('before"after'), 'before\\"after');
  });

  it('escapes backslashes', () => {
    assert.equal(swiftStringEscape('back\\slash'), 'back\\\\slash');
  });

  it('escapes newlines', () => {
    assert.equal(swiftStringEscape('line1\nline2'), 'line1\\nline2');
  });

  it('escapes carriage returns', () => {
    assert.equal(swiftStringEscape('line1\rline2'), 'line1\\rline2');
  });

  it('strips null bytes', () => {
    assert.equal(swiftStringEscape('null\u0000byte'), 'nullbyte');
  });

  it('escapes a full injection payload', () => {
    const payload = 'real")!; let pwned = malicious(); _ = URL(string:"x';
    const escaped = swiftStringEscape(payload);
    // The escaped output should not contain a bare unescaped quote —
    // every " must be preceded by a backslash
    assert.ok(!/(^|[^\\])"/g.test(escaped), 'escaped string must not contain unescaped quotes');
    assert.ok(escaped.includes('\\"'), 'escaped string should contain escaped quotes');
  });

  it('handles combined dangerous characters', () => {
    const payload = 'host\\"\n\r\u0000';
    const escaped = swiftStringEscape(payload);
    assert.equal(escaped, 'host\\\\\\"\\n\\r');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// End-to-end: generator rejects malicious server URLs
// ─────────────────────────────────────────────────────────────────────────────

describe('server URL injection prevention (end-to-end)', () => {
  it('rejects a server URL containing double quotes', () => {
    const result = generateResult('malicious-url-quote.asyncapi.yaml', { server: 'evil' });
    assert.equal(result.success, false, 'generation should fail for URL with quotes');
    assert.ok(
      result.error.includes('Unsafe server URL'),
      `error should mention unsafe URL, got: ${result.error.slice(0, 200)}`
    );
  });

  it('rejects a server URL containing backslash injection', () => {
    const result = generateResult('malicious-url-backslash.asyncapi.yaml', { server: 'evil' });
    assert.equal(result.success, false, 'generation should fail for URL with backslashes');
    assert.ok(
      result.error.includes('Unsafe server URL'),
      `error should mention unsafe URL, got: ${result.error.slice(0, 200)}`
    );
  });
});
