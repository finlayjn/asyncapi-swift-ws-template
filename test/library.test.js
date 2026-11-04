// test/library.test.js — The template as a library (lib/index.js) produces exactly what the
// generator does.
//
// Run with: node --test test/library.test.js

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { Parser, fromFile } = require('@asyncapi/parser');
const { generate: generateWithCLI } = require('./helpers');
const { generate } = require('../lib');

const FIXTURES = path.join(__dirname, 'fixtures');

const cases = [
  ['basic.asyncapi.yaml', { server: 'local' }],
  ['msgpack.asyncapi.yaml', { server: 'local', serialization: 'msgpack', msgpackFormat: 'map', typePrefix: 'MP' }],
  ['client-perspective.asyncapi.yaml', { server: 'local', perspective: 'client', openEnums: 'true' }],
  ['unions-and-nesting.asyncapi.yaml', { server: 'local', openEnums: 'true', typePrefix: 'UN' }],
];

// Generated files only: the compile tests build in the same output folders.
function listFiles(dir, base = dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).filter((entry) => entry.name !== '.build').flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? listFiles(full, base) : [path.relative(base, full)];
  });
}

describe('library mode', () => {
  for (const [fixture, params] of cases) {
    it(`matches the generator for ${fixture}`, async () => {
      const { document, diagnostics } = await fromFile(new Parser(), path.join(FIXTURES, fixture)).parse();
      assert.ok(document, diagnostics.map((d) => d.message).join('; '));
      const files = generate(document, params);

      const outputDir = generateWithCLI(fixture, params);
      const expected = listFiles(outputDir).sort();
      assert.deepEqual(files.map((f) => f.path).sort(), expected);
      for (const file of files) {
        assert.equal(file.content, fs.readFileSync(path.join(outputDir, file.path), 'utf-8'), file.path);
      }
    });
  }
});
