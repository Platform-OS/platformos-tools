import { UriString, CheckDefinition, Config } from './types';
import { Minimatch } from 'minimatch';
import { createBoundedCache } from './utils/bounded-cache';

/**
 * Compiled glob matchers, keyed by the (already transformed) pattern string.
 *
 * WHY. `isIgnored` is called once per file per check — `check()` runs it for every
 * (file, check) pair, and check-node's project loader runs it for every globbed path
 * (1686 on a real project). It used to call minimatch's FUNCTIONAL form,
 * `minimatch(uri, pattern)`, which constructs and compiles a `Minimatch` on every
 * single call: measured at 175 ms of a 211 ms `getApp`, i.e. 83% of it, and the
 * dominant per-request cost once parsing was made lazy (TASK-12.8).
 *
 * Compiling once per pattern is a pure win with nothing to invalidate: a matcher is
 * a function of its pattern string, so a changed config produces different pattern
 * strings and therefore different keys. Stale entries are impossible by
 * construction.
 *
 * Bounded because a long-lived process (the MCP supervisor, the language server) may
 * serve many projects, each contributing its own patterns. Real configs hold a
 * handful, so the cap is far above any legitimate working set.
 */
const compiledPatterns = createBoundedCache<Minimatch>(512);

/**
 * Transformed pattern lists, per `Config` object and per check.
 *
 * The three `replace` calls per pattern are cheap individually but were re-run on
 * every `isIgnored` call — thousands of times per request — for a result that depends
 * only on the config and the check. Keyed on the Config OBJECT rather than on a
 * derived string so the hot path does no key building at all: a lint run passes one
 * Config to every (file, check) pair, so this hits for all of them, and a later run
 * with a re-loaded Config simply gets a fresh entry. A `WeakMap` means eviction is
 * the garbage collector's job — there is nothing to invalidate and nothing to bound.
 */
const transformedPatterns = new WeakMap<Config, Map<string, string[]>>();

export function isIgnored(uri: UriString, config: Config, checkDef?: CheckDefinition): boolean {
  const rawPatterns = [...checkIgnorePatterns(checkDef, config), ...asArray(config.ignore)];
  if (rawPatterns.length === 0) return false;

  // Per-check patterns differ by check, so the check's code is the inner key.
  let perCheck = transformedPatterns.get(config);
  if (!perCheck) {
    perCheck = new Map();
    transformedPatterns.set(config, perCheck);
  }
  const checkCode = checkDef?.meta.code ?? '';
  let ignorePatterns = perCheck.get(checkCode);
  if (!ignorePatterns) {
    ignorePatterns = rawPatterns.map(
      (pattern) =>
        pattern
          .replace(/^\//, config.rootUri + '/') // "absolute patterns" are config.rootUri matches
          .replace(/^([^\/])/, '**/$1') // "relative patterns" are "**/${pattern}"
          .replace(/\/\*$/, '/**'), // "/*" patterns are really "/**"
    );
    perCheck.set(checkCode, ignorePatterns);
  }

  return ignorePatterns.some((pattern) =>
    compiledPatterns(pattern, () => new Minimatch(pattern)).match(uri),
  );
}

function checkIgnorePatterns(checkDef: CheckDefinition | undefined, config: Config) {
  if (!checkDef) return [];
  return asArray(config.settings[checkDef.meta.code]?.ignore);
}

function asArray<T>(x: T[] | undefined): T[] {
  return x ?? [];
}
