<h1 align="center" style="position: relative;" >
  <br>
    <img src="https://github.com/Platform-OS/platformos-tools/blob/master/packages/vscode-extension/images/platformos_logo.png?raw=true" alt="platformOS logo" width="200">
  <br>
  platformOS Check
</h1>

<h4 align="center">A linter for platformOS</h4>

platformOS Check helps you follow best practices by analyzing your platformOS files.

Theme Check is available [to code editors that support the Language Server Protocol](https://github.com/Platform-OS/platformos-tools/wiki).

You may be interested by the sibling modules:

- `@platformos/platformos-check-common`: (you are here) npm module to run checks (runtime agnostic).
- `@platformos/platformos-check-node`: npm module to run checks from a [Node.js ](https://nodejs.org) runtime.
- `@platformos/platformos-check-browser`: npm module to run checks in a Browser.

## Installation

### CLI

platformOS Check is integrated in the [platformOS CLI (pos-cli)](https://github.com/Platform-OS/pos-cli).

```bash
pos-cli check
```

### As a library

There are three libraries:

```
yarn add @platformos/platformos-check-node
yarn add @platformos/platformos-check-common
yarn add @platformos/platformos-check-browser
```

## Usage

### Node

The node version comes with batteries included.

```ts
// simple-cli.ts
import { check } from '@platformos/platformos-check-node';

async function main() {
  const root = process.cwd();
  const offenses = await check(root);
  console.log(offenses);
}

main();
```

### Browser

The browser version is a bit more complex, you need to provide your own implementation of all the dependency injections.

```ts
import { simpleCheck, recommended, ThemeData, Config, Dependencies } from '@platformos/platformos-check-browser';

async function main() {
  const themeDesc = {
    'app/views/partials/product-card.liquid': '{{ product | image_url | image_tag }}',
    'app/views/partials/for-loop.liquid': '{% for variant in product.variants %}...{% endfor %}',
  };

  const config: Config = {
    checks: recommended,
    settings: {},
    root: '/',
  };

  const dependencies: Dependencies = {
    // ...
  };

  const offenses = await simpleCheck(themeDesc, config, dependencies);

  console.log(offenses);
}

main();
```

## Contributing

See [CONTRIBUTING.md](../../docs/contributing.md).
