import { describe, expect, it } from 'vitest';
import { parseArgs, resolveImpactEnabled, resolveProjectDir } from './args.js';

describe('Unit: parseArgs', () => {
  it('parses --project <dir>', () => {
    expect(parseArgs(['--project', '/p'])).toEqual({ projectDir: '/p', impact: true, help: false });
  });

  it('parses --project=<dir>', () => {
    expect(parseArgs(['--project=/p'])).toEqual({ projectDir: '/p', impact: true, help: false });
  });

  it('parses --help and -h', () => {
    expect(parseArgs(['--help'])).toEqual({ projectDir: undefined, impact: true, help: true });
    expect(parseArgs(['-h'])).toEqual({ projectDir: undefined, impact: true, help: true });
  });

  it('tolerates unknown flags', () => {
    expect(parseArgs(['--future', 'x', '--project', '/p'])).toEqual({
      projectDir: '/p',
      impact: true,
      help: false,
    });
  });

  it('returns no projectDir when none given', () => {
    expect(parseArgs([])).toEqual({ projectDir: undefined, impact: true, help: false });
  });

  it('parses --no-impact', () => {
    expect(parseArgs(['--no-impact'])).toEqual({
      projectDir: undefined,
      impact: false,
      help: false,
    });
  });

  it('leaves impact ON when the flag is absent, alongside other arguments', () => {
    expect(parseArgs(['--project', '/p'])).toEqual({
      projectDir: '/p',
      impact: true,
      help: false,
    });
  });
});

describe('Unit: resolveProjectDir', () => {
  it('prefers the --project argument over env and cwd', () => {
    expect(
      resolveProjectDir(
        { projectDir: '/arg', impact: true, help: false },
        { POS_SUPERVISOR_PROJECT_DIR: '/env' },
        '/cwd',
      ),
    ).toEqual('/arg');
  });

  it('falls back to POS_SUPERVISOR_PROJECT_DIR when no argument', () => {
    expect(
      resolveProjectDir(
        { impact: true, help: false },
        { POS_SUPERVISOR_PROJECT_DIR: '/env' },
        '/cwd',
      ),
    ).toEqual('/env');
  });

  it('falls back to cwd when neither argument nor env is set', () => {
    expect(resolveProjectDir({ impact: true, help: false }, {}, '/cwd')).toEqual('/cwd');
  });
});

/**
 * Impact is a SAFETY feature, so its default is the safe one and only an explicit opt-out
 * turns it off. A server setting rather than a tool parameter: the per-call knob would put
 * the choice with the agent, and the agent that does not know it is editing a shared partial
 * is exactly the one that would not ask.
 */
describe('Unit: resolveImpactEnabled', () => {
  const args = (impact: boolean) => ({ impact, help: false });

  it('is ON by default, with no flag and no env', () => {
    expect(resolveImpactEnabled(args(true), {})).toBe(true);
  });

  it('is OFF when --no-impact was passed', () => {
    expect(resolveImpactEnabled(args(false), {})).toBe(false);
  });

  it('is OFF when the env var asks for it', () => {
    expect(resolveImpactEnabled(args(true), { POS_SUPERVISOR_NO_IMPACT: '1' })).toBe(false);
  });

  /**
   * `POS_SUPERVISOR_NO_IMPACT=0` reads as "do not disable it", not as "disable it with the
   * value 0" — the trap of naming an env var for the negative. Empty is the same: a client
   * that exports the key without a value has expressed nothing.
   */
  it.each([['0'], ['false'], ['']])('treats %o as NOT a request to disable', (value) => {
    expect(resolveImpactEnabled(args(true), { POS_SUPERVISOR_NO_IMPACT: value })).toBe(true);
  });

  it('lets the flag win over an env var that would enable it', () => {
    expect(resolveImpactEnabled(args(false), { POS_SUPERVISOR_NO_IMPACT: '0' })).toBe(false);
  });
});
