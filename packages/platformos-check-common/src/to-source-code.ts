import { toLiquidHtmlAST } from '@platformos/liquid-html-parser';
import { Parsers, sourceCodeTypeOf } from '@platformos/platformos-common';

import { toJSONNode } from './jsonc/parse';
import { toYAMLNode } from './yaml/parse';
import * as path from './path';
import {
  GraphQLDocumentNode,
  GraphQLSourceCode,
  JSONNode,
  JSONSourceCode,
  LiquidSourceCode,
  SourceCodeType,
  YAMLSourceCode,
} from './types';
import { asError } from './utils/error';

export function toLiquidHTMLAST(source: string) {
  try {
    return toLiquidHtmlAST(source);
  } catch (error) {
    return asError(error);
  }
}

export function toJSONAST(source: string): JSONNode | Error {
  try {
    return toJSONNode(source);
  } catch (error) {
    return asError(error);
  }
}

export function toYAMLAST(source: string): JSONNode | Error {
  try {
    return toYAMLNode(source);
  } catch (error) {
    return asError(error);
  }
}

export function toGraphQLAST(source: string): GraphQLDocumentNode | Error {
  try {
    return {
      type: 'Document',
      content: source,
    } as GraphQLDocumentNode;
  } catch (error) {
    return asError(error);
  }
}

/**
 * How an {@link AppFile} of each {@link SourceCodeType} becomes an AST.
 *
 * `platformos-common`, where the App model lives, sits below the parser stack, so
 * it takes these by injection. This is the one definition of the mapping, shared
 * by every runtime that builds an `App` — check-node's `getApp`, the language
 * server's `DocumentManager` — so a file cannot be parsed one way by the linter
 * and another by the editor. `platformos-graph` adds `.js` and image entries to it
 * (`graphParsers`) rather than replacing it.
 */
export const sourceParsers: Parsers = {
  [SourceCodeType.LiquidHtml]: (source) => toLiquidHTMLAST(source),
  [SourceCodeType.GraphQL]: (source) => toGraphQLAST(source),
  [SourceCodeType.YAML]: (source) => toYAMLAST(source),
};

/**
 * Parse a file's contents into a {@link SourceCode}.
 *
 * Which `SourceCodeType` an extension gets is NOT decided here — `sourceCodeTypeOf`
 * in `platformos-common` owns that, the same answer `AppFile` uses, so a document
 * opened in the editor and the same file seen by the linter can never be modelled
 * as two different things.
 *
 * The `undefined` case is where this function deliberately differs from the App
 * model. `sourceCodeTypeOf` returns `undefined` for anything that is not a
 * platformOS source, because the linter has nothing to say about it; but this
 * function also serves the language server's `DocumentManager`, which holds every
 * buffer the editor opens — including the `.json` files the JSON language service
 * answers hover/completion for. So an unrecognised extension is modelled as JSON
 * rather than refused. That is an EDITOR fallback, not a classification: `App`
 * still contains no JSON file, and no `.json` on disk is a platformOS source.
 */
export function toSourceCode(
  uri: string,
  source: string,
  version?: number,
): LiquidSourceCode | JSONSourceCode | GraphQLSourceCode | YAMLSourceCode {
  // The type decides the parser, and `sourceParsers` above is already that mapping —
  // restating it as a switch means a new SourceCodeType has to be added in two
  // places, which is the drift `sourceParsers` exists to prevent. JSON is the
  // editor fallback described above, so it is the one entry not in that map.
  const type = sourceCodeTypeOf(uri) ?? SourceCodeType.JSON;
  const parse = sourceParsers[type] ?? toJSONAST;

  return {
    uri: path.normalize(uri),
    source,
    type,
    ast: parse(source, uri),
    version,
  } as LiquidSourceCode | JSONSourceCode | GraphQLSourceCode | YAMLSourceCode;
}
