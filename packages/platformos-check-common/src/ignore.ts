import { UriString, CheckDefinition, Config } from './types';
import { Minimatch } from 'minimatch';

/**
 * The compiled ignore matchers of a config, keyed by the check they belong to.
 *
 * A `Config` is immutable for the life of a run, so its patterns can be rewritten
 * and compiled once and then matched against every path. Doing it per CALL is what
 * made this the most expensive part of `getApp` on a project that configures
 * `ignore`: `getAppFilePaths` asks about every globbed path and `check()` asks
 * again per file per check, and each ask re-ran three regex replaces per pattern
 * and built a fresh `Minimatch` — 140-232 ms of a 207-267 ms `getApp` on
 * pos-module-community (1558 candidate paths, 13 patterns).
 *
 * Keyed weakly on the config object, so a config that goes away takes its matchers
 * with it and a new config compiles its own.
 */
const matchersByConfig = new WeakMap<Config, Map<string | symbol, Minimatch[]>>();

/** The key for the check-less variant, which sees the global `ignore` only. */
const GLOBAL = Symbol('global ignore');

export function isIgnored(uri: UriString, config: Config, checkDef?: CheckDefinition): boolean {
  return matchers(config, checkDef).some((matcher) => matcher.match(uri));
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
  return pattern
    .replace(/^\//, rootUri + '/') // "absolute patterns" are config.rootUri matches
    .replace(/^([^\/])/, '**/$1') // "relative patterns" are "**/${pattern}"
    .replace(/\/\*$/, '/**'); // "/*" patterns are really "/**"
}

function checkIgnorePatterns(checkDef: CheckDefinition | undefined, config: Config) {
  if (!checkDef) return [];
  return asArray(config.settings[checkDef.meta.code]?.ignore);
}

function asArray<T>(x: T[] | undefined): T[] {
  return x ?? [];
}
