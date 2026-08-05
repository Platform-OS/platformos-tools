import { UriString } from '../AbstractFileSystem';
import { formatFromFilePath } from '../route-table/slugFromFilePath';

/**
 * The kinds of source a platformOS file can be, and the discriminant every
 * check narrows on.
 *
 * It lives here, below the parser stack, because {@link AppFile} is keyed on it
 * while the ASTs themselves (`LiquidHtmlNode`, `JSONNode`, …) are produced by
 * packages above this one. `@platformos/platformos-check-common` re-exports this
 * very enum, so there is exactly one of it.
 */
export enum SourceCodeType {
  JSON = 'JSON',
  LiquidHtml = 'LiquidHtml',
  GraphQL = 'GraphQL',
  YAML = 'YAML',
}

/**
 * Turns a file's source into its AST.
 *
 * Returning an `Error` rather than throwing is the contract — an unparseable
 * file is a normal state that checks report on, not an exception. A parser that
 * throws anyway is caught by {@link AppFile.ast}, so the captured-`Error`
 * guarantee holds either way.
 */
export type Parser = (source: string, uri: UriString) => unknown;

/**
 * The parsers an {@link App} was built with.
 *
 * This package sits BELOW `@platformos/liquid-html-parser`, `jsonc-parser` and
 * `yaml`, so it cannot parse anything itself — the consumer that owns the parser
 * stack injects it, the same way it already injects an `AbstractFileSystem`.
 * That is also what lets `@platformos/platformos-graph` add a JS parser without
 * building a second set of file objects.
 */
export type Parsers = {
  readonly [K in SourceCodeType]?: Parser;
} & {
  /**
   * Parsers for extensions no {@link SourceCodeType} covers (`js`, images, …),
   * keyed by lowercase extension without the leading dot.
   */
  readonly extensions?: { readonly [extension: string]: Parser };
};

/**
 * Every source this toolchain can parse, and what it is parsed as. **A whitelist:
 * a file is parsed if and only if it has a row here.**
 *
 * That is the entire exclusion mechanism. Do not add a list of extensions to skip
 * anywhere in the toolchain: an ignore-list lives in whichever consumer remembered to
 * consult it, whereas absence cannot be forgotten.
 *
 * Keyed by {@link sourceKeyOf}, not by the bare extension, because a `.liquid` file's
 * body language is its RESPONSE FORMAT: `users.json.liquid` is a Liquid template
 * producing JSON, `theme.css.liquid` one producing CSS. The `.liquid` suffix in each key
 * keeps that separate from a plain `.json` or `.css` file, which is not a platformOS
 * source at all.
 *
 * `css` and `js` are the two entries of the platform's twelve-value FORMAT_ENUM
 * (`app/models/concerns/custom_view.rb:9`) with no row: their body is a stylesheet or a
 * script, and the Liquid+HTML parser reads the `<` in `a < b` as a tag.
 *
 * `.json` has no row either: a platformOS app has no JSON source type. JSON responses
 * come from `.json.liquid`, and the only `.json` files the platform deploys are generated
 * manifests no check looks at. Ruby's `App::REGEXP_MAP` has no JSON entry.
 */
const SOURCE_CODE_TYPE_BY_KEY: Readonly<Record<string, SourceCodeType>> = {
  'html.liquid': SourceCodeType.LiquidHtml,
  'json.liquid': SourceCodeType.LiquidHtml,
  'xml.liquid': SourceCodeType.LiquidHtml,
  'rss.liquid': SourceCodeType.LiquidHtml,
  'csv.liquid': SourceCodeType.LiquidHtml,
  'pdf.liquid': SourceCodeType.LiquidHtml,
  'text.liquid': SourceCodeType.LiquidHtml,
  'txt.liquid': SourceCodeType.LiquidHtml,
  'svg.liquid': SourceCodeType.LiquidHtml,
  'ics.liquid': SourceCodeType.LiquidHtml,
  graphql: SourceCodeType.GraphQL,
  yml: SourceCodeType.YAML,
};

/** The lowercase extension of `uri`, without the dot, or `''` when it has none. */
export function extensionOf(uri: UriString): string {
  const lastSlash = uri.lastIndexOf('/');
  const lastDot = uri.lastIndexOf('.');
  return lastDot > lastSlash ? uri.slice(lastDot + 1).toLowerCase() : '';
}

/**
 * The key {@link SOURCE_CODE_TYPE_BY_KEY} is looked up by: the file's extension,
 * except for `.liquid`, where the response format goes in front of it.
 *
 * The format is the platform's own idea (`formatFromFilePath` over its FORMAT_ENUM),
 * which is also what decides whether a dot in a filename is a format or part of the
 * name: `1col.html.liquid` is the `html` format, while a partial legitimately called
 * `user.avatar.liquid` has no format and falls back to `html.liquid`, because `avatar`
 * is not in the enum.
 *
 * @example sourceKeyOf('…/api/users.json.liquid')  // → 'json.liquid'
 * @example sourceKeyOf('…/assets/theme.css.liquid') // → 'css.liquid' (no row: not parsed)
 * @example sourceKeyOf('…/translations/en.yml')     // → 'yml'
 */
function sourceKeyOf(uri: UriString): string {
  const extension = extensionOf(uri);
  return extension === 'liquid' ? `${formatFromFilePath(uri)}.liquid` : extension;
}

/**
 * The {@link SourceCodeType} a file's contents are parsed as, or `undefined` for a
 * file this toolchain has no parser for — an image, a stylesheet, a `.js` asset, a
 * `.css.liquid` partial.
 *
 * `undefined` is the whole of "do not parse this": an {@link AppFile} with no type never
 * reaches a parser, so a check narrowing on `SourceCodeType` cannot be handed one.
 */
export function sourceCodeTypeOf(uri: UriString): SourceCodeType | undefined {
  return SOURCE_CODE_TYPE_BY_KEY[sourceKeyOf(uri)];
}
