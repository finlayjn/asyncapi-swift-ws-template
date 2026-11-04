// template/Gitignore.js — Generates .gitignore based on GitHub's official Swift template
// The generator's component for lib/Gitignore.js, which holds the rendering (and is what callers
// using the template as a library get, through lib/index.js).

const { File, Text } = require('@asyncapi/generator-react-sdk');
const render = require('../lib/Gitignore');

function Gitignore(props) {
  const file = render(props);
  return file && <File name={file.path}><Text newLines={0}>{file.content}</Text></File>;
}

module.exports = Gitignore;
