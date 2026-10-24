// template/Models.js — Generates Swift struct for each message payload and component schema

const { File, Text } = require('@asyncapi/generator-react-sdk');
const { toSwiftTypeName, toSwiftPropertyName, toSwiftEnumCase, jsonSchemaTypeToSwift, setTypePrefix, setAllowNameCollisions, setPerspective, clientDirection, getWarnings, clearWarnings, prefixedName, setEnumDefs, resetUnions, getUnions } = require('../helpers/swift');
const { extractMessages, extractSchemas, extractEnums, buildPropertyList, collectReceiveSchemaNames, extractInlineStructs } = require('../helpers/schema');

/**
 * Sort properties by their position in the required array, then remaining in original order.
 */
function sortByRequiredOrder(properties) {
  return [...properties].sort((a, b) => {
    const ai = a.requiredIndex === -1 ? Infinity : a.requiredIndex;
    const bi = b.requiredIndex === -1 ? Infinity : b.requiredIndex;
    return ai - bi;
  });
}

/**
 * Render a single Swift struct from a list of properties.
 *
 * @param {string} swiftName
 * @param {Array} properties
 * @param {string} description
 * @param {object} options
 * @param {boolean} options.unkeyedDecode — generate init(from decoder:) with unkeyedContainer
 * @param {boolean} options.containerInit — generate init(from container: inout UnkeyedDecodingContainer)
 */
function renderStruct(swiftName, properties, description, options = {}) {
  const { unkeyedDecode = false, containerInit = false } = options;
  const lines = [];

  if (description) {
    lines.push(`/// ${description.split('\n')[0]}`);
  }
  lines.push(`public struct ${swiftName}: Codable, Sendable {`);

  // Properties
  for (const prop of properties) {
    if (prop.description) {
      lines.push(`    /// ${prop.description.split('\n')[0]}`);
    }
    if (prop.isConst) {
      // Const fields: still decode them but provide a default
      lines.push(`    public let ${prop.swiftName}: String`);
    } else {
      lines.push(`    public let ${prop.swiftName}: ${prop.swiftType}`);
    }
  }

  // CodingKeys
  const needsKeys = properties.some(p => {
    const clean = p.swiftName.replace(/`/g, '');
    return clean !== p.wireFormat;
  });

  if (needsKeys) {
    lines.push('');
    lines.push('    private enum CodingKeys: String, CodingKey {');
    for (const prop of properties) {
      const clean = prop.swiftName.replace(/`/g, '');
      if (clean !== prop.wireFormat) {
        lines.push(`        case ${prop.swiftName} = "${prop.wireFormat}"`);
      } else {
        lines.push(`        case ${prop.swiftName}`);
      }
    }
    lines.push('    }');
  }

  // Public init — Swift auto-generated memberwise init is internal
  const initParams = properties.filter(p => !p.isConst);

  if (initParams.length > 0 || properties.some(p => p.isConst)) {
    lines.push('');
    if (initParams.length > 0) {
      lines.push('    public init(');
      for (let i = 0; i < initParams.length; i++) {
        const p = initParams[i];
        const hasDefault = p.swiftType.endsWith('?');
        const suffix = i < initParams.length - 1 ? ',' : '';
        lines.push(`        ${p.swiftName}: ${p.swiftType}${hasDefault ? ' = nil' : ''}${suffix}`);
      }
      lines.push('    ) {');
    } else {
      lines.push('    public init() {');
    }
    for (const prop of properties) {
      if (prop.isConst) {
        const escaped = String(prop.constVal != null ? prop.constVal : '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
        lines.push(`        self.${prop.swiftName} = "${escaped}"`);
      } else {
        lines.push(`        self.${prop.swiftName} = ${prop.swiftName}`);
      }
    }
    lines.push('    }');
  }

  // ── Array-format decoding (for msgpack receive messages) ──
  if (unkeyedDecode) {
    const orderedProps = sortByRequiredOrder(properties);

    // init(from decoder: Decoder) — decode ALL fields from an unkeyed container
    lines.push('');
    lines.push('    public init(from decoder: Decoder) throws {');
    lines.push('        var container = try decoder.unkeyedContainer()');
    for (const prop of orderedProps) {
      const baseType = prop.swiftType.replace(/\?$/, '');
      const isOptional = prop.swiftType.endsWith('?');
      if (prop.isConst) {
        lines.push(`        self.${prop.swiftName} = try container.decode(String.self)`);
      } else if (isOptional) {
        lines.push(`        self.${prop.swiftName} = try container.decodeIfPresent(${baseType}.self)`);
      } else {
        lines.push(`        self.${prop.swiftName} = try container.decode(${baseType}.self)`);
      }
    }
    lines.push('    }');

    // init(from container:) — type already consumed by IncomingMessage discriminator
    if (containerInit) {
      lines.push('');
      lines.push('    internal init(from container: inout UnkeyedDecodingContainer) throws {');
      for (const prop of orderedProps) {
        if (prop.isConst) {
          const escaped = String(prop.constVal != null ? prop.constVal : '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
          lines.push(`        self.${prop.swiftName} = "${escaped}"`);
        } else {
          const baseType = prop.swiftType.replace(/\?$/, '');
          const isOptional = prop.swiftType.endsWith('?');
          if (isOptional) {
            lines.push(`        self.${prop.swiftName} = try container.decodeIfPresent(${baseType}.self)`);
          } else {
            lines.push(`        self.${prop.swiftName} = try container.decode(${baseType}.self)`);
          }
        }
      }
      lines.push('    }');
    }
  }

  lines.push('}');

  return lines.join('\n');
}

/**
 * Render a union registered by jsonSchemaTypeToSwift: a primitive union (one case per JSON
 * type) or a discriminated object union (one case per variant, plus `unknown`).
 */
function renderUnion(union) {
  const lines = [];
  if (union.description) lines.push(`/// ${union.description.split('\n')[0]}`);

  if (union.kind === 'primitive') {
    lines.push(`public enum ${union.swiftName}: Codable, Sendable, Hashable {`);
    for (const c of union.cases) lines.push(`    case ${c.kind}(${c.swiftType})`);
    lines.push('');
    lines.push('    public init(from decoder: Decoder) throws {');
    lines.push('        let container = try decoder.singleValueContainer()');
    for (const c of union.cases) {
      lines.push(`        if let value = try? container.decode(${c.swiftType}.self) {`);
      lines.push(`            self = .${c.kind}(value)`);
      lines.push('            return');
      lines.push('        }');
    }
    lines.push('        throw DecodingError.typeMismatch(');
    lines.push(`            ${union.swiftName}.self,`);
    lines.push(`            DecodingError.Context(codingPath: decoder.codingPath, debugDescription: "Expected ${union.cases.map(c => c.swiftType).join(' or ')}")`);
    lines.push('        )');
    lines.push('    }');
    lines.push('');
    lines.push('    public func encode(to encoder: Encoder) throws {');
    lines.push('        var container = encoder.singleValueContainer()');
    lines.push('        switch self {');
    for (const c of union.cases) lines.push(`        case .${c.kind}(let value): try container.encode(value)`);
    lines.push('        }');
    lines.push('    }');
    lines.push('}');
    return lines.join('\n');
  }

  if (union.kind === 'tuple') {
    lines.push(`public struct ${union.swiftName}: Codable, Sendable, Hashable {`);
    for (const f of union.fields) {
      if (f.description) lines.push(`    /// ${f.description.split('\n')[0]}`);
      lines.push(`    public let ${f.swiftName}: ${f.swiftType}`);
    }
    lines.push('');
    lines.push('    public init(');
    union.fields.forEach((f, i) => lines.push(`        ${f.swiftName}: ${f.swiftType}${i < union.fields.length - 1 ? ',' : ''}`));
    lines.push('    ) {');
    for (const f of union.fields) lines.push(`        self.${f.swiftName} = ${f.swiftName}`);
    lines.push('    }');
    lines.push('');
    lines.push('    /// Decoded from a positional array.');
    lines.push('    public init(from decoder: Decoder) throws {');
    lines.push('        var container = try decoder.unkeyedContainer()');
    for (const f of union.fields) lines.push(`        self.${f.swiftName} = try container.decode(${f.swiftType}.self)`);
    lines.push('    }');
    lines.push('');
    lines.push('    public func encode(to encoder: Encoder) throws {');
    lines.push('        var container = encoder.unkeyedContainer()');
    for (const f of union.fields) lines.push(`        try container.encode(${f.swiftName})`);
    lines.push('    }');
    lines.push('}');
    return lines.join('\n');
  }

  const key = union.discriminator;
  lines.push(`public enum ${union.swiftName}: Codable, Sendable {`);
  for (const c of union.cases) lines.push(`    case ${c.caseName}(${c.swiftType})`);
  lines.push(`    /// A variant whose \`${key}\` this client version doesn't know.`);
  lines.push('    case unknown(String)');
  lines.push('');
  lines.push('    private enum DiscriminatorKey: String, CodingKey {');
  lines.push(`        case discriminator = "${key}"`);
  lines.push('    }');
  lines.push('');
  lines.push('    public init(from decoder: Decoder) throws {');
  lines.push('        let container = try decoder.container(keyedBy: DiscriminatorKey.self)');
  lines.push('        let discriminator = try container.decode(String.self, forKey: .discriminator)');
  lines.push('        switch discriminator {');
  for (const c of union.cases) {
    lines.push(`        case "${c.value}": self = .${c.caseName}(try ${c.swiftType}(from: decoder))`);
  }
  lines.push('        default: self = .unknown(discriminator)');
  lines.push('        }');
  lines.push('    }');
  lines.push('');
  lines.push('    public func encode(to encoder: Encoder) throws {');
  lines.push('        switch self {');
  for (const c of union.cases) lines.push(`        case .${c.caseName}(let value): try value.encode(to: encoder)`);
  lines.push('        case .unknown(let discriminator):');
  lines.push('            var container = encoder.container(keyedBy: DiscriminatorKey.self)');
  lines.push('            try container.encode(discriminator, forKey: .discriminator)');
  lines.push('        }');
  lines.push('    }');
  lines.push('}');
  return lines.join('\n');
}

/**
 * Render the JSONValue enum — a Codable catch-all for untyped schemas.
 */
function renderJSONValue(prefix) {
  const name = prefix ? prefix + 'JSONValue' : 'JSONValue';
  return `public enum ${name}: Codable, Sendable, Hashable {
    case string(String)
    case int(Int)
    case double(Double)
    case bool(Bool)
    case object([String: ${name}])
    case array([${name}])
    case null

    public init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if container.decodeNil() {
            self = .null
        } else if let v = try? container.decode(Bool.self) {
            self = .bool(v)
        } else if let v = try? container.decode(Int.self) {
            self = .int(v)
        } else if let v = try? container.decode(Double.self) {
            self = .double(v)
        } else if let v = try? container.decode(String.self) {
            self = .string(v)
        } else if let v = try? container.decode([String: ${name}].self) {
            self = .object(v)
        } else if let v = try? container.decode([${name}].self) {
            self = .array(v)
        } else {
            throw DecodingError.dataCorrupted(
                DecodingError.Context(codingPath: decoder.codingPath, debugDescription: "Cannot decode JSONValue")
            )
        }
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case .string(let v): try container.encode(v)
        case .int(let v): try container.encode(v)
        case .double(let v): try container.encode(v)
        case .bool(let v): try container.encode(v)
        case .object(let v): try container.encode(v)
        case .array(let v): try container.encode(v)
        case .null: try container.encodeNil()
        }
    }
}`;
}

function Models({ asyncapi, params }) {
  setTypePrefix(params?.typePrefix);
  setAllowNameCollisions(params?.allowNameCollisions);
  setPerspective(params?.perspective);
  clearWarnings();
  const useMsgpack = params?.serialization === 'msgpack';
  const msgpackArray = useMsgpack && params?.msgpackFormat === 'array';
  const messages = extractMessages(asyncapi);
  const schemas = extractSchemas(asyncapi);
  const enumDefs = extractEnums(asyncapi);
  setEnumDefs(enumDefs);
  resetUnions({ objectUnions: !msgpackArray });
  const inlineStructMap = extractInlineStructs(asyncapi);
  const renderedStructs = [];
  const generatedNames = new Set();

  // Collect names of schemas that need array-format decoding (msgpack array receive)
  const receiveSchemaNames = msgpackArray ? collectReceiveSchemaNames(asyncapi) : new Set();

  // Receive messages with object payloads also need the container init
  const receiveMessageNames = new Set();
  if (msgpackArray) {
    for (const msg of messages) {
      if (clientDirection(msg.direction) === 'incoming' && msg.hasObjectPayload) {
        receiveMessageNames.add(msg.swiftName);
      }
    }
  }

  // Generate structs for inline anonymous objects (deduplicated)
  for (const [, entry] of inlineStructMap) {
    if (generatedNames.has(entry.swiftName)) continue;
    generatedNames.add(entry.swiftName);

    const properties = buildPropertyList(entry.schema, entry.swiftName, enumDefs, inlineStructMap);
    if (properties.length === 0) continue;

    const needsUnkeyed = receiveSchemaNames.has(entry.swiftName);
    renderedStructs.push(renderStruct(entry.swiftName, properties, '', {
      unkeyedDecode: needsUnkeyed,
      containerInit: false,
    }));
  }

  // Generate structs for each message payload
  for (const msg of messages) {
    if (!msg.payload) continue;
    if (generatedNames.has(msg.swiftName)) continue;
    generatedNames.add(msg.swiftName);

    const properties = buildPropertyList(msg.payload, msg.swiftName, enumDefs, inlineStructMap);
    if (properties.length === 0) continue;

    const desc = msg.title || msg.summary || '';
    const needsUnkeyed = receiveSchemaNames.has(msg.swiftName);
    const needsContainerInit = receiveMessageNames.has(msg.swiftName);
    renderedStructs.push(renderStruct(msg.swiftName, properties, desc, {
      unkeyedDecode: needsUnkeyed,
      containerInit: needsContainerInit,
    }));
  }

  // Generate structs for component schemas
  for (const sch of schemas) {
    if (generatedNames.has(sch.swiftName)) continue;
    generatedNames.add(sch.swiftName);

    const properties = buildPropertyList(sch.schema, sch.swiftName, enumDefs, inlineStructMap);
    if (properties.length === 0) continue;

    const needsUnkeyed = receiveSchemaNames.has(sch.swiftName);
    renderedStructs.push(renderStruct(sch.swiftName, properties, '', {
      unkeyedDecode: needsUnkeyed,
      containerInit: false,
    }));
  }

  // Unions registered while resolving property types above
  for (const union of getUnions()) {
    renderedStructs.push(renderUnion(union));
  }

  // Check if JSONValue is referenced by any generated struct
  const allCode = renderedStructs.join('\n');
  const jsonValueName = prefixedName('JSONValue');
  const needsJSONValue = allCode.includes(jsonValueName);

  // Print any generation warnings
  const warnings = getWarnings();
  if (warnings.length > 0) {
    for (const w of warnings) {
      console.warn(w);
    }
  }

  if (renderedStructs.length === 0) return null;

  const jsonValueBlock = needsJSONValue ? '\n\n' + renderJSONValue(params?.typePrefix || '') : '';

  return (
    <File name="Sources/Models.swift">
      <Text>{`// Generated by asyncapi-swift-ws-template — do not edit
import Foundation

${renderedStructs.join('\n\n')}${jsonValueBlock}`}</Text>
    </File>
  );
}

module.exports = Models;
