/**
 * Force-disable enforcement (manual operator override).
 *
 * Source's `disabled-rules.test.js` exercised the analytics-driven
 * auto-disable layer (`updateDisabledRules` + `getDisabledRules`), which
 * the v1 scope dropped. This spec covers what survives: the manual
 * `forceDisable` / `releaseDisable` / `isCheckForceDisabled` surface that
 * `validate_code` uses to drop diagnostics whose check name an operator
 * has explicitly suppressed.
 *
 * The engine treats `forceDisable` as a SUPER-set: it can target either a
 * rule id (`<Check>.<variant>`) or a bare check name (`pos-supervisor:*`,
 * LSP check names). Rule-id entries gate the rule engine; check-name
 * entries gate downstream filtering in the validator.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  clearRules,
  registerRule,
  registerRules,
  runRules,
  forceDisable,
  releaseDisable,
  isCheckForceDisabled,
  type Rule,
} from './engine';

function makeRule(id: string, check: string, priority = 50): Rule {
  return {
    id,
    check,
    priority,
    when: () => true,
    apply: () => ({ rule_id: id, hint_md: `Hint from ${id}`, fixes: [], confidence: 0.5 }),
  };
}

beforeEach(() => clearRules());
afterEach(() => clearRules());

describe('rules/engine — force-disable (manual override)', () => {
  it('isCheckForceDisabled returns false when nothing is disabled', () => {
    expect(isCheckForceDisabled('Test')).toBe(false);
    expect(isCheckForceDisabled('pos-supervisor:HtmlInPage')).toBe(false);
  });

  it('forceDisable(check) marks a check name as suppressed', () => {
    forceDisable('pos-supervisor:HtmlInPage');
    expect(isCheckForceDisabled('pos-supervisor:HtmlInPage')).toBe(true);
    expect(isCheckForceDisabled('pos-supervisor:MissingSlug')).toBe(false);
  });

  it('forceDisable is idempotent', () => {
    forceDisable('Test');
    forceDisable('Test');
    expect(isCheckForceDisabled('Test')).toBe(true);
  });

  it('releaseDisable removes a previously force-disabled id', () => {
    forceDisable('Test');
    expect(isCheckForceDisabled('Test')).toBe(true);
    releaseDisable('Test');
    expect(isCheckForceDisabled('Test')).toBe(false);
  });

  it('releaseDisable is a no-op when the id was never disabled', () => {
    releaseDisable('Never');
    expect(isCheckForceDisabled('Never')).toBe(false);
  });

  it('handles null / undefined inputs without throwing', () => {
    expect(isCheckForceDisabled(null)).toBe(false);
    expect(isCheckForceDisabled(undefined)).toBe(false);
  });

  it('force-disabling a rule id makes runRules skip that rule and use the next one', () => {
    registerRules([makeRule('Test.high', 'Test', 10), makeRule('Test.low', 'Test', 100)]);
    forceDisable('Test.high');
    const result = runRules({ check: 'Test', severity: 'warning', message: '' }, {} as never);
    expect(result).not.toBeNull();
    expect(result?.rule_id).toBe('Test.low');
  });

  it('force-disabling every rule for a check returns null from runRules', () => {
    registerRule(makeRule('Test.only', 'Test', 10));
    forceDisable('Test.only');
    expect(runRules({ check: 'Test', severity: 'warning', message: '' }, {} as never)).toBeNull();
  });

  it('non-disabled rules fire normally even when other ids are force-disabled', () => {
    registerRule(makeRule('Test.active', 'Test', 10));
    forceDisable('Some.other.rule');
    const result = runRules({ check: 'Test', severity: 'warning', message: '' }, {} as never);
    expect(result?.rule_id).toBe('Test.active');
  });

  it('clearRules() drops the force-disable set as well as the rule registry', () => {
    registerRule(makeRule('Test.rule', 'Test', 10));
    forceDisable('Test.rule');
    expect(runRules({ check: 'Test', severity: 'warning', message: '' }, {} as never)).toBeNull();

    clearRules();
    registerRule(makeRule('Test.rule', 'Test', 10));
    const result = runRules({ check: 'Test', severity: 'warning', message: '' }, {} as never);
    expect(result?.rule_id).toBe('Test.rule');
  });
});
