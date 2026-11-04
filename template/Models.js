// template/Models.js — Generates Swift struct for each message payload and component schema
// The generator's component for lib/Models.js, which holds the rendering (and is what callers
// using the template as a library get, through lib/index.js).

const { File, Text } = require('@asyncapi/generator-react-sdk');
const render = require('../lib/Models');

function Models(props) {
  const file = render(props);
  return file && <File name={file.path}><Text newLines={0}>{file.content}</Text></File>;
}

module.exports = Models;
