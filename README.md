<h1 align="center" style="position: relative;" >
  <br>
    <img src="https://github.com/Platform-OS/platformos-tools/blob/main/packages/vscode-extension/images/platformos_logo.png?raw=true" alt="platformOS logo" width="200">
  <br>
  platformOS Tools
</h1>

<h4 align="center">Developer tools for platformOS</h4>

<p align="center">
  <a href="https://github.com/Platform-OS/platformos-tools/blob/main/LICENSE.md"><img src="https://img.shields.io/npm/l/@platformos/prettier-plugin-liquid.svg?sanitize=true" alt="License"></a>
  <a href="https://github.com/Platform-OS/platformos-tools/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/Platform-OS/platformos-tools/actions/workflows/ci.yml/badge.svg"></a>
</p>

<div align="center">

📝 [Changelog](https://github.com/Platform-OS/platformos-tools/blob/main/packages/vscode-extension/CHANGELOG.md)

</div>

## Introduction

This monorepo is home of platformOS developer tools:

- [`@platformos/platformos-common`](./packages/platformos-common) — Common utilities and types shared across packages.
- [`@platformos/liquid-html-parser`](./packages/liquid-html-parser) — The LiquidHTML parser that powers everything.
- [`@platformos/prettier-plugin-liquid`](./packages/prettier-plugin-liquid) — The formatter and prettier plugin for LiquidHTML.
- [`@platformos/codemirror-language-client`](./packages/codemirror-language-client) — A CodeMirror Language Client (batteries not included).
- [`@platformos/lang-jsonc`](./packages/lang-jsonc) — JSONC language support utilities.
- [`platformos-check-vscode`](./packages/vscode-extension) — The VS Code extension for platformOS Liquid development.

These tools are integrated in the [platformOS CLI (pos-cli)](https://github.com/Platform-OS/pos-cli).

They can be used individually or collectively, catering to varied use cases and offering flexibility in their application.

## Contributing

Contributions to the platformOS Tools repository are highly encouraged.

See [CONTRIBUTING.md](./docs/contributing.md) for more details.

## Credits

This project was originally forked from [Shopify's Theme Tools](https://github.com/Shopify/theme-tools). We are grateful to Shopify and the open-source community for creating and maintaining these excellent developer tools. The original project is licensed under MIT, and we continue to maintain this fork under the same license.

## License

MIT.
