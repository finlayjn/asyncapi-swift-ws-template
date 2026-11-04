// lib/params.js — Template parameters as both entry points see them.
//
// The AsyncAPI generator passes every parameter as a string; a library caller may pass
// `openEnums: true` or `reconnect: false`. Every renderer compares against strings, so values
// are stringified once here, and combinations that can't generate are refused for both paths.

function normalizeParams(params = {}) {
  const normalized = {};
  for (const [key, value] of Object.entries(params)) {
    normalized[key] = typeof value === 'boolean' || typeof value === 'number' ? String(value) : value;
  }
  if (normalized.helpersModule && normalized.serialization === 'msgpack' && !normalized.messagePackHelpersModule) {
    throw new Error('helpersModule with MessagePack needs messagePackHelpersModule too');
  }
  return normalized;
}

module.exports = { normalizeParams };
