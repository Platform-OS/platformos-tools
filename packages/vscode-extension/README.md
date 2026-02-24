<h1 align="center" style="position: relative;" >
  <br>
    <img src="https://github.com/Platform-OS/platformos-tools/blob/master/packages/vscode-extension/images/platformos_logo.png?raw=true" alt="platformOS logo" width="150" height="160">
  <br>
  platformOS Liquid
</h1>

<h4 align="center">A complete developer experience for platformOS</h4>

Official VS Code extension for [platformOS](https://documentation.platformos.com).

[Features](#features) | [User guide](#user-guide) | [Installation](#installation) | [Configuration](#configuration) | [📦 VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=platformOS.platformos-check-vscode).

## Features

* 🎨 Syntax highlighting
* 💅 Code formatting
* 💡 Code completion and documentation on hover
  * 💧 Liquid tag, filter and object
  * 🏷️ HTML tag, attribute and value
  * 🖼️ Render tag partial
* 🔎 Code navigation
* 🎎 Auto-closing pairs
* ✅ platformOS checks and fixes

## User guide

Take a look at [our user guide](https://documentation.platformos.com/developer-guide/platformos-check/platformos-check) for an in-depth demonstration and explanation of all the features.

## Installation

This VS Code extensions comes with batteries included.

## Configuration

- `"platformosCheck.checkOnOpen": boolean`, (default: `true`) makes it so platformOS check runs on file open.
- `"platformosCheck.checkOnChange": boolean`, (default: `true`) makes it so platformOS check runs on file change.
- `"platformosCheck.checkOnSave": boolean`, (default: `true`) makes it so platformOS check runs on file save.
- `"platformosCheck.preloadOnBoot": boolean`, (default: `true`) makes it so all files are preloaded on extension activation.

## License

MIT.
