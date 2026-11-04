// lib/helpers.js — The shared helpers for clients generated with `helpersModule`: one copy of
// the WebSocket client (generic over each spec's messages), its configuration, reconnection
// policies and errors, the serializers and UnknownEnumValue, instead of a prefixed copy in
// every client.
//
//   generateHelpers()                        // files for the helpers module
//   generateMessagePackHelpers('MyHelpers')  // files for a module with MessagePackSerializer,
//                                            // which depends on msgpack-swift and MyHelpers
//
// A client generated with `helpersModule: 'MyHelpers'` (and, for MessagePack,
// `messagePackHelpersModule`) imports them and keeps its old names as type aliases.

const { renderSharedSocket } = require('./WebSocketClient');
const { renderSharedSerializer, renderSharedMessagePackSerializer } = require('./Serializer');
const { renderSharedUnknownEnumValue } = require('./Enums');

/**
 * @param {{ unknownEnumValue?: boolean }} [options] `unknownEnumValue: false` leaves out
 *   UnknownEnumValue, for a module that already has one with the same API.
 */
function generateHelpers({ unknownEnumValue = true } = {}) {
  return [
    { path: 'Sources/WebSocketClient.swift', content: renderSharedSocket() },
    { path: 'Sources/MessageSerializer.swift', content: renderSharedSerializer() },
    ...(unknownEnumValue ? [{ path: 'Sources/UnknownEnumValue.swift', content: renderSharedUnknownEnumValue() }] : []),
  ];
}

function generateMessagePackHelpers(helpersModule) {
  if (!helpersModule) throw new Error('generateMessagePackHelpers needs the helpers module name');
  return [{ path: 'Sources/MessagePackSerializer.swift', content: renderSharedMessagePackSerializer(helpersModule) }];
}

module.exports = { generateHelpers, generateMessagePackHelpers };
