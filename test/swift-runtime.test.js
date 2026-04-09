// test/swift-runtime.test.js — Tests that compile and run Swift code exercising generated types
//
// Run with: node --test test/swift-runtime.test.js
//
// These tests generate a Swift package, inject a test executable, compile and run it.
// They verify that the generated Swift code works correctly at runtime.

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { generate, OUTPUT_BASE } = require('./helpers');

/**
 * Convert a generated library package into an executable package that includes
 * the library sources and a test main file. This avoids cross-module import issues.
 */
function injectTestMain(outputDir, testSwiftFile) {
  // Read the generated Package.swift
  const pkgPath = path.join(outputDir, 'Package.swift');
  let pkg = fs.readFileSync(pkgPath, 'utf-8');

  // Replace the library product with an executable product
  pkg = pkg.replace(
    /\.library\(\s*name:\s*"([^"]+)"[\s\S]*?\)/,
    '.executable(name: "$1", targets: ["$1"])'
  );

  // Replace the library target with an executable target
  pkg = pkg.replace(
    /\.target\(\s*name:\s*"([^"]+)"([\s\S]*?)\)/,
    '.executableTarget(name: "$1"$2)'
  );
  fs.writeFileSync(pkgPath, pkg);

  // Copy the test Swift file into Sources/
  const destFile = path.join(outputDir, 'Sources', 'main.swift');
  fs.copyFileSync(testSwiftFile, destFile);
}

/**
 * Build and run the Swift executable.
 * Returns { success, output }.
 */
function swiftRun(outputDir) {
  try {
    const output = execSync('swift run 2>&1', {
      cwd: outputDir,
      timeout: 180000,
      stdio: 'pipe',
    }).toString();
    return { success: true, output };
  } catch (err) {
    const output = (err.stdout ? err.stdout.toString() : '') + '\n' + (err.stderr ? err.stderr.toString() : '');
    return { success: false, output };
  }
}

describe('Swift runtime tests — basic spec (JSON + reconnect)', () => {
  let out;
  const testFile = path.join(__dirname, 'swift-tests', 'TypeTests.swift');

  before(() => {
    out = generate('basic.asyncapi.yaml', { server: 'local', packageName: 'RuntimeTestBasic' });
    injectTestMain(out, testFile);
  });

  it('compiles and runs with all tests passing', () => {
    const result = swiftRun(out);
    if (!result.success) {
      console.log(result.output);
    }
    assert.ok(result.success, `Swift runtime tests failed:\n${result.output}`);
    assert.ok(result.output.includes('0 failed'), `Some Swift tests failed:\n${result.output}`);
  });

  it('reports test counts', () => {
    const result = swiftRun(out);
    const passMatch = result.output.match(/(\d+) passed/);
    assert.ok(passMatch, 'should report pass count');
    const passCount = parseInt(passMatch[1], 10);
    assert.ok(passCount > 0, `should have at least 1 passing test, got ${passCount}`);
  });
});
