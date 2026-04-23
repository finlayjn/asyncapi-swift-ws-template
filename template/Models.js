// template/Models.js — Generates Swift struct for each message payload and component schema

const { File, Text } = require('@asyncapi/generator-react-sdk');
const { toSwiftTypeName, toSwiftPropertyName, toSwiftEnumCase, jsonSchemaTypeToSwift, setTypePrefix } = require('../helpers/swift');
const { extractMessages, extractSchemas, extractEnums, buildPropertyList, collectReceiveSchemaNames } = require('../helpers/schema');

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

function Models({ asyncapi, params }) {
  setTypePrefix(params?.typePrefix);
  const useMsgpack = params?.serialization === 'msgpack';
  const msgpackArray = useMsgpack && params?.msgpackFormat === 'array';
  const messages = extractMessages(asyncapi);
  const schemas = extractSchemas(asyncapi);
  const enumDefs = extractEnums(asyncapi);
  const renderedStructs = [];
  const generatedNames = new Set();

  // Collect names of schemas that need array-format decoding (msgpack array receive)
  const receiveSchemaNames = msgpackArray ? collectReceiveSchemaNames(asyncapi) : new Set();

  // Receive messages with object payloads also need the container init
  const receiveMessageNames = new Set();
  if (msgpackArray) {
    for (const msg of messages) {
      if (msg.direction === 'receive' && msg.hasObjectPayload) {
        receiveMessageNames.add(msg.swiftName);
      }
    }
  }

  // Generate structs for each message payload
  for (const msg of messages) {
    if (!msg.payload) continue;
    if (generatedNames.has(msg.swiftName)) continue;
    generatedNames.add(msg.swiftName);

    const properties = buildPropertyList(msg.payload, msg.swiftName, enumDefs);
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

    const properties = buildPropertyList(sch.schema, sch.swiftName, enumDefs);
    if (properties.length === 0) continue;

    const needsUnkeyed = receiveSchemaNames.has(sch.swiftName);
    renderedStructs.push(renderStruct(sch.swiftName, properties, '', {
      unkeyedDecode: needsUnkeyed,
      containerInit: false,
    }));
  }

  if (renderedStructs.length === 0) return null;

  return (
    <File name="Sources/Models.swift">
      <Text>{`// Generated by asyncapi-swift-ws-template — do not edit
import Foundation

${renderedStructs.join('\n\n')}`}</Text>
    </File>
  );
}

module.exports = Models;
