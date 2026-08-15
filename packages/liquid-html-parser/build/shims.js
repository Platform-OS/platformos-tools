const fs = require('fs');
const path = require('path');

const grammarPath = path.join(__dirname, '../grammar');

// JSON.stringify, not a String.raw template: the grammar is full of backslashes (escape
// rules) and backticks (prose in comments), and in a template literal a backslash directly
// before a backtick escapes the `$` of the `${"`"}` replacement, so the raw backtick then
// terminates the literal and the generated module is a syntax error. JSON string escaping
// has no such interaction — every character is escaped independently.
fs.writeFileSync(
  path.join(grammarPath, 'liquid-html.ohm.js'),
  'module.exports = ' +
    JSON.stringify(fs.readFileSync(path.join(grammarPath, 'liquid-html.ohm'), 'utf8')) +
    ';\n',
  'utf8',
);
