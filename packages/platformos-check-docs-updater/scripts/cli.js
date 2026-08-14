#!/usr/bin/env node

const path = require('path');
const fs = require('fs');
const { downloadPlatformOSLiquidDocs, root } = require(path.resolve(__dirname, '../dist'));

// Get the command line arguments
const args = process.argv.slice(2);

// Check if a command was provided
if (args.length === 0) {
  console.log(`
Please provide a command.

Usage:
 download <dir> \t\tDownloads all docsets and JSON Schemas to the specified directory.
 root \tPrints the default docsets root directory.
 clear-cache \tClears the default docsets root directory.
`);
  process.exit(1);
}

// Handle the command
switch (args[0]) {
  case 'download': {
    // `--optional` may appear anywhere after the command; everything else is the destination.
    const rest = args.slice(1).filter((arg) => arg !== '--optional');
    const optional = args.includes('--optional');

    if (rest.length > 1) {
      console.log('Please provide a directory to download docs into.');
      process.exit(1);
    }
    console.log('Downloading docs...');

    // A REJECTION HANDLER, not a floating promise. This script is CommonJS and cannot await at the top
    // level; what mattered was never the await but the handler — without one, a rejection here was an
    // unhandled promise rejection, which Node turns into a process abort, so an unreachable documentation
    // site ended the build with a raw undici stack trace instead of a sentence saying what had failed.
    downloadPlatformOSLiquidDocs(rest[0], console.error.bind(console)).then(
      () => console.log('Docs downloaded.'),
      (error) => {
        // `--optional` is for the build. The committed `data/` is the fallback the runtime
        // already uses (see `fallbackResource` in platformOSLiquidDocsManager), and
        // `downloadPlatformOSLiquidDocs` writes nothing unless every file arrived — so what
        // is on disk is a coherent, if older, docset. Refusing to build against it would make
        // every offline machine, and every CDN blip, a broken build for no gain.
        //
        // LOUD EITHER WAY: a silent fallback is how a release ships against a docset nobody
        // meant to use.
        // `error.message` only when there IS one: a rejection with a string or an undici error object
        // printed "Could not refresh the docs: undefined", which is the stack-trace-instead-of-a-sentence
        // failure this handler exists to prevent, wearing the sentence's clothes.
        console.error(`\nCould not refresh the docs: ${error?.message ?? error}`);
        if (!optional) process.exit(1);
        console.error('Continuing with the docset committed in data/ — it may be out of date.\n');
      },
    );

    break;
  }

  case 'root':
    console.log(root);
    break;

  case 'clear-cache':
    console.log(`Removing '${root}'`);
    fs.rmSync(root, { recursive: true });
    break;

  default:
    console.log(`Unknown command: ${args[0]}`);
    process.exit(1);
}
