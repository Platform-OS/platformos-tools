import { toLiquidHtmlAST } from '@platformos/liquid-html-parser';

import { toJSONNode } from './jsonc/parse';
import { toYAMLNode } from './yaml/parse';
import * as path from './path';
import { memo } from './utils/memo';
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

export function toSourceCode(
  uri: string,
  source: string,
  version?: number,
): LiquidSourceCode | JSONSourceCode | GraphQLSourceCode | YAMLSourceCode {
  const isLiquid = uri.endsWith('.liquid');
  const isGraphQL = uri.endsWith('.graphql');
  const isYAML = uri.endsWith('.yml') || uri.endsWith('.yaml');

  if (isLiquid) {
    return {
      uri: path.normalize(uri),
      source,
      type: SourceCodeType.LiquidHtml,
      ast: toLiquidHTMLAST(source),
      version,
    };
  } else if (isGraphQL) {
    return {
      uri: path.normalize(uri),
      source,
      type: SourceCodeType.GraphQL,
      ast: toGraphQLAST(source),
      version,
    };
  } else if (isYAML) {
    return {
      uri: path.normalize(uri),
      source,
      type: SourceCodeType.YAML,
      ast: toYAMLAST(source),
      version,
    };
  } else {
    return {
      uri: path.normalize(uri),
      source,
      type: SourceCodeType.JSON,
      ast: toJSONAST(source),
      version,
    };
  }
}

/**
 * Like {@link toSourceCode}, but the `ast` is parsed on FIRST ACCESS rather than up
 * front. Identical shape, identical values — only the timing of the parse differs.
 *
 * WHY. Liquid parsing is the dominant cost in this repo (a whole-project load is
 * seconds), and the biggest consumer of that cost does not need most of it:
 * check-node's `getApp` reads every project file so cross-file checks can resolve
 * against a complete `App`, but since `CheckOptions.only` scopes a `validate_code`
 * request to the edited buffer, only that one file is ever visited. Deferring the
 * parse removes the work instead of caching it — which also removes the transient
 * ASTs that dominate the server's peak RSS.
 *
 * WHO SHOULD USE IT. Callers that build an `App` for CONTEXT and visit a subset —
 * i.e. check-node's project loader. Callers that will certainly parse (the language
 * server's `DocumentManager`, platformos-graph's traversal, the browser runtime)
 * should keep using `toSourceCode`: for them laziness only adds an indirection, and
 * `DocumentManager` spreads its source codes, which would evaluate the getter
 * anyway.
 *
 * PARSE ERRORS BEHAVE IDENTICALLY: the `to*AST` helpers capture them as `Error`
 * values, so a malformed file yields `ast instanceof Error` on access and never
 * throws out of this function — exactly as with the eager version. Nothing here can
 * throw, so a lazy `App` cannot turn a syntax error into a failed project load.
 *
 * The getter memoizes, so repeated access parses once.
 */
export function toLazySourceCode(
  uri: string,
  source: string,
  version?: number,
): LiquidSourceCode | JSONSourceCode | GraphQLSourceCode | YAMLSourceCode {
  const normalizedUri = path.normalize(uri);
  const isLiquid = uri.endsWith('.liquid');
  const isGraphQL = uri.endsWith('.graphql');
  const isYAML = uri.endsWith('.yml') || uri.endsWith('.yaml');

  if (isLiquid) {
    const ast = memo(() => toLiquidHTMLAST(source));
    return {
      uri: normalizedUri,
      source,
      type: SourceCodeType.LiquidHtml,
      get ast() {
        return ast();
      },
      version,
    };
  } else if (isGraphQL) {
    const ast = memo(() => toGraphQLAST(source));
    return {
      uri: normalizedUri,
      source,
      type: SourceCodeType.GraphQL,
      get ast() {
        return ast();
      },
      version,
    };
  } else if (isYAML) {
    const ast = memo(() => toYAMLAST(source));
    return {
      uri: normalizedUri,
      source,
      type: SourceCodeType.YAML,
      get ast() {
        return ast();
      },
      version,
    };
  } else {
    const ast = memo(() => toJSONAST(source));
    return {
      uri: normalizedUri,
      source,
      type: SourceCodeType.JSON,
      get ast() {
        return ast();
      },
      version,
    };
  }
}
