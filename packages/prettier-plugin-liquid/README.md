<h1 align="center" style="position: relative;" >
  <br>
    <img src="https://github.com/Platform-OS/platformos-tools/blob/master/packages/vscode-extension/images/platformos_logo.png?raw=true" alt="platformOS logo" width="200">
  <br>
  platformOS Liquid Prettier Plugin
</h1>

<p align="center">
  <a href="https://www.npmjs.com/package/@platformos/prettier-plugin-liquid"><img src="https://img.shields.io/npm/v/@platformos/prettier-plugin-liquid.svg?sanitize=true" alt="Version"></a>
  <a href="https://github.com/Platform-OS/platformos-tools/blob/master/LICENSE.md"><img src="https://img.shields.io/npm/l/@platformos/prettier-plugin-liquid.svg?sanitize=true" alt="License"></a>
  <a href="https://github.com/Platform-OS/platformos-tools/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/Platform-OS/platformos-tools/actions/workflows/ci.yml/badge.svg"></a>
  <!--
    <a href="https://npmcharts.com/compare/@platformos/prettier-plugin-liquid?minimal=true"><img src="https://img.shields.io/npm/dm/@platformos/prettier-plugin-liquid.svg?sanitize=true" alt="Downloads"></a>
  -->
</p>

<div align="center">

💬 [Discussions](https://github.com/Platform-OS/platformos-tools/discussions) | 📝 [Changelog](./CHANGELOG.md)

</div>

[Prettier](https://prettier.io) is an opinionated code formatter. It enforces a consistent style by parsing your code and re-printing it with its own rules that take the maximum line length into account, wrapping code when necessary.

![demo](https://github.com/Platform-OS/platformos-tools/blob/master/docs/demo.gif?raw=true)

## Can this be used in production?

Yes!

## Installation

```bash
# with npm
npm install --save-dev prettier @platformos/prettier-plugin-liquid

# with yarn
yarn add --dev prettier @platformos/prettier-plugin-liquid
```

For Prettier version 3 and above, the plugin must also be declared in the [configuration](https://prettier.io/docs/en/configuration.html).

```
{
  "plugins": ["@platformos/prettier-plugin-liquid"]
}
```

## Usage

See our [Wiki](https://github.com/Platform-OS/platformos-tools/wiki) pages on the subject:

- [In the terminal](https://github.com/Platform-OS/platformos-tools/wiki/Use-it-in-your-terminal) (with Node.js)
- [In the browser](https://github.com/Platform-OS/platformos-tools/wiki/Use-it-in-the-browser)
- [In your editor](https://github.com/Platform-OS/platformos-tools/wiki/Use-it-in-your-editor)
- [In a CI workflow](https://github.com/Platform-OS/platformos-tools/wiki/Use-it-in-CI)
- [As a pre-commit hook](https://github.com/Platform-OS/platformos-tools/wiki/Use-it-as-a-pre-commit-hook)
- [With a bundler](https://github.com/Platform-OS/platformos-tools/wiki/Use-it-with-a-bundler)

## Configuration

Prettier for Liquid supports the following options.

| Name                           | Default  | Description                                                                                                                                                      |
| ------------------------------ | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `printWidth`                   | `120`    | Changed from Prettier's default (`80`) ([see prettier docs](https://prettier.io/docs/en/options.html#print-width))                                               |
| `tabWidth`                     | `2`      | Same as in Prettier ([see prettier docs](https://prettier.io/docs/en/options.html#tab-width))                                                                    |
| `useTabs`                      | `false`  | Same as in Prettier ([see prettier docs](https://prettier.io/docs/en/options.html#tabs))                                                                         |
| `singleQuote`                  | `false`  | Same as in Prettier ([see prettier docs](https://prettier.io/docs/en/options.html#quotes))                                                                       |
| `bracketSameLine`              | `false`  | Same as in Prettier ([see prettier docs](https://prettier.io/docs/en/options.html#bracket-line))                                                                 |
| `liquidSingleQuote`            | `true`   | Use single quotes instead of double quotes in Liquid tag and objects (since v0.2.0).                                                                             |
| `embeddedSingleQuote`          | `true`   | Use single quotes instead of double quotes in embedded languages (JavaScript, CSS, TypeScript inside `<script>`, `<style>` or Liquid equivalent) (since v0.4.0). |
| `htmlWhitespaceSensitivity`    | `css`    | Same as in Prettier ([see prettier docs](https://prettier.io/docs/en/options.html#html-whitespace-sensitivity))                                                  |
| `captureWhitespaceSensitivity` | `strict` | Specify the default whitespace sensitivity of the `capture` Liquid tag. Valid options: `"strict"` \| `"ignore"`.                                                 |
| `singleLineLinkTags`           | `false`  | If set to `true`, will print `<link>` tags on a single line to remove clutter                                                                                    |
| `indentSchema`                 | `false`  | If set to `true`, will indent the contents of the `{% schema %}` tag                                                                                             |

## Ignoring code

We support the following comments (either via HTML or Liquid comments):

- `prettier-ignore`
- `prettier-ignore-attribute`
- `prettier-ignore-attributes` (alias)

They target the next node in the tree. Unparseable code can't be ignored and will throw an error.

```liquid
{% # prettier-ignore %}
<div         class="x"       >hello world</div            >

{% # prettier-ignore-attributes %}
<div
  [[#if Condition]]
    class="a b c"
  [[/if ]]
></div>
```

## Whitespace handling

You'll quickly notice that the default value for `--htmlWhitespaceSensitivity` is set to `css` (like [Prettier's](https://prettier.io/blog/2018/11/07/1.15.0#whitespace-sensitive-formatting)).

If you want to change this behaviour for a specific tag that has a different default, you can use either the `display` or `white-space` comment to alter the behaviour.

Examples:

```liquid
{% # this tag is whitespace sensitive by default, since the value of the string shouldn't change by formatting. %}
{% capture value %}
  Hello {% name %}
{% endcapture %}

{% # here we alter its white-space property so that we allow pretty printing of its body %}
{% # white-space: normal %}
{% capture _ %}
  <div>
    {% render 'snip' %}
  </div>
{% endcapture %}

{% # this will prevent prettier from formatting it %}
{% # white-space: pre %}
{% capture _ %}
  <div>
    {% render 'snip' %}
  </div>
{% endcapture %}

{% # a span is normally sensitive to whitespace on both ends %}
<span
  ><b
    >hi</b
  ></span
>

{% # with display: block, it isn't %}
{% # display: block %}
<span>
  <b>hi</b>
</span>
```

## Known issues

Take a look at our [known issues](./KNOWN_ISSUES.md) and [open issues](https://github.com/Platform-OS/platformos-tools/issues).

## Contributing

[Read our contributing guide](CONTRIBUTING.md)

## License

MIT.
