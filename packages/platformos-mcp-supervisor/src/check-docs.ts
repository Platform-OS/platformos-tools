/**
 * What a check MEANS and where to read more — derived from check-common's registry.
 *
 * THE SUPERVISOR AUTHORS NO DOCUMENTATION (ARCHITECTURE.md §Invariants). It may describe
 * itself — its result contract, how to read an answer — and nothing about the platform or
 * about what a check is for; that prose lives in `meta.docs.description` and at
 * `meta.docs.url`.
 *
 * So this module is a LOOKUP, not a table, built from `allChecks` at load time: a check
 * renamed, removed or added upstream changes this map without anyone editing it.
 */
import { allChecks } from '@platformos/platformos-check-common';

/** The documentation a check publishes about itself. */
export interface CheckDocs {
  /** One-line description, from `meta.docs.description`. */
  description: string;
  /**
   * The check's documentation page. Absent for the few checks whose meta publishes no
   * `url` — absent rather than guessed, because a URL assembled from a code is a link
   * that 404s, which is worse than no link.
   */
  url?: string;
}

/**
 * Keyed by `meta.code` ONLY, which is the exact string an offense carries
 * (`check: check.meta.code` in check-common's `check()`).
 *
 * `meta.aliases` are deliberately NOT keys: an alias is a name a CONFIG may use, never
 * something an offense carries, so mapping it would add entries nothing can look up.
 */
const BY_CODE: ReadonlyMap<string, CheckDocs> = new Map(
  allChecks.map((check) => [
    check.meta.code,
    { description: check.meta.docs.description, url: check.meta.docs.url },
  ]),
);

/**
 * The documentation for a check code, or `undefined` when nothing is registered under it.
 *
 * `undefined` is a real answer, not a gap to paper over: `CheckError` — check-common's code
 * for "a check crashed on this file" — is reported on offenses and is not a registered
 * check, so a consumer must handle a miss rather than assume every offense has a page.
 */
export function checkDocs(code: string): CheckDocs | undefined {
  return BY_CODE.get(code);
}

/** Every registered check code. Exported for the tests that assert this map is complete. */
export function registeredCheckCodes(): string[] {
  return [...BY_CODE.keys()];
}
