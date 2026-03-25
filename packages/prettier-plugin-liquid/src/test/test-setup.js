const moduleAlias = require('module-alias');
const path = require('path');
const fs = require('fs');

const prettierMajor = process.env.PRETTIER_MAJOR;
const prettierPath =
  prettierMajor === '3'
    ? path.join(__dirname, '..', '..', '..', '..', 'node_modules', 'prettier3')
    : path.join(__dirname, '..', '..', '..', '..', 'node_modules', 'prettier2');

export function setup() {
  // Generate the Ohm grammar shim once, before any test workers start.
  // This avoids a race condition when parallel workers all try to write the
  // same file simultaneously (causes SyntaxError: Unexpected end of input on Windows).
  require(path.join(__dirname, '..', '..', '..', 'liquid-html-parser', 'build', 'shims.js'));

  moduleAlias.addAlias('prettier', prettierPath);
  console.error('====================================');
  console.error(`Prettier version: ${require('prettier').version}`);
  console.error('====================================');
}
