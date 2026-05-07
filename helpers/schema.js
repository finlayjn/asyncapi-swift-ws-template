// helpers/schema.js — Extract messages, schemas, and enums from parsed AsyncAPI v3 document
// Parser v3 API: collections have .all() returning arrays, schemas have method-based accessors

const { toSwiftTypeName, toSwiftBaseTypeName, toSwiftPropertyName, jsonSchemaTypeToSwift, getTypePrefix, isAnonymousSchema, addWarning, getAllowNameCollisions, clientDirection } = require('./swift');

/**
 * Apply the current type prefix to a base name.
 */
function _applyPrefix(baseName) {
  const prefix = getTypePrefix();
  return prefix ? prefix + baseName : baseName;
}

/**
 * Safely call a method or read a property from a parser model object.
 */
function call(obj, method) {
  if (!obj) return undefined;
  if (typeof obj[method] === 'function') return obj[method]();
  return obj[method];
}

/**
 * Extract all messages from operations, tagged with direction (send/receive).
 */
function extractMessages(asyncapi) {
  const messages = [];
  const seen = new Map(); // messageName → { action, messageId }

  const operations = asyncapi.operations();
  if (!operations) return messages;
  const allOps = typeof operations.all === 'function' ? operations.all() : [];

  for (const operation of allOps) {
    const action = operation.action();
    const opMessages = operation.messages();
    if (!opMessages) continue;
    const allMsgs = typeof opMessages.all === 'function' ? opMessages.all() : [];

    for (const message of allMsgs) {
      const messageName = message.name() || message.id();
      const messageId = message.id() || messageName;
      if (!messageName) continue;

      if (seen.has(messageName)) {
        const prev = seen.get(messageName);
        // Same message referenced from multiple operations — safe to skip
        if (prev.messageId === messageId) continue;

        // Different messages sharing the same name — payload collision
        if (!getAllowNameCollisions()) {
          throw new Error(
            `Message name collision: "${messageName}" is used by both ` +
            `"${prev.messageId}" (${prev.action}) and "${messageId}" (${action}) ` +
            `with different payloads. This will cause incorrect decoding at runtime. ` +
            `Fix the spec by giving each message a unique "name", or pass ` +
            `-p allowNameCollisions=true to disambiguate using component keys.`
          );
        }

        // Bypass: disambiguate by using the component message key (messageId)
        addWarning(
          `[warn] Message name collision: "${messageName}" is used by both ` +
          `"${prev.messageId}" (${prev.action}) and "${messageId}" (${action}). ` +
          `Disambiguating: second message will use struct name derived from "${messageId}".`
        );
        // Don't skip — fall through to add with disambiguated name
        // Override messageName with the unique component key for this message
        const disambiguatedName = messageId;
        seen.set(disambiguatedName, { action, messageId });

        const payload = message.payload();
        let constTypeValue = null;
        let discriminatorKey = null;
        let hasObjectPayload = false;

        if (payload && typeof payload.properties === 'function') {
          const props = payload.properties();
          if (props && typeof props === 'object' && Object.keys(props).length > 0) {
            hasObjectPayload = true;
            for (const [key, propSchema] of Object.entries(props)) {
              const c = call(propSchema, 'const');
              if (c !== undefined && c !== null) {
                discriminatorKey = key;
                constTypeValue = String(c);
                break;
              }
            }
          }
        }

        if (!hasObjectPayload && payload) {
          const c = call(payload, 'const');
          if (c !== undefined && c !== null) {
            constTypeValue = String(c);
          }
        }

        messages.push({
          messageName: disambiguatedName,
          swiftName: toSwiftTypeName(disambiguatedName),
          direction: action,
          payload,
          constTypeValue,
          discriminatorKey,
          hasObjectPayload,
          title: (typeof message.title === 'function' ? message.title() : '') || '',
          summary: (typeof message.summary === 'function' ? message.summary() : '') || '',
        });
        continue;
      }
      seen.set(messageName, { action, messageId });

      const payload = message.payload();
      let constTypeValue = null;
      let discriminatorKey = null;
      let hasObjectPayload = false;

      if (payload && typeof payload.properties === 'function') {
        const props = payload.properties();
        if (props && typeof props === 'object' && Object.keys(props).length > 0) {
          hasObjectPayload = true;
          // Find the discriminator: first property with a const value
          for (const [key, propSchema] of Object.entries(props)) {
            const c = call(propSchema, 'const');
            if (c !== undefined && c !== null) {
              discriminatorKey = key;
              constTypeValue = String(c);
              break;
            }
          }
        }
      }

      // For non-object payloads (plain string), check the payload itself for a const
      if (!hasObjectPayload && payload) {
        const c = call(payload, 'const');
        if (c !== undefined && c !== null) {
          constTypeValue = String(c);
        }
      }

      messages.push({
        messageName,
        swiftName: toSwiftTypeName(messageName),
        direction: action,
        payload,
        constTypeValue,
        discriminatorKey,
        hasObjectPayload,
        title: (typeof message.title === 'function' ? message.title() : '') || '',
        summary: (typeof message.summary === 'function' ? message.summary() : '') || '',
      });
    }
  }

  return messages;
}

/**
 * Extract reusable schemas from components.
 */
function extractSchemas(asyncapi) {
  const schemas = [];
  const components = asyncapi.components();
  if (!components) return schemas;

  const componentSchemas = components.schemas();
  if (!componentSchemas) return schemas;
  const allSchemas = typeof componentSchemas.all === 'function' ? componentSchemas.all() : [];

  for (const schema of allSchemas) {
    const name = schema.id();
    schemas.push({
      schemaName: name,
      swiftName: toSwiftTypeName(name),
      schema,
    });
  }
  return schemas;
}

/**
 * Convert a parsed schema model property to a plain JS object.
 */
function schemaToPlain(schema) {
  if (!schema) return {};
  const plain = {};

  // Preserve the schema id (used to detect named $ref types)
  const id = call(schema, 'id');
  if (id) plain._schemaId = id;

  const t = call(schema, 'type');
  if (t) plain.type = Array.isArray(t) ? t[0] : t;

  const f = call(schema, 'format');
  if (f) plain.format = f;

  const c = call(schema, 'const');
  if (c !== undefined && c !== null) plain.const = c;

  const e = call(schema, 'enum');
  if (e) plain.enum = e;

  const d = call(schema, 'description');
  if (d) plain.description = d;

  const def = call(schema, 'default');
  if (def !== undefined && def !== null) plain.default = def;

  const rawType = call(schema, 'type');
  if (Array.isArray(rawType) && rawType.includes('null')) {
    plain.nullable = true;
  }

  const req = call(schema, 'required');
  if (req) plain.required = req;

  if (typeof schema.properties === 'function') {
    const props = schema.properties();
    if (props && typeof props === 'object' && Object.keys(props).length > 0) {
      plain.properties = {};
      for (const [key, value] of Object.entries(props)) {
        plain.properties[key] = schemaToPlain(value);
      }
    }
  }

  if (typeof schema.items === 'function') {
    const items = schema.items();
    if (items) plain.items = schemaToPlain(items);
  }

  // Handle anyOf / oneOf / allOf
  for (const keyword of ['anyOf', 'oneOf', 'allOf']) {
    if (typeof schema[keyword] === 'function') {
      const variants = schema[keyword]();
      if (Array.isArray(variants) && variants.length > 0) {
        plain[keyword] = variants.map(v => schemaToPlain(v));
      }
    }
  }

  // Handle prefixItems (JSON Schema tuple arrays, e.g. TupleArray: [String, String])
  // The parser doesn't expose prefixItems() as a method, so read from raw JSON.
  if (!plain.items) {
    const raw = typeof schema.json === 'function' ? schema.json() : null;
    if (raw && Array.isArray(raw.prefixItems) && raw.prefixItems.length > 0) {
      const types = raw.prefixItems.map(pi => pi.type).filter(Boolean);
      if (types.length === raw.prefixItems.length && new Set(types).size === 1) {
        plain.items = { type: types[0] };
      }
    }
  }

  const minI = call(schema, 'minItems');
  if (minI !== undefined && minI !== null) plain.minItems = minI;
  const maxI = call(schema, 'maxItems');
  if (maxI !== undefined && maxI !== null) plain.maxItems = maxI;

  return plain;
}

/**
 * Extract all enum properties across messages and schemas. Deduplicated.
 */
function extractEnums(asyncapi) {
  const enumMap = new Map(); // key: sorted values, value: enum info
  const nameCount = new Map(); // track name collisions
  const allMessages = extractMessages(asyncapi);
  const allSchemas = extractSchemas(asyncapi);

  for (const msg of allMessages) {
    if (!msg.payload) continue;
    scanForEnums(msg.payload, toSwiftBaseTypeName(msg.messageName || ''), enumMap, nameCount);
  }

  for (const sch of allSchemas) {
    scanForEnums(sch.schema, toSwiftBaseTypeName(sch.schemaName || ''), enumMap, nameCount);
  }

  return Array.from(enumMap.values());
}

/**
 * Recursively scan a schema for enum properties.
 */
function scanForEnums(schema, contextName, enumMap, nameCount) {
  if (!schema || typeof schema.properties !== 'function') return;

  const props = schema.properties();
  if (!props) return;

  for (const [propName, propSchema] of Object.entries(props)) {
    const enumValues = call(propSchema, 'enum') || null;
    const constVal = call(propSchema, 'const');

    if (enumValues && enumValues.length > 1 && constVal === undefined) {
      const allIntegers = enumValues.every(v => typeof v === 'number' && Number.isInteger(v));
      const rawType = allIntegers ? 'Int' : 'String';
      const key = enumValues.slice().sort().join('|');
      if (!enumMap.has(key)) {
        // Disambiguate: if a different enum already uses this property name, prefix with context
        // Use base names (no type prefix) for context building; prefix is applied via toSwiftTypeName at usage sites
        let baseName = toSwiftBaseTypeName(propName);
        const existingWithName = Array.from(enumMap.values()).find(e => e.baseName === baseName);
        if (existingWithName) {
          baseName = contextName + baseName;
        }
        enumMap.set(key, {
          enumName: propName,
          baseName,
          swiftName: _applyPrefix(baseName),
          values: enumValues,
          rawType,
        });
      }
    }

    const propType = call(propSchema, 'type');
    if (propType === 'object' && typeof propSchema.properties === 'function') {
      scanForEnums(propSchema, contextName + toSwiftBaseTypeName(propName), enumMap);
    }

    if (propType === 'array' && typeof propSchema.items === 'function') {
      const items = propSchema.items();
      if (items) {
        const itemType = call(items, 'type');
        if (itemType === 'object' && typeof items.properties === 'function') {
          scanForEnums(items, contextName + toSwiftBaseTypeName(propName), enumMap);
        }
      }
    }
  }
}

/**
 * Build a flat property list from a payload schema.
 * @param {object} schema - Parsed schema model
 * @param {string} parentSwiftName - Parent type name for context
 * @param {Array} [enumDefs] - Extracted enum definitions from extractEnums() for correct type resolution
 * @param {Map} [inlineStructMap] - Inline struct registry for resolving anonymous objects
 * Returns array of { name, swiftName, swiftType, isRequired, isConst, constVal, description, wireFormat }
 */
function buildPropertyList(schema, parentSwiftName, enumDefs, inlineStructMap) {
  if (!schema || typeof schema.properties !== 'function') return [];

  const props = schema.properties();
  if (!props) return [];

  const requiredFields = (typeof schema.required === 'function' ? schema.required() : null) || [];
  const result = [];

  for (const [propName, propSchema] of Object.entries(props)) {
    const plain = schemaToPlain(propSchema);
    const isRequired = requiredFields.includes(propName);
    const swiftPropName = toSwiftPropertyName(propName);

    let swiftType;
    if (plain.enum && !plain.const && plain.enum.length > 1) {
      // Look up the actual enum type name from extracted enums
      const enumKey = plain.enum.slice().sort().join('|');
      const enumDef = enumDefs && enumDefs.find(e => e.values.slice().sort().join('|') === enumKey);
      swiftType = enumDef ? enumDef.swiftName : toSwiftTypeName(propName);
      if (!isRequired || plain.nullable) swiftType += '?';
    } else {
      swiftType = jsonSchemaTypeToSwift(plain, isRequired, parentSwiftName + toSwiftTypeName(propName), inlineStructMap);
    }

    result.push({
      name: propName,
      swiftName: swiftPropName,
      swiftType,
      isRequired,
      isConst: plain.const !== undefined,
      constVal: plain.const || null,
      description: plain.description || '',
      wireFormat: propName,
      requiredIndex: requiredFields.indexOf(propName),
    });
  }

  return result;
}

/**
 * Build the server URL from the parsed asyncapi document and server name.
 */
function buildServerURL(asyncapi, serverName) {
  const servers = asyncapi.servers();
  if (!servers) return null;

  const allServers = typeof servers.all === 'function' ? servers.all() : [];

  for (const server of allServers) {
    if (server.id() === serverName) {
      const protocol = server.protocol();
      const host = server.host();
      const pathname = typeof server.pathname === 'function' ? server.pathname() : '';
      const path = pathname && pathname !== '/' ? pathname : '';
      return { protocol, host, pathname: path, url: `${protocol}://${host}${path}` };
    }
  }
  return null;
}

/**
 * Collect all Swift type names for schemas that appear in receive messages,
 * including nested $ref component schemas.
 */
function collectReceiveSchemaNames(asyncapi) {
  const names = new Set();
  const messages = extractMessages(asyncapi);

  for (const msg of messages) {
    if (clientDirection(msg.direction) !== 'incoming') continue;
    if (!msg.payload) continue;
    if (!msg.hasObjectPayload) continue;
    names.add(msg.swiftName);
    _collectNestedSchemaNames(msg.payload, names);
  }

  return names;
}

function _collectNestedSchemaNames(schema, names) {
  if (!schema || typeof schema.properties !== 'function') return;

  const props = schema.properties();
  if (!props) return;

  for (const [, propSchema] of Object.entries(props)) {
    const propType = call(propSchema, 'type');
    const id = call(propSchema, 'id');

    if (propType === 'object' && id && !isAnonymousSchema(id)) {
      const swiftName = toSwiftTypeName(id);
      if (!names.has(swiftName)) {
        names.add(swiftName);
        _collectNestedSchemaNames(propSchema, names);
      }
    }

    if (propType === 'array' && typeof propSchema.items === 'function') {
      const items = propSchema.items();
      if (items) {
        const itemType = call(items, 'type');
        const itemId = call(items, 'id');
        if (itemType === 'object' && itemId && !isAnonymousSchema(itemId)) {
          const swiftName = toSwiftTypeName(itemId);
          if (!names.has(swiftName)) {
            names.add(swiftName);
            _collectNestedSchemaNames(items, names);
          }
        }
      }
    }
  }
}

/**
 * Compute a shape key for an inline object schema (sorted property names + types).
 * Used to deduplicate identical anonymous structs.
 */
function _shapeKey(plainSchema) {
  if (!plainSchema || !plainSchema.properties) return null;
  const entries = Object.entries(plainSchema.properties)
    .map(([name, prop]) => {
      let t = prop.type || 'unknown';
      if (prop.format) t += ':' + prop.format;
      if (prop.nullable) t += '?';
      return `${name}:${t}`;
    })
    .sort();
  return entries.join('|');
}

/**
 * Extract inline anonymous object schemas from all messages, deduplicated by shape.
 * Returns a Map<shapeKey, { swiftName, plainSchema, schema }> for structs that
 * need to be generated.
 *
 * Also mutates the inline struct registry so that `jsonSchemaTypeToSwift` can
 * resolve anonymous object types by their parent-derived name.
 */
function extractInlineStructs(asyncapi) {
  const structMap = new Map(); // shapeKey → { swiftName, plainSchema, schema }
  const messages = extractMessages(asyncapi);
  const schemas = extractSchemas(asyncapi);

  function scanSchema(schema, parentBaseName) {
    if (!schema || typeof schema.properties !== 'function') return;
    const props = schema.properties();
    if (!props) return;

    for (const [propName, propSchema] of Object.entries(props)) {
      const propType = call(propSchema, 'type');
      const id = call(propSchema, 'id');

      // Direct inline object
      if (propType === 'object' && isAnonymousSchema(id)) {
        _registerInlineObject(propSchema, propName, parentBaseName, structMap);
      }

      // Array of inline objects
      if (propType === 'array' && typeof propSchema.items === 'function') {
        const items = propSchema.items();
        if (items) {
          const itemType = call(items, 'type');
          const itemId = call(items, 'id');
          if (itemType === 'object' && isAnonymousSchema(itemId)) {
            _registerInlineObject(items, propName, parentBaseName, structMap);
          }
        }
      }

      // anyOf/oneOf with an inline object variant (nullable pattern)
      for (const keyword of ['anyOf', 'oneOf']) {
        if (typeof propSchema[keyword] === 'function') {
          const variants = propSchema[keyword]();
          if (!Array.isArray(variants)) continue;
          const nonNull = variants.filter(v => call(v, 'type') !== 'null');
          for (const variant of nonNull) {
            const vType = call(variant, 'type');
            const vId = call(variant, 'id');
            if (vType === 'object' && isAnonymousSchema(vId)) {
              _registerInlineObject(variant, propName, parentBaseName, structMap);
            }
          }
        }
      }

      // Recurse into nested objects
      if (propType === 'object' && typeof propSchema.properties === 'function') {
        scanSchema(propSchema, parentBaseName + toSwiftBaseTypeName(propName));
      }
    }
  }

  function _registerInlineObject(schema, propName, parentBaseName, map) {
    const plain = schemaToPlain(schema);
    const key = _shapeKey(plain);
    if (!key) return;

    if (!map.has(key)) {
      // Derive name from property name; if collision with parent, prefix with parent
      const baseName = toSwiftBaseTypeName(propName);
      const existingNames = new Set(Array.from(map.values()).map(v => v.baseName));
      const finalBase = existingNames.has(baseName) ? parentBaseName + baseName : baseName;
      map.set(key, {
        baseName: finalBase,
        swiftName: _applyPrefix(finalBase),
        plainSchema: plain,
        schema,
      });
    }
  }

  for (const msg of messages) {
    if (!msg.payload) continue;
    scanSchema(msg.payload, toSwiftBaseTypeName(msg.messageName || ''));
  }

  for (const sch of schemas) {
    scanSchema(sch.schema, toSwiftBaseTypeName(sch.schemaName || ''));
  }

  return structMap;
}

module.exports = {
  extractMessages,
  extractSchemas,
  extractEnums,
  schemaToPlain,
  buildPropertyList,
  buildServerURL,
  scanForEnums,
  collectReceiveSchemaNames,
  extractInlineStructs,
};
