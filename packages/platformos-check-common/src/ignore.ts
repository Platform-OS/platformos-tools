import { uriFromPathOrUri } from '@platformos/platformos-common';
import { normalize } from './path';
import { CheckDefinition, Config } from './types';
import { Minimatch } from 'minimatch';

/**
 * The compiled ignore matchers of a config, keyed by the check they belong to.
 *
 * A `Config` is immutable for the life of a run, so its patterns are rewritten and compiled
 * once and then matched against every path. Doing it per CALL made this the most expensive part
 * of `getApp` on a project that configures `ignore` — 140-232 ms of a 207-267 ms `getApp` on a
 * real project — because every ask re-ran three regex replaces per pattern and built a fresh
 * `Minimatch`.
 *
 * Keyed weakly on the config object, so a config that goes away takes its matchers with it.
 */
const matchersByConfig = new WeakMap<Config, Map<string | symbol, Minimatch[]>>();

/** The key for the check-less variant, which sees the global `ignore` only. */
const GLOBAL = Symbol('global ignore');

/**
 * The global verdict per subject, per config — the answer that does not depend on which check
 * is asking, so it is remembered once per file rather than once per (file, check).
 *
 * Keyed on the subject AS SPELLED, since canonicalizing is the cost being avoided: two
 * spellings of one file get two entries holding the same answer.
 */
const globalVerdictByConfig = new WeakMap<Config, Map<string, boolean>>();

/**
 * Whether `config` ignores the file — however the caller spells it.
 *
 * `uriFromPathOrUri` puts the subject in the normalized-URI spelling the patterns are
 * rewritten against (`rewrite` anchors patterns on `config.rootUri`, a URI), so
 * a `file://` URI, a percent-encoded URI, and a raw filesystem path all get ONE answer —
 * `file:///c%3A/project/x.liquid` and `c:/project/x.liquid` are otherwise different
 * strings, and "which files are ignored" must not depend on who asked.
 */
export function isIgnored(pathOrUri: string, config: Config, checkDef?: CheckDefinition): boolean {
  // Matching one list is an OR, so consulting the global half first cannot change the
  // answer — only how often each half is evaluated.
  if (globalVerdict(config, pathOrUri)) return true;

  const own = ownMatchers(config, checkDef);
  if (own.length === 0) return false;

  const subject = uriFromPathOrUri(pathOrUri);
  return own.some((matcher) => matcher.match(subject));
}

/** Whether the config's own `ignore` — the part no check can change — covers this file. */
function globalVerdict(config: Config, pathOrUri: string): boolean {
  const compiled = globalMatchers(config);
  // No patterns — the common case — means nothing to remember and no subject to canonicalize.
  if (compiled.length === 0) return false;

  let bySubject = globalVerdictByConfig.get(config);
  if (!bySubject) {
    bySubject = new Map();
    globalVerdictByConfig.set(config, bySubject);
  }

  let verdict = bySubject.get(pathOrUri);
  if (verdict === undefined) {
    const subject = uriFromPathOrUri(pathOrUri);
    verdict = compiled.some((matcher) => matcher.match(subject));
    bySubject.set(pathOrUri, verdict);
  }
  return verdict;
}

/**
 * Whether `config` ignores anything at all, so a caller can skip the work of
 * PRODUCING paths to ask about.
 *
 * Most projects configure no `ignore`, and check-node converts every one of a
 * project's URIs to a filesystem path before asking — 4 ms per `getApp` on a
 * 3139-file project, all of it to be told there is nothing to match against.
 */
export function hasIgnorePatterns(config: Config, checkDef?: CheckDefinition): boolean {
  return globalMatchers(config).length > 0 || ownMatchers(config, checkDef).length > 0;
}

/** The config's global `ignore`, compiled once per config. */
function globalMatchers(config: Config): Minimatch[] {
  return compiled(config, GLOBAL, asArray(config.ignore));
}

/**
 * The patterns `checkDef` configures FOR ITSELF, compiled once per (config, check) — the
 * global ones are never concatenated onto these, or they would be compiled and matched once
 * per check. `ignore.spec.ts` pins the exact set of `Minimatch` constructions.
 */
function ownMatchers(config: Config, checkDef?: CheckDefinition): Minimatch[] {
  if (!checkDef) return [];
  return compiled(config, checkDef.meta.code, checkIgnorePatterns(checkDef, config));
}

function compiled(config: Config, key: string | symbol, patterns: string[]): Minimatch[] {
  let byCheck = matchersByConfig.get(config);
  if (!byCheck) {
    byCheck = new Map();
    matchersByConfig.set(config, byCheck);
  }

  let matchers = byCheck.get(key);
  if (!matchers) {
    matchers = patterns
      // A BLANK OR NON-STRING ENTRY IS SKIPPED, and must not take the valid ones with it: a
      // blank rewrites to a pattern matching every file, and a YAML `null` from a bare `-`
      // reaches `.startsWith` and throws. `.gitignore` skips a blank line too — verified
      // against git, which still applies the surrounding patterns.
      .filter((pattern) => typeof pattern === 'string' && pattern !== '')
      .map((pattern) => rewrite(pattern, config.rootUri))
      .map((pattern) => new Minimatch(pattern));
    byCheck.set(key, matchers);
  }

  return matchers;
}

/**
 * The minimatch pattern `pattern` means, in the spelling the subject is canonicalized to.
 *
 * `.gitignore` semantics, because a `.platformos-check.yml` reads like one: a slash anywhere
 * but the very end ANCHORS the pattern to the project root, and a bare name matches at any
 * depth. `modules/user/**` is how the docs tell you to drop a vendored module, and anchoring
 * is the only reading under which that does not ALSO silence the first-party
 * `app/modules/user` — a suppression nothing reports, because an ignored file produces no
 * offense to notice.
 */
function rewrite(pattern: string, rootUri: string): string {
  // The root is normalized to the same spelling `isIgnored` puts the subject in, so an
  // anchored pattern and its subject cannot diverge on the root's spelling.
  if (pattern.startsWith('/')) return normalize(rootUri) + widen(pattern);
  if (isAnchored(pattern)) return `${normalize(rootUri)}/${widen(pattern)}`;
  return anyDepth(pattern);
}

/** A slash anywhere but the very end anchors the pattern, exactly as `.gitignore` does. */
function isAnchored(pattern: string): boolean {
  return trimTrailingSlash(pattern).includes('/');
}

/** `foo/` and `foo/*` both mean everything under `foo`. */
function widen(pattern: string): string {
  return pattern.replace(/\/\*?$/, '/**');
}

/**
 * A bare name matches at any depth — and has to cover what is INSIDE it as well as a file
 * of that name, since the subject is always a file: `node_modules` must reach
 * `some-library/node_modules/foo.liquid`, which `**\/node_modules` alone never does.
 */
function anyDepth(pattern: string): string {
  return `**/${trimTrailingSlash(pattern)}{,/**}`;
}

/**
 * Scanned rather than `replace(/\/+$/, '')`, which CodeQL reports as polynomial ReDoS.
 * MEASURED, the report is wrong on V8: an end-anchored quantifier does not retry from every
 * `/`, and a subject of 1.6M slashes costs 1.3 ms. The scan is linear without depending on
 * that optimization, which is the only reason to prefer it.
 */
function trimTrailingSlash(pattern: string): string {
  let end = pattern.length;
  while (end > 0 && pattern[end - 1] === '/') end--;
  return end === pattern.length ? pattern : pattern.slice(0, end);
}

function checkIgnorePatterns(checkDef: CheckDefinition | undefined, config: Config) {
  if (!checkDef) return [];
  return asArray(config.settings[checkDef.meta.code]?.ignore);
}

function asArray<T>(x: T[] | undefined): T[] {
  return x ?? [];
}
