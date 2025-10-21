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

This monorepo is home of all things dev tools for Shopify themes:

- [`@platformos/liquid-html-parser`](./packages/liquid-html-parser) — the LiquidHTML parser that powers everything.  
- [`@platformos/prettier-plugin-liquid`](./packages/prettier-plugin-liquid) — the formatter and prettier plugin for LiquidHTML.  
- [`@platformos/theme-check-common`](./packages/theme-check-common) — Runtime agnostic linter that can run in browser or Node.js.  
- [`@platformos/theme-check-browser`](./packages/theme-check-browser) — Browser specific wrapper over the common library.  
- [`@platformos/theme-check-node`](./packages/theme-check-node) — Node.js specific wrapper over the common library.  
- [`@platformos/theme-language-server-common`](./packages/theme-language-server-common) — Runtime agnostic [Language Server](https://microsoft.github.io/language-server-protocol/) that can run in browser or Node.js.  
- [`@platformos/theme-language-server-browser`](./packages/theme-language-server-browser) — Browser specific wrapper over the common library.  
- [`@platformos/theme-language-server-node`](./packages/theme-language-server-node) — Node.js specific wrapper over the common library.  
- [`@platformos/theme-graph`](./packages/theme-graph) — Runtime agnostic data structure that represents themes.  
- [`@platformos/codemirror-language-client`](./packages/codemirror-language-client) — A CodeMirror Language Client (batteries not included).  
- [`theme-check-vscode`](./packages/vscode-extension) — The VS Code extension that uses it all.

These tools are also integrated in the [Online Store Code Editor](https://shopify.dev/docs/storefronts/themes/tools/code-editor) and the [Shopify CLI](https://shopify.dev/docs/api/shopify-cli/theme).

They can be used individually or collectively, catering to varied use cases and offering flexibility in their application.

## Contributing

Contributions to the Theme Tools repository are highly encouraged.

See [CONTRIBUTING.md](./docs/contributing.md) for more details.

## License

MIT.
