/**
 * Parity acceptance gate — every corpus entry runs through v1's
 * `validate_code` and its normalised output is deep-equal'd against the
 * pre-captured pos-supervisor snapshot in `test/fixtures/parity/<id>.expected.json`.
 *
 * The snapshots were captured by `scripts/record-parity.mjs` against the
 * live source supervisor (HTTP transport, Bun runtime, real pos-cli LSP)
 * and normalised with the SAME function used here. Re-run the recorder
 * any time the source contract changes; this spec is read-only against
 * the captured baselines.
 *
 * **Normalisation** (applied to both sides before comparison):
 *
 *   - Sort `errors` / `warnings` / `infos` by `(check, line, column, message)`.
 *   - Strip per-diagnostic analytics / pending / CAC fields:
 *     `fingerprint`, `template_fp`, `fp`, `content_hash`, `hint_md_hash`,
 *     `hint_rule_id`, `params`, plus any field starting with `_`.
 *   - Strip per-fix internal fields starting with `_`.
 *   - Round numeric `confidence` to 3 decimals.
 *
 * **Permanent v1 strips** documented at the file's tail: fields the v1
 * surface does not emit at all (analytics, pending, CAC, fingerprint).
 *
 * Failures here are P0. A spec failure indicates a behavioural drift
 * between the source and v1 surfaces; either:
 *   - the v1 implementation regressed → fix v1
 *   - the source moved and we accepted the move → re-run the recorder
 *   - a tolerated divergence needs documenting → extend the normaliser
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  startSupervisor,
  FIXTURE_PROJECT_DIR,
  createTempProject,
  type SupervisorHandle,
} from '../helpers/server';
import type { ValidateCodeResult } from '../../src/tools/validate-code';
import { CORPUS, type CorpusEntry } from '../fixtures/parity/corpus';

const BOOT_TIMEOUT_MS = 30_000;
const CALL_TIMEOUT_MS = 15_000;

const __dirname = dirname(fileURLToPath(import.meta.url));
const SNAPSHOT_DIR = resolve(__dirname, '..', 'fixtures', 'parity');

let supervisor: SupervisorHandle;
let tempProject: { dir: string; cleanup: () => void };

beforeAll(async () => {
  // Use a writable copy of the fixture so v1's LSP doesn't poison the
  // read-only test/fixtures/project tree, mirroring what the recorder did
  // on the source side.
  tempProject = createTempProject(FIXTURE_PROJECT_DIR);
  supervisor = await startSupervisor(tempProject.dir, { timeoutMs: BOOT_TIMEOUT_MS });
}, BOOT_TIMEOUT_MS + 5_000);

afterAll(async () => {
  await supervisor?.stop();
  tempProject?.cleanup();
});

interface ExpectedSnapshot {
  id: string;
  filePath: string;
  mode: 'full' | 'quick';
  description?: string;
  result: NormalisedResult;
}

interface NormalisedResult {
  status: string | null;
  must_fix_before_write: boolean | null;
  errors: NormalisedDiag[];
  warnings: NormalisedDiag[];
  infos: NormalisedDiag[];
  proposed_fixes: Record<string, unknown>[];
  clusters: unknown[];
  scorecard: unknown[];
  tips: unknown[];
  domain_guide: unknown;
  structural: unknown;
  parse_error: string | null;
  next_step: string | null;
}

type NormalisedDiag = Record<string, unknown>;

// ── Normaliser shared with the recorder ─────────────────────────────────────

const DROP_KEYS: ReadonlySet<string> = new Set([
  'fingerprint',
  'template_fp',
  'fp',
  'content_hash',
  'hint_md_hash',
  'hint_rule_id',
  'params',
  '_filePath',
  '_origIdx',
  '_origType',
  '_source',
  '_pipelineTrace',
]);

function stripFix(fix: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fix)) {
    if (k === '_source' || k.startsWith('_')) continue;
    out[k] = v;
  }
  return out;
}

function stripDiag(d: Record<string, unknown>): NormalisedDiag {
  const out: NormalisedDiag = {};
  for (const [k, v] of Object.entries(d)) {
    if (DROP_KEYS.has(k) || k.startsWith('_')) continue;
    out[k] = v;
  }
  if (typeof out.confidence === 'number') {
    out.confidence = Number((out.confidence as number).toFixed(3));
  }
  if (Array.isArray(out.fixes)) {
    out.fixes = (out.fixes as Record<string, unknown>[]).map(stripFix);
  }
  if (out.fix && typeof out.fix === 'object') {
    out.fix = stripFix(out.fix as Record<string, unknown>);
  }
  return out;
}

function sortDiags(arr: unknown[] | undefined): NormalisedDiag[] {
  return [...(arr ?? [])].map((d) => stripDiag(d as Record<string, unknown>)).sort((a, b) => {
    const k = String(a.check ?? '').localeCompare(String(b.check ?? ''));
    if (k) return k;
    const l = ((a.line as number) ?? -1) - ((b.line as number) ?? -1);
    if (l) return l;
    const c = ((a.column as number) ?? -1) - ((b.column as number) ?? -1);
    if (c) return c;
    return String(a.message ?? '').localeCompare(String(b.message ?? ''));
  });
}

function normaliseResult(result: ValidateCodeResult): NormalisedResult {
  return {
    status: result.status ?? null,
    must_fix_before_write: result.must_fix_before_write ?? null,
    errors: sortDiags(result.errors),
    warnings: sortDiags(result.warnings),
    infos: sortDiags(result.infos),
    proposed_fixes: (result.proposed_fixes ?? []).map((f) => stripFix(f as unknown as Record<string, unknown>)),
    clusters: result.clusters ?? [],
    scorecard: result.scorecard ?? [],
    tips: result.tips ?? [],
    domain_guide: result.domain_guide ?? null,
    structural: result.structural ?? null,
    parse_error: result.parse_error ?? null,
    next_step: result.next_step ?? null,
  };
}

function loadSnapshot(id: string): ExpectedSnapshot {
  const path = join(SNAPSHOT_DIR, `${id}.expected.json`);
  return JSON.parse(readFileSync(path, 'utf8')) as ExpectedSnapshot;
}

// ── Coverage sanity (matches the spec to the snapshot dir) ──────────────────

describe('parity corpus structure', () => {
  it('every captured snapshot belongs to a corpus entry', () => {
    const ids = new Set(CORPUS.map((e: CorpusEntry) => e.id));
    const snapshots = readdirSync(SNAPSHOT_DIR)
      .filter((f) => f.endsWith('.expected.json'))
      .map((f) => f.replace(/\.expected\.json$/, ''));
    const stray = snapshots.filter((s) => !ids.has(s));
    expect(stray).toEqual([]);
  });

  it('every corpus entry has a captured snapshot', () => {
    for (const entry of CORPUS) {
      expect(() => loadSnapshot(entry.id)).not.toThrow();
    }
  });

  it('corpus has 10–15 entries (acceptance #1)', () => {
    expect(CORPUS.length).toBeGreaterThanOrEqual(10);
    expect(CORPUS.length).toBeLessThanOrEqual(15);
  });
});

// ── Per-entry parity assertions ──────────────────────────────────────────────

describe('parity: validate_code output matches pos-supervisor', () => {
  for (const entry of CORPUS) {
    it(
      `${entry.id} — ${entry.description}`,
      async () => {
        const expected = loadSnapshot(entry.id);
        const raw = await supervisor.callTool<ValidateCodeResult>('validate_code', {
          file_path: entry.filePath,
          content: entry.content,
          mode: entry.mode,
        });
        const actual = normaliseResult(raw);
        expect(actual).toEqual(expected.result);
      },
      CALL_TIMEOUT_MS,
    );
  }
});
