/**
 * Synchronous diagnostic enrichment.
 *
 * Every LSP diagnostic passes through `enrichAll` before the pipeline
 * runs. For each diagnostic:
 *
 *   1. Hover-fetch the LSP at the diagnostic position (cached per file).
 *   2. If a rule module is registered for `diag.check` and a fact graph
 *      is available, run rules — first match wins, its output is copied
 *      onto the diagnostic, and the per-check regex fallback is skipped.
 *   3. Otherwise apply per-check regex enrichment: extract identifiers
 *      via `extractParams`, look them up against the docset / Shopify
 *      lists, render the matching hint template.
 *   4. Always run `attachSeeAlso` to bolt on a structured route hint.
 *
 * `bridgeRulesOntoUnattributed` re-runs step (2) over diagnostics that
 * were pushed into `result` AFTER `enrichAll` finished (structural
 * warnings, schema/translation validators, diff-aware `RemovedRender` /
 * `AddedParam`, new-partial caller check). Idempotent — diagnostics that
 * already carry a `rule_id` are skipped.
 *
 * v1 trim: no `analyticsStore` and no `case_base_signal`. The adaptive
 * engine is out of v1 scope; rules return their raw output and the
 * enricher copies it without scoring. SchemaIndex is also absent (its
 * sole in-scope consumers were dropped in P7).
 */

import type { Hover } from 'vscode-languageserver-protocol';

import type { PlatformOSLSPClient } from './lsp-client';
import type { ProjectFactGraph } from './project-fact-graph';
import type { FiltersIndex } from './filters-index';
import type { ObjectsIndex } from './objects-index';
import type { TagsIndex } from './tags-index';
import type { RuleFacts, RuleFix, SeeAlso } from './rules/engine';

import { getHint } from './hint-loader';
import { extractParams, templateOf } from './diagnostic-record';
import { isShopifyObject, isShopifyFilter, getShopifyObject, getShopifyFilter } from './knowledge-loader';
import { runRules, hasRules } from './rules/engine';

// ── Public types ───────────────────────────────────────────────────────────

export interface EnrichContext {
  /** File URI used for LSP hover / completion requests. */
  uri: string;
  lsp?: PlatformOSLSPClient;
  filtersIndex?: FiltersIndex;
  objectsIndex?: ObjectsIndex;
  tagsIndex?: TagsIndex;
  /** Raw file content under analysis (used by rules + completion lookup). */
  content?: string;
  /** Project fact graph — when present, rules fire ahead of regex fallback. */
  factGraph?: ProjectFactGraph;
  /** Repo-relative path of the file under analysis. */
  filePath?: string;
  /** Absolute project root. */
  projectDir?: string;
  /** Internal: hover cache populated by `enrichAll`. Not part of the public surface. */
  _hoverCache?: HoverCache;
}

export interface EnrichedDiagnostic {
  check: string;
  severity: 'error' | 'warning' | 'info';
  message: string;
  line?: number;
  column?: number;
  endLine?: number | null;
  endColumn?: number | null;
  _filePath?: string;

  hint?: string | null;
  suggestion?: string;
  rule_id?: string;
  confidence?: number;
  see_also?: SeeAlso;
  fixes?: RuleFix[];
  hover_docs?: string;

  /** Rules may attach arbitrary keys; surfaced for downstream consumers. */
  [key: string]: unknown;
}

/** Shape consumed by `bridgeRulesOntoUnattributed`. */
export interface BridgeResult {
  errors: EnrichedDiagnostic[];
  warnings: EnrichedDiagnostic[];
  infos: EnrichedDiagnostic[];
}

// ── Hover helpers ──────────────────────────────────────────────────────────

type HoverCache = Map<string, string | null>;

/**
 * Extract human-readable text from an LSP `Hover` result. Returns `null`
 * for empty hovers, malformed shapes, and the explicit-null cache hit.
 */
function extractHoverText(result: Hover | null | undefined): string | null {
  if (!result?.contents) return null;
  const c = result.contents;
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) {
    return c
      .map((x) => (typeof x === 'string' ? x : (x?.value ?? '')))
      .join('\n\n');
  }
  if (typeof c === 'object' && 'value' in c && typeof c.value === 'string') {
    return c.value;
  }
  return null;
}

// ── enrichError — per-diagnostic enrichment ────────────────────────────────

/**
 * Enrich a single diagnostic with hint, LSP hover, index suggestions, and
 * an optional rule-engine result. Returns a NEW object — never mutates
 * the input.
 */
export async function enrichError(
  diagnostic: EnrichedDiagnostic,
  ctx: EnrichContext,
): Promise<EnrichedDiagnostic> {
  const { uri, lsp, filtersIndex, objectsIndex, tagsIndex, content, _hoverCache, factGraph, filePath, projectDir } = ctx;

  const result: EnrichedDiagnostic = { ...diagnostic };

  // 1. Hint stays null until a per-check branch (or rule) sets it. A
  //    fallback at the bottom assigns the generic hint for any check that
  //    didn't match a specialised branch.
  result.hint = null;

  // 2. LSP hover at the diagnostic position. Read from the per-position
  //    cache that `enrichAll` populated; fall back to a direct call when
  //    the cache is absent (single-diagnostic callers).
  if (diagnostic.line != null) {
    const posKey = `${diagnostic.line}:${diagnostic.column ?? 0}`;
    if (_hoverCache?.has(posKey)) {
      const cached = _hoverCache.get(posKey);
      if (cached) result.hover_docs = cached;
    } else if (lsp?.initialized) {
      try {
        const hover = await lsp.hover(uri, diagnostic.line, diagnostic.column ?? 0);
        const text = extractHoverText(hover);
        if (text) result.hover_docs = text;
      } catch {
        // LSP hover failed — skip
      }
    }
  }

  // 2b. Rule engine — when rules exist for this check and a fact graph
  //     is available, run rules first. If a rule matches, its output
  //     wins and the per-check regex fallback is skipped.
  if (factGraph && hasRules(diagnostic.check)) {
    const params = extractParams(diagnostic.check, diagnostic.message);
    const tmplFp = templateOf(diagnostic.check, diagnostic.message);
    const diagForRule = {
      check: diagnostic.check,
      params,
      message: diagnostic.message,
      file: filePath,
      line: diagnostic.line,
      column: diagnostic.column ?? 0,
      template_fp: tmplFp,
    };
    // `content` is threaded into facts so rules can detect in-memory
    // patterns the project graph does not yet reflect (e.g. multi-line
    // graphql calls inside a {% liquid %} block that the upstream LSP
    // truncates — see GraphQLVariablesCheck.parser_blind_spot).
    const facts: RuleFacts = {
      graph: factGraph,
      filtersIndex,
      objectsIndex,
      tagsIndex,
      projectDir,
      content,
    };
    const ruleResult = runRules(diagForRule, facts);
    if (ruleResult) {
      if (ruleResult.hint_md) result.hint = ruleResult.hint_md;
      result.rule_id = ruleResult.rule_id;
      if (ruleResult.suggestion) result.suggestion = ruleResult.suggestion;
      if (ruleResult.see_also) result.see_also = ruleResult.see_also;
      if (ruleResult.confidence != null) result.confidence = ruleResult.confidence;
      if (ruleResult.fixes && ruleResult.fixes.length > 0) result.fixes = ruleResult.fixes;
      attachSeeAlso(result, content);
      return result;
    }
  }

  // 3. Per-check regex enrichment fallback.

  if (diagnostic.check === 'UnknownFilter') {
    const filterName = extractParams(diagnostic.check, diagnostic.message).filter ?? null;
    let suggestion: string | null = null;
    if (filterName) {
      if (tagsIndex?.isTag(filterName)) {
        suggestion = `\`${filterName}\` is a tag, not a filter. Use \`{% ${filterName} ... %}\` instead of \`| ${filterName}\`.`;
      } else if (isShopifyFilter(filterName)) {
        const info = getShopifyFilter(filterName);
        suggestion = info?.replacement
          ? `\`${filterName}\` is a Shopify filter — not in platformOS. Use \`${info.replacement}\` instead.${info.note ? ` ${info.note}` : ''}`
          : `\`${filterName}\` is a Shopify-specific filter — not in platformOS.${info?.note ? ` ${info.note}` : ''}`;
      } else if (filtersIndex?.loaded) {
        const exact = filtersIndex.lookup(filterName);
        if (exact) {
          suggestion = `Filter \`${exact.name}\` exists: ${exact.syntax || exact.summary}`;
        } else {
          const closest = filtersIndex.closestMatch(filterName);
          if (closest) {
            suggestion = `Did you mean \`${closest.name}\`? ${closest.syntax || closest.summary}`;
          }
        }
      }
    }
    if (suggestion) result.suggestion = suggestion;
    result.hint = filterName
      ? getHint(diagnostic.check, null, {
          filter_name: filterName,
          has_suggestion: !!suggestion,
          suggestion: suggestion ?? '',
        })
      : getHint(diagnostic.check, null);
  }

  if (diagnostic.check === 'UndefinedObject') {
    const varName = extractParams(diagnostic.check, diagnostic.message).variable ?? null;
    const isPartial = uri?.includes('/partials/') ?? false;
    let suggestion: string | null = null;
    let isShopify = false;
    if (varName) {
      if (isShopifyObject(varName)) {
        isShopify = true;
        const info = getShopifyObject(varName);
        suggestion = info?.replacement
          ? `\`${varName}\` is a Shopify object. Use: \`${info.replacement}\`${info.note ? ` — ${info.note}` : ''}`
          : `\`${varName}\` is a Shopify theme object — not in platformOS.${info?.note ? ` ${info.note}` : ' Use GraphQL queries to fetch data and `context.*` for request/user data.'}`;
      } else if (objectsIndex?.loaded) {
        const obj = objectsIndex.lookup(varName);
        if (obj) {
          suggestion = `Use \`${obj.handle}\` instead of bare \`${varName}\`. Properties: ${obj.properties.slice(0, 5).join(', ')}`;
        }
      }
    }
    if (suggestion) result.suggestion = suggestion;
    // Pick variant: Shopify objects get a dedicated hint (never "declare
    // as @param"), partials get the partial variant, pages get default.
    const objVariant = isShopify ? 'shopify' : (isPartial ? 'partial' : null);
    result.hint = varName
      ? getHint(diagnostic.check, objVariant, {
          var_name: varName,
          has_suggestion: !!suggestion,
          suggestion: suggestion ?? '',
        })
      : getHint(diagnostic.check, isPartial ? 'partial' : null);
  }

  if (diagnostic.check === 'GraphQLCheck') {
    const vars = classifyGraphQLError(diagnostic.message);
    result.hint = getHint(diagnostic.check, null, vars);
  }

  if (diagnostic.check === 'TranslationKeyExists') {
    const tp = extractParams(diagnostic.check, diagnostic.message);
    const key = tp.key ?? null;
    const hasSuggestion = tp.has_typo_suggestion === 'true';
    if (key) {
      result.hint = getHint(diagnostic.check, null, {
        key,
        yaml_snippet: buildYamlSnippet(key),
        yaml_path_comment: key.split('.').join(' > '),
        has_suggestion: hasSuggestion,
      });
    }
  }

  if (diagnostic.check === 'MissingPartial') {
    const partialName = extractParams(diagnostic.check, diagnostic.message).partial ?? null;
    const objType = detectObjectType(partialName);
    const createPath = buildCreatePath(objType, partialName);
    const tag = objType === 'partial' ? 'render' : 'function';
    let hintVariant: string | null = null;
    if (objType === 'module') hintVariant = 'module';
    else if (objType === 'invalid_lib_prefix') hintVariant = 'invalid_lib_prefix';

    // For module paths: fetch LSP completions to show available paths.
    // For project paths the agent has project_map context, no completions needed.
    let suggestion: string | null = null;
    if (objType === 'module' && partialName && lsp?.initialized && content && diagnostic.line != null) {
      const lines = content.split('\n');
      const lineContent = lines[diagnostic.line] ?? '';
      const squoteIdx = lineContent.indexOf(`'${partialName}'`);
      const dquoteIdx = lineContent.indexOf(`"${partialName}"`);
      const quoteIdx = squoteIdx >= 0 ? squoteIdx : dquoteIdx;
      if (quoteIdx >= 0) {
        const col = quoteIdx + 1;
        try {
          const completionResult = await lsp.completions(uri, diagnostic.line, col);
          const labels = extractCompletionLabels(completionResult);
          if (labels.length > 0) {
            const moduleParts = partialName.split('/');
            const modulePrefix = moduleParts.length >= 2 ? `${moduleParts[0]}/${moduleParts[1]}/` : '';
            const inSameModule = modulePrefix ? labels.filter((l) => l.startsWith(modulePrefix)) : [];
            // Suggest only paths from the SAME module — don't fall back to
            // unrelated project paths.
            if (inSameModule.length > 0) {
              const filtered = inSameModule.slice(0, 8);
              suggestion = `'${partialName}' not found in module. Available: ${filtered.join(', ')}`;
            }
          }
        } catch {
          // LSP completions failed — no suggestions
        }
      }
    }
    if (suggestion) result.suggestion = suggestion;

    const correctedName = objType === 'invalid_lib_prefix' && partialName
      ? partialName.slice('lib/'.length)
      : null;
    result.hint = partialName
      ? getHint(diagnostic.check, hintVariant, {
          object: objType,
          name: partialName,
          create_path: createPath,
          tag,
          has_suggestion: !!suggestion,
          ...(correctedName ? { corrected_name: correctedName } : {}),
        })
      : getHint(diagnostic.check, hintVariant);
  }

  if (diagnostic.check === 'UnknownProperty') {
    const { property: propertyName, object: objectName } = extractParams(diagnostic.check, diagnostic.message);
    const propVariant = uri?.includes('/partials/') ? 'partial' : null;
    result.hint = propertyName && objectName
      ? getHint(diagnostic.check, propVariant, {
          property_name: propertyName,
          object_name: objectName,
        })
      : getHint(diagnostic.check, propVariant);
  }

  if (diagnostic.check === 'DeprecatedTag') {
    const { tag: tagName, replacement: replacementTag } = extractParams(diagnostic.check, diagnostic.message);
    result.hint = tagName
      ? getHint(diagnostic.check, null, {
          tag_name: tagName,
          replacement_tag: replacementTag ?? '',
        })
      : getHint(diagnostic.check, null);

    // Override the LSP message — it reads as if the tag is still usable
    // ("Invalid syntax for tag 'X'. Expected syntax: ..."). Replace with
    // an explicit deprecation message so the hint doesn't contradict it.
    if (tagName && /Expected syntax/i.test(diagnostic.message)) {
      const REPLACEMENTS: Record<string, string> = {
        hash_assign: '{% assign hash["key"] = "value" %} (platformOS assign supports bracket/dot notation)',
        parse_json: '{% assign obj = { "key": "value" } %} (use assign with hash/array literals)',
        include: "{% render 'partial', var: value %} (render has isolated scope — pass all variables explicitly)",
      };
      const replacement = REPLACEMENTS[tagName];
      result.message = replacement
        ? `'{% ${tagName} %}' is deprecated and will be removed. Replace with: ${replacement}.`
        : `'{% ${tagName} %}' is deprecated and will be removed.`;
    }
  }

  if (diagnostic.check === 'MissingRenderPartialArguments') {
    const { partial: partialName, missing_param: missingParam } = extractParams(diagnostic.check, diagnostic.message);
    result.hint = partialName || missingParam
      ? getHint(diagnostic.check, null, {
          partial_name: partialName ?? 'unknown',
          missing_param: missingParam ?? 'unknown',
        })
      : getHint(diagnostic.check, null);
  }

  if (diagnostic.check === 'MetadataParamsCheck') {
    // Distinguish function calls (queries/commands) from render calls.
    const isFunctionCall = /function call/i.test(diagnostic.message);
    result.hint = getHint(diagnostic.check, null, {
      is_function_call: isFunctionCall,
    });
  }

  if (diagnostic.check === 'UnusedAssign') {
    const varName = extractParams(diagnostic.check, diagnostic.message).variable ?? null;
    result.hint = varName
      ? getHint(diagnostic.check, null, { var_name: varName })
      : getHint(diagnostic.check, null);
  }

  // Fallback hint for checks without a specific enrichment block.
  if (result.hint === null) {
    result.hint = getHint(diagnostic.check, null);
  }

  // Always run the see-also routing.
  attachSeeAlso(result, content);

  return result;
}

// ── attachSeeAlso — structured "go read X" routing ─────────────────────────

/**
 * Attach a structured `see_also` field pointing at the authoritative
 * source for this diagnostic — usually a `domain_guide` call,
 * occasionally `module_info`. MUST be a structured object (tool + args),
 * NOT embedded prose, because agents react reliably to fields and ignore
 * prose advice.
 *
 * Mutates `diagnostic` in place. No-op when `see_also` is already set.
 */
export function attachSeeAlso(diagnostic: EnrichedDiagnostic, content?: string): void {
  if (!diagnostic || typeof diagnostic !== 'object') return;
  if (diagnostic.see_also) return; // never overwrite an explicit route

  const check = diagnostic.check;
  const message = diagnostic.message ?? '';

  // Shopify contamination → partials gotchas. Identified either by
  // suggestion text mentioning Shopify or by the UndefinedObject-shopify
  // hint variant. Either signal means the diagnostic is about a
  // Shopify-ism in otherwise valid Liquid.
  if (check === 'UndefinedObject' && /shopify/i.test(diagnostic.suggestion ?? '')) {
    diagnostic.see_also = {
      tool: 'domain_guide',
      args: { domain: 'partials', section: 'gotchas' },
      reason:
        'Shopify object detected — platformOS uses context.* objects, not shop/cart/customer/product/collection. ' +
        'domain_guide(partials, gotchas) lists every deprecated/forbidden identifier.',
    };
    return;
  }

  // Deprecated {% include %} tag.
  if (check === 'DeprecatedTag' && /include/i.test(message)) {
    diagnostic.see_also = {
      tool: 'domain_guide',
      args: { domain: 'partials', section: 'gotchas' },
      reason:
        '{% include %} is deprecated in platformOS. Use {% render %} for isolated scope or {% function %} for module helpers. ' +
        'domain_guide(partials, gotchas) has the full deprecated-tag list.',
    };
    return;
  }

  // Missing module partial — route to module_info for the authoritative call path.
  if (check === 'MissingPartial') {
    const nameMatch = message.match(/['"]([^'"]+)['"]/);
    const partialName = nameMatch?.[1];
    if (partialName?.startsWith('modules/')) {
      const moduleName = partialName.split('/')[1];
      diagnostic.see_also = {
        tool: 'module_info',
        args: { name: moduleName, section: 'api' },
        reason: `Module partial '${partialName}' not found. module_info(${moduleName}, api) returns the live-scanned call paths and signatures from the installed module — stale memory of module paths is the #1 reason for this error.`,
      };
      return;
    }
  }

  // Missing param on render/function — route to the relevant domain API section.
  // forms/* partials use form-specific conventions documented in the forms
  // guide; everything else falls back to the partials guide.
  if (check === 'MetadataParamsCheck' || check === 'MissingRenderPartialArguments') {
    const isFormPartial =
      /['"]modules\/common-styling\/forms\//.test(content ?? '') ||
      /['"][^'"]*forms\/[^'"]+['"]/.test(content ?? '');
    diagnostic.see_also = {
      tool: 'domain_guide',
      args: { domain: isFormPartial ? 'forms' : 'partials', section: 'api' },
      reason: isFormPartial
        ? 'Form partial call is missing required params. domain_guide(forms, api) lists every form helper signature (error_list, error_input_handler, etc.).'
        : 'Render call is missing required params. domain_guide(partials, api) explains how {% doc %} @param declarations interact with render and function calls.',
    };
    return;
  }

  // Missing translation key — route to translations gotchas.
  if (check === 'TranslationKeyExists') {
    diagnostic.see_also = {
      tool: 'domain_guide',
      args: { domain: 'translations', section: 'gotchas' },
      reason:
        'Translation key not found. domain_guide(translations, gotchas) covers locale nesting, key derivation, and dot-notation conventions.',
    };
    return;
  }

  // Hardcoded auth routes — common Shopify/Rails contamination.
  if (check === 'HardcodedRoutes') {
    const looksAuth = /\/sessions\b|\/users\b|\/login\b|\/signup\b|\/register\b/i.test(message);
    diagnostic.see_also = {
      tool: 'domain_guide',
      args: looksAuth
        ? { domain: 'authentication', section: 'patterns' }
        : { domain: 'routing', section: 'patterns' },
      reason: looksAuth
        ? 'Auth route detected. platformOS uses /sessions/new (not /sessions) and /users/new (not /users). domain_guide(authentication, patterns) has the correct URLs and ownership patterns.'
        : 'Hardcoded route. domain_guide(routing, patterns) explains slug conventions and how to use link_to helpers.',
    };
    return;
  }
}

// ── GraphQL error classifier ───────────────────────────────────────────────

/**
 * Classify a GraphQL error message into a category with extracted
 * variables. Returns the variable bag for the `GraphQLCheck` hint template.
 *
 * Note: the source returns a discriminated bag (`category_unused_var`,
 * `category_unknown_field_record`, etc.) keyed by category. We keep the
 * same shape so the hint template's `{{#if category_X}}` conditionals
 * fire identically.
 */
function classifyGraphQLError(message: string | undefined): Record<string, string | boolean> {
  if (!message) return { category_generic: true };

  const unusedMatch = message.match(/Variable\s+["']?\$(\w+)["']?\s+is never used/i);
  if (unusedMatch) {
    return { category_unused_var: true, var_name: unusedMatch[1] };
  }

  const fieldMatch = message.match(/Cannot query field\s+["']?(\w+)["']?\s+on type\s+["']?(\w+)["']?/i);
  if (fieldMatch) {
    const isRecord = fieldMatch[2] === 'Record';
    return {
      [`category_unknown_field_${isRecord ? 'record' : 'other'}`]: true,
      field_name: fieldMatch[1],
      type_name: fieldMatch[2],
    };
  }

  const typeMismatch = message.match(/Variable\s+["']?\$(\w+)["']?\s+of type\s+["']?([^"']+)["']?\s+used in position expecting(?: type)?\s+["']?([^"'.]+)["']?/i);
  if (typeMismatch) {
    const expectedType = typeMismatch[3].trim();
    const isFilter = /filter/i.test(expectedType);
    return {
      [`category_type_mismatch_${isFilter ? 'filter' : 'other'}`]: true,
      var_name: typeMismatch[1],
      actual_type: typeMismatch[2],
      expected_type: expectedType,
    };
  }

  const filterMatch = message.match(/Expected value of type\s+["']?(\w+)["']?,?\s+found\s+["']?([^"'.]+)["']?/i);
  if (filterMatch) {
    const isFilter = /filter/i.test(filterMatch[1]);
    return {
      [`category_type_mismatch_${isFilter ? 'filter' : 'other'}`]: true,
      var_name: filterMatch[2].trim(),
      actual_type: `"${filterMatch[2].trim()}"`,
      expected_type: filterMatch[1],
    };
  }

  return { category_generic: true };
}

// ── Translation-key snippet builder ────────────────────────────────────────

/**
 * Build an indented YAML snippet showing where to add a translation key.
 * `'foo.bar.baz'` → `'  en:\n    foo:\n      bar:\n        baz: "TODO: translation text"'`.
 */
function buildYamlSnippet(key: string | null | undefined): string {
  if (!key) return '  en:\n    your_key: "TODO: translation text"';
  const parts = key.split('.');
  const lines: string[] = ['  en:'];
  for (let i = 0; i < parts.length; i++) {
    const indent = '  '.repeat(i + 2);
    if (i === parts.length - 1) {
      lines.push(`${indent}${parts[i]}: "TODO: translation text"`);
    } else {
      lines.push(`${indent}${parts[i]}:`);
    }
  }
  return lines.join('\n');
}

// ── LSP completion extractor ───────────────────────────────────────────────

interface CompletionItemLike {
  label?: string;
  insertText?: string;
}

interface CompletionListLike {
  items?: ReadonlyArray<CompletionItemLike>;
}

/**
 * Normalise LSP completion result to an array of label strings. LSP can
 * return either `CompletionItem[]` or `CompletionList { items }`.
 */
function extractCompletionLabels(
  result: ReadonlyArray<CompletionItemLike> | CompletionListLike | null | undefined,
): string[] {
  if (!result) return [];
  let items: ReadonlyArray<CompletionItemLike>;
  if (Array.isArray(result)) {
    items = result;
  } else {
    items = (result as CompletionListLike).items ?? [];
  }
  const out: string[] = [];
  for (const c of items) {
    const label = c.label ?? c.insertText ?? '';
    if (label) out.push(label);
  }
  return out;
}

// ── MissingPartial path classifier ─────────────────────────────────────────

type ObjectType = 'partial' | 'command' | 'query' | 'module' | 'invalid_lib_prefix';

/**
 * Detect what kind of platformOS object a missing partial name refers to.
 */
function detectObjectType(name: string | null | undefined): ObjectType {
  if (!name) return 'partial';
  if (name.startsWith('modules/')) return 'module';
  // Literal `lib/commands/` or `lib/queries/` prefix is invalid: the
  // `function` tag resolves under the partial search paths, so
  // `lib/commands/X` expands to `app/lib/lib/commands/X` and never
  // resolves. Tag separately so the hint renderer can surface "drop the
  // prefix" instead of the generic "missing file" copy.
  if (name.startsWith('lib/commands/') || name.startsWith('lib/queries/')) {
    return 'invalid_lib_prefix';
  }
  if (name.startsWith('commands/')) return 'command';
  if (name.startsWith('queries/')) return 'query';
  return 'partial';
}

/**
 * Build the expected disk path for a missing platformOS file.
 */
function buildCreatePath(type: ObjectType, name: string | null | undefined): string {
  if (!name) return '(unknown path)';
  switch (type) {
    case 'command':
    case 'query':
      return `app/lib/${name}.liquid`;
    case 'invalid_lib_prefix': {
      // The path is wrong, not the file. Show where the corrected call
      // *would* resolve so the agent can sanity-check that the existing
      // file is the intended target before applying the rule's text edit.
      const corrected = name.slice('lib/'.length);
      return `app/lib/${corrected}.liquid`;
    }
    case 'module': {
      const moduleName = name.split('/')[1] ?? name;
      return `(install module '${moduleName}' or check modules/${moduleName}/ on disk)`;
    }
    default:
      return `app/views/partials/${name}.liquid`;
  }
}

// ── enrichAll — batch enrichment ───────────────────────────────────────────

/**
 * Enrich every diagnostic in `diagnostics`. Deduplicates LSP hover calls
 * — errors at the same `(line, column)` share one hover result.
 */
export async function enrichAll(
  diagnostics: EnrichedDiagnostic[],
  ctx: EnrichContext,
): Promise<EnrichedDiagnostic[]> {
  // Pre-fetch hover docs by unique position to avoid duplicate LSP calls.
  const hoverCache: HoverCache = new Map();
  if (ctx.lsp?.initialized) {
    const positions = new Set<string>();
    for (const d of diagnostics) {
      if (d.line != null) positions.add(`${d.line}:${d.column ?? 0}`);
    }
    await Promise.all(
      [...positions].map(async (key) => {
        const parts = key.split(':');
        const line = Number(parts[0]);
        const col = Number(parts[1]);
        try {
          const hover = await ctx.lsp!.hover(ctx.uri, line, col);
          const text = extractHoverText(hover);
          // Cache hits AND misses so enrichError doesn't retry.
          hoverCache.set(key, text);
        } catch {
          hoverCache.set(key, null);
        }
      }),
    );
  }

  return Promise.all(diagnostics.map((d) => enrichError(d, { ...ctx, _hoverCache: hoverCache })));
}

// ── bridgeRulesOntoUnattributed — late attribution ─────────────────────────

/**
 * Run the rule engine over diagnostics that bypassed `enrichAll`.
 *
 * Structural warnings, schema/translation/GraphQL validators, diff-aware
 * `RemovedRender`/`AddedParam`, and the new-partial-caller check are
 * pushed into `result.{errors,warnings,infos}` AFTER `enrichAll`
 * returns. Without this bridge their rule modules never fire and they
 * land in analytics as `<Check>.unmatched`.
 *
 * Idempotent — diagnostics already carrying a `rule_id` are skipped.
 */
export function bridgeRulesOntoUnattributed(result: BridgeResult, ctx: EnrichContext): void {
  const { filePath, content, factGraph, filtersIndex, objectsIndex, tagsIndex, projectDir } = ctx;
  if (!factGraph) return;

  const facts: RuleFacts = {
    graph: factGraph,
    filtersIndex,
    objectsIndex,
    tagsIndex,
    projectDir,
  };

  const apply = (d: EnrichedDiagnostic): void => {
    if (d.rule_id) return; // already attributed
    if (!d.check) return;
    if (!hasRules(d.check)) return;

    const params = extractParams(d.check, d.message);
    const tmplFp = templateOf(d.check, d.message);
    const diagForRule = {
      check: d.check,
      params,
      message: d.message,
      file: filePath,
      line: d.line,
      column: d.column ?? 0,
      template_fp: tmplFp,
    };
    let ruleResult;
    try {
      ruleResult = runRules(diagForRule, facts);
    } catch {
      return; // runRules failure is non-fatal
    }
    if (!ruleResult) return;

    d.rule_id = ruleResult.rule_id;
    if (ruleResult.hint_md && !d.hint) d.hint = ruleResult.hint_md;
    if (ruleResult.confidence != null && d.confidence == null) d.confidence = ruleResult.confidence;
    if (ruleResult.see_also && !d.see_also) d.see_also = ruleResult.see_also;
    if (ruleResult.fixes && ruleResult.fixes.length > 0 && !d.fixes) d.fixes = ruleResult.fixes;
    attachSeeAlso(d, content);
  };

  for (const d of result.errors) apply(d);
  for (const d of result.warnings) apply(d);
  for (const d of result.infos) apply(d);
}
