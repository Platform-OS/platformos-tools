import {
  ConfigTarget,
  GraphQLCheckDefinition,
  LiquidCheckDefinition,
  YAMLCheckDefinition,
} from '../types';

import { DeprecatedFilter } from './deprecated-filter';
import { DeprecatedTag } from './deprecated-tag';
import { DuplicateRenderPartialArguments } from './duplicate-render-partial-arguments';
import { DuplicateYAMLKey } from './duplicate-yaml-key';
import { ImgWidthAndHeight } from './img-width-and-height';
import { ImplicitIncludeArguments } from './implicit-include-arguments';
import { LiquidHTMLSyntaxError } from './liquid-html-syntax-error';
import { MatchingTranslations } from './matching-translations';
import { MissingAsset } from './missing-asset';
import { MissingDocParam } from './missing-doc-param';
import { MissingPartial } from './missing-partial';
import { ParserBlockingScript } from './parser-blocking-script';
import { RequiredDocParamWithDefault } from './required-doc-param-with-default';
import { ReservedVariableName } from './reserved-variable-name';
import { RollbackOutsideTransaction } from './rollback-outside-transaction';
import { TranslationKeyExists } from './translation-key-exists';
import { UnclosedHTMLElement } from './unclosed-html-element';
import { UndefinedObject } from './undefined-object';
import { UniqueDocParamNames } from './unique-doc-param-names';
import { FilterArity } from './filter-arity';
import { FilterWithoutEffect } from './filter-without-effect';
import { UnknownFilter } from './unknown-filter';
import { UnrecognizedRenderPartialArguments } from './unrecognized-render-partial-arguments';
import { UnusedAssign } from './unused-assign';
import { UnusedDocParam } from './unused-doc-param';
import { ValidHTMLTranslation } from './valid-html-translation';
import { ValidDocParamTypes } from './valid-doc-param-types';
import { ValidRenderPartialArgumentTypes } from './valid-render-partial-argument-types';
import { ValidFilterArgumentTypes } from './valid-filter-argument-types';
import { ValidTagArgumentTypes } from './valid-tag-argument-types';
import { VariableName } from './variable-name';
import { PartialCallArguments } from './partial-call-arguments';
import { GraphQLVariablesCheck } from './graphql-variables';
import { GraphQLCheck } from './graphql';
import { UnknownProperty } from './unknown-property';
import { InvalidSchemaPropertyType } from './invalid-schema-property-type';
import { InvalidWriteTarget } from './invalid-write-target';
import { DuplicateFunctionArguments } from './duplicate-function-arguments';
import { MissingRenderPartialArguments } from './missing-render-partial-arguments';
import { NestedGraphQLQuery } from './nested-graphql-query';
import { MissingPage } from './missing-page';
import { ValidFrontmatter } from './valid-frontmatter';
import { JsonLiteralQuoteStyle } from './json-literal-quote-style';
import { MissingContentForLayout } from './missing-content-for-layout';
import { YAMLSyntaxError } from './yaml-syntax-error';
import { UnsupportedStringEscape } from './unsupported-string-escape';

export const allChecks: (LiquidCheckDefinition | GraphQLCheckDefinition | YAMLCheckDefinition)[] = [
  DeprecatedFilter,
  DeprecatedTag,
  DuplicateFunctionArguments,
  DuplicateRenderPartialArguments,
  DuplicateYAMLKey,
  ImgWidthAndHeight,
  ImplicitIncludeArguments,
  LiquidHTMLSyntaxError,
  MatchingTranslations,
  MissingAsset,
  MissingDocParam,
  MissingPartial,
  ParserBlockingScript,
  RequiredDocParamWithDefault,
  ReservedVariableName,
  RollbackOutsideTransaction,
  TranslationKeyExists,
  UnclosedHTMLElement,
  UndefinedObject,
  UniqueDocParamNames,
  FilterArity,
  FilterWithoutEffect,
  UnknownFilter,
  UnrecognizedRenderPartialArguments,
  UnusedAssign,
  UnusedDocParam,
  ValidHTMLTranslation,
  ValidDocParamTypes,
  ValidRenderPartialArgumentTypes,
  ValidFilterArgumentTypes,
  ValidTagArgumentTypes,
  VariableName,
  PartialCallArguments,
  GraphQLVariablesCheck,
  GraphQLCheck,
  UnknownProperty,
  InvalidSchemaPropertyType,
  InvalidWriteTarget,
  MissingRenderPartialArguments,
  NestedGraphQLQuery,
  MissingPage,
  ValidFrontmatter,
  JsonLiteralQuoteStyle,
  MissingContentForLayout,
  YAMLSyntaxError,
  UnsupportedStringEscape,
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
