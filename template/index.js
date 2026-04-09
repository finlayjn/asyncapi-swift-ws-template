// template/index.js — Main entry point for the AsyncAPI generator template
// Returns all generated files as React <File> components

const { setTypePrefix } = require('../helpers/swift');
const PackageSwift = require('./PackageSwift');
const Models = require('./Models');
const Enums = require('./Enums');
const MessageEnums = require('./MessageEnums');
const Serializer = require('./Serializer');
const WebSocketClient = require('./WebSocketClient');

function Index({ asyncapi, params, originalAsyncAPI }) {
  // Configure type prefix before any rendering
  const prefix = params.typePrefix || '';
  setTypePrefix(prefix);

  return [
    <PackageSwift key="package" asyncapi={asyncapi} params={params} />,
    <Models key="models" asyncapi={asyncapi} params={params} />,
    <Enums key="enums" asyncapi={asyncapi} params={params} />,
    <MessageEnums key="messageEnums" asyncapi={asyncapi} params={params} />,
    <Serializer key="serializer" asyncapi={asyncapi} params={params} />,
    <WebSocketClient key="client" asyncapi={asyncapi} params={params} />,
  ].filter(Boolean);
}

module.exports = Index;
