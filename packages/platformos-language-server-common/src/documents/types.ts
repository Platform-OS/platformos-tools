import { SourceCodeType, SourceCode } from '@platformos/platformos-check-common';
import { JSONNode } from '@platformos/platformos-check-common';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { DocDefinition } from '@platformos/platformos-check-common';

/**
 * Reserved for future use. platformOS does not use `{% schema %}` blocks,
 * so `getSchema()` always returns `undefined`.
 */
export interface SchemaObject {
  parsed: any;
  validSchema?: unknown;
  ast: JSONNode | Error;
  offset: number;
}

/** Util type to add the common `textDocument` property to the SourceCode. */
type _AugmentedSourceCode<SCT extends SourceCodeType = SourceCodeType> = SourceCode<SCT> & {
  textDocument: TextDocument;
};

/** JsonSourceCode + textDocument */
export type AugmentedJsonSourceCode = _AugmentedSourceCode<SourceCodeType.JSON>;

export type AugmentedGraphQLSourceCode = _AugmentedSourceCode<SourceCodeType.GraphQL>;

/**
 * AugmentedLiquidSourceCode may hold the schema for the section or block.
 *
 * We'll use the SourceCode as the source of truth since we won't need to care
 * about cache invalidation and will mean we'll parse the schema at most once.
 */
export type AugmentedLiquidSourceCode = _AugmentedSourceCode<SourceCodeType.LiquidHtml> & {
  getSchema: () => Promise<SchemaObject | undefined>;
  getLiquidDoc: () => Promise<DocDefinition | undefined>;
};

/**
 * AugmentedSourceCode is a union of the two augmented source codes.
 *
 * When passed a specific SourceCodeType, it will return the correct AugmentedSourceCode.
 *
 * @example
 * AugmentedSourceCode -> AugmentedJsonSourceCode | AugmentedLiquidSourceCode
 * AugmentedSourceCode<SourceCodeType.JSON> -> AugmentedJsonSourceCode
 * AugmentedSourceCode<SourceCodeType.LiquidHtml> -> AugmentedLiquidSourceCode
 */
export type AugmentedYAMLSourceCode = _AugmentedSourceCode<SourceCodeType.YAML>;

export type AugmentedSourceCode<SCT extends SourceCodeType = SourceCodeType> = {
  [SourceCodeType.JSON]: AugmentedJsonSourceCode;
  [SourceCodeType.LiquidHtml]: AugmentedLiquidSourceCode;
  [SourceCodeType.GraphQL]: AugmentedGraphQLSourceCode;
  [SourceCodeType.YAML]: AugmentedYAMLSourceCode;
}[SCT];

export const isLiquidSourceCode = (file: AugmentedSourceCode): file is AugmentedLiquidSourceCode =>
  file.type === SourceCodeType.LiquidHtml;

export const isJsonSourceCode = (file: AugmentedSourceCode): file is AugmentedJsonSourceCode =>
  file.type === SourceCodeType.JSON;

export const isGraphQLSourceCode = (file: AugmentedSourceCode): file is AugmentedJsonSourceCode =>
  file.type === SourceCodeType.GraphQL;
