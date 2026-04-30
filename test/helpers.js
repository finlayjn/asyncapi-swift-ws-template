// test/helpers.js — Shared test utilities for generating and inspecting output
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const TEMPLATE_DIR = path.resolve(__dirname, '..');
const FIXTURES_DIR = path.join(__dirname, 'fixtures');
const OUTPUT_BASE = path.join(__dirname, '..', '.test-output');

/**
 * Generate Swift code from a fixture spec with given params.
 * Returns the output directory path.
 */
function generate(fixtureName, params = {}) {
  const specPath = path.join(FIXTURES_DIR, fixtureName);
  if (!fs.existsSync(specPath)) {
    throw new Error(`Fixture not found: ${specPath}`);
  }

  // Build a deterministic output dir name from fixture + params
  const paramStr = Object.entries(params)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join('_');
  const dirName = fixtureName.replace(/\.(asyncapi\.)?ya?ml$/, '') + (paramStr ? `_${paramStr}` : '');
  const outputDir = path.join(OUTPUT_BASE, dirName);

  // Build CLI args
  const paramArgs = Object.entries(params)
    .map(([k, v]) => `-p ${k}=${v}`)
    .join(' ');

  const cmd = `asyncapi generate fromTemplate "${specPath}" "${TEMPLATE_DIR}" -o "${outputDir}" ${paramArgs} --force-write`;

  try {
    execSync(cmd, { stdio: 'pipe', timeout: 30000 });
  } catch (err) {
    const stderr = err.stderr ? err.stderr.toString() : '';
    const stdout = err.stdout ? err.stdout.toString() : '';
    throw new Error(`Generation failed for ${fixtureName}:\n${stderr}\n${stdout}`);
  }

  return outputDir;
}

/**
 * Read a generated file from an output directory.
 */
function readGenerated(outputDir, relativePath) {
  const filePath = path.join(outputDir, relativePath);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Generated file not found: ${filePath}`);
  }
  return fs.readFileSync(filePath, 'utf-8');
}

/**
 * Check if a generated file exists.
 */
function generatedFileExists(outputDir, relativePath) {
  return fs.existsSync(path.join(outputDir, relativePath));
}

/**
 * List all generated Swift source files.
 */
function listGeneratedSwiftFiles(outputDir) {
  const sourcesDir = path.join(outputDir, 'Sources');
  if (!fs.existsSync(sourcesDir)) return [];
  return fs.readdirSync(sourcesDir).filter(f => f.endsWith('.swift'));
}

/**
 * Run `swift build` on a generated output directory.
 * Returns { success, stdout, stderr }.
 */
function swiftBuild(outputDir) {
  try {
    const stdout = execSync('swift build 2>&1', {
      cwd: outputDir,
      timeout: 120000,
      stdio: 'pipe',
    }).toString();
    return { success: true, stdout, stderr: '' };
  } catch (err) {
    return {
      success: false,
      stdout: err.stdout ? err.stdout.toString() : '',
      stderr: err.stderr ? err.stderr.toString() : '',
    };
  }
}

/**
 * Clean all test output.
 */
function cleanOutput() {
  if (fs.existsSync(OUTPUT_BASE)) {
    fs.rmSync(OUTPUT_BASE, { recursive: true, force: true });
  }
}

/**
 * Attempt to generate and return { success, error, outputDir }.
 * Does NOT throw on generation failure — returns the error message instead.
 */
function generateResult(fixtureName, params = {}) {
  const specPath = path.join(FIXTURES_DIR, fixtureName);
  if (!fs.existsSync(specPath)) {
    throw new Error(`Fixture not found: ${specPath}`);
  }

  const paramStr = Object.entries(params)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join('_');
  const dirName = fixtureName.replace(/\.(asyncapi\.)?ya?ml$/, '') + (paramStr ? `_${paramStr}` : '');
  const outputDir = path.join(OUTPUT_BASE, dirName);

  const paramArgs = Object.entries(params)
    .map(([k, v]) => `-p ${k}=${v}`)
    .join(' ');

  const cmd = `asyncapi generate fromTemplate "${specPath}" "${TEMPLATE_DIR}" -o "${outputDir}" ${paramArgs} --force-write`;

  try {
    execSync(cmd, { stdio: 'pipe', timeout: 30000 });
    return { success: true, error: null, outputDir };
  } catch (err) {
    const stderr = err.stderr ? err.stderr.toString() : '';
    const stdout = err.stdout ? err.stdout.toString() : '';
    return { success: false, error: stderr + stdout, outputDir };
  }
}

module.exports = {
  generate,
  generateResult,
  readGenerated,
  generatedFileExists,
  listGeneratedSwiftFiles,
  swiftBuild,
  cleanOutput,
  OUTPUT_BASE,
  FIXTURES_DIR,
  TEMPLATE_DIR,
};
