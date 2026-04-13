const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

module.exports = {
  'generate:after': async function formatOutput({ targetDir, params }) {
    const formatter = params?.formatter;
    if (!formatter) return;

    const sourcesDir = path.join(targetDir, 'Sources');
    if (!fs.existsSync(sourcesDir)) return;

    const swiftFiles = fs.readdirSync(sourcesDir)
      .filter(f => f.endsWith('.swift'))
      .map(f => path.join(sourcesDir, f));

    if (swiftFiles.length === 0) return;

    const fileArgs = swiftFiles.map(f => `"${f}"`).join(' ');
    // Safety: never invoke the formatter without explicit file paths —
    // tools like swift-format will format the entire working directory if called bare.
    if (!fileArgs) {
      throw new Error('Formatter aborted: no Swift file arguments resolved. This should not happen.');
    }
    const cmd = `${formatter} ${fileArgs}`;
    try {
      execSync(cmd, { stdio: 'pipe', timeout: 30000 });
    } catch (err) {
      const stderr = err.stderr ? err.stderr.toString() : '';
      console.warn(`Warning: formatter command failed: ${stderr || err.message}`);
    }
  },
};
