/**
 * The check-documentation lookup is DERIVED, and these assertions are written so a
 * documentation release cannot fail them while OUR side falling behind does.
 */
import { allChecks } from '@platformos/platformos-check-common';
import { describe, expect, it } from 'vitest';

import { checkDocs, registeredCheckCodes } from './check-docs.js';

describe('Unit: checkDocs', () => {
  it('answers for every registered check, and for nothing else', () => {
    // Derived on both sides: the registry is the input AND the expectation, so adding a
    // check upstream cannot leave this map behind.
    expect(registeredCheckCodes().sort()).toEqual(allChecks.map((check) => check.meta.code).sort());
  });

  it('returns each check its own description, taken from the registry rather than restated', () => {
    const mismatched = allChecks
      .map((check) => ({
        code: check.meta.code,
        expected: check.meta.docs.description,
        actual: checkDocs(check.meta.code)?.description,
      }))
      .filter((entry) => entry.actual !== entry.expected);

    expect(mismatched).toEqual([]);
  });

  it('returns the check its own documentation URL, and omits it when meta publishes none', () => {
    const mismatched = allChecks
      .map((check) => ({
        code: check.meta.code,
        expected: check.meta.docs.url,
        actual: checkDocs(check.meta.code)?.url,
      }))
      .filter((entry) => entry.actual !== entry.expected);

    expect(mismatched).toEqual([]);
  });

  /**
   * A miss is a real answer. `CheckError` is check-common's code for "a check crashed on
   * this file"; it reaches an agent as an ordinary offense and has no registry entry, so a
   * consumer that assumed every code resolves would throw on exactly the paths that are
   * already going wrong.
   */
  it('returns undefined for a code that is not a registered check', () => {
    expect(checkDocs('CheckError')).toBeUndefined();
    expect(checkDocs('NotACheckAtAll')).toBeUndefined();
  });

  /**
   * EVERY check publishes a documentation URL — a requirement rather than a report, now
   * that the server instructions tell an agent to follow `see_also` instead of restating
   * platform rules. A check with no URL means an agent is stopped by a finding and given
   * nowhere to read about it.
   */
  it('every registered check publishes a documentation URL', () => {
    const withoutUrl = allChecks
      .filter((check) => !check.meta.docs.url)
      .map((check) => check.meta.code)
      .sort();

    expect(
      withoutUrl,
      `these checks have no docs.url — add a page under ` +
        `app/views/pages/developer-guide/platformos-check/checks/ in platformos-documentation, ` +
        `plus its overview row and nav entry:\n${withoutUrl.join('\n')}`,
    ).toEqual([]);
  });

  /**
   * The URL must be one the documentation site can serve, not merely a non-empty string.
   */
  it('every documentation URL points into the checks section of the docs site', () => {
    const BASE = 'https://documentation.platformos.com/developer-guide/platformos-check/checks/';
    const malformed = allChecks
      .map((check) => ({ code: check.meta.code, url: check.meta.docs.url }))
      .filter(
        ({ url }) =>
          url !== undefined &&
          (!url.startsWith(BASE) || !/^[a-z0-9-]+$/.test(url.slice(BASE.length))),
      )
      .map(({ code, url }) => `${code} -> ${url}`);

    expect(malformed).toEqual([]);
  });
});
