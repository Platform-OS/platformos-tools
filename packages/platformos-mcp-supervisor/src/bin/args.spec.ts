import { describe, expect, it } from 'vitest';
import { parseArgs, resolveProjectDir } from './args';

describe('Unit: parseArgs', () => {
  it('parses --project <dir>', () => {
    expect(parseArgs(['--project', '/p'])).toEqual({ projectDir: '/p', help: false });
  });

  it('parses --project=<dir>', () => {
    expect(parseArgs(['--project=/p'])).toEqual({ projectDir: '/p', help: false });
  });

  it('parses --help and -h', () => {
    expect(parseArgs(['--help'])).toEqual({ projectDir: undefined, help: true });
    expect(parseArgs(['-h'])).toEqual({ projectDir: undefined, help: true });
  });

  it('tolerates unknown flags', () => {
    expect(parseArgs(['--future', 'x', '--project', '/p'])).toEqual({
      projectDir: '/p',
      help: false,
    });
  });

  it('returns no projectDir when none given', () => {
    expect(parseArgs([])).toEqual({ projectDir: undefined, help: false });
  });
});

describe('Unit: resolveProjectDir', () => {
  it('prefers the --project argument over env and cwd', () => {
    expect(
      resolveProjectDir(
        { projectDir: '/arg', help: false },
        { POS_SUPERVISOR_PROJECT_DIR: '/env' },
        '/cwd',
      ),
    ).toEqual('/arg');
  });

  it('falls back to POS_SUPERVISOR_PROJECT_DIR when no argument', () => {
    expect(
      resolveProjectDir({ help: false }, { POS_SUPERVISOR_PROJECT_DIR: '/env' }, '/cwd'),
    ).toEqual('/env');
  });

  it('falls back to cwd when neither argument nor env is set', () => {
    expect(resolveProjectDir({ help: false }, {}, '/cwd')).toEqual('/cwd');
  });
});
