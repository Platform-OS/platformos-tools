/**
 * Asset index — a snapshot of every file under `app/assets/`, keyed by both
 * full relative path and by basename.
 *
 * Purpose: the LSP's `MissingAsset` check has a chronic false-positive rate
 * for two reasons that both reduce to "the LSP's asset picture disagrees
 * with the real filesystem":
 *
 *   1. Persistence of absence. The LSP may report an asset missing right
 *      after the file is written — its internal asset cache doesn't pick up
 *      new files on disk until a re-index. Agents see `MissingAsset` for a
 *      path they can literally `read()` and stop trusting linter output.
 *   2. Path-prefix ambiguity. `asset_url` takes a path relative to
 *      `app/assets/` and the directory layout (`styles/`, `scripts/`,
 *      `images/`) must be part of that path. Agents often write
 *      `{{ 'logo.png' | asset_url }}` expecting a flat root when the file
 *      actually lives at `app/assets/images/logo.png`. The LSP reports
 *      `MissingAsset` but gives no hint about where the file actually is.
 *
 * This module lets the diagnostic pipeline (a) verify `MissingAsset` against
 * the real filesystem and suppress verified false positives, and (b) when a
 * path truly is wrong, look up the real nested path by basename and give
 * the agent a concrete "use this path instead" suggestion.
 *
 * The walker is deliberately scoped to `app/assets/` so we don't pay to scan
 * the whole project. On a large tree this is a few ms of sync I/O per
 * `validate_code` call; cheaper and more correct than trying to cache across
 * calls — files get added/removed during a session.
 */

import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import normalize from 'normalize-path';

const ASSETS_SUBDIR = 'app/assets';

export interface AssetIndex {
  /** Every file's relative path from the assets root, forward-slashed. */
  paths: Set<string>;
  /** Map<basename, list of relative paths> for "did you mean?" lookups. */
  basenames: Map<string, string[]>;
}

export type AssetResolution =
  | { status: 'exists' }
  | { status: 'renamed'; suggestion: string }
  | { status: 'ambiguous'; suggestions: string[] }
  | { status: 'missing' };

/**
 * Walk `projectDir/app/assets/` recursively.
 *
 * Missing or unreadable directories yield an empty index — callers must
 * treat an empty index as "no suppression possible, fall through to LSP".
 */
export function buildAssetIndex(projectDir: string): AssetIndex {
  const paths = new Set<string>();
  const basenames = new Map<string, string[]>();

  if (!projectDir) return { paths, basenames };
  const rootAbs = join(projectDir, ASSETS_SUBDIR);
  if (!existsSync(rootAbs)) return { paths, basenames };

  const stack: string[] = [rootAbs];
  while (stack.length > 0) {
    const dir = stack.pop()!;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const abs = join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(abs);
        continue;
      }
      // Symlinks and anything else: skip — deploy syncs real files only.
      if (!entry.isFile()) {
        let stat;
        try {
          stat = statSync(abs);
        } catch {
          continue;
        }
        if (!stat.isFile()) continue;
      }

      const rel = normalize(relative(rootAbs, abs));
      paths.add(rel);

      const bn = entry.name;
      const existing = basenames.get(bn);
      if (existing) existing.push(rel);
      else basenames.set(bn, [rel]);
    }
  }

  return { paths, basenames };
}

/**
 * Normalise whatever the LSP reported into a path relative to `app/assets/`.
 *
 * The LSP quotes the literal string the template used, so agents commonly
 * submit absolute-looking forms too:
 *   - `"styles/app.css"`         — already correct
 *   - `"/styles/app.css"`        — leading slash
 *   - `"assets/styles/app.css"`  — prefixed with the directory
 *   - `"/assets/styles/app.css"` — both
 *   - `"app/assets/styles/..."`  — full repo-relative (rare, but seen)
 *
 * Each form is stripped so downstream can compare against the index set.
 */
export function normalizeAssetPath(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null;
  let p = raw.trim();
  if (p.length === 0) return null;
  while (p.startsWith('/')) p = p.slice(1);
  if (p.startsWith('app/assets/')) p = p.slice('app/assets/'.length);
  else if (p.startsWith('assets/')) p = p.slice('assets/'.length);
  return p;
}

/**
 * Look up a reported asset path against the index.
 *
 *   - `exists`    — file is real; suppress diagnostic.
 *   - `renamed`   — file exists under a different nested path (typical
 *                   prefix-ambiguity case); suggest the nested path.
 *   - `ambiguous` — basename matches multiple files; don't suppress, but
 *                   surface the candidates.
 *   - `missing`   — no match; diagnostic stands.
 */
export function resolveAssetPath(rawPath: string | null | undefined, index: AssetIndex): AssetResolution {
  const p = normalizeAssetPath(rawPath);
  if (!p) return { status: 'missing' };
  if (index.paths.has(p)) return { status: 'exists' };

  const bn = p.split('/').pop() ?? '';
  const matches = index.basenames.get(bn) ?? [];
  if (matches.length === 1) {
    return { status: 'renamed', suggestion: matches[0] };
  }
  if (matches.length > 1) {
    return { status: 'ambiguous', suggestions: matches.slice(0, 5) };
  }
  return { status: 'missing' };
}
