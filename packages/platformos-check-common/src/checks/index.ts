import {
  ConfigTarget,
  GraphQLCheckDefinition,
  JSONCheckDefinition,
  LiquidCheckDefinition,
  YAMLCheckDefinition,
} from '../types';

import { DeprecatedFilter } from './deprecated-filter';
import { DeprecatedTag } from './deprecated-tag';
import { DuplicateRenderPartialArguments } from './duplicate-render-partial-arguments';
import { ImgWidthAndHeight } from './img-width-and-height';
import { JSONSyntaxError } from './json-syntax-error';
import { LiquidHTMLSyntaxError } from './liquid-html-syntax-error';
import { MatchingTranslations } from './matching-translations';
import { MissingAsset } from './missing-asset';
import { MissingPartial } from './missing-partial';
import { OrphanedPartial } from './orphaned-partial';
import { ParserBlockingScript } from './parser-blocking-script';
import { TranslationKeyExists } from './translation-key-exists';
import { UnclosedHTMLElement } from './unclosed-html-element';
import { UndefinedObject } from './undefined-object';
import { UniqueDocParamNames } from './unique-doc-param-names';
import { UnknownFilter } from './unknown-filter';
import { UnrecognizedRenderPartialArguments } from './unrecognized-render-partial-arguments';
import { UnusedAssign } from './unused-assign';
import { UnusedDocParam } from './unused-doc-param';
import { ValidHTMLTranslation } from './valid-html-translation';
import { ValidJSON } from './valid-json';
import { ValidDocParamTypes } from './valid-doc-param-types';
import { ValidRenderPartialArgumentTypes } from './valid-render-partial-argument-types';
import { VariableName } from './variable-name';
import { MetadataParamsCheck } from './metadata-params';
import { GraphQLVariablesCheck } from './graphql-variables';
import { GraphQLCheck } from './graphql';
import { UnknownProperty } from './unknown-property';
import { InvalidHashAssignTarget } from './invalid-hash-assign-target';
import { DuplicateFunctionArguments } from './duplicate-function-arguments';
import { MissingPage } from './missing-page';
import { ValidFrontmatter } from './valid-frontmatter';

export const allChecks: (
  | LiquidCheckDefinition
  | JSONCheckDefinition
  | GraphQLCheckDefinition
  | YAMLCheckDefinition
)[] = [
  DeprecatedFilter,
  DeprecatedTag,
  DuplicateFunctionArguments,
  DuplicateRenderPartialArguments,
  ImgWidthAndHeight,
  JSONSyntaxError,
  LiquidHTMLSyntaxError,
  MatchingTranslations,
  MissingAsset,
  MissingPartial,
  OrphanedPartial,
  ParserBlockingScript,
  TranslationKeyExists,
  UnclosedHTMLElement,
  UndefinedObject,
  UniqueDocParamNames,
  UnknownFilter,
  UnrecognizedRenderPartialArguments,
  UnusedAssign,
  UnusedDocParam,
  ValidHTMLTranslation,
  ValidJSON,
  ValidDocParamTypes,
  ValidRenderPartialArgumentTypes,
  VariableName,
  MetadataParamsCheck,
  GraphQLVariablesCheck,
  GraphQLCheck,
  UnknownProperty,
  InvalidHashAssignTarget,
  MissingPage,
  ValidFrontmatter,
];

/**
 * The recommended checks is populated by all checks with the following conditions:
 * - meta.docs.recommended: true
 * - Either no meta.targets list exist or if it does exist then Recommended is a target
 */
export const recommended = allChecks.filter((check) => {
  const isRecommended = check.meta.docs.recommended;
  const isValidTarget =
    !check.meta.targets ||
    !check.meta.targets.length ||
    check.meta.targets.includes(ConfigTarget.Recommended);

  return isRecommended && isValidTarget;
});
