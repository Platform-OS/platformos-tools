<h1 align="center" style="position: relative;" >
  <br>
    <img src="https://github.com/Platform-OS/platformos-tools/blob/master/packages/vscode-extension/images/platformos_logo.png?raw=true" alt="platformOS logo" width="200">
  <br>
  platformOS Tools
</h1>

<h4 align="center">A comprehensive suite of developer tools for platformOS Liquid development</h4>

<p align="center">
  <a href="https://github.com/Platform-OS/platformos-tools/blob/main/LICENSE.md"><img src="https://img.shields.io/npm/l/@platformos/prettier-plugin-liquid.svg?sanitize=true" alt="License"></a>
  <a href="https://github.com/Platform-OS/platformos-tools/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/Platform-OS/platformos-tools/actions/workflows/ci.yml/badge.svg"></a>
  <a href="https://github.com/Platform-OS/platformos-tools/issues"><img alt="Issues" src="https://img.shields.io/github/issues/Platform-OS/platformos-tools"></a>
</p>

<div align="center">

📝 [Changelog](https://github.com/Platform-OS/platformos-tools/blob/master/packages/vscode-extension/CHANGELOG.md) |
📚 [Documentation](https://github.com/Platform-OS/platformos-tools/tree/main/docs) |
🐛 [Report Issues](https://github.com/Platform-OS/platformos-tools/issues)

</div>

---

## Table of Contents

- [Features](#features)
- [Quick Start](#quick-start)
- [Packages](#packages)
- [Installation](#installation)
- [Development](#development)
- [Integration](#integration)
- [Contributing](#contributing)
- [Credits](#credits)
- [License](#license)

## Features

- **Syntax Highlighting** — Rich syntax support for platformOS Liquid templates
- **Code Formatting** — Automatic code formatting with Prettier integration
- **Linting & Diagnostics** — Real-time code analysis and error detection
- **IntelliSense** — Intelligent code completion and suggestions
- **Language Server** — Full LSP implementation for IDE integration
- **Parser** — Fast and accurate LiquidHTML parser
- **Graph Analysis** — Dependency tracking and code navigation
- **Multi-Environment** — Support for Node.js, Browser, and VS Code environments

## Quick Start

### For CLI Users

Install the [platformOS CLI (pos-cli)](https://github.com/Platform-OS/pos-cli) which includes all the necessary tools:

```bash
npm install -g @platformos/pos-cli
```

The pos-cli automatically includes the linter, formatter, and all other platformOS developer tools from this repository.

### For VS Code Users

Install the [platformOS Liquid extension](https://marketplace.visualstudio.com/items?itemName=platformOS.platformos-check-vscode) from the VS Code marketplace:

```bash
code --install-extension platformOS.platformos-check-vscode
```

### For Standalone Tool Integration

If you want to integrate individual tools into your own projects or build pipeline:

```bash
# Install prettier plugin for code formatting
npm install --save-dev @platformos/prettier-plugin-liquid

# Install platformOS check for linting
npm install --save-dev @platformos/platformos-check-node
```

## Packages

This monorepo contains a comprehensive suite of tools for platformOS development:

### Core Packages

#### [`@platformos/platformos-common`](./packages/platformos-common)
Common utilities, types, and shared functionality used across all packages.

#### [`@platformos/liquid-html-parser`](./packages/liquid-html-parser)
A fast and accurate parser for LiquidHTML templates. Powers all syntax analysis and tooling.

#### [`@platformos/prettier-plugin-liquid`](./packages/prettier-plugin-liquid)
Prettier plugin for automatic code formatting of LiquidHTML templates.

### Linting & Analysis

#### [`@platformos/platformos-check-common`](./packages/platformos-check-common)
Core linting engine and rule definitions shared across environments.

#### [`@platformos/platformos-check-node`](./packages/platformos-check-node)
Node.js implementation of platformOS linter for CLI and build tools.

#### [`@platformos/platformos-check-browser`](./packages/platformos-check-browser)
Browser-compatible version of the linter for web-based editors.

### Language Server

#### [`@platformos/platformos-language-server-common`](./packages/platformos-language-server-common)
Language Server Protocol (LSP) implementation providing IDE features.

#### [`@platformos/platformos-language-server-node`](./packages/platformos-language-server-node)
Node.js runtime for the language server.

#### [`@platformos/platformos-language-server-browser`](./packages/platformos-language-server-browser)
Browser-compatible language server for web IDEs.

### Editor Integration

#### [`platformos-check-vscode`](./packages/vscode-extension)
Official VS Code extension for platformOS Liquid development with full IDE support.

#### [`@platformos/codemirror-language-client`](./packages/codemirror-language-client)
Language Server Protocol client for CodeMirror editors.

### Utilities

#### [`@platformos/platformos-graph`](./packages/platformos-graph)
Dependency graph analysis for platformOS projects, tracking relationships between templates and components.

#### [`@platformos/lang-jsonc`](./packages/lang-jsonc)
JSONC (JSON with Comments) language support utilities.

#### [`@platformos/platformos-check-docs-updater`](./packages/platformos-check-docs-updater)
Tool for maintaining and updating documentation.

## Installation

### Prerequisites

- Node.js 16.x or higher
- Yarn 1.22.x or higher

### For Development

Clone the repository and install dependencies:

```bash
git clone https://github.com/Platform-OS/platformos-tools.git
cd platformos-tools
yarn install
```

Build all packages:

```bash
yarn build
```

Run tests:

```bash
yarn test
```

## Development

### Project Structure

```
platformos-tools/
├── packages/           # All packages live here
│   ├── platformos-common/
│   ├── liquid-html-parser/
│   ├── prettier-plugin-liquid/
│   └── ...
├── docs/              # Documentation
└── scripts/           # Build and development scripts
```

### Available Scripts

- `yarn build` — Build all packages
- `yarn test` — Run all tests
- `yarn format` — Format code with Prettier
- `yarn type-check` — Type check all packages
- `yarn playground` — Start CodeMirror playground
- `yarn dev:web` — Start VS Code web extension development

### Testing Changes

For VS Code extension development:
1. Open the repository in VS Code
2. Press `F5` to launch the extension development host
3. Set breakpoints and debug as needed

For other packages:
```bash
yarn workspace @platformos/package-name test
```

See [CONTRIBUTING.md](./docs/contributing.md) for detailed development guidelines.

## Integration

These tools are designed to work together and are integrated into:

- **[platformOS CLI (pos-cli)](https://github.com/Platform-OS/pos-cli)** — Official CLI tool for platformOS development
- **VS Code** — Through the official extension
- **Prettier** — As a formatting plugin
- **CodeMirror** — Through the language client package
- **Custom Build Tools** — Individual packages can be integrated into any JavaScript build pipeline

## Contributing

Contributions to the platformOS Tools repository are highly encouraged.

See [CONTRIBUTING.md](./docs/contributing.md) for more details.

## Credits

This project was originally forked from [Shopify's Theme Tools](https://github.com/Shopify/theme-tools). We are grateful to Shopify and the open-source community for creating and maintaining these excellent developer tools. The original project is licensed under MIT, and we continue to maintain this fork under the same license.

## License

MIT.
