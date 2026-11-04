// template/MessageEnums.js — Generates IncomingMessage and OutgoingMessage tagged enums
// The generator's component for lib/MessageEnums.js, which holds the rendering (and is what callers
// using the template as a library get, through lib/index.js).

const { File, Text } = require('@asyncapi/generator-react-sdk');
const render = require('../lib/MessageEnums');

function MessageEnums(props) {
  const file = render(props);
  return file && <File name={file.path}><Text newLines={0}>{file.content}</Text></File>;
}

module.exports = MessageEnums;
