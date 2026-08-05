import { uriFromPathOrUri } from '@platformos/platformos-common';
import { normalize } from './path';
import { CheckDefinition, Config } from './types';
import { Minimatch } from 'minimatch';

/**
 * The compiled ignore matchers of a config, keyed by the check they belong to.
 *
 * A `Config` is immutable for the life of a run, so its patterns can be rewritten
 * and compiled once and then matched against every path. Doing it per CALL is what
 * made this the most expensive part of `getApp` on a project that configures
 * `ignore`: `getAppFilePaths` asks about every globbed path and `check()` asks
 * again per file per check, and each ask re-ran three regex replaces per pattern
 * and built a fresh `Minimatch` — 140-232 ms of a 207-267 ms `getApp` on a real
 * project (1558 candidate paths, 13 patterns).
 *
 * Keyed weakly on the config object, so a config that goes away takes its matchers
 * with it and a new config compiles its own.
 */
const matchersByConfig = new WeakMap<Config, Map<string | symbol, Minimatch[]>>();

/** The key for the check-less variant, which sees the global `ignore` only. */
const GLOBAL = Symbol('global ignore');

/**
 * Whether `config` ignores the file — however the caller spells it.
 *
 * `uriFromPathOrUri` puts the subject in the normalized-URI spelling the patterns are
 * rewritten against (`rewrite` anchors absolute patterns on `config.rootUri`, a URI), so
 * a `file://` URI, a percent-encoded URI, and a raw filesystem path all get ONE answer —
 * `file:///c%3A/project/x.liquid` and `c:/project/x.liquid` are otherwise different
 * strings, and "which files are ignored" must not depend on who asked.
 */
export function isIgnored(pathOrUri: string, config: Config, checkDef?: CheckDefinition): boolean {
  const subject = uriFromPathOrUri(pathOrUri);
  return matchers(config, checkDef).some((matcher) => matcher.match(subject));
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
  return matchers(config, checkDef).length > 0;
}

function matchers(config: Config, checkDef?: CheckDefinition): Minimatch[] {
  let byCheck = matchersByConfig.get(config);
  if (!byCheck) {
    byCheck = new Map();
    matchersByConfig.set(config, byCheck);
  }

  const key = checkDef?.meta.code ?? GLOBAL;
  let compiled = byCheck.get(key);
  if (!compiled) {
    compiled = [...checkIgnorePatterns(checkDef, config), ...asArray(config.ignore)]
      .map((pattern) => rewrite(pattern, config.rootUri))
      .map((pattern) => new Minimatch(pattern));
    byCheck.set(key, compiled);
  }

  return compiled;
}

function rewrite(pattern: string, rootUri: string): string {
  return (
    pattern
      // "absolute patterns" are config.rootUri matches. The root is normalized to
      // the same spelling `canonicalSubject` puts the subject in, so an anchored
      // pattern and its subject cannot diverge on the root's spelling.
      .replace(/^\//, normalize(rootUri) + '/')
      .replace(/^([^\/])/, '**/$1') // "relative patterns" are "**/${pattern}"
      .replace(/\/\*$/, '/**')
  ); // "/*" patterns are really "/**"
}

function checkIgnorePatterns(checkDef: CheckDefinition | undefined, config: Config) {
  if (!checkDef) return [];
  return asArray(config.settings[checkDef.meta.code]?.ignore);
}

function asArray<T>(x: T[] | undefined): T[] {
  return x ?? [];
}
