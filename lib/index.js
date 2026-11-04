// lib/index.js — The template as a library: every generated file for a parsed AsyncAPI document,
// without the AsyncAPI generator (and its CLI, npm installs and hooks).
//
//   const { Parser, fromFile } = require('@asyncapi/parser');
//   const { generate } = require('@finlayjn/asyncapi-swift-ws-template/lib');
//   const { document } = await fromFile(new Parser(), 'asyncapi.yaml').parse();
//   const files = generate(document, { server: 'test', typePrefix: 'X', openEnums: true });
//   // [{ path: 'Sources/Models.swift', content: '…' }, …]
//
// `params` are the generator's template parameters (README). The formatter hook doesn't run:
// format the files yourself if you want them formatted. With `helpersModule`, the clients use
// shared helpers from that module (see lib/helpers.js for generating them).

const { setTypePrefix, setAllowNameCollisions } = require('../helpers/swift');
const { normalizeParams } = require('./params');
const PackageSwift = require('./PackageSwift');
const Gitignore = require('./Gitignore');
const Models = require('./Models');
const Enums = require('./Enums');
const MessageEnums = require('./MessageEnums');
const Serializer = require('./Serializer');
const WebSocketClient = require('./WebSocketClient');

// The generator's order (template/index.js): the helpers keep state (the type prefix, warnings,
// collected unions) between files.
const renderers = [PackageSwift, Gitignore, Models, Enums, MessageEnums, Serializer, WebSocketClient];

function generate(asyncapi, rawParams = {}) {
  const params = normalizeParams(rawParams);
  setTypePrefix(params.typePrefix || '');
  setAllowNameCollisions(params.allowNameCollisions);
  return renderers.map((render) => render({ asyncapi, params })).filter(Boolean);
}

module.exports = { generate, ...require('./helpers') };
