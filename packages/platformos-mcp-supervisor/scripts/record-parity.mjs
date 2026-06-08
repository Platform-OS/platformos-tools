#!/usr/bin/env node
/**
 * Capture pos-supervisor's `validate_code` output for every parity-corpus
 * entry (P24 acceptance gate) and save a normalised snapshot per entry as
 * `test/fixtures/parity/<id>.expected.json`.
 *
 * The recorder boots the SOURCE supervisor (`<repo-root>/bin/pos-supervisor.js`)
 * under Bun against a copy of the migrated fixture project (so the
 * pos-supervisor analytics/session dirs land in a tmp scratch dir, not the
 * package), waits for both HTTP + LSP to be ready, runs the corpus, and
 * normalises each response with the same function the parity spec uses on
 * the v1 side. Run this ONCE manually (when the source contract changes);
 * the spec just reads the captured JSON.
 *
 * Usage:
 *   yarn workspace @platformos/platformos-mcp-supervisor build:ts   # ensure dist exists for cleanup hooks
 *   node packages/platformos-mcp-supervisor/scripts/record-parity.mjs
 *
 * Requires:
 *   - `bun` on PATH (pos-supervisor's runtime)
 *   - `pos-cli` on PATH (source's LSP)
 *   - source repo at `<destination-pkg>/../../../../` — i.e. the migration
 *     happens inside the source tree, so `../../../..` reaches the source
 *     repo root from the package directory.
 */

import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, cpSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = resolve(__dirname, '..');
// `<pkg>` → `..` (packages/) → `../..` (platformos-tools/) → `../../..` (pos-mcp/).
const SOURCE_REPO_ROOT = resolve(PACKAGE_ROOT, '..', '..', '..');
const SOURCE_BIN = join(SOURCE_REPO_ROOT, 'bin', 'pos-supervisor.js');
const FIXTURE_SRC = join(PACKAGE_ROOT, 'test', 'fixtures', 'project');
const SNAPSHOT_DIR = join(PACKAGE_ROOT, 'test', 'fixtures', 'parity');

if (!existsSync(SOURCE_BIN)) {
  console.error(`record-parity: source bin not found at ${SOURCE_BIN}`);
  process.exit(2);
}

// ── Load the corpus via dynamic import (TS via Bun's resolver). ──────────
//
// `corpus.ts` is plain TS — we feed it to Node via a child process running
// `bun` so we don't need to set up TS resolution in this script. Simpler:
// the corpus is small + stable, mirror it as a JS literal at the bottom
// of this file instead of importing TS at runtime.
import { CORPUS } from './_parity-corpus.mjs';

if (!Array.isArray(CORPUS) || CORPUS.length === 0) {
  console.error('record-parity: corpus is empty');
  process.exit(2);
}

console.error(`record-parity: ${CORPUS.length} entries to capture`);

// ── Build a writable copy of the fixture so the source's analytics dirs
//    don't poison the read-only test/fixtures/project tree. ─────────────
const tmpDir = mkdtempSync(join(tmpdir(), 'mcp-parity-record-'));
const projectDir = join(tmpDir, 'project');
cpSync(FIXTURE_SRC, projectDir, { recursive: true });
console.error(`record-parity: source project copy at ${projectDir}`);

// Random port to avoid colliding with another running supervisor.
const port = 14000 + Math.floor(Math.random() * 500);

const proc = spawn('bun', [SOURCE_BIN], {
  stdio: ['pipe', 'pipe', 'pipe'],
  env: {
    ...process.env,
    POS_SUPERVISOR_HTTP_PORT: String(port),
    POS_SUPERVISOR_PROJECT_DIR: projectDir,
  },
});

let stderrBuf = '';
proc.stderr.on('data', (chunk) => {
  const text = chunk.toString();
  stderrBuf += text;
  for (const line of text.split('\n')) {
    if (line) process.stderr.write(`  ↳ [source] ${line}\n`);
  }
});

// MCP handshake so the stdio transport doesn't bail.
proc.stdin.write(
  `${JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'recorder', version: '1.0' } },
  })}\n`,
);
proc.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);

// Wait for HTTP + LSP terminal state.
const lspTerminalRe =
  /(LSP ready|LSP init failed|LSP warm-up failed|pos-cli not found — static tools only|Neither pos-cli nor Node\.js found|pos-cli at .* but no Node\.js interpreter found)/;

await new Promise((resolveBoot, rejectBoot) => {
  let httpUp = false;
  let lspSettled = false;
  function maybe() {
    if (httpUp && lspSettled) resolveBoot();
  }
  proc.stderr.on('data', () => {
    if (!httpUp && stderrBuf.includes('HTTP server listening')) {
      httpUp = true;
      maybe();
    }
    if (!lspSettled && lspTerminalRe.test(stderrBuf)) {
      lspSettled = true;
      maybe();
    }
  });
  setTimeout(() => rejectBoot(new Error(`source server boot timeout (httpUp=${httpUp}, lspSettled=${lspSettled})`)), 90_000);
});

console.error('record-parity: source server ready');

// ── Capture loop ───────────────────────────────────────────────────────────

mkdirSync(SNAPSHOT_DIR, { recursive: true });

let failures = 0;
for (const entry of CORPUS) {
  console.error(`record-parity: ${entry.id}…`);
  try {
    const res = await fetch(`http://localhost:${port}/call`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tool: 'validate_code',
        params: { file_path: entry.filePath, content: entry.content, mode: entry.mode },
      }),
    });
    const body = await res.json();
    if (!res.ok || !body.result) {
      throw new Error(`HTTP ${res.status}: ${body.error ?? '(no body)'}`);
    }
    const normalised = normaliseResult(body.result);
    const out = {
      id: entry.id,
      filePath: entry.filePath,
      mode: entry.mode,
      description: entry.description,
      result: normalised,
    };
    writeFileSync(
      join(SNAPSHOT_DIR, `${entry.id}.expected.json`),
      `${JSON.stringify(out, null, 2)}\n`,
      'utf8',
    );
  } catch (e) {
    console.error(`  ✗ ${entry.id}: ${e instanceof Error ? e.message : String(e)}`);
    failures++;
  }
}

// ── Shutdown source ────────────────────────────────────────────────────────

try {
  proc.stdin.end();
  proc.kill('SIGTERM');
  await new Promise((r) => setTimeout(r, 200));
} catch {
  /* already dead */
}

rmSync(tmpDir, { recursive: true, force: true });

if (failures > 0) {
  console.error(`record-parity: FAILED (${failures} entries did not record)`);
  process.exit(1);
}

console.error(`record-parity: PASS (${CORPUS.length} snapshots → ${SNAPSHOT_DIR})`);

// ── Normalisation (shared with the parity spec) ────────────────────────────

function normaliseResult(result) {
  const stripDiag = (d) => {
    const out = {};
    // Drop analytics / pending / CAC / debug-only fields.
    const DROP = new Set([
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
    for (const [k, v] of Object.entries(d)) {
      if (DROP.has(k) || k.startsWith('_')) continue;
      out[k] = v;
    }
    if (typeof out.confidence === 'number') out.confidence = Number(out.confidence.toFixed(3));
    if (Array.isArray(out.fixes)) out.fixes = out.fixes.map(stripFix);
    if (out.fix) out.fix = stripFix(out.fix);
    return out;
  };
  const stripFix = (f) => {
    const out = {};
    for (const [k, v] of Object.entries(f)) {
      if (k === '_source' || k.startsWith('_')) continue;
      out[k] = v;
    }
    return out;
  };
  // Keep this set in lockstep with `CROSS_PLATFORM_DIVERGENT_LSP_CHECKS`
  // in `test/parity/validate-code-parity.spec.ts`. Both sides must drop
  // the same upstream-LSP cross-file checks; otherwise re-recorded
  // snapshots would carry findings the spec strips at compare time and
  // every parity entry would diverge.
  const CROSS_PLATFORM_DIVERGENT = new Set(['MatchingTranslations']);
  const sortDiags = (arr) =>
    [...(arr ?? [])]
      .filter((d) => typeof d?.check !== 'string' || !CROSS_PLATFORM_DIVERGENT.has(d.check))
      .map(stripDiag)
      .sort((a, b) => {
        const k = (a.check ?? '').localeCompare(b.check ?? '');
        if (k) return k;
        const l = (a.line ?? -1) - (b.line ?? -1);
        if (l) return l;
        const c = (a.column ?? -1) - (b.column ?? -1);
        if (c) return c;
        return (a.message ?? '').localeCompare(b.message ?? '');
      });

  const out = {
    status: result.status ?? null,
    must_fix_before_write: result.must_fix_before_write ?? null,
    errors: sortDiags(result.errors),
    warnings: sortDiags(result.warnings),
    infos: sortDiags(result.infos),
    proposed_fixes: (result.proposed_fixes ?? []).map(stripFix),
    clusters: result.clusters ?? [],
    scorecard: result.scorecard ?? [],
    tips: result.tips ?? [],
    domain_guide: result.domain_guide ?? null,
    structural: result.structural ?? null,
    parse_error: result.parse_error ?? null,
    next_step: result.next_step ?? null,
  };
  return out;
}
