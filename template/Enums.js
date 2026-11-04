// template/Enums.js — Generates shared Swift enum types from enum properties
// The generator's component for lib/Enums.js, which holds the rendering (and is what callers
// using the template as a library get, through lib/index.js).

const { File, Text } = require('@asyncapi/generator-react-sdk');
const render = require('../lib/Enums');

function Enums(props) {
  const file = render(props);
  return file && <File name={file.path}><Text newLines={0}>{file.content}</Text></File>;
}

module.exports = Enums;
