/**
 * Knowledge-base loader.
 *
 * Lazily reads the structured rule + domain + Shopify metadata at first
 * access. The on-disk layout splits the data across files for editability;
 * this module presents a single in-memory `KnowledgeBase` and a stable set
 * of typed getters consumed by `error-enricher`, `diagnostic-pipeline`,
 * `structural-warnings`, `fix-generator`, and the individual rule modules.
 *
 * Resolution: `join(__dirname, '..', 'data')` — works in both `dist/`
 * (after the post-build `copy-data` step) and `src/` (vitest / dev).
 */

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import yaml from 'js-yaml';

const DATA_DIR = join(__dirname, '..', 'data');

// ── Types ──────────────────────────────────────────────────────────────────

export interface KnowledgeCheck {
  name: string;
  summary?: string;
  /** Per-context hint variants. `default` is the canonical one. */
  hint?: Record<string, string>;
  /** Populated from `shopify-objects.json` for the `UndefinedObject` check. */
  shopify_objects?: string[];
  /** Populated from `shopify-objects.json` for the `UnknownFilter` check. */
  shopify_filters?: string[];
  /** Optional Shopify-migration guidance string. */
  shopify_guidance?: string;
}

export interface DomainGotcha {
  id: string;
  /** `'always' | 'has_check:<Name>' | 'uses_tag:<name>' | 'uses_filter:<name>'`. */
  trigger: string;
  message: string;
  severity: string;
}

export interface DomainDefinition {
  rule?: string;
  gotchas?: DomainGotcha[];
}

export interface ContentTriggerDef {
  id: string;
  pattern: string;
  message: string;
  severity: string;
  domains?: string[];
}

export interface ModulesMissingDocs {
  description?: string;
  known: string[];
}

export interface ShopifyContaminationEntry {
  replacement: string | null;
  note?: string;
}

export interface ShopifyContamination {
  objects?: Record<string, ShopifyContaminationEntry>;
  filters?: Record<string, ShopifyContaminationEntry>;
  tags?: Record<string, ShopifyContaminationEntry>;
}

export interface KnowledgeBase {
  checks: Record<string, KnowledgeCheck>;
  domains: Record<string, DomainDefinition>;
  language_features: Record<string, unknown>;
  content_triggers: ContentTriggerDef[];
  modules_missing_docs: ModulesMissingDocs;
}

export interface TriggerContext {
  checks?: Set<string>;
  tags?: Set<string>;
  filters?: Set<string>;
}

export interface CheckKnowledgeView {
  summary?: string;
  hint: string | null;
  shopify_guidance?: string;
}

export interface TriggeredGotchasView {
  rule?: string;
  gotchas: Array<Pick<DomainGotcha, 'id' | 'message' | 'severity'>>;
}

export interface ContentTriggerHit {
  id: string;
  message: string;
  severity: string;
}

// ── State ──────────────────────────────────────────────────────────────────

let _knowledge: KnowledgeBase | null = null;
let _shopifyObjects: Set<string> | null = null;
let _shopifyFilters: Set<string> | null = null;
let _shopifyContamination: ShopifyContamination | null = null;

// ── Filesystem helpers ─────────────────────────────────────────────────────

function loadYaml<T>(filePath: string): T | null {
  if (!existsSync(filePath)) return null;
  try {
    return yaml.load(readFileSync(filePath, 'utf8')) as T;
  } catch {
    return null;
  }
}

function loadJson<T>(filePath: string): T | null {
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(readFileSync(filePath, 'utf8')) as T;
  } catch {
    return null;
  }
}

function loadShopifyContamination(): ShopifyContamination | null {
  if (_shopifyContamination) return _shopifyContamination;
  const path = join(DATA_DIR, 'shopify-contamination.json');
  _shopifyContamination = loadJson<ShopifyContamination>(path);
  return _shopifyContamination;
}

function loadFromSplitFiles(): KnowledgeBase | null {
  const kb: KnowledgeBase = {
    checks: {},
    domains: {},
    language_features: {},
    content_triggers: [],
    modules_missing_docs: { known: [] },
  };

  const checksDir = join(DATA_DIR, 'checks');
  if (existsSync(checksDir)) {
    for (const file of readdirSync(checksDir)) {
      if (!file.endsWith('.yml') && !file.endsWith('.yaml')) continue;
      const check = loadYaml<KnowledgeCheck>(join(checksDir, file));
      if (check?.name) kb.checks[check.name] = check;
    }
  }
  if (Object.keys(kb.checks).length === 0) return null;

  type ShopifyObjectsFile = { objects?: string[]; filters?: string[] };
  const shopify = loadJson<ShopifyObjectsFile>(join(DATA_DIR, 'shopify-objects.json'));
  if (shopify) {
    if (kb.checks.UndefinedObject) {
      kb.checks.UndefinedObject.shopify_objects = shopify.objects ?? [];
    }
    if (kb.checks.UnknownFilter) {
      kb.checks.UnknownFilter.shopify_filters = shopify.filters ?? [];
    }
  }

  kb.domains = loadYaml<Record<string, DomainDefinition>>(join(DATA_DIR, 'domain-gotchas.yml')) ?? {};
  kb.content_triggers = loadYaml<ContentTriggerDef[]>(join(DATA_DIR, 'content-triggers.yml')) ?? [];
  kb.language_features = loadYaml<Record<string, unknown>>(join(DATA_DIR, 'language-features.yml')) ?? {};
  kb.modules_missing_docs =
    loadJson<ModulesMissingDocs>(join(DATA_DIR, 'modules-missing-docs.json')) ?? { known: [] };

  return kb;
}

function load(): KnowledgeBase | null {
  if (_knowledge) return _knowledge;

  _knowledge = loadFromSplitFiles();
  if (!_knowledge) {
    // Monolithic-knowledge fallback (legacy layout).
    const jsonPath = join(DATA_DIR, 'knowledge.json');
    _knowledge = loadJson<KnowledgeBase>(jsonPath);
  }
  if (!_knowledge) return null;

  _shopifyObjects = new Set();
  _shopifyFilters = new Set();
  const uo = _knowledge.checks.UndefinedObject;
  if (uo?.shopify_objects) uo.shopify_objects.forEach((o) => _shopifyObjects!.add(o));
  const uf = _knowledge.checks.UnknownFilter;
  if (uf?.shopify_filters) uf.shopify_filters.forEach((f) => _shopifyFilters!.add(f));

  return _knowledge;
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Structured knowledge for a check: TL;DR summary + per-context hint.
 * Returns `null` when the check is unknown.
 */
export function getCheckKnowledge(
  checkName: string,
  context: string = 'default',
): CheckKnowledgeView | null {
  const kb = load();
  if (!kb?.checks?.[checkName]) return null;
  const check = kb.checks[checkName];
  const hint = check.hint?.[context] ?? check.hint?.default ?? null;
  const result: CheckKnowledgeView = { summary: check.summary, hint };
  if (check.shopify_guidance) result.shopify_guidance = check.shopify_guidance;
  return result;
}

/**
 * Evaluate domain gotchas against the current code state.
 *
 * `triggers` is a "what the current file looks like" snapshot: the set of
 * check names emitted so far, the Liquid tags used, the filters used.
 */
export function getTriggeredGotchas(
  domain: string,
  triggers: TriggerContext = {},
): TriggeredGotchasView | null {
  const kb = load();
  if (!kb?.domains?.[domain]) return null;
  const domainDef = kb.domains[domain];
  const checks = triggers.checks ?? new Set<string>();
  const tags = triggers.tags ?? new Set<string>();
  const filters = triggers.filters ?? new Set<string>();

  const matched: TriggeredGotchasView['gotchas'] = [];
  for (const g of domainDef.gotchas ?? []) {
    if (evaluateTrigger(g.trigger, checks, tags, filters)) {
      matched.push({ id: g.id, message: g.message, severity: g.severity });
    }
  }

  return { rule: domainDef.rule, gotchas: matched };
}

function evaluateTrigger(
  trigger: string | undefined,
  checks: Set<string>,
  tags: Set<string>,
  filters: Set<string>,
): boolean {
  if (!trigger) return false;
  if (trigger === 'always') return true;
  if (trigger.startsWith('has_check:')) return checks.has(trigger.slice('has_check:'.length));
  if (trigger.startsWith('uses_tag:')) return tags.has(trigger.slice('uses_tag:'.length));
  if (trigger.startsWith('uses_filter:')) return filters.has(trigger.slice('uses_filter:'.length));
  return false;
}

/** True if `name` is a Shopify-only object identifier. */
export function isShopifyObject(name: string): boolean {
  load();
  return _shopifyObjects?.has(name) ?? false;
}

/** True if `name` is a Shopify-only filter identifier. */
export function isShopifyFilter(name: string): boolean {
  load();
  return _shopifyFilters?.has(name) ?? false;
}

/** Migration guidance for a Shopify object reference, or `null` if unknown. */
export function getShopifyObject(name: string): ShopifyContaminationEntry | null {
  return loadShopifyContamination()?.objects?.[name] ?? null;
}

/** Migration guidance for a Shopify filter reference, or `null` if unknown. */
export function getShopifyFilter(name: string): ShopifyContaminationEntry | null {
  return loadShopifyContamination()?.filters?.[name] ?? null;
}

/** Migration guidance for a Shopify tag reference, or `null` if unknown. */
export function getShopifyTag(name: string): ShopifyContaminationEntry | null {
  return loadShopifyContamination()?.tags?.[name] ?? null;
}

/** Module paths whose missing `{% doc %}` blocks are known and suppressed. */
export function getKnownModulesMissingDocs(): Set<string> {
  const kb = load();
  return new Set(kb?.modules_missing_docs?.known ?? []);
}

/** Pattern-driven advisories matched against `content` for the given `domain`. */
export function getContentTriggers(content: string, domain: string): ContentTriggerHit[] {
  const kb = load();
  if (!kb?.content_triggers || !content || !domain) return [];

  const matched: ContentTriggerHit[] = [];
  for (const trigger of kb.content_triggers) {
    if (trigger.domains && !trigger.domains.includes(domain)) continue;
    try {
      if (new RegExp(trigger.pattern).test(content)) {
        matched.push({ id: trigger.id, message: trigger.message, severity: trigger.severity });
      }
    } catch {
      // Skip malformed patterns.
    }
  }

  return matched;
}

/** Reset all in-memory state. For tests only. */
export function _resetKnowledge(): void {
  _knowledge = null;
  _shopifyObjects = null;
  _shopifyFilters = null;
  _shopifyContamination = null;
}
