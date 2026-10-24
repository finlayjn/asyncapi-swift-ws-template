// helpers/schema.js — Extract messages, schemas, and enums from parsed AsyncAPI v3 document
// Parser v3 API: collections have .all() returning arrays, schemas have method-based accessors

const { toSwiftTypeName, toSwiftBaseTypeName, toSwiftPropertyName, jsonSchemaTypeToSwift, getTypePrefix, isAnonymousSchema, addWarning, getAllowNameCollisions, clientDirection, swiftStringEscape, tupleElementLabel } = require('./swift');

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

        // Check for allOf composition — flatten and treat as object payload
        if (!hasObjectPayload && payload) {
          const flattened = flattenAllOf(payload);
          if (flattened && Object.keys(flattened.properties).length > 0) {
            hasObjectPayload = true;
            for (const [key, propSchema] of Object.entries(flattened.properties)) {
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

      // Check for allOf composition — flatten and treat as object payload
      if (!hasObjectPayload && payload) {
        const flattened = flattenAllOf(payload);
        if (flattened && Object.keys(flattened.properties).length > 0) {
          hasObjectPayload = true;
          // Find the discriminator in the flattened properties
          for (const [key, propSchema] of Object.entries(flattened.properties)) {
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

  _avoidSchemaNameCollisions(asyncapi, messages);
  return messages;
}

/**
 * A message struct is named after the message, so a message called `fill` whose payload is
 * the `FillMessage` schema would take the name of an unrelated `Fill` component schema, and
 * the two structs would collapse into one that contains itself. Rename such message structs
 * after their payload schema (or `<Name>Message` when the payload is anonymous).
 */
function _avoidSchemaNameCollisions(asyncapi, messages) {
  const components = asyncapi.components && asyncapi.components();
  const componentSchemas = components && components.schemas();
  const all = componentSchemas && typeof componentSchemas.all === 'function' ? componentSchemas.all() : [];
  const schemaIdsByName = new Map(all.map(sch => [toSwiftTypeName(sch.id()), sch.id()]));

  for (const msg of messages) {
    const schemaId = schemaIdsByName.get(msg.swiftName);
    if (!schemaId || !msg.hasObjectPayload) continue;
    const payloadId = call(msg.payload, 'id');
    if (payloadId === schemaId) continue;
    const renamed = payloadId && !isAnonymousSchema(payloadId)
      ? toSwiftTypeName(payloadId)
      : toSwiftTypeName(msg.messageName + '_message');
    addWarning(
      `[warn] Message "${msg.messageName}" would share the Swift name ${msg.swiftName} with ` +
      `component schema "${schemaId}"; naming the message struct ${renamed}.`
    );
    msg.swiftName = renamed;
  }
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
      } else {
        // Mixed element types: a positional tuple, generated as a struct
        plain.prefixItems = raw.prefixItems;
      }
    }
  }

  // allOf of several object schemas (e.g. a $ref plus extra properties): merge them, so the
  // composition resolves like an inline object
  if (!plain.properties && Array.isArray(plain.allOf) && plain.allOf.length > 1 && plain.allOf.every(v => v.properties)) {
    plain.properties = Object.assign({}, ...plain.allOf.map(v => v.properties));
    plain.required = [...new Set(plain.allOf.flatMap(v => v.required || []))];
    plain.type = plain.type || 'object';
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
  const allMessages = extractMessages(asyncapi);
  const allSchemas = extractSchemas(asyncapi);
  const roots = [
    ...allMessages.filter(m => m.payload).map(m => [m.payload, toSwiftBaseTypeName(m.messageName || '')]),
    ...allSchemas.map(s => [s.schema, toSwiftBaseTypeName(s.schemaName || '')]),
  ];

  for (const [schema, contextName] of roots) {
    scanForEnums(schema, contextName, enumMap);
  }

  // Second pass: enums the first pass doesn't reach (array items, anyOf/oneOf variants,
  // objects nested inside arrays). It runs after the first pass so that enums found there
  // keep the names they had before this pass existed.
  for (const [schema, contextName] of roots) {
    scanDeep(schema, contextName, (node, propName, ctx) => {
      const values = enumValuesOf(node);
      if (values) _registerEnum(values, propName, ctx, enumMap);
    });
  }

  return Array.from(enumMap.values());
}

/**
 * The enum values of a schema without `null` (a null member makes the property optional
 * rather than adding a case). Returns null unless the schema is an enum of two or more values.
 */
function enumValuesOf(schema) {
  const values = call(schema, 'enum');
  if (!Array.isArray(values) || call(schema, 'const') !== undefined) return null;
  const nonNull = values.filter(v => v !== null);
  return nonNull.length > 1 ? nonNull : null;
}

/**
 * Key identifying an enum by its values, shared by extraction and type lookup.
 */
function enumKey(values) {
  return values.filter(v => v !== null).slice().sort().join('|');
}

function _registerEnum(enumValues, propName, contextName, enumMap) {
  const key = enumKey(enumValues);
  if (enumMap.has(key)) return;
  const allIntegers = enumValues.every(v => typeof v === 'number' && Number.isInteger(v));
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
    rawType: allIntegers ? 'Int' : 'String',
  });
}

/**
 * The properties of an object schema, flattening allOf. Null when it has none.
 */
function _propertiesOf(schema) {
  if (!schema) return null;
  let props = typeof schema.properties === 'function' ? schema.properties() : null;
  if (!props || Object.keys(props).length === 0) {
    const flattened = flattenAllOf(schema);
    props = flattened ? flattened.properties : null;
  }
  return props && Object.keys(props).length > 0 ? props : null;
}

/**
 * Walk every schema reachable through a schema's properties, at any depth: each property
 * schema, array items (including arrays of arrays), anyOf/oneOf variants, and the properties
 * of nested objects. Calls `visit(node, propName, contextName)` for each node, where
 * propName is the property it belongs to and contextName the base type name of the object
 * declaring that property. Named component schemas are descended into once.
 */
function scanDeep(schema, contextName, visit, seen = new Set()) {
  const props = _propertiesOf(schema);
  if (!props) return;

  for (const [propName, propSchema] of Object.entries(props)) {
    const pending = [propSchema];
    while (pending.length > 0) {
      const node = pending.shift();
      if (!node) continue;
      visit(node, propName, contextName);

      // Tuple elements (prefixItems) are only in the raw JSON; visit them under their labels
      const raw = typeof node.json === 'function' ? node.json() : null;
      if (raw && Array.isArray(raw.prefixItems)) {
        raw.prefixItems.forEach((item, i) => visit(item, tupleElementLabel(item, i), contextName));
      }

      if (typeof node.items === 'function') {
        const items = node.items();
        if (items && !Array.isArray(items)) pending.push(items);
      }
      for (const keyword of ['anyOf', 'oneOf']) {
        if (typeof node[keyword] !== 'function') continue;
        const variants = node[keyword]();
        if (Array.isArray(variants)) pending.push(...variants);
      }
      if (_propertiesOf(node)) {
        const id = call(node, 'id');
        const named = id && !isAnonymousSchema(id);
        if (named && seen.has(id)) continue;
        if (named) seen.add(id);
        scanDeep(node, contextName + toSwiftBaseTypeName(propName), visit, seen);
      }
    }
  }
}

/**
 * Recursively scan a schema for enum properties.
 */
function scanForEnums(schema, contextName, enumMap) {
  const props = _propertiesOf(schema);
  if (!props) return;

  for (const [propName, propSchema] of Object.entries(props)) {
    const enumValues = enumValuesOf(propSchema);
    if (enumValues) {
      _registerEnum(enumValues, propName, contextName, enumMap);
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
 * Flatten an allOf-composed schema into merged properties and required fields.
 * Returns { properties: { ... }, requiredFields: [...] } or null if not allOf.
 */
function flattenAllOf(schema) {
  if (!schema) return null;

  // Check for allOf on the schema model
  let allOfVariants = null;
  if (typeof schema.allOf === 'function') {
    const variants = schema.allOf();
    if (Array.isArray(variants) && variants.length > 0) {
      allOfVariants = variants;
    }
  }

  if (!allOfVariants) return null;

  const mergedProps = {};
  const mergedRequired = [];

  for (const variant of allOfVariants) {
    // Collect properties
    if (typeof variant.properties === 'function') {
      const props = variant.properties();
      if (props && typeof props === 'object') {
        for (const [key, value] of Object.entries(props)) {
          if (!mergedProps[key]) {
            mergedProps[key] = value;
          }
        }
      }
    }

    // Collect required fields
    const req = typeof variant.required === 'function' ? variant.required() : null;
    if (Array.isArray(req)) {
      for (const r of req) {
        if (!mergedRequired.includes(r)) {
          mergedRequired.push(r);
        }
      }
    }
  }

  if (Object.keys(mergedProps).length === 0) return null;

  return { properties: mergedProps, requiredFields: mergedRequired };
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
  // Try direct properties first
  let props = null;
  let requiredFields = [];

  if (schema && typeof schema.properties === 'function') {
    props = schema.properties();
    requiredFields = (typeof schema.required === 'function' ? schema.required() : null) || [];
  }

  // If no direct properties, try flattening allOf
  if ((!props || Object.keys(props).length === 0) && schema) {
    const flattened = flattenAllOf(schema);
    if (flattened) {
      props = flattened.properties;
      requiredFields = flattened.requiredFields;
    }
  }

  if (!props || Object.keys(props).length === 0) return [];

  const result = [];

  for (const [propName, propSchema] of Object.entries(props)) {
    const plain = schemaToPlain(propSchema);
    const isRequired = requiredFields.includes(propName);
    const swiftPropName = toSwiftPropertyName(propName);

    let swiftType;
    const enumValues = enumValuesOf(propSchema);
    if (enumValues) {
      // Look up the actual enum type name from extracted enums
      const key = enumKey(enumValues);
      const enumDef = enumDefs && enumDefs.find(e => enumKey(e.values) === key);
      swiftType = enumDef ? enumDef.swiftName : toSwiftTypeName(propName);
      if (!isRequired || plain.nullable || plain.enum.includes(null)) swiftType += '?';
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
      const url = `${protocol}://${host}${path}`;
      if (!/^wss?:\/\/[A-Za-z0-9.\-:/_?=&%#+@!$'()*,;~\[\]]+$/.test(url)) {
        throw new Error(`Unsafe server URL rejected during generation: ${url}`);
      }
      return { protocol, host, pathname: path, url };
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
  let props = null;
  if (schema && typeof schema.properties === 'function') {
    props = schema.properties();
  }

  // If no direct properties, try flattening allOf
  if ((!props || Object.keys(props).length === 0) && schema) {
    const flattened = flattenAllOf(schema);
    if (flattened) {
      props = flattened.properties;
    }
  }

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
    let props = null;
    if (schema && typeof schema.properties === 'function') {
      props = schema.properties();
    }

    // If no direct properties, try flattening allOf
    if ((!props || Object.keys(props).length === 0) && schema) {
      const flattened = flattenAllOf(schema);
      if (flattened) {
        props = flattened.properties;
      }
    }

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
      let finalBase = existingNames.has(baseName) ? parentBaseName + baseName : baseName;
      for (let n = 2; existingNames.has(finalBase); n++) {
        finalBase = parentBaseName + baseName + n;
      }
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

  // Second pass: inline objects the first pass doesn't reach (inside array items or
  // anyOf/oneOf variants of nested objects, arrays of arrays). After the first pass so
  // existing struct names don't change.
  const roots = [
    ...messages.filter(m => m.payload).map(m => [m.payload, toSwiftBaseTypeName(m.messageName || '')]),
    ...schemas.map(sch => [sch.schema, toSwiftBaseTypeName(sch.schemaName || '')]),
  ];
  for (const [schema, contextName] of roots) {
    scanDeep(schema, contextName, (node, propName, ctx) => {
      const type = call(node, 'type');
      const isObject = [].concat(type).includes('object') || (type === undefined && _propertiesOf(node));
      if (isObject && isAnonymousSchema(call(node, 'id'))) {
        _registerInlineObject(node, propName, ctx, structMap);
      }
    });
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
  scanDeep,
  enumValuesOf,
  enumKey,
  collectReceiveSchemaNames,
  extractInlineStructs,
};
