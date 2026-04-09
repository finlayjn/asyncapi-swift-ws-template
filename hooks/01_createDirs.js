const fs = require('fs');
const path = require('path');

module.exports = {
  'generate:before': async function createDirectories({ targetDir }) {
    const sourcesDir = path.join(targetDir, 'Sources');
    fs.mkdirSync(sourcesDir, { recursive: true });
  },
};
