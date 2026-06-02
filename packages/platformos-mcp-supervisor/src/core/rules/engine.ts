/**
 * Rule engine — pure `(diag, facts) → RuleResult | null` dispatch.
 *
 * Each check has 0..N rules. Rules run in `priority` order (lower = first);
 * first match wins. `runRules` returns the matched rule's `apply()` result
 * unchanged — no confidence adjustment, no scoring, no case-base feedback.
 * The v1 engine is symbolic only; the adaptive layer (case base, promoted
 * rules, probation, force-enable overrides) is intentionally absent.
 *
 * The only suppression gate carried over is `_forceDisabled`: a flat set
 * containing either rule ids (`'MissingPartial.suggest_nearest'`) or check
 * names (`'pos-supervisor:HtmlInPage'`). `runRules` checks both per rule;
 * `isCheckForceDisabled` is called by validate-code AFTER all enrichment
 * to drop diagnostics whose check is in the same set — covers structural
 * warnings and LSP checks without a registered rule module.
 *
 * Failure isolation: a rule whose `when` or `apply` throws is silently
 * skipped. Matching the source behaviour — one broken rule never poisons
 * the whole pipeline.
 */

import type { ProjectFactGraph } from '../project-fact-graph';
import type { FiltersIndex } from '../filters-index';
import type { ObjectsIndex } from '../objects-index';
import type { TagsIndex } from '../tags-index';

// ── Diagnostic + Facts shapes ──────────────────────────────────────────────

export type RuleSeverity = 'error' | 'warning' | 'info';

/**
 * Diagnostic shape consumed by rules. The required fields (`check`,
 * `message`) are common to every diagnostic; the rest are optional and
 * populated incrementally as the enrichment + pipeline + structural-warnings
 * stages add data. The `[key: string]: unknown` index lets rules read
 * ad-hoc fields (`diag.params.partial`, `diag.template_fp`, etc.) without
 * the type system pushing back at every read site.
 */
export interface RuleDiagnostic {
  check: string;
  message?: string;
  severity?: RuleSeverity;
  line?: number;
  column?: number;
  endLine?: number | null;
  endColumn?: number | null;
  /** Repo-relative file path. Some rules read `diag.file` directly. */
  file?: string;
  /** Extracted regex captures (filled by `error-enricher`). */
  params?: Record<string, string>;
  /** Stable fingerprint of the message template (analytics dropped in v1 but the field is preserved for rule-internal use). */
  template_fp?: string;
  /** Stamped by the rule that wins. */
  rule_id?: string;
  [key: string]: unknown;
}

/**
 * Facts the engine passes to each rule's `when` / `apply`. All fields are
 * optional because the enricher assembles the bag from whatever the
 * caller provides; rules guard with `facts.graph?.` style checks.
 */
export interface RuleFacts {
  /** The primary fact graph (built once per validate_code call). */
  graph?: ProjectFactGraph;
  /** Alias some rule files use historically. */
  factGraph?: ProjectFactGraph;
  filtersIndex?: FiltersIndex;
  objectsIndex?: ObjectsIndex;
  tagsIndex?: TagsIndex;
  /** Raw file content under analysis. */
  content?: string;
  /** Repo-relative path of the file under analysis. */
  filePath?: string;
  /** Absolute project root. */
  projectDir?: string;
  [key: string]: unknown;
}

// ── Result shape ───────────────────────────────────────────────────────────

export type FixKind = 'text_edit' | 'insert' | 'create_file' | 'guidance' | 'add_doc_param' | string;

/**
 * Discriminated-ish union over fix kinds. Rules emit varied shapes by
 * kind; the `[key: string]: unknown` index lets each rule pass through
 * `range`, `new_text`, `description`, `position`, `path`, `content`,
 * `param_name`, `args` etc. without per-kind narrowing.
 */
export interface RuleFix {
  type: FixKind;
  rule_id?: string;
  source?: string;
  [key: string]: unknown;
}

export interface SeeAlso {
  tool: string;
  args?: Record<string, unknown>;
  reason: string;
}

/**
 * What a rule's `apply()` returns. `rule_id` is the only required field —
 * the enricher stamps every winning result with it. Everything else is
 * optional surface that downstream stages may consume.
 */
export interface RuleResult {
  rule_id: string;
  hint_md?: string;
  fixes?: RuleFix[];
  confidence?: number;
  see_also?: SeeAlso;
  suggestion?: string;
  [key: string]: unknown;
}

export interface Rule {
  id: string;
  check: string;
  /** Lower = first. Default 100 when omitted. */
  priority?: number;
  when: (diag: RuleDiagnostic, facts: RuleFacts) => unknown;
  apply: (diag: RuleDiagnostic, facts: RuleFacts) => RuleResult | null | undefined;
}

// ── State ──────────────────────────────────────────────────────────────────

interface RegisteredRule {
  id: string;
  check: string;
  priority: number;
  when: Rule['when'];
  apply: Rule['apply'];
}

const _registry = new Map<string, RegisteredRule[]>();
/**
 * Flat set of suppressed identifiers. Each entry is EITHER a rule_id
 * (e.g. `'UnknownFilter.suggest_nearest'`) OR a bare check name (e.g.
 * `'pos-supervisor:HtmlInPage'`). The engine consults it twice:
 *   - during `runRules` to skip individual rules,
 *   - via `isCheckForceDisabled` from validate-code to drop a whole
 *     diagnostic class after enrichment.
 */
const _forceDisabled = new Set<string>();

// ── Registration ───────────────────────────────────────────────────────────

export function registerRule(rule: Rule): void {
  if (!rule?.id || !rule?.check || !rule?.when || !rule?.apply) {
    throw new Error('registerRule: rule must have id, check, when, apply');
  }
  const entry: RegisteredRule = {
    id: rule.id,
    check: rule.check,
    priority: rule.priority ?? 100,
    when: rule.when,
    apply: rule.apply,
  };
  let bucket = _registry.get(rule.check);
  if (!bucket) {
    bucket = [];
    _registry.set(rule.check, bucket);
  }
  bucket.push(entry);
  bucket.sort((a, b) => a.priority - b.priority);
}

export function registerRules(rules: ReadonlyArray<Rule>): void {
  for (const rule of rules) registerRule(rule);
}

// ── Lookup ─────────────────────────────────────────────────────────────────

export function hasRules(check: string): boolean {
  const rules = _registry.get(check);
  return !!(rules && rules.length > 0);
}

// ── Dispatch ───────────────────────────────────────────────────────────────

/**
 * Walk the rule list for `diag.check` in priority order; return the first
 * matching rule's `apply()` result. `null` when nothing matches.
 *
 * A rule is skipped when either its `id` OR its `check` is in
 * `_forceDisabled`. Exceptions thrown from `when` / `apply` are swallowed
 * so a single broken rule cannot poison the pipeline.
 */
export function runRules(diag: RuleDiagnostic, facts: RuleFacts): RuleResult | null {
  const rules = _registry.get(diag.check);
  if (!rules || rules.length === 0) return null;

  for (const rule of rules) {
    if (_forceDisabled.has(rule.id) || _forceDisabled.has(rule.check)) continue;
    try {
      if (!rule.when(diag, facts)) continue;
      const result = rule.apply(diag, facts);
      if (result) return result;
    } catch {
      // Rule failure is non-fatal — try the next one.
    }
  }
  return null;
}

// ── Force-disable surface (operator kill-switch) ───────────────────────────

/**
 * Add a rule_id or check name to the force-disable set. Idempotent.
 */
export function forceDisable(idOrCheck: string): void {
  if (idOrCheck) _forceDisabled.add(idOrCheck);
}

/**
 * Remove an id from the force-disable set. No-op when absent.
 */
export function releaseDisable(idOrCheck: string): void {
  _forceDisabled.delete(idOrCheck);
}

/**
 * True when `checkName` (a check name, NOT a rule id) is suppressed. Called
 * by validate-code AFTER enrichment to drop diagnostics whose check is in
 * the force-disable set even if no rule fired for it (covers
 * `pos-supervisor:*` structural warnings and LSP checks without rules).
 */
export function isCheckForceDisabled(checkName: string | null | undefined): boolean {
  if (!checkName) return false;
  return _forceDisabled.has(checkName);
}

// ── Maintenance ────────────────────────────────────────────────────────────

/**
 * Reset every piece of in-memory state — registry AND force-disable set.
 *
 * Source historically cleared only the registry; that leaked override state
 * across test files (a force-disable set in test A silently filtered a
 * rule re-registered in test B). Clearing both is the safe default.
 */
export function clearRules(): void {
  _registry.clear();
  _forceDisabled.clear();
}

export function ruleCount(): number {
  let n = 0;
  for (const rules of _registry.values()) n += rules.length;
  return n;
}
