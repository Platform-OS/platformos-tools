<h1 align="center" style="position: relative;" >
  <br>
    <img src="https://github.com/Platform-OS/platformos-tools/blob/master/packages/vscode-extension/images/platformos_logo.png?raw=true" alt="platformOS logo" width="200">
  <br>
  platformOS Graph
</h1>

<h4 align="center">A data structure that represents your platformOS application</h4>

A platformOS Graph is a data structure that spans Liquid, JSON, JavaScript and CSS files.

It has the following interface:

```ts
interface AppGraph {
  rootUri: UriString; // e.g. 'file:/path/to/my-app'
  entryPoints: AppModule[];
  modules: Record<UriString, AppModule>
}
```

An `AppModule` holds _dependencies_ and _references_ of a module. For instance,

```ts
interface LiquidModule {
  uri: UriString;
  type: 'liquid';
  kind: 'layout' | 'partial' | 'page';
  references: Reference[];
  dependencies: Reference[];
}
```

For a module $M$,
- a _reference_ is a backlink to _other_ modules that depend on $M$,
- a _dependency_ is a dependent link on another module.

```ts
interface Reference {
  /* The file that initiated the dependency/reference */
  source: { uri: string, range?: Range };

  /* The file that it points to */
  target: { uri: string, range?: Range };

  type:
    | 'direct'   // e.g. {% render 'child' %}, {{ 'app.js' | asset_url }}, <custom-element>, etc.
    | 'indirect' // e.g. files that loosely depend on another
}
```

See [types.md](./src/types.ts) for more details and [how-it-works.md](./docs/how-it-works.md) for an overview of the algorithm.

## Installation

```bash
npm install @platformos/platformos-graph
```

## Usage

### Through the VS Code extension

The app graph is used by the VS Code extension to power the dependencies, references and dead code features.

### From the CLI

```
Usage:
  platformos-graph <path-to-app-directory>

Example:
  platformos-graph horizon > graph.json
```

### As a library

[See bin/platformos-graph](./bin/platformos-graph) for inspiration.

## Contributing

See [CONTRIBUTING.md](../../docs/contributing.md).
