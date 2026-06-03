/**
 * Diagnostic post-processing pipeline.
 *
 * Extracted from validate_code for testability and clear ordering. Each
 * filter is a named function that mutates `result.{errors, warnings, infos}`
 * and is documented with its purpose and ordering dependencies.
 *
 * ORDERING CONTRACT (v1):
 *   0.  userSuppressions               — `.pos-supervisor-ignore.yml`. Runs
 *       first so anything the operator has explicitly silenced is gone
 *       before every other step makes decisions.
 *   0a. suppressLspKnownFalsePositives — must run after userSuppressions and
 *       BEFORE every other step, so downstream enrichment, fix generation,
 *       and the must_fix_before_write gate never see the spurious LSP
 *       error. Currently covers the pos-cli LSP "Syntax is not supported"
 *       regression on `assign x = a <op> b`.
 *   1.  suppressDocParams              — must run before Shopify elevation
 *       (doc params may look like Shopify objects).
 *   2.  suppressUnusedDocParams        — depends on content; independent of
 *       other filters.
 *   3.  elevateShopify                 — must run after enrichment (needs
 *       `.suggestion` field on the diagnostic).
 *   4.  deduplicateArgChecks           — must run after linting (needs
 *       both `MissingRenderPartialArguments` + `MetadataParamsCheck`).
 *   5.  suppressUndocumentedTargetParams — must run after step 4 (only
 *       suppress what wasn't already removed).
 *   6.  suppressRequiredParamsWithDefault — must run after step 5 (the two
 *       cover disjoint cases, but step 5 may remove diagnostics this step
 *       would otherwise re-process).
 *   7.  suppressModuleHelpers          — independent.
 *   8.  suppressOrphanedPartial        — independent.
 *   9.  verifyMissingAssets            — filesystem check.
 *   10. verifyTranslationKeysOnDisk    — filesystem check.
 *   11. verifyPageRoutesOnDisk         — filesystem check. The overlay
 *       (file currently under validation) is folded in so its in-memory
 *       frontmatter contributes to the route index.
 *   12. verifyOrphanedPartialOnDisk    — filesystem check.
 *   13. verifyMissingPartialsOnDisk    — filesystem check.
 *   14. populateDefaultConfidence      — must run LAST. The rule engine
 *       sets confidence and rule_id when a rule matches; this step
 *       covers every surviving diagnostic that ESCAPED the rule path with
 *       a severity-based default + a stable `${check}.unmatched`
 *       fallback so consumers can bucket every row.
 *
 * v1 trim: the three `suppressByPending(...)` steps (MissingPartial /
 * MissingPage / TranslationKeyExists for in-plan files) were dropped along
 * with the `pendingFiles` / `pendingPages` / `pendingTranslations`
 * parameters. `validate_intent` (the source of pending state) is out of
 * v1 scope. The disk-verification steps (10, 11, 13) still handle the
 * post-write case where the file IS on disk but the LSP hasn't re-indexed.
 *
 * NOTE: `MissingPartial`, `MissingPage`, and `TranslationKeyExists` are
 * real errors — never downgrade them based on `isPreWrite` or other
 * implicit state.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import yaml from 'js-yaml';
import { toLiquidHtmlAST } from '@platformos/liquid-html-parser';

import { toPosixPath } from './utils';
import { getKnownModulesMissingDocs } from './knowledge-loader';
import { buildAssetIndex, resolveAssetPath } from './asset-index';
import { buildTranslationIndex } from './translation-index';
import {
  buildPageRouteIndex,
  parseMissingPageMessage,
  resolvePageRoute,
  type PageOverlay,
} from './page-route-index';
import {
  DEFAULT_CONFIDENCE_BY_SEVERITY,
  STRUCTURAL_DEFAULT_CONFIDENCE,
  type Severity,
} from './constants';

// ── Public types ───────────────────────────────────────────────────────────

/**
 * Subset of the enriched-diagnostic shape that the pipeline actually
 * reads or writes. Permissive index signature so pipeline steps can
 * pass through ad-hoc fields the enricher attached (e.g. `suggestion`,
 * `hint`, `rule_id`) without re-listing them everywhere.
 */
export interface PipelineDiagnostic {
  check: string;
  severity?: Severity;
  message?: string;
  line?: number;
  column?: number;
  endLine?: number | null;
  endColumn?: number | null;
  hint?: string | null;
  suggestion?: string;
  rule_id?: string;
  confidence?: number;
  [key: string]: unknown;
}

export interface PipelineTraceEntry {
  step: string;
  errorsRemoved: number;
  warningsRemoved: number;
  errorsAfter: number;
  warningsAfter: number;
}

/**
 * Mutable result shape consumed by `runDiagnosticPipeline`. The pipeline
 * REPLACES `result.errors` / `result.warnings` / `result.infos` arrays
 * in place; `_pipelineTrace` is stamped at the end.
 */
export interface PipelineResult {
  errors: PipelineDiagnostic[];
  warnings: PipelineDiagnostic[];
  infos: PipelineDiagnostic[];
  _pipelineTrace?: PipelineTraceEntry[];
}

export interface PipelineContext {
  filePath: string;
  content: string;
  docParamNames?: Set<string>;
  projectDir?: string;
}

// ── Pipeline entry point ───────────────────────────────────────────────────

/**
 * Run the full post-processing pipeline. Mutates `result` in place.
 */
export function runDiagnosticPipeline(result: PipelineResult, opts: PipelineContext): void {
  const { filePath, content, docParamNames = new Set<string>(), projectDir } = opts;

  const trace: PipelineTraceEntry[] = [];
  const traceStep = (name: string, fn: () => void): void => {
    const eBefore = result.errors.length;
    const wBefore = result.warnings.length;
    fn();
    const eRemoved = eBefore - result.errors.length;
    const wRemoved = wBefore - result.warnings.length;
    trace.push({
      step: name,
      errorsRemoved: eRemoved,
      warningsRemoved: wRemoved,
      errorsAfter: result.errors.length,
      warningsAfter: result.warnings.length,
    });
  };

  // 0. Apply user-defined suppressions from `.pos-supervisor-ignore.yml`.
  if (projectDir) {
    traceStep('userSuppressions', () => applyUserSuppressions(result, filePath, projectDir));
  }

  // 0a. Suppress known pos-cli LSP false positives ("Syntax is not supported"
  //     on boolean comparisons in `assign`). Runs early so the bogus error
  //     never reaches enrichment, fix gen, or the must_fix gate.
  traceStep('suppressLspKnownFalsePositives', () =>
    suppressLspKnownFalsePositives(result, content),
  );

  // 1. Suppress UndefinedObject for declared @param names.
  if (docParamNames.size > 0) {
    traceStep('suppressDocParams', () => suppressDocParams(result, docParamNames));
  }

  // 2. Suppress UnusedDocParam when the param is used as a named argument.
  if (docParamNames.size > 0) {
    traceStep('suppressUnusedDocParams', () =>
      suppressUnusedDocParams(result, docParamNames, content),
    );
  }

  // 3. Elevate Shopify contamination from warning to error.
  traceStep('elevateShopify', () => elevateShopify(result));

  // 4. Deduplicate MissingRenderPartialArguments + MetadataParamsCheck.
  traceStep('deduplicateArgChecks', () => deduplicateArgChecks(result));

  // 5. Suppress MetadataParamsCheck when the called target has no `{% doc %}`.
  traceStep('suppressUndocumentedTargetParams', () =>
    suppressUndocumentedTargetParams(result, content, projectDir),
  );

  // 6. Suppress required-param diagnostics whose target partial defaults
  //    the param via a `| default:` filter.
  traceStep('suppressRequiredParamsWithDefault', () =>
    suppressRequiredParamsWithDefault(result, content, projectDir),
  );

  // 7. Suppress DeprecatedTag for module helper includes.
  traceStep('suppressModuleHelpers', () => suppressModuleHelpers(result, content));

  // 8. Suppress OrphanedPartial for commands/queries (always invoked dynamically).
  traceStep('suppressOrphanedPartial', () => suppressOrphanedPartial(result, filePath));

  // 9. Verify MissingAsset against the filesystem.
  if (projectDir) {
    traceStep('verifyMissingAssets', () => verifyMissingAssets(result, projectDir));
  }

  // 10. Verify TranslationKeyExists against the filesystem.
  if (projectDir) {
    traceStep('verifyTranslationKeysOnDisk', () => verifyTranslationKeysOnDisk(result, projectDir));
  }

  // 11. Verify MissingPage against the filesystem. The file under
  //     validation is passed as an overlay so its in-memory frontmatter
  //     (`slug:`, `method:`) contributes to the route index.
  if (projectDir) {
    traceStep('verifyPageRoutesOnDisk', () =>
      verifyPageRoutesOnDisk(result, projectDir, { filePath, content }),
    );
  }

  // 12. Verify OrphanedPartial against the filesystem.
  if (projectDir) {
    traceStep('verifyOrphanedPartialOnDisk', () =>
      verifyOrphanedPartialOnDisk(result, filePath, projectDir),
    );
  }

  // 13. Verify MissingPartial against the filesystem.
  if (projectDir) {
    traceStep('verifyMissingPartialsOnDisk', () => verifyMissingPartialsOnDisk(result, projectDir));
  }

  // 14. Stamp default confidence + rule_id on every surviving diagnostic
  //     the rule engine did not already score. Runs last so suppressed/
  //     downgraded items are gone by now.
  traceStep('populateDefaultConfidence', () => populateDefaultConfidence(result));

  result._pipelineTrace = trace;
}

// ── Step 0: user suppressions ──────────────────────────────────────────────

interface SuppressionRule {
  check: string;
  file_pattern?: string;
}

interface SuppressionFile {
  suppressions?: SuppressionRule[];
}

export function applyUserSuppressions(
  result: PipelineResult,
  filePath: string,
  projectDir: string,
): void {
  const suppressFile = join(projectDir, '.pos-supervisor-ignore.yml');
  if (!existsSync(suppressFile)) return;
  let rules: SuppressionRule[] | undefined;
  try {
    const parsed = yaml.load(readFileSync(suppressFile, 'utf-8')) as SuppressionFile | undefined;
    rules = parsed?.suppressions;
  } catch {
    return;
  }
  if (!Array.isArray(rules) || rules.length === 0) return;
  const ruleList = rules;

  const matchRule = (d: PipelineDiagnostic): boolean =>
    ruleList.some((r) => {
      if (r.check !== d.check) return false;
      if (r.file_pattern) {
        if (r.file_pattern.includes('*')) {
          const re = new RegExp('^' + r.file_pattern.replace(/\*/g, '.*') + '$');
          if (!re.test(filePath)) return false;
        } else if (!filePath.includes(r.file_pattern)) {
          return false;
        }
      }
      return true;
    });

  const errBefore = result.errors.length;
  const warnBefore = result.warnings.length;
  result.errors = result.errors.filter((d) => !matchRule(d));
  result.warnings = result.warnings.filter((d) => !matchRule(d));
  const suppressed = errBefore - result.errors.length + (warnBefore - result.warnings.length);
  if (suppressed > 0) {
    result.infos.push({
      check: 'pos-supervisor:UserSuppressed',
      severity: 'info',
      message: `Suppressed ${suppressed} diagnostic(s) via .pos-supervisor-ignore.yml`,
    });
  }
}

// ── Step 0a: LSP false positives ───────────────────────────────────────────

/**
 * Suppress the pos-cli LSP "Syntax is not supported" false positive on
 * boolean comparisons inside `assign` tags — the platformOS parser
 * accepts the syntax and `pos-cli check run` reports no offenses. The
 * file is strict-parsed as a precondition; if the parser rejects it the
 * suppression bails so any genuine syntax error stays visible.
 */
export function suppressLspKnownFalsePositives(result: PipelineResult, content: string): void {
  const matches = (d: PipelineDiagnostic): boolean =>
    d.check === 'LiquidHTMLSyntaxError' &&
    typeof d.message === 'string' &&
    /^Syntax is not supported$/i.test(d.message.trim());

  const candidates = [...result.errors.filter(matches), ...result.warnings.filter(matches)];
  if (candidates.length === 0) return;

  // Strict parse — no tolerant flag — is the gate.
  let parsesCleanly: boolean;
  try {
    toLiquidHtmlAST(content);
    parsesCleanly = true;
  } catch {
    parsesCleanly = false;
  }
  if (!parsesCleanly) return;

  const removeSet = new Set<PipelineDiagnostic>(candidates);
  result.errors = result.errors.filter((d) => !removeSet.has(d));
  result.warnings = result.warnings.filter((d) => !removeSet.has(d));

  const lines = candidates.map((d) => d.line).filter((n): n is number => n != null);
  result.infos.push({
    check: 'pos-supervisor:LspSyntaxFalsePositiveSuppressed',
    severity: 'info',
    message:
      `Suppressed ${candidates.length} LiquidHTMLSyntaxError("Syntax is not supported") ` +
      `diagnostic(s)${lines.length ? ` on line(s) ${lines.join(', ')}` : ''} — ` +
      `the platformOS parser (@platformos/liquid-html-parser) accepts the file. ` +
      `This is a known pos-cli LSP regression, most often triggered by a boolean ` +
      `comparison inside \`assign\` (e.g. \`assign x = a == b\`).`,
  });
}

// ── Step 1: doc params ─────────────────────────────────────────────────────

export function suppressDocParams(result: PipelineResult, docParamNames: Set<string>): void {
  const match = (diag: PipelineDiagnostic): boolean => {
    if (diag.check !== 'UndefinedObject') return false;
    const varMatch = diag.message?.match(/`([^`]+)`/);
    return !!varMatch && docParamNames.has(varMatch[1]);
  };
  const count = result.errors.filter(match).length + result.warnings.filter(match).length;
  if (count > 0) {
    result.errors = result.errors.filter((d) => !match(d));
    result.warnings = result.warnings.filter((d) => !match(d));
    result.infos.push({
      check: 'pos-supervisor:DocParamSuppressed',
      severity: 'info',
      message: `Suppressed ${count} UndefinedObject warning(s) for declared @param(s): ${[...docParamNames].join(', ')}`,
    });
  }
}

// ── Step 2: unused doc params ──────────────────────────────────────────────

export function suppressUnusedDocParams(
  result: PipelineResult,
  docParamNames: Set<string>,
  content: string,
): void {
  const usedAsArg = new Set<string>();
  for (const name of docParamNames) {
    const argPattern = new RegExp(
      `(?:,|{%\\s*(?:graphql|function|render|include|theme_render_rc)\\b[^%]*)\\b${name}\\s*:`,
      's',
    );
    if (argPattern.test(content)) usedAsArg.add(name);
  }
  if (usedAsArg.size === 0) return;

  const match = (d: PipelineDiagnostic): boolean => {
    if (d.check !== 'UnusedDocParam') return false;
    const varMatch = d.message?.match(/['"`](\w+)['"`]/);
    return !!varMatch && usedAsArg.has(varMatch[1]);
  };
  const count = result.errors.filter(match).length + result.warnings.filter(match).length;
  if (count > 0) {
    result.errors = result.errors.filter((d) => !match(d));
    result.warnings = result.warnings.filter((d) => !match(d));
    result.infos.push({
      check: 'pos-supervisor:UnusedDocParamSuppressed',
      severity: 'info',
      message: `Suppressed ${count} UnusedDocParam warning(s) for @param(s) used as named arguments: ${[...usedAsArg].join(', ')}`,
    });
  }
}

// ── Step 3: Shopify elevation ──────────────────────────────────────────────

export function elevateShopify(result: PipelineResult): void {
  const shopifyWarnings = result.warnings.filter(
    (d) => d.check === 'UndefinedObject' && d.suggestion && /shopify/i.test(d.suggestion),
  );
  if (shopifyWarnings.length === 0) return;
  result.warnings = result.warnings.filter((d) => !shopifyWarnings.includes(d));
  for (const d of shopifyWarnings) {
    result.errors.push({ ...d, severity: 'error' });
  }
}

// ── Step 4: dedup arg checks ───────────────────────────────────────────────

export function deduplicateArgChecks(result: PipelineResult): void {
  const mrpaLines = new Set<number | undefined>([
    ...result.errors.filter((d) => d.check === 'MissingRenderPartialArguments').map((d) => d.line),
    ...result.warnings
      .filter((d) => d.check === 'MissingRenderPartialArguments')
      .map((d) => d.line),
  ]);
  if (mrpaLines.size === 0) return;

  const isRedundant = (d: PipelineDiagnostic): boolean =>
    d.check === 'MetadataParamsCheck' && mrpaLines.has(d.line);
  const count =
    result.errors.filter(isRedundant).length + result.warnings.filter(isRedundant).length;
  if (count > 0) {
    result.errors = result.errors.filter((d) => !isRedundant(d));
    result.warnings = result.warnings.filter((d) => !isRedundant(d));
    result.infos.push({
      check: 'pos-supervisor:DuplicateArgCheck',
      severity: 'info',
      message: `Suppressed ${count} MetadataParamsCheck diagnostic(s) already covered by MissingRenderPartialArguments`,
    });
  }
}

// ── Step 5: undocumented target params ─────────────────────────────────────

interface ParamTarget {
  path: string;
  kind: 'module' | 'partial' | 'function';
}

export function suppressUndocumentedTargetParams(
  result: PipelineResult,
  content: string,
  projectDir: string | undefined,
): void {
  const lines = content.split('\n');

  const extractTarget = (line: string): ParamTarget | null => {
    let m = line.match(/['"](modules\/[^'"]+)['"]/);
    if (m) return { path: m[1].replace(/\.liquid$/, ''), kind: 'module' };
    m = line.match(/\brender\s+['"]([^'"]+)['"]/);
    if (m) return { path: `app/views/partials/${m[1]}.liquid`, kind: 'partial' };
    m = line.match(/\btheme_render_rc\s+['"]([^'"]+)['"]/);
    if (m) return { path: `app/views/partials/${m[1]}.liquid`, kind: 'partial' };
    m = line.match(/\bfunction\s+\w+\s*=\s*['"]([^'"]+)['"]/);
    if (m) return { path: `app/lib/${m[1]}.liquid`, kind: 'function' };
    return null;
  };

  // Cache disk reads — one target may back many diagnostics in this content.
  const undocCache = new Map<string, boolean | null>();
  const targetIsUndocumented = (target: ParamTarget): boolean | null => {
    if (target.kind === 'module') return true;
    if (!projectDir) return null;
    if (undocCache.has(target.path)) return undocCache.get(target.path) ?? null;
    try {
      const abs = join(projectDir, target.path);
      if (!existsSync(abs)) {
        undocCache.set(target.path, null);
        return null;
      }
      const src = readFileSync(abs, 'utf8');
      const hasDoc = /\{%\s*doc\s*%\}/.test(src);
      const undocumented = !hasDoc;
      undocCache.set(target.path, undocumented);
      return undocumented;
    } catch {
      undocCache.set(target.path, null);
      return null;
    }
  };

  const removeSet = new Set<PipelineDiagnostic>();
  const modulePaths = new Set<string>();
  const appPaths = new Set<string>();

  const classify = (d: PipelineDiagnostic): void => {
    if (d.check !== 'MetadataParamsCheck') return;
    const line = lines[(d.line ?? 1) - 1] ?? '';
    const target = extractTarget(line);
    if (!target) return;
    if (targetIsUndocumented(target) !== true) return;
    removeSet.add(d);
    if (target.kind === 'module') modulePaths.add(target.path);
    else appPaths.add(target.path);
  };

  for (const d of result.errors) classify(d);
  for (const d of result.warnings) classify(d);

  if (removeSet.size === 0) return;

  result.errors = result.errors.filter((d) => !removeSet.has(d));
  result.warnings = result.warnings.filter((d) => !removeSet.has(d));

  if (modulePaths.size > 0) {
    const moduleCount = [...removeSet].filter((d) => {
      const line = lines[(d.line ?? 1) - 1] ?? '';
      return /['"]modules\//.test(line);
    }).length;
    result.infos.push({
      check: 'pos-supervisor:ModuleParamsSuppressed',
      severity: 'info',
      message:
        `Suppressed ${moduleCount} MetadataParamsCheck error(s) on calls to modules/ partials. ` +
        `These fire on the calling file despite modules/ being excluded in .platformos-check.yml ` +
        `because the error is attributed to the caller, not the module file. ` +
        `Root fix: add {% doc %} blocks to the module partials.`,
    });

    const known = getKnownModulesMissingDocs();
    const knownList: string[] = [];
    const unknownList: string[] = [];
    for (const path of modulePaths) {
      if (known.has(path)) knownList.push(path);
      else unknownList.push(path);
    }
    const unknownNote =
      unknownList.length > 0
        ? ` New offender(s) not on the known list — consider filing an upstream issue ` +
          `against each module repo to add a {% doc %} block: ${unknownList.join(', ')}.`
        : '';
    result.infos.push({
      check: 'pos-supervisor:module_doc_missing',
      severity: 'info',
      message: `Module partial(s) missing {% doc %} blocks detected on calling file: ${[...modulePaths].join(', ')}.${unknownNote}`,
      known: knownList,
      unknown: unknownList,
    });
  }

  if (appPaths.size > 0) {
    const appCount =
      modulePaths.size > 0
        ? removeSet.size -
          [...removeSet].filter((d) => {
            const line = lines[(d.line ?? 1) - 1] ?? '';
            return /['"]modules\//.test(line);
          }).length
        : removeSet.size;
    result.infos.push({
      check: 'pos-supervisor:UndocumentedPartialParamsSuppressed',
      severity: 'info',
      message:
        `Suppressed ${appCount} MetadataParamsCheck error(s) whose target partial lacks a {% doc %} block. ` +
        `Without a contract, the LSP guesses required parameters from usage and produces false positives. ` +
        `Root fix: add {% doc %} with @param declarations to each target: ${[...appPaths].join(', ')}.`,
      paths: [...appPaths],
    });
  }
}

// ── Step 6: required params defaulted in body ──────────────────────────────

interface DefaultTarget {
  path: string;
}

export function suppressRequiredParamsWithDefault(
  result: PipelineResult,
  content: string,
  projectDir: string | undefined,
): void {
  if (!projectDir) return;
  const lines = content.split('\n');

  const extractTarget = (line: string): DefaultTarget | null => {
    let m = line.match(/['"](modules\/[^'"]+)['"]/);
    if (m) return { path: m[1].endsWith('.liquid') ? m[1] : `${m[1]}.liquid` };
    m = line.match(/\brender\s+['"]([^'"]+)['"]/);
    if (m) return { path: `app/views/partials/${m[1]}.liquid` };
    m = line.match(/\btheme_render_rc\s+['"]([^'"]+)['"]/);
    if (m) return { path: `app/views/partials/${m[1]}.liquid` };
    m = line.match(/\bfunction\s+\w+\s*=\s*['"]([^'"]+)['"]/);
    if (m) return { path: `app/lib/${m[1]}.liquid` };
    return null;
  };

  const extractParamName = (msg: string | undefined): string | null => {
    if (!msg) return null;
    let m = msg.match(/\bargument\s+['"`](\w+)['"`]/i);
    if (m) return m[1];
    m = msg.match(/[Rr]equired parameter\s+['"`]?(\w+)['"`]?/);
    if (m) return m[1];
    return null;
  };

  const targetCache = new Map<string, string | null>();
  const readTarget = (relPath: string): string | null => {
    if (targetCache.has(relPath)) return targetCache.get(relPath) ?? null;
    try {
      const abs = join(projectDir, relPath);
      if (!existsSync(abs)) {
        targetCache.set(relPath, null);
        return null;
      }
      const src = readFileSync(abs, 'utf8');
      targetCache.set(relPath, src);
      return src;
    } catch {
      targetCache.set(relPath, null);
      return null;
    }
  };

  const paramDefaultedInBody = (src: string | null, paramName: string | null): boolean => {
    if (!src || !paramName) return false;
    const re = new RegExp(`\\b${paramName}\\s*\\|\\s*default\\s*:`);
    return re.test(src);
  };

  const removeSet = new Set<PipelineDiagnostic>();
  const affected = new Set<string>();

  const classify = (d: PipelineDiagnostic): void => {
    if (d.check !== 'MetadataParamsCheck' && d.check !== 'MissingRenderPartialArguments') return;
    const target = extractTarget(lines[(d.line ?? 1) - 1] ?? '');
    if (!target) return;
    const paramName = extractParamName(d.message);
    if (!paramName) return;
    const src = readTarget(target.path);
    if (!paramDefaultedInBody(src, paramName)) return;
    removeSet.add(d);
    affected.add(`${target.path}#${paramName}`);
  };

  for (const d of result.errors) classify(d);
  for (const d of result.warnings) classify(d);

  if (removeSet.size === 0) return;

  result.errors = result.errors.filter((d) => !removeSet.has(d));
  result.warnings = result.warnings.filter((d) => !removeSet.has(d));

  result.infos.push({
    check: 'pos-supervisor:ParamHasDefaultSuppressed',
    severity: 'info',
    message:
      `Suppressed ${removeSet.size} required-param diagnostic(s) whose target partial defaults the ` +
      `parameter via a \`| default:\` filter — the param is effectively optional. ` +
      `Root fix: convert the @param declaration to bracket notation ([name]) in the target's {% doc %} block. ` +
      `Affected target:param pairs: ${[...affected].join(', ')}.`,
    affected: [...affected],
  });
}

// ── Step 7: module helper includes ─────────────────────────────────────────

export function suppressModuleHelpers(result: PipelineResult, content: string): void {
  const isModuleHelperInclude = (d: PipelineDiagnostic): boolean => {
    if (d.check !== 'DeprecatedTag') return false;
    return (
      /include\s+['"]modules\/[^'"]*\/helpers\//.test(content) && !!d.message?.includes('include')
    );
  };
  const count =
    result.errors.filter(isModuleHelperInclude).length +
    result.warnings.filter(isModuleHelperInclude).length;
  if (count > 0) {
    result.errors = result.errors.filter((d) => !isModuleHelperInclude(d));
    result.warnings = result.warnings.filter((d) => !isModuleHelperInclude(d));
    result.infos.push({
      check: 'pos-supervisor:ModuleHelperInclude',
      severity: 'info',
      message: `Suppressed ${count} DeprecatedTag warning(s) for module helper includes — modules use {% include %} for scope sharing by design.`,
    });
  }
}

// ── Step 8: orphaned partial (commands/queries only in v1) ─────────────────

/**
 * Suppress `OrphanedPartial` for `app/lib/(commands|queries)/` — these
 * are invoked via `{% function %}` / `{% graphql %}` / GraphQL mutations.
 * Static analysis cannot follow those invocation paths, so every command
 * /query looks orphaned. Shipping ≠ dead code for this class of file.
 *
 * v1 trim: the source's second branch suppressed orphans when a pending
 * plan contained potential caller files. With pending state dropped from
 * the pipeline, that branch never fires; removed for clarity.
 */
export function suppressOrphanedPartial(result: PipelineResult, filePath: string): void {
  const isOrphan = (d: PipelineDiagnostic): boolean => d.check === 'OrphanedPartial';
  const count = result.errors.filter(isOrphan).length + result.warnings.filter(isOrphan).length;
  if (count === 0) return;

  if (!/\/lib\/(commands|queries)\//.test(filePath)) return;

  result.errors = result.errors.filter((d) => !isOrphan(d));
  result.warnings = result.warnings.filter((d) => !isOrphan(d));
  result.infos.push({
    check: 'pos-supervisor:OrphanedPartialSuppressed',
    severity: 'info',
    message:
      `Suppressed ${count} OrphanedPartial diagnostic(s) — commands/queries are invoked via ` +
      `{% function %} / GraphQL and appear orphaned to static cross-reference analysis.`,
    reason: 'lib-target',
  });
}

// ── Step 9: verify MissingAsset ────────────────────────────────────────────

export function verifyMissingAssets(result: PipelineResult, projectDir: string): void {
  const missingAssets = [...result.errors, ...result.warnings].filter(
    (d) => d.check === 'MissingAsset',
  );
  if (missingAssets.length === 0) return;

  const index = buildAssetIndex(projectDir);
  const suppressed = new Set<PipelineDiagnostic>();
  const verifiedPaths: string[] = [];
  const renamedHints: Array<{ reported: string; suggestion: string }> = [];

  for (const d of missingAssets) {
    const pathMatch = d.message?.match(/['"`]([^'"`]+)['"`]/);
    if (!pathMatch) continue;
    const reported = pathMatch[1];
    const resolution = resolveAssetPath(reported, index);

    if (resolution.status === 'exists') {
      suppressed.add(d);
      verifiedPaths.push(reported);
    } else if (resolution.status === 'renamed') {
      suppressed.add(d);
      renamedHints.push({ reported, suggestion: resolution.suggestion });
    } else if (resolution.status === 'ambiguous') {
      d.hint =
        (d.hint ? d.hint + '\n' : '') +
        `Basename matches multiple assets: ${resolution.suggestions.join(', ')}. Use the path that belongs to this template's module/feature.`;
    }
  }

  if (suppressed.size > 0) {
    result.errors = result.errors.filter((d) => !suppressed.has(d));
    result.warnings = result.warnings.filter((d) => !suppressed.has(d));
  }

  if (verifiedPaths.length > 0) {
    result.infos.push({
      check: 'pos-supervisor:MissingAssetSuppressed',
      severity: 'info',
      message: `Suppressed ${verifiedPaths.length} MissingAsset diagnostic(s) — asset(s) exist on disk: ${verifiedPaths.join(', ')}`,
    });
  }

  for (const { reported, suggestion } of renamedHints) {
    result.infos.push({
      check: 'pos-supervisor:MissingAssetPathHint',
      severity: 'info',
      message: `Asset '${reported}' is not at the path written, but '${suggestion}' exists. asset_url paths are relative to app/assets/ and MUST include the subdirectory (styles/, scripts/, images/, fonts/, media/). Change the template to: {{ '${suggestion}' | asset_url }}.`,
      suggestion,
    });
  }
}

// ── Step 10: verify TranslationKeyExists ───────────────────────────────────

export function verifyTranslationKeysOnDisk(result: PipelineResult, projectDir: string): void {
  const candidates = [...result.errors, ...result.warnings].filter(
    (d) => d.check === 'TranslationKeyExists',
  );
  if (candidates.length === 0) return;

  const { keys } = buildTranslationIndex(projectDir);
  if (keys.size === 0) return;

  const verified: Array<{ d: PipelineDiagnostic; key: string }> = [];
  for (const d of candidates) {
    const m = d.message?.match(/['"`]([^'"`]+)['"`]/);
    if (!m) continue;
    if (keys.has(m[1])) verified.push({ d, key: m[1] });
  }
  if (verified.length === 0) return;

  const suppressed = new Set<PipelineDiagnostic>(verified.map((v) => v.d));
  result.errors = result.errors.filter((d) => !suppressed.has(d));
  result.warnings = result.warnings.filter((d) => !suppressed.has(d));
  result.infos.push({
    check: 'pos-supervisor:TranslationKeyExistsSuppressed',
    severity: 'info',
    message:
      `Suppressed ${verified.length} TranslationKeyExists diagnostic(s) — ` +
      `key(s) already defined in app/translations/: ${verified.map((v) => v.key).join(', ')}. ` +
      `(LSP cache lag — no need to pass pending_translations for keys already on disk.)`,
  });
}

// ── Step 11: verify MissingPage ────────────────────────────────────────────

export function verifyPageRoutesOnDisk(
  result: PipelineResult,
  projectDir: string,
  currentFile: PageOverlay | null = null,
): void {
  const candidates = [...result.errors, ...result.warnings].filter(
    (d) => d.check === 'MissingPage',
  );
  if (candidates.length === 0) return;

  const index = buildPageRouteIndex(projectDir, currentFile);
  if (index.routes.size === 0) return;

  const suppressed = new Set<PipelineDiagnostic>();
  const verifiedRoutes: string[] = [];

  for (const d of candidates) {
    const parsed = parseMissingPageMessage(d.message);
    if (!parsed) continue;
    const resolution = resolvePageRoute(parsed.route, parsed.method, index);

    if (resolution.status === 'exists') {
      suppressed.add(d);
      verifiedRoutes.push(`${parsed.route || '/'} (${parsed.method.toUpperCase()})`);
    } else if (resolution.status === 'wrong-method') {
      d.hint =
        (d.hint ? d.hint + '\n' : '') +
        `Route '${parsed.route || '/'}' IS served, but only for ${resolution.methods.map((m) => m.toUpperCase()).join(', ')} — not ${parsed.method.toUpperCase()}. ` +
        `If this is an <a href> use the method that's actually served, or scaffold a new page for the missing method.`;
    }
  }

  if (suppressed.size > 0) {
    result.errors = result.errors.filter((d) => !suppressed.has(d));
    result.warnings = result.warnings.filter((d) => !suppressed.has(d));
    result.infos.push({
      check: 'pos-supervisor:MissingPageSuppressed',
      severity: 'info',
      message:
        `Suppressed ${verifiedRoutes.length} MissingPage diagnostic(s) — route(s) served by other page file(s) in ` +
        `app/views/pages/: ${verifiedRoutes.join(', ')}. (validate_code analyses one file at a time and cannot see neighbouring pages.)`,
    });
  }
}

// ── Step 12: verify OrphanedPartial on disk ────────────────────────────────

export function verifyOrphanedPartialOnDisk(
  result: PipelineResult,
  filePath: string,
  projectDir: string,
): void {
  const isOrphan = (d: PipelineDiagnostic): boolean => d.check === 'OrphanedPartial';
  const orphanCount =
    result.errors.filter(isOrphan).length + result.warnings.filter(isOrphan).length;
  if (orphanCount === 0) return;

  const partialName = extractPartialNameFromPath(filePath);
  if (!partialName) return;

  if (!hasRenderReferenceOnDisk(projectDir, partialName, filePath)) return;

  result.errors = result.errors.filter((d) => !isOrphan(d));
  result.warnings = result.warnings.filter((d) => !isOrphan(d));
  result.infos.push({
    check: 'pos-supervisor:OrphanedPartialVerified',
    severity: 'info',
    message: `Suppressed OrphanedPartial — '${partialName}' is referenced by file(s) on disk. (Checker index lag.)`,
  });
}

// ── Step 13: verify MissingPartial on disk ─────────────────────────────────

export function verifyMissingPartialsOnDisk(result: PipelineResult, projectDir: string): void {
  const candidates = [...result.errors, ...result.warnings].filter(
    (d) => d.check === 'MissingPartial',
  );
  if (candidates.length === 0) return;

  const suppressed = new Set<PipelineDiagnostic>();
  const verified: string[] = [];

  for (const d of candidates) {
    const nameMatch = d.message?.match(/['"]([^'"]+)['"]/);
    if (!nameMatch) continue;
    const name = nameMatch[1];
    if (name.startsWith('modules/')) continue;

    if (resolveMissingPartialPaths(name, projectDir).some((p) => existsSync(p))) {
      suppressed.add(d);
      verified.push(name);
    }
  }

  if (suppressed.size === 0) return;

  result.errors = result.errors.filter((d) => !suppressed.has(d));
  result.warnings = result.warnings.filter((d) => !suppressed.has(d));
  result.infos.push({
    check: 'pos-supervisor:MissingPartialSuppressed',
    severity: 'info',
    message:
      `Suppressed ${verified.length} MissingPartial diagnostic(s) — partial(s) exist on disk: ${verified.join(', ')}. ` +
      `(LSP cache lag — partial was written but not yet re-indexed.)`,
  });
}

/**
 * Mirror upstream `DocumentsLocator` partial-resolution semantics: the
 * `function` / `render` tags resolve relative to the partial search
 * paths declared by `@platformos/platformos-common` —
 *   `FILE_TYPE_DIRS[Partial] = ['views/partials', 'lib']`
 * — joined under `app/`. So `commands/X` is found at
 * `app/lib/commands/X.liquid` and `lib/commands/X` would only resolve at
 * `app/lib/lib/commands/X.liquid` (which never exists in any sane
 * project). DO NOT strip a leading `lib/`: doing so silently suppresses
 * the LSP's correct `MissingPartial` for the invalid prefix and steers
 * agents toward the bug.
 */
function resolveMissingPartialPaths(name: string, projectDir: string): string[] {
  return [
    join(projectDir, 'app', 'views', 'partials', `${name}.liquid`),
    join(projectDir, 'app', 'views', 'partials', `${name}.html.liquid`),
    join(projectDir, 'app', 'lib', `${name}.liquid`),
  ];
}

function extractPartialNameFromPath(filePath: string): string | null {
  const m = filePath.match(/^app\/views\/partials\/(.+?)\.(?:html\.)?liquid$/);
  return m ? m[1] : null;
}

function hasRenderReferenceOnDisk(
  projectDir: string,
  partialName: string,
  selfPath: string,
): boolean {
  const escaped = partialName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`['"]${escaped}['"]`);

  const scanDirs = ['app/views/pages', 'app/views/partials', 'app/views/layouts'];
  const selfPathNorm = toPosixPath(selfPath);
  for (const dir of scanDirs) {
    const fullDir = join(projectDir, dir);
    let entries: string[];
    try {
      entries = readdirSync(fullDir, { recursive: true }) as string[];
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (!entry.endsWith('.liquid')) continue;
      // `entry` carries native separators on Windows; the comparison
      // against `selfPath` (POSIX from upstream callers) needs both
      // sides normalised.
      const relPath = toPosixPath(join(dir, entry));
      if (relPath === selfPathNorm) continue;
      try {
        const content = readFileSync(join(fullDir, entry), 'utf8');
        if (pattern.test(content)) return true;
      } catch {
        // unreadable file — skip
      }
    }
  }
  return false;
}

// ── Step 14: default confidence + rule_id stamp ────────────────────────────

function defaultConfidenceFor(diag: PipelineDiagnostic): number {
  if (typeof diag.check === 'string' && diag.check.startsWith('pos-supervisor:')) {
    return STRUCTURAL_DEFAULT_CONFIDENCE;
  }
  const sev = diag.severity;
  if (sev && DEFAULT_CONFIDENCE_BY_SEVERITY[sev] != null) {
    return DEFAULT_CONFIDENCE_BY_SEVERITY[sev];
  }
  return DEFAULT_CONFIDENCE_BY_SEVERITY.warning;
}

function defaultRuleIdFor(diag: PipelineDiagnostic): string {
  // Stable fallback so rule-less diagnostics cluster under a single
  // bucket per check instead of scattering into `unknown` or the check
  // name alone (which collides with the check-level scorecard and
  // muddles rule attribution).
  return diag.check ? `${diag.check}.unmatched` : 'unknown.unmatched';
}

function populateDefaultConfidence(result: PipelineResult): void {
  const stamp = (d: PipelineDiagnostic): void => {
    if (d.confidence == null) d.confidence = defaultConfidenceFor(d);
    if (!d.rule_id) d.rule_id = defaultRuleIdFor(d);
  };
  for (const d of result.errors) stamp(d);
  for (const d of result.warnings) stamp(d);
  for (const d of result.infos) stamp(d);
}

/**
 * Stand-alone entry point — same semantics as the pipeline's last step,
 * callable from outside.
 *
 * `validate-code` pushes several diagnostic sources (structural warnings,
 * schema validation, translation YAML check, diff-aware
 * `RemovedRender`/`RemovedGraphQL`/`AddedParam`, new-partial caller
 * check) into `result.errors` / `result.warnings` AFTER
 * `runDiagnosticPipeline` finishes. Those late additions would otherwise
 * escape `populateDefaultConfidence` and land with `confidence = null` /
 * no `rule_id`. This helper fills the gap.
 *
 * Idempotent — calling twice is safe.
 */
export function stampDefaultsOn(result: PipelineResult): void {
  populateDefaultConfidence(result);
}

// ── Cross-check helper: suppress upstream ValidFrontmatter dup ─────────────

/**
 * Drop upstream `ValidFrontmatter` diagnostics that overlap with our
 * richer structural-check counterparts. pos-cli 6.0.7 added
 * `ValidFrontmatter` which independently reports the same root causes
 * as our existing `pos-supervisor:InvalidLayout` (missing layout file)
 * and `pos-supervisor:InvalidFrontMatter` (unknown / misleading
 * frontmatter keys).
 *
 * Our checks carry richer messages (named expected paths, deprecation
 * guidance, fix templates) so we keep them and drop the upstream copy.
 * Upstream `ValidFrontmatter` rows that don't share a line / layout
 * name with one of our checks pass through untouched.
 *
 * Idempotent. Safe to call after both diagnostic sources have pushed.
 *
 * Returns the count of suppressed diagnostics.
 */
export function suppressUpstreamFrontmatterDup(result: PipelineResult): number {
  const ourLines = new Set<number | undefined>();
  const ourInvalidLayoutNames = new Set<string>();
  for (const d of [...result.errors, ...result.warnings]) {
    if (
      d.check === 'pos-supervisor:InvalidLayout' ||
      d.check === 'pos-supervisor:InvalidFrontMatter'
    ) {
      ourLines.add(d.line);
    }
    if (d.check === 'pos-supervisor:InvalidLayout') {
      const layoutName = d.message?.match(/^Layout `([^`]+)` not found/)?.[1];
      if (layoutName) ourInvalidLayoutNames.add(layoutName);
    }
  }
  if (ourLines.size === 0 && ourInvalidLayoutNames.size === 0) return 0;

  const isRedundant = (d: PipelineDiagnostic): boolean => {
    if (d.check !== 'ValidFrontmatter') return false;
    if (ourLines.has(d.line)) return true;
    const layoutName = d.message?.match(/^Layout ['"`]([^'"`]+)['"`] does not exist$/)?.[1];
    return !!layoutName && ourInvalidLayoutNames.has(layoutName);
  };
  const eRemoved = result.errors.filter(isRedundant).length;
  const wRemoved = result.warnings.filter(isRedundant).length;
  const removed = eRemoved + wRemoved;
  if (removed === 0) return 0;

  result.errors = result.errors.filter((d) => !isRedundant(d));
  result.warnings = result.warnings.filter((d) => !isRedundant(d));
  result.infos.push({
    check: 'pos-supervisor:DuplicateFrontmatterCheck',
    severity: 'info',
    message: `Suppressed ${removed} ValidFrontmatter diagnostic(s) already covered by pos-supervisor structural check(s) (InvalidLayout / InvalidFrontMatter).`,
  });
  return removed;
}
