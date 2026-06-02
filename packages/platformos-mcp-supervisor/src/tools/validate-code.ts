/**
 * `validate_code` MCP tool — the orchestrator that ties the entire validation
 * pipeline together. Composes parse → LSP lint → enrichment → diagnostic
 * pipeline → schema/translation/graphql validators → structural warnings →
 * diff-aware checks → domain knowledge → fix generation → cluster/scorecard
 * → bridge-rules → stamp-defaults → force-disable filter into a single
 * deterministic result type the agent reads on each call.
 *
 * v1 scope (per migration TASK-18):
 *
 *   - **In-process LSP only.** The source's `pos-cli check` subprocess
 *     fallback is gone. If the LSP is not initialised, the lint step is a
 *     no-op (an `info` is surfaced so the agent sees what happened).
 *
 *   - **No session.** Source carried `ctx.session.pending` so a prior
 *     `validate_intent` call could pre-suppress `MissingPartial` for
 *     not-yet-written files. v1 drops `validate_intent`, the pending state,
 *     the `unionUnique` helper, and the `params.pending_*` inputs. Every
 *     caller of a new partial is treated as `external` (no plan-aware
 *     partitioning).
 *
 *   - **No analytics.** The `sessionBus`/`blobStore`/`analyticsStore` emit
 *     block (section 13 in source) and the `fingerprint` / `templateFingerprint`
 *     / `messageTemplate` helpers from `diagnostic-record` are gone.
 *
 *   - **No CAC predictor.** Section 12c's `applyCac` invocation and the
 *     `cacConfigState` / `untracked` gating are gone.
 *
 *   - **No `schemaIndex`.** The fix generator and error enricher both
 *     dropped this in P7/P13/P16. The context type follows suit; the task
 *     spec's mention of `schemaIndex` is stale.
 *
 *   - **No `getDomainHeader` import.** Source imports it but never calls
 *     it — dead import. Dropped.
 *
 * Every other behavioural branch from source is preserved verbatim.
 */

import { existsSync, readFileSync } from 'node:fs';
import { z } from 'zod';

import { parseLiquidFile, extractAllFromAST } from '../core/liquid-parser';
import { normalizeLspDiagnostics, type PlatformOSLSPClient, type NormalizedDiagnostics } from '../core/lsp-client';
import {
  enrichAll,
  bridgeRulesOntoUnattributed,
  type EnrichedDiagnostic,
} from '../core/error-enricher';
import {
  generateFixes,
  clusterDiagnostics,
  generateScorecard,
  type Fix,
  type FixDiagnostic,
  type DiagnosticCluster,
  type ScorecardNote,
} from '../core/fix-generator';
import { getDomainFromPath } from '../core/domain-detector';
import { getTriggeredGotchas, getContentTriggers } from '../core/knowledge-loader';
import { generateStructuralWarnings, type StructuralDiagnostic } from '../core/structural-warnings';
import { validateSchema } from '../core/schema-validator';
import { validateTranslationYaml } from '../core/translation-validator';
import { checkSchemaProperties } from '../core/schema-property-checker';
import {
  runDiagnosticPipeline,
  stampDefaultsOn,
  suppressUpstreamFrontmatterDup,
  type PipelineResult,
} from '../core/diagnostic-pipeline';
import { isCheckForceDisabled } from '../core/rules/engine';
import { toUri, sanitizePath } from '../core/utils';
import { getProjectMap } from '../core/project-map';
import { buildFactGraph } from '../core/project-fact-graph';
import { loadAllRules } from '../core/rules';
import { LSP_DIAGNOSTICS_TIMEOUT_MS } from '../core/constants';

import type { FiltersIndex } from '../core/filters-index';
import type { ObjectsIndex } from '../core/objects-index';
import type { TagsIndex } from '../core/tags-index';
import type { GraphqlRef } from '../core/liquid-parser';
import type { ProjectMap } from '../core/project-scanner';

// Register every per-check rule module against the engine once per process.
// `loadAllRules` is idempotent so importing this module from multiple entry
// points (server.ts, tests) is safe.
loadAllRules();

// ── Public types ───────────────────────────────────────────────────────────

export type ValidateCodeMode = 'full' | 'quick';

export type ValidateCodeStatus = 'ok' | 'warning' | 'error';

export interface ValidateCodeParams {
  file_path: string;
  content: string;
  mode?: ValidateCodeMode;
}

/**
 * Diagnostic shape exposed in the result. Errors / warnings / infos all share
 * this type. The index signature accommodates rule-emitted ad-hoc fields
 * (`hover_docs`, ad-hoc rule outputs) without forcing every callsite to cast.
 */
export interface ValidateCodeDiagnostic extends EnrichedDiagnostic {
  fix?: Fix;
  completions?: string[];
}

export interface ValidateCodeStructuralSnapshot {
  renders_used: string[];
  graphql_queries_used: GraphqlRef[];
  filters_used: string[];
  tags_used: string[];
  translation_keys: string[];
  doc_params: string[];
  slug: string | null;
  layout: string | null;
  method: string | null;
  prompts: string[];
}

/**
 * A proposed fix shown to the agent. Heuristic fixes come from
 * `generateFixes`; rule-engine fixes are merged in afterwards and carry
 * `source: 'rule'` + the originating `rule_id` + `check`.
 */
export interface ProposedFix {
  type: string;
  description?: string;
  rule_id?: string | null;
  check?: string | null;
  source?: 'rule' | 'heuristic';
  /** Tolerated ad-hoc fields (range / new_text / path / scaffold / etc.). */
  [key: string]: unknown;
}

export interface DomainGuideGotcha {
  id: string;
  message: string;
  severity: string;
  applies_to_errors?: string[];
}

export interface DomainGuide {
  domain: string;
  rule?: string;
  triggered_gotchas: DomainGuideGotcha[];
}

export interface TipEntry {
  id: string;
  severity: string;
  message: string;
}

export interface ValidateCodeResult {
  status: ValidateCodeStatus;
  must_fix_before_write?: boolean;
  errors: ValidateCodeDiagnostic[];
  warnings: ValidateCodeDiagnostic[];
  infos: ValidateCodeDiagnostic[];
  proposed_fixes: ProposedFix[];
  clusters: DiagnosticCluster[];
  scorecard: ScorecardNote[];
  tips: TipEntry[];
  domain_guide: DomainGuide | null;
  structural: ValidateCodeStructuralSnapshot | null;
  parse_error?: string;
  next_step?: string;
}

export interface ValidateCodeContext {
  /** Absolute project root. */
  directory: string;
  /** In-process LSP client (lifecycle managed by the server). */
  lsp: PlatformOSLSPClient;
  /** Resolves once the LSP has finished its warm-up indexing. */
  awaitLsp: () => Promise<void>;
  filtersIndex: FiltersIndex;
  objectsIndex: ObjectsIndex;
  tagsIndex: TagsIndex;
  log?: (msg: string) => void;
}

// ── BLOCKING_WARNINGS ──────────────────────────────────────────────────────

/**
 * Warnings that MUST block a write even when `status === 'warning'`.
 *
 * Agents often read `status !== 'error'` as "safe to write" and ship a file
 * that silently breaks callers or drops functionality. The cases below are
 * narrower than "all warnings" — they are the specific cross-file or
 * signal-loss warnings that turn into bugs if ignored, and they drive the
 * boolean `must_fix_before_write` field. `next_step` branches on that field
 * instead of on status, so the agent sees a hard stop in the response shape
 * rather than a gentle "fix them before writing" prose line.
 */
const BLOCKING_WARNINGS: ReadonlySet<string> = new Set([
  'pos-supervisor:AddedParam', // new @param breaks existing callers
  'pos-supervisor:NewPartialParams', // new partial declares params existing callers don't pass
  'pos-supervisor:RemovedRender', // removing render breaks user-visible behavior
  'pos-supervisor:RemovedGraphQL', // removing graphql call drops data fetch
  'pos-supervisor:RemovedParam', // removing @param breaks callers
  'OrphanedPartial', // not reachable — shipping means orphaned file
]);

// ── Internal types ────────────────────────────────────────────────────────

interface CallerDiag {
  check: string;
  severity: 'warning' | 'info';
  message: string;
  /** Tolerated ad-hoc fields so this slots into `ValidateCodeDiagnostic` arrays. */
  [key: string]: unknown;
}

// ── Tool definition ────────────────────────────────────────────────────────

const inputSchema = {
  file_path: z
    .string()
    .describe(
      'Target file path (relative to project root, e.g. "app/views/pages/index.html.liquid")',
    ),
  content: z
    .string()
    .describe(
      'The complete text content of the file — NOT a file path. Read the file first, then pass the full text here.',
    ),
  mode: z
    .enum(['full', 'quick'])
    .optional()
    .describe(
      'Validation mode. Both modes: parse + lint + enrichment (suggestions, Shopify detection) + structural warnings. Difference: "full" additionally provides LSP completions, fix proposals, domain guidance, and architectural scoring. "quick" is for rapid re-validation after applying fixes.',
    ),
};

const description = `PURPOSE:
Validate platformOS code content prior to any hand-authored write/edit operation. Returns
enriched diagnostics, fix hints, LSP intelligence, domain guidance, and structural analysis.

WHEN TO CALL:
  - Before writing any HAND-DRAFTED .liquid, .graphql, or .yml file (REQUIRED).
  - After manually EDITING a previously written file (REQUIRED for the edited file only).

You MUST:
  Resolve every ERROR and WARNING returned before writing the file.
  Re-run validate_code after fixing until zero issues remain.
  Skipping validation on a hand-drafted file = FAIL.

REQUIRED PROCEDURE:
1. If editing an existing file: READ the file first, extract its FULL current content.
2. Prepare the COMPLETE target content — full file text for new files; full updated text for edits (not a diff).
3. Call validate_code with content = full file text.
4. Fix every ERROR and WARNING in the result before writing.
5. Only write the file after validate_code returns no errors or warnings.

CONSTRAINTS:
  - NEVER call validate_code with part of the content.
  - NEVER pass a file path as the content parameter.
  - NEVER skip validation on a hand-drafted file regardless of confidence level.
  - Validation must occur immediately before the write operation.`;

export const validateCodeTool = {
  name: 'validate_code' as const,
  description,
  inputSchema,
  createHandler(ctx: ValidateCodeContext) {
    return async (params: ValidateCodeParams): Promise<ValidateCodeResult> => {
      const { file_path, content } = params;
      const mode: ValidateCodeMode = params.mode ?? 'full';

      // ── Input validation ────────────────────────────────────────────────
      //
      // Returns a validation-shaped response so agents get a uniform
      // `{ status, errors, warnings, infos }` shape even on bad input.

      if (!file_path || typeof file_path !== 'string') {
        return inputErrorResult('file_path is required');
      }
      if (typeof content !== 'string') {
        return inputErrorResult('content is required and must be a string');
      }

      // Catch the most common agent mistakes: empty content, or passing a file
      // path instead of file text. We also reject anything shorter than 5
      // characters (cannot contain meaningful Liquid) and flag frontmatter-only
      // pages as an advisory warning rather than a silent pass.
      const contentTrimmed = content.trim();
      const looksLikePath =
        content === file_path ||
        /^(app|modules)\/[^\n]+\.(liquid|graphql|yml)$/.test(contentTrimmed);
      const tooShort = contentTrimmed.length > 0 && contentTrimmed.length < 5;

      if (contentTrimmed === '' || looksLikePath || tooShort) {
        const reason =
          contentTrimmed === ''
            ? '(empty string)'
            : looksLikePath
              ? `looks like a file path, not file content: "${content.slice(0, 80)}"`
              : `too short to be valid content (${contentTrimmed.length} chars): "${contentTrimmed}"`;
        return {
          status: 'error',
          must_fix_before_write: true,
          errors: [
            {
              check: 'InputError',
              severity: 'error',
              message:
                `content must be the actual file text, not a path or empty string. ` +
                `Read the file first (e.g. via Read tool), then pass the full text here. ` +
                `Received: ${reason}`,
            },
          ],
          warnings: [],
          infos: [],
          proposed_fixes: [],
          clusters: [],
          scorecard: [],
          tips: [],
          domain_guide: null,
          structural: null,
        };
      }

      let absPath: string;
      try {
        absPath = sanitizePath(ctx.directory, file_path);
      } catch (e) {
        return inputErrorResult((e as Error).message);
      }
      const fileExists = existsSync(absPath);
      const isPreWrite = !fileExists;

      const uri = toUri(absPath);
      const isLiquid = file_path.endsWith('.liquid');
      const isGraphql = file_path.endsWith('.graphql');
      const isSchema = file_path.endsWith('.yml') && /(?:^|\/)app\/schema\//.test(file_path);
      const isTranslationYaml =
        /\.ya?ml$/.test(file_path) && /(?:^|\/)app\/translations\//.test(file_path);

      const result: ValidateCodeResult = {
        status: 'ok',
        errors: [],
        warnings: [],
        infos: [],
        proposed_fixes: [],
        clusters: [],
        scorecard: [],
        tips: [],
        domain_guide: null,
        structural: null,
      };

      // Frontmatter-only page detection — flagged and pushed AFTER the lint
      // pass (section 2), because section 2 reassigns `result.warnings` from
      // the enriched lint output and would blow away anything pushed earlier.
      const isPage = /(?:^|\/)app\/views\/pages\//.test(file_path);
      const isFrontmatterOnlyPage =
        isLiquid && isPage && content.replace(/^---[\s\S]*?---\s*/m, '').trim() === '';

      // ── 1. Parse (Liquid only) ──────────────────────────────────────────
      let ast = null;
      if (isLiquid) {
        ast = parseLiquidFile(content);
        if (!ast) {
          result.parse_error =
            'Liquid parse failed — fix syntax errors before other issues can be detected';
        } else {
          const extracted = extractAllFromAST(ast);
          result.structural = {
            renders_used: extracted.renders,
            graphql_queries_used: extracted.graphql,
            filters_used: [...extracted.filters],
            tags_used: [...extracted.tags],
            translation_keys: [...extracted.transKeys],
            doc_params: [...extracted.docParams],
            slug: extracted.slug,
            layout: extracted.layout,
            method: extracted.method,
            prompts: extracted.prompts,
          };
        }
      }

      // ── 2. Lint — in-process LSP only (no pos-cli subprocess) ──────────
      try {
        let checkResult: NormalizedDiagnostics | null = null;
        const useLsp = ctx.lsp?.initialized;

        if (useLsp) {
          // Always wait for warm-up indexing before requesting diagnostics so
          // cross-file checks (MissingPartial, MissingPage, …) are warm.
          await ctx.awaitLsp();
          const lspDiags = await ctx.lsp.awaitDiagnostics(
            uri,
            content,
            LSP_DIAGNOSTICS_TIMEOUT_MS,
          );
          checkResult = normalizeLspDiagnostics(lspDiags, file_path);
        } else {
          result.infos.push({
            check: 'lsp',
            severity: 'info',
            message:
              'LSP is not initialised — diagnostics skipped. Start the supervisor with a valid project directory.',
          });
        }

        // Defensive second await in case enrichment leans on LSP hovers.
        if (ctx.lsp?.initialized) {
          await ctx.awaitLsp();
        }

        const projectMap = await getProjectMap(ctx.directory);
        const factGraph = buildFactGraph(projectMap);

        const enrichCtx = {
          uri,
          lsp: ctx.lsp,
          filtersIndex: ctx.filtersIndex,
          objectsIndex: ctx.objectsIndex,
          tagsIndex: ctx.tagsIndex,
          content,
          factGraph,
          filePath: file_path,
          projectDir: ctx.directory,
        };

        // Enrich in both modes — enrichment is critical for correct
        // classification (e.g. Shopify-contamination detection). `full` mode
        // additionally adds suggestions and completions. `NormalizedDiagnostic`
        // is a structural subset of `EnrichedDiagnostic` (same fields, fewer);
        // the `unknown` hop appeases TS's missing-index-signature check.
        const lspErrors = (checkResult?.errors ?? []) as unknown as EnrichedDiagnostic[];
        const lspWarnings = (checkResult?.warnings ?? []) as unknown as EnrichedDiagnostic[];
        result.errors = (await enrichAll(lspErrors, enrichCtx)) as ValidateCodeDiagnostic[];
        result.warnings = (await enrichAll(lspWarnings, enrichCtx)) as ValidateCodeDiagnostic[];

        // Auto-enrich: for errors without `suggestion`, attempt LSP
        // completions (full mode only). Skipped for checks where Liquid
        // completions are meaningless (asset / HTML / GraphQL errors).
        if (mode === 'full' && ctx.lsp?.initialized) {
          const SKIP_COMPLETIONS = new Set([
            'MissingAsset',
            'ParserBlockingScript',
            'ImgWidthAndHeight',
            'ImgLazyLoading',
            'LiquidHTMLSyntaxError',
            'GraphQLCheck',
            'NestedGraphQLQuery',
          ]);
          const needsDeeper = result.errors.filter(
            (e) => !e.suggestion && e.line != null && !SKIP_COMPLETIONS.has(e.check),
          );
          if (needsDeeper.length > 0) {
            await Promise.all(
              needsDeeper.map(async (e) => {
                try {
                  const completions = await ctx.lsp.completions(uri, e.line ?? 0, e.column ?? 0);
                  const items = Array.isArray(completions) ? completions : (completions?.items ?? []);
                  const labels = items
                    .slice(0, 10)
                    .map((i) => i.label ?? i.insertText ?? '')
                    .filter((s): s is string => !!s);
                  if (labels.length > 0) e.completions = labels;
                } catch {
                  /* completions failed — skip */
                }
              }),
            );
          }
        }

        if (checkResult?.infos) {
          result.infos.push(...(checkResult.infos as unknown as ValidateCodeDiagnostic[]));
        }
      } catch (e) {
        result.infos.push({
          check: 'lsp',
          severity: 'info',
          message: `Linter unavailable: ${(e as Error).message}`,
        });
      }

      // ── 2a. Diagnostic post-processing pipeline ─────────────────────────
      // Suppress / downgrade false positives for platformOS patterns.
      if (isLiquid && result.structural) {
        runDiagnosticPipeline(result as PipelineResult, {
          filePath: file_path,
          content,
          docParamNames: new Set(result.structural.doc_params ?? []),
          projectDir: ctx.directory,
        });
      } else {
        // MissingAsset and a handful of other on-disk verifications also run
        // for non-Liquid files (e.g. GraphQL).
        runDiagnosticPipeline(result as PipelineResult, {
          filePath: file_path,
          content,
          projectDir: ctx.directory,
        });
      }

      // ── 2b. Schema YAML structural validation ───────────────────────────
      if (isSchema) {
        try {
          const schemaResult = validateSchema(content, file_path);
          result.errors.push(...(schemaResult.errors as unknown as ValidateCodeDiagnostic[]));
          result.warnings.push(...(schemaResult.warnings as unknown as ValidateCodeDiagnostic[]));
        } catch (e) {
          result.infos.push({
            check: 'schema-validator',
            severity: 'info',
            message: `Schema validation failed: ${(e as Error).message}`,
          });
        }
      }

      // ── 2b1. Translation YAML structural validation ─────────────────────
      // Catches the missing top-level locale-key case (`app:` at root instead
      // of `en: → app:`). The LSP won't flag this because the YAML parses
      // fine, but every `{{ 'key' | t }}` lookup will silently return the raw
      // key. Runs before the GraphQL / structural branches so the error lands
      // on the file itself.
      if (isTranslationYaml) {
        try {
          const transResult = validateTranslationYaml(content, file_path);
          result.errors.push(...(transResult.errors as unknown as ValidateCodeDiagnostic[]));
          result.warnings.push(...(transResult.warnings as unknown as ValidateCodeDiagnostic[]));
        } catch (e) {
          result.infos.push({
            check: 'translation-validator',
            severity: 'info',
            message: `Translation validation failed: ${(e as Error).message}`,
          });
        }
      }

      // ── 2b2. Schema property cross-check (GraphQL files only) ───────────
      if (isGraphql) {
        try {
          const propResult = checkSchemaProperties(content, file_path, ctx.directory);
          result.warnings.push(...(propResult.warnings as unknown as ValidateCodeDiagnostic[]));
        } catch (e) {
          result.infos.push({
            check: 'schema-property-checker',
            severity: 'info',
            message: `Schema property check failed: ${(e as Error).message}`,
          });
        }
      }

      // ── 2c. Structural warnings (pos-supervisor intelligence) ───────────
      if (ast) {
        try {
          // Build the set of checks already reported by the linter so we
          // don't double-fire structural duplicates.
          const existingChecks = new Set<string>();
          for (const d of [...result.errors, ...result.warnings]) {
            existingChecks.add(d.check);
            if (d.check === 'UndefinedObject') {
              const varMatch = d.message?.match(/`([^`]+)`/);
              if (varMatch) existingChecks.add(`UndefinedObject:${varMatch[1]}`);
            }
            if (d.check === 'DeprecatedTag') {
              const tagMatch = d.message?.match(/tag\s+[`'"](\w+)[`'"]/i);
              if (tagMatch) existingChecks.add(`DeprecatedTag:${tagMatch[1]}`);
            }
          }

          const structResults = generateStructuralWarnings(
            ast,
            content,
            absPath,
            result.structural ?? undefined,
            existingChecks,
            { projectDir: ctx.directory },
          );
          for (const s of structResults) {
            if (s.severity === 'error') {
              result.errors.push(s as unknown as ValidateCodeDiagnostic);
            } else {
              result.warnings.push(s as unknown as ValidateCodeDiagnostic);
            }
          }
        } catch (e) {
          ctx.log?.(`Structural warnings failed for ${file_path}: ${(e as Error).message}`);
        }
      }

      // ── 2c1. Drop upstream `ValidFrontmatter` rows that share a line with
      //         our richer `pos-supervisor:InvalidLayout` /
      //         `pos-supervisor:InvalidFrontMatter` diagnostics. Without this
      //         dedup the agent sees two warnings for the same root cause.
      //         Upstream rows covering cases our checks don't handle
      //         (deprecated `layout_name`, missing required fields per file
      //         type) survive untouched.
      suppressUpstreamFrontmatterDup(result as PipelineResult);

      // ── 2d. Diff-aware comparison ───────────────────────────────────────
      // Detect removed functionality on update (full mode only).
      if (isLiquid && fileExists && result.structural && mode === 'full') {
        try {
          const oldContent = readFileSync(absPath, 'utf8');
          const oldAst = parseLiquidFile(oldContent);
          if (oldAst) {
            const oldExtracted = extractAllFromAST(oldAst);
            const newRenders = new Set(result.structural.renders_used);
            const newGraphql = new Set(
              result.structural.graphql_queries_used.map((g) => g.queryName),
            );
            const newParams = new Set(result.structural.doc_params);

            const removedRenders = oldExtracted.renders.filter((r) => !newRenders.has(r));
            const removedGraphql = oldExtracted.graphql.filter((g) => !newGraphql.has(g.queryName));
            const removedParams = [...oldExtracted.docParams].filter((p) => !newParams.has(p));

            if (removedRenders.length > 0) {
              result.warnings.push({
                check: 'pos-supervisor:RemovedRender',
                severity: 'warning',
                message: `Update removes render call(s): ${removedRenders
                  .map((r) => `'${r}'`)
                  .join(', ')}. Verify this is intentional — removing a render breaks the page for users.`,
              });
            }
            if (removedGraphql.length > 0) {
              result.warnings.push({
                check: 'pos-supervisor:RemovedGraphQL',
                severity: 'warning',
                message: `Update removes GraphQL call(s): ${removedGraphql
                  .map((g) => `'${g.queryName}'`)
                  .join(', ')}. Verify this is intentional — data may no longer be fetched.`,
              });
            }
            if (removedParams.length > 0) {
              result.warnings.push({
                check: 'pos-supervisor:RemovedParam',
                severity: 'warning',
                message: `Update removes @param(s): ${removedParams
                  .map((p) => `'${p}'`)
                  .join(', ')}. Callers passing these parameters will break.`,
              });
            }

            // ADDED params — callers that don't pass them will trigger
            // `MissingRenderPartialArguments`. In v1 we have no pending /
            // plan-aware partitioning, so every existing caller counts as
            // external.
            const addedParams = [...newParams].filter((p) => !oldExtracted.docParams.has(p));
            if (addedParams.length > 0 && file_path.includes('app/views/partials/')) {
              const partialName = file_path
                .replace(/^app\/views\/partials\//, '')
                .replace(/\.html\.liquid$/, '')
                .replace(/\.liquid$/, '');
              try {
                const projectMap = await getProjectMap(ctx.directory);
                const externalCallers: string[] = projectMapCallers(projectMap, partialName);
                if (externalCallers.length > 0) {
                  result.warnings.push({
                    check: 'pos-supervisor:AddedParam',
                    severity: 'warning',
                    message: `Adding @param(s) ${addedParams
                      .map((p) => `'${p}'`)
                      .join(', ')} will break ${externalCallers.length} caller(s) that don't pass them yet: ${externalCallers
                      .slice(0, 10)
                      .join(', ')}${
                      externalCallers.length > 10
                        ? ` (+${externalCallers.length - 10} more)`
                        : ''
                    }. Each caller must be updated to pass the new parameter(s).`,
                  });
                }
              } catch {
                // Project map unavailable — still emit a generic warning.
                result.warnings.push({
                  check: 'pos-supervisor:AddedParam',
                  severity: 'warning',
                  message: `Adding @param(s) ${addedParams
                    .map((p) => `'${p}'`)
                    .join(', ')} to this partial will break any callers that don't pass them.`,
                });
              }
            }
          }
        } catch (e) {
          ctx.log?.(`Diff comparison failed for ${file_path}: ${(e as Error).message}`);
        }
      }

      // ── 2e. New partial with @params — check existing callers ───────────
      if (isPreWrite && isLiquid && (result.structural?.doc_params?.length ?? 0) > 0) {
        try {
          const callerDiag = await checkNewPartialCallers(
            file_path,
            result.structural!.doc_params,
            ctx.directory,
          );
          if (callerDiag?.severity === 'warning') {
            result.warnings.push(callerDiag);
          } else if (callerDiag?.severity === 'info') {
            result.infos.push(callerDiag);
          }
        } catch (e) {
          ctx.log?.(`Cross-file caller check failed for ${file_path}: ${(e as Error).message}`);
        }
      }

      // ── 3. Domain knowledge — triggered gotchas (full mode) ─────────────
      if (mode === 'full') {
        const domain = getDomainFromPath(absPath);
        if (domain) {
          const checkNames = new Set<string>([
            ...result.errors.map((e) => e.check),
            ...result.warnings.map((w) => w.check),
          ]);
          const tagsUsed = new Set<string>(result.structural?.tags_used ?? []);
          const filtersUsed = new Set<string>(result.structural?.filters_used ?? []);

          const triggered = getTriggeredGotchas(domain, {
            checks: checkNames,
            tags: tagsUsed,
            filters: filtersUsed,
          });

          if (triggered) {
            const gotchasWithErrors: DomainGuideGotcha[] = triggered.gotchas.map((g) => {
              const entry: DomainGuideGotcha = {
                id: g.id,
                message: g.message,
                severity: g.severity,
              };
              const related: string[] = [];
              for (const check of checkNames) {
                if (
                  g.message.toLowerCase().includes(check.toLowerCase().replace('pos-supervisor:', ''))
                ) {
                  related.push(check);
                }
              }
              if (related.length > 0) entry.applies_to_errors = related;
              return entry;
            });

            result.domain_guide = {
              domain,
              rule: triggered.rule,
              triggered_gotchas: gotchasWithErrors,
            };
          }
        }
      }

      // ── 4. Generate proposed fixes (full mode, has diagnostics) ─────────
      if (mode === 'full' && (result.errors.length > 0 || result.warnings.length > 0)) {
        try {
          // Tag each diagnostic with its origin (errors vs warnings array +
          // index) so we can attach per-diagnostic `fix` fields after the
          // generator emits its map.
          const allDiagnostics: Array<FixDiagnostic & { _origIdx: number; _origType: 'error' | 'warning' }> = [
            ...result.errors.map((e, i) => ({ ...(e as FixDiagnostic), _origIdx: i, _origType: 'error' as const })),
            ...result.warnings.map((w, i) => ({ ...(w as FixDiagnostic), _origIdx: i, _origType: 'warning' as const })),
          ];

          const { proposedFixes, diagnosticFixes } = generateFixes(
            allDiagnostics,
            ast,
            content,
            file_path,
            {
              objectsIndex: ctx.objectsIndex,
              filtersIndex: ctx.filtersIndex,
              tagsIndex: ctx.tagsIndex,
            },
            ctx.directory,
          );

          // Precedence rule (2026-04-25):
          //
          //   - Heuristic `text_edit`  → ALWAYS keep (actionable; complements
          //                              any rule guidance).
          //   - Heuristic `guidance`   → DROP if the rule already emitted any
          //                              fix for this diagnostic. Otherwise
          //                              keep.
          //   - Rule fixes             → ALWAYS keep.
          //
          // Without this gate the agent saw competing guidance for the same
          // root cause (rule Levenshtein vs heuristic specific-case
          // detection), which actively misled fixes.
          const rulesByDiag = new Map<FixDiagnostic, Fix[]>();
          for (const d of allDiagnostics) {
            const fixes = (d as { fixes?: Fix[] }).fixes;
            if (fixes && fixes.length > 0) {
              rulesByDiag.set(d, fixes);
            }
          }
          const heuristicByDiagIdx = new Map(diagnosticFixes);
          const dropHeuristicGuidance = new Set<Fix>();
          for (const [diagIdx, hFix] of heuristicByDiagIdx) {
            const d = allDiagnostics[diagIdx];
            if (rulesByDiag.has(d) && hFix?.type === 'guidance') {
              dropHeuristicGuidance.add(hFix);
            }
          }
          result.proposed_fixes = proposedFixes
            .filter((f) => !dropHeuristicGuidance.has(f))
            .map((f) => f as ProposedFix);

          // Merge rule-generated fixes into proposed_fixes.
          for (const d of allDiagnostics) {
            const fixes = (d as { fixes?: Fix[]; rule_id?: string | null; check?: string | null }).fixes;
            if (fixes && fixes.length > 0) {
              for (const f of fixes) {
                result.proposed_fixes.push({
                  ...(f as object),
                  source: 'rule',
                  rule_id: (d as { rule_id?: string | null }).rule_id ?? null,
                  check: d.check ?? null,
                } as ProposedFix);
              }
            }
          }

          // Attach per-diagnostic `fix` field. If the rule won precedence and
          // the heuristic was guidance-only, attach the rule's first fix
          // instead so `diagnostic.fix` matches what `proposed_fixes` carries.
          for (const [diagIdx, fix] of heuristicByDiagIdx) {
            const d = allDiagnostics[diagIdx];
            const ruleFixes = rulesByDiag.get(d);
            const useFix: Fix =
              ruleFixes && fix?.type === 'guidance'
                ? ({
                    ...(ruleFixes[0] as object),
                    source: 'rule',
                    rule_id: (d as { rule_id?: string | null }).rule_id ?? null,
                  } as unknown as Fix)
                : fix;
            if (d._origType === 'error') {
              result.errors[d._origIdx].fix = useFix;
            } else {
              result.warnings[d._origIdx].fix = useFix;
            }
          }
        } catch (e) {
          // Fix generation is best-effort — don't fail the whole tool.
          result.infos.push({
            check: 'fix-generator',
            severity: 'info',
            message: `Fix generation failed: ${(e as Error).message}`,
          });
        }
      }

      // ── 5. Content-triggered proactive tips (full mode) ─────────────────
      if (mode === 'full') {
        const domain = getDomainFromPath(absPath);
        if (domain) {
          try {
            const triggers = getContentTriggers(content, domain);
            for (const t of triggers) {
              result.tips.push({ id: t.id, severity: t.severity, message: t.message });
            }
          } catch {
            /* best-effort */
          }
        }

        // 5b. Scaffold-preventable error detection. When we see errors that
        // scaffold would have prevented, tell the agent so the next attempt
        // uses scaffold output verbatim instead of re-deriving the patterns.
        try {
          const scaffoldHints = detectScaffoldPreventableErrors(content, result.errors, result.warnings);
          for (const h of scaffoldHints) {
            result.tips.push(h);
          }
        } catch {
          /* best-effort */
        }
      }

      // ── 6. Error clustering (reduce noise for repeated check types) ─────
      if (mode === 'full' && result.errors.length + result.warnings.length >= 2) {
        try {
          result.clusters = clusterDiagnostics(result.errors, result.warnings);
        } catch {
          /* best-effort */
        }
      }

      // ── 7. Architecture scorecard (full mode, Liquid files) ─────────────
      if (mode === 'full' && isLiquid && result.structural) {
        try {
          const domain = getDomainFromPath(absPath);
          result.scorecard = generateScorecard(
            result.structural,
            domain ?? null,
            result.errors,
            result.warnings,
          );
        } catch {
          /* best-effort */
        }
      }

      // ── 8a. Frontmatter-only page advisory ──────────────────────────────
      // Pushed here so it survives section 2's `result.warnings` reassignment.
      if (isFrontmatterOnlyPage) {
        result.warnings.push({
          check: 'pos-supervisor:FrontmatterOnlyPage',
          severity: 'warning',
          message:
            `Page '${file_path}' has frontmatter but no body — the rendered output will be empty. ` +
            `If this is intentional (redirect-only page, header-driven response), add a body comment to ` +
            `acknowledge the empty body; otherwise add the page content.`,
        });
      }

      // ── 9. Derive status — single source of truth, computed once ────────
      result.status =
        result.errors.length > 0 ? 'error' : result.warnings.length > 0 ? 'warning' : 'ok';

      // ── 9a. Structured blocking-gate field ──────────────────────────────
      //
      // `status` is advisory — agents sometimes read `status !== 'error'` as
      // "safe to write" and ship a file with silent cross-file damage (new
      // @param that callers don't pass, removed render that breaks a page,
      // etc.). `must_fix_before_write` is a hard boolean the agent cannot
      // mis-interpret. It is `true` whenever:
      //   - there is at least one error, OR
      //   - there is a warning whose check name is in `BLOCKING_WARNINGS`.
      const blockingWarnings = result.warnings.filter((w) => BLOCKING_WARNINGS.has(w.check));
      result.must_fix_before_write = result.errors.length > 0 || blockingWarnings.length > 0;

      // ── 10. Next step guidance — branches on must_fix_before_write ──────
      if (!result.must_fix_before_write) {
        result.next_step =
          result.status === 'ok'
            ? 'File validated. Write it to disk now.'
            : 'File has advisory warnings but none block the write. Review the warnings, then write the file to disk.';
      } else {
        const parts: string[] = [];
        if (result.errors.length > 0) {
          parts.push('Fix every ERROR above.');
        }
        if (blockingWarnings.length > 0) {
          const names = [...new Set(blockingWarnings.map((w) => w.check))].join(', ');
          parts.push(
            `Fix every BLOCKING WARNING above (${names}). These break callers or drop functionality — they MUST be resolved before write.`,
          );
        }
        if (result.proposed_fixes.length > 0) {
          parts.push(`${result.proposed_fixes.length} proposed fix(es) available — apply them first.`);
        }
        parts.push('Re-validate with validate_code (mode: "quick") after fixing.');
        parts.push('MUST NOT write the file to disk until validation passes (must_fix_before_write: false).');
        result.next_step = parts.join('\n');
      }

      // ── 11. Convert 0-based line numbers to 1-based for agent display ───
      // LSP and pos-cli check both use 0-based lines internally. Agents and
      // editors use 1-based (cat -n, Read tool, IDE line numbers).
      for (const d of [...result.errors, ...result.warnings, ...result.infos]) {
        if (d.line != null) d.line += 1;
        if (d.endLine != null) d.endLine += 1;
      }

      // ── 12a. Bridge rules onto unattributed diagnostics ─────────────────
      // Several sources push into `result.errors` / `result.warnings` AFTER
      // `enrichAll` runs (structural warnings, schema / translation /
      // GraphQL validators, diff-aware RemovedRender/AddedParam, new-partial
      // caller check). Rule modules for those check names registered against
      // the engine but only fire inside `enrichAll`. This bridge lets them
      // fire on the late additions, attaching `rule_id` + `hint_md` that
      // would otherwise be lost.
      try {
        const projectMapForBridge = await getProjectMap(ctx.directory);
        const factGraphForBridge = buildFactGraph(projectMapForBridge);
        bridgeRulesOntoUnattributed(result, {
          uri,
          filePath: file_path,
          content,
          factGraph: factGraphForBridge,
          filtersIndex: ctx.filtersIndex,
          objectsIndex: ctx.objectsIndex,
          tagsIndex: ctx.tagsIndex,
          projectDir: ctx.directory,
        });
      } catch {
        /* bridge is best-effort — fall through to default stamping */
      }

      // ── 12b. Re-stamp default confidence + rule_id ──────────────────────
      // `runDiagnosticPipeline` already ran this as its last step, but every
      // source pushed into `result.errors` / `result.warnings` AFTER the
      // pipeline finishes needs the same treatment. Idempotent — the helper
      // only fills when a field is missing.
      stampDefaultsOn(result as PipelineResult);

      // ── 12b (force-disable filter) ──────────────────────────────────────
      // `runRules` already honors force-disable for `rule_id`s, but many
      // diagnostics originate outside the rule engine (structural warnings,
      // LSP checks without a rule module). An operator who force-disables
      // `pos-supervisor:HtmlInPage` expects it to stop appearing entirely.
      // Filter here so the override semantics match operator intent.
      const dropForceDisabled = (d: ValidateCodeDiagnostic): boolean =>
        !(isCheckForceDisabled(d.check) || isCheckForceDisabled(d.rule_id ?? null));
      result.errors = result.errors.filter(dropForceDisabled);
      result.warnings = result.warnings.filter(dropForceDisabled);
      result.infos = result.infos.filter(dropForceDisabled);

      // ── 12 (null-hint cleanup) ──────────────────────────────────────────
      // Diagnostics without hints should omit the field entirely rather than
      // returning `hint: null` which looks like a bug in the output.
      for (const d of [...result.errors, ...result.warnings, ...result.infos]) {
        if (d.hint === null || d.hint === undefined) delete d.hint;
      }

      return result;
    };
  },
};

// ── Helpers ─────────────────────────────────────────────────────────────────

function inputErrorResult(message: string): ValidateCodeResult {
  return {
    status: 'error',
    errors: [{ check: 'InputError', severity: 'error', message }],
    warnings: [],
    infos: [],
    proposed_fixes: [],
    clusters: [],
    scorecard: [],
    tips: [],
    domain_guide: null,
    structural: null,
  };
}

/**
 * Find all files that render a given partial by scanning project_map entries.
 * Works for partials that don't exist on disk yet (`rendered_by` would be
 * empty in that case).
 *
 * Source iterated `pages`, `partials`, AND `commands`, but `CommandEntry`
 * carries no `renders` array (commands invoke other commands via
 * `{% function %}`, not `{% render %}`), so the commands branch was a
 * permanent no-op. Dropped in the port to keep types honest.
 */
function findCallersInProjectMap(projectMap: ProjectMap, partialName: string): string[] {
  const callers: string[] = [];

  for (const page of Object.values(projectMap.pages ?? {})) {
    if (page.renders?.includes(partialName)) {
      callers.push(page.path);
    }
  }

  for (const partial of Object.values(projectMap.partials ?? {})) {
    if (partial.renders?.includes(partialName)) {
      callers.push(partial.path);
    }
  }

  return callers;
}

/**
 * Convenience for the AddedParam path — prefers the partial's
 * `rendered_by` index (built by `project-scanner`) over a full project map
 * scan, falling back to the scan when the partial is unknown.
 */
function projectMapCallers(projectMap: ProjectMap, partialName: string): string[] {
  const rendered_by = projectMap.partials?.[partialName]?.rendered_by;
  if (Array.isArray(rendered_by) && rendered_by.length > 0) return [...rendered_by];
  return findCallersInProjectMap(projectMap, partialName);
}

/**
 * When creating a NEW partial that declares @params, check if existing files
 * already render it. Those callers don't pass the new params — warn the
 * agent.
 *
 * Unlike section 2d (diff-aware AddedParam for updates), this handles the
 * creation case where the file doesn't exist on disk yet, so we scan
 * pages / partials / commands renders directly.
 */
async function checkNewPartialCallers(
  filePath: string,
  docParams: string[],
  projectDir: string,
): Promise<CallerDiag | null> {
  if (!filePath.includes('app/views/partials/')) return null;

  const partialName = filePath
    .replace(/^app\/views\/partials\//, '')
    .replace(/\.html\.liquid$/, '')
    .replace(/\.liquid$/, '');

  const projectMap = await getProjectMap(projectDir);
  const externalCallers = findCallersInProjectMap(projectMap, partialName);
  if (externalCallers.length === 0) return null;

  return {
    check: 'pos-supervisor:NewPartialParams',
    severity: 'warning',
    message:
      `New partial declares @param(s) ${docParams.map((p) => `'${p}'`).join(', ')} ` +
      `but ${externalCallers.length} existing file(s) already render '${partialName}' without passing them: ` +
      `${externalCallers.slice(0, 10).join(', ')}${
        externalCallers.length > 10 ? ` (+${externalCallers.length - 10} more)` : ''
      }. Each caller must be updated to pass the required parameter(s).`,
  };
}

// ── Scaffold-preventable error detection ───────────────────────────────────

/**
 * Detect patterns in code that the scaffold tool would have generated
 * correctly. Returns tips suggesting the agent should use scaffold output
 * as-is. Scope-irrelevant heuristic — kept verbatim from source.
 *
 * `errors` and `warnings` are accepted for parity with the source signature
 * even though only `content` is consulted; future hints may want to read
 * back the current diagnostic state.
 */
function detectScaffoldPreventableErrors(
  content: string,
  _errors: ValidateCodeDiagnostic[],
  _warnings: ValidateCodeDiagnostic[],
): TipEntry[] {
  const tips: TipEntry[] = [];

  // Deprecated `{% include %}` (scaffold uses `{% function %}`).
  if (/\{%[-\s]*include\s/.test(content)) {
    tips.push({
      id: 'scaffold_include_deprecated',
      severity: 'warning',
      message:
        'This file uses deprecated {% include %} tag. The scaffold tool generates code with the modern {% function %} tag. If you used scaffold to generate this code, write the scaffold output exactly as returned — do not substitute {% include %} for {% function %}.',
    });
  }

  // Deprecated `{% hash_assign %}` (scaffold uses `parse_json` / bracket assign).
  if (/\{%[-\s]*hash_assign\s/.test(content)) {
    tips.push({
      id: 'scaffold_hash_assign_deprecated',
      severity: 'warning',
      message:
        'This file uses deprecated {% hash_assign %} tag. The scaffold tool generates code with {% assign %} bracket notation or {% parse_json %}. If you used scaffold, write its output exactly as returned.',
    });
  }

  // Missing `| json` filter inside `parse_json` blocks.
  const parseJsonBlocks = content.match(/\{%\s*parse_json[\s\S]*?\{%\s*endparse_json\s*%\}/g);
  if (parseJsonBlocks) {
    for (const block of parseJsonBlocks) {
      const interpolations = block.match(/\{\{[^}]+\}\}/g);
      if (interpolations) {
        const missingJson = interpolations.filter((i) => !i.includes('| json'));
        if (missingJson.length > 0) {
          tips.push({
            id: 'scaffold_missing_json_filter',
            severity: 'warning',
            message:
              'Found {{ variable }} without | json filter inside parse_json block. This causes injection bugs. The scaffold tool always generates {{ variable | json }}. If you used scaffold, write its output exactly as returned.',
          });
          break;
        }
      }
    }
  }

  // Authorization helper using the deprecated `include` syntax.
  const hasDeprecatedIncludeAuth =
    /include\s+['"]modules\/user\/helpers\/can_do_or_unauthorized['"]/.test(content);
  if (hasDeprecatedIncludeAuth) {
    tips.push({
      id: 'scaffold_include_auth',
      severity: 'warning',
      message:
        "Authorization uses deprecated {% include %} syntax. The scaffold tool generates: {% function _ = 'modules/user/helpers/can_do_or_unauthorized', requester: profile, do: '...' %}. Write scaffold output exactly as returned.",
    });
  }

  if (tips.length >= 2) {
    tips.push({
      id: 'scaffold_use_as_is',
      severity: 'warning',
      message:
        'Multiple scaffold-preventable errors detected. If you generated this code with the scaffold tool, you MUST write the scaffold output character-for-character. Do NOT rewrite, rephrase, or "improve" it. The scaffold output is pre-validated production code.',
    });
  }

  return tips;
}

// Re-export structural-warnings' diagnostic type so external test fixtures
// can describe expected shapes without a deep import.
export type { StructuralDiagnostic };
