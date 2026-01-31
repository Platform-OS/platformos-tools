<h1 align="center" style="position: relative;" >
  <br>
    <img src="https://github.com/Shopify/theme-check-vscode/blob/main/images/shopify_glyph.png?raw=true" alt="logo" width="141" height="160">
  <br>
  Shopify Theme Tools
</h1>

<h4 align="center">Everything developer experience for Shopify themes</h4>

<p align="center">
  <a href="https://github.com/Platform-OS/platformos-tools/blob/main/LICENSE.md"><img src="https://img.shields.io/npm/l/@platformos/prettier-plugin-liquid.svg?sanitize=true" alt="License"></a>
  <a href="https://github.com/Platform-OS/platformos-tools/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/Platform-OS/platformos-tools/actions/workflows/ci.yml/badge.svg"></a>
</p>

<div align="center">

🗣 [Slack](https://join.slack.com/t/shopifypartners/shared_invite/zt-sdr2quab-mGkzkttZ2hnVm0~8noSyvw) | 📝 [Changelog](https://github.com/Platform-OS/platformos-tools/blob/main/packages/vscode-extension/CHANGELOG.md)

</div>

## Introduction

This monorepo is home of platformOS developer tools:

- [`@platformos/platformos-common`](./packages/platformos-common) — Common utilities and types shared across packages.
- [`@platformos/liquid-html-parser`](./packages/liquid-html-parser) — The LiquidHTML parser that powers everything.
- [`@platformos/prettier-plugin-liquid`](./packages/prettier-plugin-liquid) — The formatter and prettier plugin for LiquidHTML.
- [`@platformos/codemirror-language-client`](./packages/codemirror-language-client) — A CodeMirror Language Client (batteries not included).
- [`@platformos/lang-jsonc`](./packages/lang-jsonc) — JSONC language support utilities.
- [`platformos-check-vscode`](./packages/vscode-extension) — The VS Code extension for platformOS Liquid development.

These tools are also integrated in the [Online Store Code Editor](https://shopify.dev/docs/storefronts/themes/tools/code-editor) and the [Shopify CLI](https://shopify.dev/docs/api/shopify-cli/theme).

They can be used individually or collectively, catering to varied use cases and offering flexibility in their application.

## Contributing

Contributions to the Theme Tools repository are highly encouraged.

See [CONTRIBUTING.md](./docs/contributing.md) for more details.

## License

MIT.
