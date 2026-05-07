// helpers/swift.js — Swift naming and type-mapping utilities

let _generationWarnings = [];

function addWarning(msg) { _generationWarnings.push(msg); }
function getWarnings() { return _generationWarnings; }
function clearWarnings() { _generationWarnings.length = 0; }

let _allowNameCollisions = false;

function setAllowNameCollisions(allow) { _allowNameCollisions = allow === true || allow === 'true'; }
function getAllowNameCollisions() { return _allowNameCollisions; }

let _perspective = 'server';

/**
 * Set the spec perspective: 'server' (default, standard AsyncAPI v3) or 'client'.
 * In server perspective, action: send = server sends (client receives).
 * In client perspective, action: send = client sends (client sends).
 */
function setPerspective(perspective) { _perspective = perspective === 'client' ? 'client' : 'server'; }
function getPerspective() { return _perspective; }

/**
 * Map a raw AsyncAPI operation action to the client direction.
 * Returns 'outgoing' (client sends) or 'incoming' (client receives).
 */
function clientDirection(action) {
  if (_perspective === 'client') {
    return action === 'send' ? 'outgoing' : 'incoming';
  }
  // server perspective (default): send = server sends → client receives
  return action === 'send' ? 'incoming' : 'outgoing';
}

/**
 * Check whether a schema ID is parser-generated anonymous.
 * The parser v3 uses `<anonymous-schema-N>` format.
 */
function isAnonymousSchema(id) {
  if (!id) return true;
  return /^(<anonymous-schema-\d+>|AnonymousSchema\d+)$/i.test(id);
}

let _typePrefix = '';

/**
 * Set a prefix that will be prepended to all generated Swift type names.
 */
function setTypePrefix(prefix) {
  _typePrefix = prefix || '';
}

/**
 * Get the current type prefix.
 */
function getTypePrefix() {
  return _typePrefix;
}

/**
 * Convert a snake_case or camelCase name to PascalCase (Swift type name).
 * e.g. "place_order" → "PlaceOrder", "authAck" → "AuthAck"
 * Avoids collisions with Swift standard library types.
 * Prepends the configured type prefix.
 */
function toSwiftBaseTypeName(name) {
  if (!name) return '';
  let result = name
    .replace(/[^a-zA-Z0-9_]/g, '_')
    .split(/[_\s]+/)
    .filter(Boolean)
    .map(part => {
      // Split on camelCase boundaries too
      return part.replace(/([a-z])([A-Z])/g, '$1_$2').split('_');
    })
    .flat()
    .filter(Boolean)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join('');

  // Avoid collision with Swift standard library / Foundation types
  if (SWIFT_RESERVED_TYPES.has(result)) {
    result = 'Server' + result;
  }

  return result;
}

function toSwiftTypeName(name) {
  let result = toSwiftBaseTypeName(name);

  // Apply configured prefix
  if (_typePrefix) {
    result = _typePrefix + result;
  }

  return result;
}

// Types from Swift stdlib and Foundation that should not be shadowed
const SWIFT_RESERVED_TYPES = new Set([
  'Error', 'Result', 'Optional', 'Array', 'Dictionary', 'Set',
  'String', 'Int', 'Double', 'Float', 'Bool', 'Data', 'URL',
  'Date', 'UUID', 'Codable', 'Sendable', 'Equatable', 'Hashable',
  'Any', 'AnyObject', 'Void', 'Never', 'Type',
]);

/**
 * Convert a snake_case name to camelCase (Swift property name).
 * e.g. "market_id" → "marketId", "timestamp_ms" → "timestampMs"
 */
function toSwiftPropertyName(name) {
  if (!name) return '';
  const pascal = name
    .replace(/[^a-zA-Z0-9_]/g, '_')
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((word, i) => {
      if (i === 0) return word.toLowerCase();
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join('');
  return escapeSwiftKeyword(pascal);
}

const SWIFT_KEYWORDS = new Set([
  'class', 'struct', 'enum', 'protocol', 'extension', 'func', 'var', 'let',
  'import', 'return', 'if', 'else', 'switch', 'case', 'default', 'for',
  'while', 'repeat', 'break', 'continue', 'in', 'where', 'guard', 'defer',
  'do', 'catch', 'throw', 'throws', 'try', 'as', 'is', 'self', 'Self',
  'super', 'init', 'deinit', 'subscript', 'typealias', 'associatedtype',
  'operator', 'precedencegroup', 'type', 'true', 'false', 'nil',
  'static', 'public', 'private', 'internal', 'fileprivate', 'open',
  'mutating', 'nonmutating', 'override', 'required', 'convenience',
  'dynamic', 'final', 'lazy', 'optional', 'indirect', 'infix',
  'prefix', 'postfix', 'async', 'await', 'actor', 'nonisolated',
  'isolated', 'sending', 'consuming', 'borrowing',
]);

function escapeSwiftKeyword(name) {
  if (SWIFT_KEYWORDS.has(name)) return '`' + name + '`';
  return name;
}

/**
 * Map a JSON Schema property to a Swift type string.
 * @param {object} prop - JSON Schema property object (from schemaToPlain)
 * @param {boolean} isRequired - whether the property is required
 * @param {string} [parentName] - parent type name for nested type generation
 * @param {Map} [inlineStructMap] - inline struct registry (shapeKey → { swiftName })
 * @returns {string} Swift type string
 */
function jsonSchemaTypeToSwift(prop, isRequired = true, parentName = '', inlineStructMap = null) {
  if (!prop) {
    addWarning(`[warn] Null schema for ${parentName || 'unknown'}, using JSONValue`);
    return _prefixed('JSONValue');
  }

  // Handle $ref
  if (prop.$ref) {
    const refName = prop.$ref.split('/').pop();
    const typeName = toSwiftTypeName(refName);
    return isRequired ? typeName : typeName + '?';
  }

  // Handle anyOf / oneOf — special case: one real type + null = optional
  for (const keyword of ['anyOf', 'oneOf']) {
    if (prop[keyword] && Array.isArray(prop[keyword]) && prop[keyword].length > 0) {
      const variants = prop[keyword];
      const nonNull = variants.filter(v => v.type !== 'null');
      const hasNull = variants.some(v => v.type === 'null');

      if (nonNull.length === 1) {
        // Single type + null → that type as optional
        const resolved = jsonSchemaTypeToSwift(nonNull[0], true, parentName, inlineStructMap);
        return (hasNull || !isRequired) ? resolved.replace(/\?$/, '') + '?' : resolved;
      }

      // Genuine multi-type anyOf — not yet supported, warn and fall through
      addWarning(`[warn] Multi-type ${keyword} not fully supported for ${parentName || 'unknown'}, using JSONValue`);
      const fallback = _prefixed('JSONValue');
      return (hasNull || !isRequired) ? fallback + '?' : fallback;
    }
  }

  let swiftType;

  // Handle enum — if it has const, it's a discriminator field, just use String
  if (prop.const !== undefined) {
    swiftType = 'String';
  } else if (prop.enum) {
    // Will be mapped to a dedicated Swift enum type
    swiftType = 'String'; // placeholder, replaced by enum extraction
  } else {
    switch (prop.type) {
      case 'string':
        swiftType = 'String';
        break;
      case 'integer':
        if (prop.format === 'int64') swiftType = 'Int64';
        else if (prop.format === 'uint16') swiftType = 'UInt16';
        else if (prop.format === 'uint64') swiftType = 'UInt64';
        else swiftType = 'Int';
        break;
      case 'number':
        swiftType = 'Double';
        break;
      case 'boolean':
        swiftType = 'Bool';
        break;
      case 'array':
        if (prop.items) {
          // If the items has a real named schema id (resolved $ref, not anonymous), use that type
          if (prop.items._schemaId && !isAnonymousSchema(prop.items._schemaId) && prop.items.type === 'object') {
            swiftType = `[${toSwiftTypeName(prop.items._schemaId)}]`;
          } else if (prop.items.type === 'object' && prop.items.properties && isAnonymousSchema(prop.items._schemaId)) {
            // Inline anonymous object in array — look up in inline struct map
            const resolved = _resolveInlineObject(prop.items, parentName, inlineStructMap);
            swiftType = `[${resolved}]`;
          } else if (prop.items.type === 'array') {
            // Array of arrays (e.g. orderbook levels [[String]])
            const innerType = jsonSchemaTypeToSwift(prop.items, true, parentName, inlineStructMap);
            swiftType = `[${innerType}]`;
          } else if (prop.items.$ref) {
            const refName = prop.items.$ref.split('/').pop();
            swiftType = `[${toSwiftTypeName(refName)}]`;
          } else {
            const itemType = jsonSchemaTypeToSwift(prop.items, true, parentName, inlineStructMap);
            swiftType = `[${itemType}]`;
          }
        } else {
          addWarning(`[warn] Array with no items schema for ${parentName || 'unknown'}, using [JSONValue]`);
          swiftType = `[${_prefixed('JSONValue')}]`;
        }
        break;
      case 'object':
        if (prop._schemaId && !isAnonymousSchema(prop._schemaId)) {
          // Resolved $ref to a named schema
          swiftType = toSwiftTypeName(prop._schemaId);
        } else if (prop.properties) {
          // Nested inline object — look up in inline struct map
          swiftType = _resolveInlineObject(prop, parentName, inlineStructMap);
        } else {
          addWarning(`[warn] Untyped object (no properties) for ${parentName || 'unknown'}, using [String: JSONValue]`);
          swiftType = `[String: ${_prefixed('JSONValue')}]`;
        }
        break;
      default:
        addWarning(`[warn] Unknown/missing type for ${parentName || 'unknown'} (type=${prop.type}), using JSONValue`);
        swiftType = _prefixed('JSONValue');
    }
  }

  if (prop.nullable || !isRequired) {
    return swiftType + '?';
  }
  return swiftType;
}

/**
 * Resolve an inline anonymous object to its deduplicated Swift type name.
 */
function _resolveInlineObject(plainProp, parentName, inlineStructMap) {
  if (inlineStructMap && plainProp.properties) {
    // Build shape key to look up
    const entries = Object.entries(plainProp.properties)
      .map(([name, p]) => {
        let t = p.type || 'unknown';
        if (p.format) t += ':' + p.format;
        if (p.nullable) t += '?';
        return `${name}:${t}`;
      })
      .sort();
    const key = entries.join('|');
    const found = inlineStructMap.get(key);
    if (found) return found.swiftName;
  }
  // Fallback: derive from parent name
  return parentName ? toSwiftTypeName(parentName) : _prefixed('JSONValue');
}

function _prefixed(name) {
  return _typePrefix ? _typePrefix + name : name;
}

/**
 * Check if any property name differs between wire format (snake_case) and Swift (camelCase).
 */
function needsCodingKeys(properties) {
  if (!properties) return false;
  return Object.keys(properties).some(key => {
    const swiftName = toSwiftPropertyName(key);
    // Remove backtick escaping for comparison
    const cleanSwift = swiftName.replace(/`/g, '');
    return cleanSwift !== key;
  });
}

/**
 * Extract the const value from a property schema (for type discriminator).
 */
function constValue(prop) {
  if (!prop) return null;
  return prop.const !== undefined ? prop.const : null;
}

/**
 * Generate Swift enum case name from a const/enum value.
 * e.g. "post_only" → "postOnly", "buy" → "buy"
 */
function toSwiftEnumCase(value) {
  if (!value && value !== 0) return '';
  value = String(value);
  const camel = value
    .replace(/([a-z])([A-Z])/g, '$1_$2')
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((word, i) => {
      if (i === 0) return word.toLowerCase();
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join('');
  // Prefix with _ if starts with a digit (not a valid Swift identifier)
  const result = /^\d/.test(camel) ? '_' + camel : camel;
  return escapeSwiftKeyword(result);
}

/**
 * Derive a default package name from the AsyncAPI document title.
 */
function derivePackageName(title) {
  if (!title) return 'GeneratedWSClient';
  return title
    .replace(/[^a-zA-Z0-9\s]/g, '')
    .split(/\s+/)
    .filter(Boolean)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join('');
}

/**
 * Prefix a hardcoded type name with the configured prefix.
 * Use for types defined in the template itself (not derived from the spec).
 */
function prefixedName(name) {
  return _typePrefix ? _typePrefix + name : name;
}

module.exports = {
  toSwiftTypeName,
  toSwiftBaseTypeName,
  toSwiftPropertyName,
  jsonSchemaTypeToSwift,
  needsCodingKeys,
  constValue,
  toSwiftEnumCase,
  derivePackageName,
  escapeSwiftKeyword,
  setTypePrefix,
  getTypePrefix,
  prefixedName,
  isAnonymousSchema,
  addWarning,
  getWarnings,
  clearWarnings,
  setAllowNameCollisions,
  getAllowNameCollisions,
  setPerspective,
  getPerspective,
  clientDirection,
  SWIFT_KEYWORDS,
};
