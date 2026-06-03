/**
 * Synchronous module call-path enumeration for rule-engine use.
 *
 * Rules run in a sync context inside `runRules`. The async
 * `module-scanner` (out of v1 scope) reads file contents; rules only
 * need filenames, so this helper does a fast sync filesystem walk and
 * returns the same `modules/<name>/<category>/<rest>` call-path shape.
 *
 * Walk layout:
 *   - Primary tree:  `modules/<name>/public/lib/<category>/**​/*.liquid`
 *   - Fallback tree: `modules/<name>/public/views/partials/lib/<category>/**​/*.liquid`
 *     (legacy modules park lib code under views/partials/lib/)
 *   - Plain partials at `modules/<name>/public/views/partials/<rest>` are
 *     additionally indexed under `partials`.
 *
 * Never throws — missing dirs / unreadable files yield `[]`.
 *
 * v1 trim: dropped `moduleCallPaths` (flat list helper) and `_internal`
 * (tests use the per-category form instead).
 */

import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const KNOWN_CATEGORIES = [
  'commands',
  'queries',
  'helpers',
  'validations',
  'events',
  'hooks',
  'partials',
] as const;
export type ModuleCategory = (typeof KNOWN_CATEGORIES)[number];

export type ModuleCallPathsByCategory = Record<ModuleCategory, string[]>;

/**
 * True iff `modules/<moduleName>` exists under `projectDir`.
 */
export function moduleInstalled(projectDir: string, moduleName: string): boolean {
  if (!projectDir || !moduleName) return false;
  return existsSync(join(projectDir, 'modules', moduleName));
}

/**
 * List installed module directory names. Returns `[]` if no modules dir.
 */
export function installedModules(projectDir: string): string[] {
  if (!projectDir) return [];
  const modulesDir = join(projectDir, 'modules');
  if (!existsSync(modulesDir)) return [];
  try {
    return readdirSync(modulesDir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort();
  } catch {
    return [];
  }
}

/**
 * Enumerate every callable path exported by `moduleName`, grouped by category.
 *
 * Result keys are exhaustive (every category in `KNOWN_CATEGORIES` appears
 * even when empty) so callers can iterate without `hasOwnProperty` dances.
 * Each string is a `modules/<moduleName>/<category>/<rest>` call path
 * (no leading slash, no `.liquid` extension).
 */
export function moduleCallPathsByCategory(
  projectDir: string,
  moduleName: string,
): ModuleCallPathsByCategory {
  const out = emptyByCategory();
  if (!moduleInstalled(projectDir, moduleName)) return out;

  const publicDir = join(projectDir, 'modules', moduleName, 'public');
  const libDir = join(publicDir, 'lib');
  const partialsLibDir = join(publicDir, 'views', 'partials', 'lib');
  const partialsDir = join(publicDir, 'views', 'partials');

  if (existsSync(libDir)) {
    walkLib(libDir, (rel, category) => {
      out[category].push(`modules/${moduleName}/${category}/${rel}`);
    });
  }

  if (existsSync(partialsLibDir)) {
    walkLib(partialsLibDir, (rel, category) => {
      const callPath = `modules/${moduleName}/${category}/${rel}`;
      if (!out[category].includes(callPath)) out[category].push(callPath);
    });
  }

  // Plain partials under views/partials/ that don't live in the lib/ subtree
  // are still legitimate render targets.
  if (existsSync(partialsDir)) {
    walkLiquid(partialsDir, '', (rel) => {
      if (rel.startsWith('lib/')) return; // already classified above
      const callPath = `modules/${moduleName}/${rel}`;
      if (!out.partials.includes(callPath)) out.partials.push(callPath);
    });
  }

  for (const k of KNOWN_CATEGORIES) out[k].sort();
  return out;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function emptyByCategory(): ModuleCallPathsByCategory {
  const out = {} as ModuleCallPathsByCategory;
  for (const c of KNOWN_CATEGORIES) out[c] = [];
  return out;
}

function classifyLibFirstSegment(first: string): ModuleCategory {
  const known = (KNOWN_CATEGORIES as ReadonlyArray<string>).includes(first);
  if (known && first !== 'partials') return first as ModuleCategory;
  return 'partials';
}

type LibEmit = (rel: string, category: ModuleCategory) => void;

function walkLib(libRoot: string, emit: LibEmit): void {
  // First-level directory = category; deeper structure becomes the call path.
  let entries;
  try {
    entries = readdirSync(libRoot, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const category = classifyLibFirstSegment(entry.name);
    walkLiquid(join(libRoot, entry.name), '', (rel) => emit(rel, category));
  }
}

function walkLiquid(dir: string, prefix: string, emit: (rel: string) => void): void {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const next = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      walkLiquid(join(dir, entry.name), next, emit);
    } else if (entry.isFile() && entry.name.endsWith('.liquid')) {
      emit(next.replace(/\.liquid$/, ''));
    }
  }
}
