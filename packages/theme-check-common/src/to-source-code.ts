import { toLiquidHtmlAST } from '@platformos/liquid-html-parser';

import { toJSONNode } from './jsonc/parse';
import * as path from './path';
import {
  GraphQLDocumentNode,
  GraphQLSourceCode,
  JSONNode,
  JSONSourceCode,
  LiquidSourceCode,
  SourceCodeType,
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
): LiquidSourceCode | JSONSourceCode | GraphQLSourceCode {
  const isLiquid = uri.endsWith('.liquid');
  const isGraphQL = uri.endsWith('.graphql');

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
