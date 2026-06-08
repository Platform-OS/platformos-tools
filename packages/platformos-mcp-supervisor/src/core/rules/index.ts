/**
 * Rule registry bootstrap.
 *
 * `loadAllRules()` registers every in-scope per-check rule module against
 * the engine. Idempotent: a second call against an already-loaded registry
 * is a no-op. `reloadRules()` clears state and re-registers — used by
 * tests to isolate fixtures.
 *
 * v1 trim: dropped `loadPromotedRules` and the `engine-mode.isAdaptive()`
 * gate. There is no adaptive layer in v1; every rule loads unconditionally.
 *
 * Module order below mirrors the source for parity with the analytics
 * baseline. The engine sorts by `priority` inside each check anyway, so
 * the registration order is observable only when two modules emit rules
 * for the SAME check — which none of the 32 modules do (each owns its
 * own `check` name).
 */

import { clearRules, registerRules, ruleCount, type Rule } from './engine';

import { rules as MissingPartialRules } from './MissingPartial';
import { rules as UndefinedObjectRules } from './UndefinedObject';
import { rules as UnknownFilterRules } from './UnknownFilter';
import { rules as TranslationKeyExistsRules } from './TranslationKeyExists';
import { rules as UnusedAssignRules } from './UnusedAssign';
import { rules as MissingRenderPartialArgumentsRules } from './MissingRenderPartialArguments';
import { rules as UnknownPropertyRules } from './UnknownProperty';
import { rules as MetadataParamsCheckRules } from './MetadataParamsCheck';
import { rules as GraphQLCheckRules } from './GraphQLCheck';
import { rules as ImgLazyLoadingRules } from './ImgLazyLoading';
import { rules as ImgWidthAndHeightRules } from './ImgWidthAndHeight';
import { rules as ConvertIncludeToRenderRules } from './ConvertIncludeToRender';
import { rules as NonGetRenderingPageRules } from './NonGetRenderingPage';
import { rules as ValidFrontmatterRules } from './ValidFrontmatter';
import { rules as JsonLiteralQuoteStyleRules } from './JsonLiteralQuoteStyle';
import { rules as DuplicateFunctionArgumentsRules } from './DuplicateFunctionArguments';
import { rules as DeprecatedTagRules } from './DeprecatedTag';
import { rules as UnrecognizedRenderPartialArgumentsRules } from './UnrecognizedRenderPartialArguments';
import { rules as SchemaPropertyRules } from './SchemaProperty';
import { rules as SchemaYAMLRules } from './SchemaYAML';
import { rules as MissingSlugRules } from './MissingSlug';
import { rules as MissingContentForLayoutRules } from './MissingContentForLayout';
import { rules as ParserBlockingScriptRules } from './ParserBlockingScript';
import { rules as TranslationMissingLocaleKeyRules } from './TranslationMissingLocaleKey';
import { rules as MissingAssetRules } from './MissingAsset';
import { rules as OrphanedPartialRules } from './OrphanedPartial';
import { rules as MissingPageRules } from './MissingPage';
import { rules as LiquidHTMLSyntaxErrorRules } from './LiquidHTMLSyntaxError';
import { rules as InvalidLayoutRules } from './InvalidLayout';
import { rules as PartialCallArgumentsRules } from './PartialCallArguments';
import { rules as GraphQLVariablesCheckRules } from './GraphQLVariablesCheck';
import { rules as UnusedDocParamRules } from './UnusedDocParam';

const ALL_RULE_MODULES: ReadonlyArray<ReadonlyArray<Rule>> = [
  MissingPartialRules,
  UndefinedObjectRules,
  UnknownFilterRules,
  TranslationKeyExistsRules,
  UnusedAssignRules,
  MissingRenderPartialArgumentsRules,
  UnknownPropertyRules,
  MetadataParamsCheckRules,
  GraphQLCheckRules,
  ImgLazyLoadingRules,
  ImgWidthAndHeightRules,
  ConvertIncludeToRenderRules,
  NonGetRenderingPageRules,
  ValidFrontmatterRules,
  JsonLiteralQuoteStyleRules,
  DuplicateFunctionArgumentsRules,
  DeprecatedTagRules,
  UnrecognizedRenderPartialArgumentsRules,
  SchemaPropertyRules,
  SchemaYAMLRules,
  MissingSlugRules,
  MissingContentForLayoutRules,
  ParserBlockingScriptRules,
  TranslationMissingLocaleKeyRules,
  MissingAssetRules,
  OrphanedPartialRules,
  MissingPageRules,
  LiquidHTMLSyntaxErrorRules,
  InvalidLayoutRules,
  PartialCallArgumentsRules,
  GraphQLVariablesCheckRules,
  UnusedDocParamRules,
];

let _loaded = false;

/**
 * Register every per-check rule module. Idempotent.
 */
export function loadAllRules(): void {
  if (_loaded) return;
  for (const rules of ALL_RULE_MODULES) {
    registerRules(rules);
  }
  _loaded = true;
}

/**
 * Reset the registry and re-register from scratch. Used by tests that
 * want fresh state per file.
 */
export function reloadRules(): void {
  clearRules();
  _loaded = false;
  loadAllRules();
}

export { ruleCount };
