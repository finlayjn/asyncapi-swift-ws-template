// template/Serializer.js — Generates MessageSerializer protocol and implementations
// The generator's component for lib/Serializer.js, which holds the rendering (and is what callers
// using the template as a library get, through lib/index.js).

const { File, Text } = require('@asyncapi/generator-react-sdk');
const render = require('../lib/Serializer');

function Serializer(props) {
  const file = render(props);
  return file && <File name={file.path}><Text newLines={0}>{file.content}</Text></File>;
}

module.exports = Serializer;
