import { SourceCodeType, SourceCode, DocDefinition } from '@platformos/platformos-check-common';
import { TextDocument } from 'vscode-languageserver-textdocument';

/** Util type to add the common `textDocument` property to the SourceCode. */
type _AugmentedSourceCode<SCT extends SourceCodeType = SourceCodeType> = SourceCode<SCT> & {
  textDocument: TextDocument;
};

/** JsonSourceCode + textDocument */
export type AugmentedJsonSourceCode = _AugmentedSourceCode<SourceCodeType.JSON>;

export type AugmentedGraphQLSourceCode = _AugmentedSourceCode<SourceCodeType.GraphQL>;

export type AugmentedLiquidSourceCode = _AugmentedSourceCode<SourceCodeType.LiquidHtml> & {
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
