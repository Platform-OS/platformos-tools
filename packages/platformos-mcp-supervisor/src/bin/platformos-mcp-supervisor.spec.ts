/**
 * Unit pins for the CLI entrypoint's argv parsing + project-directory
 * precedence chain. These are pure functions extracted from `main()` so
 * the contract MCP clients depend on (cwd fallback, env override, CLI
 * win) is mechanically verified — every prior test exercised the bin via
 * `--project`, so a regression in the fallback chain would have shipped
 * silently.
 */

import { describe, it, expect } from 'vitest';
import { parseArgs, resolveProjectDir } from './platformos-mcp-supervisor';

// ── parseArgs ──────────────────────────────────────────────────────────────

describe('parseArgs', () => {
  it('returns empty result for no args', () => {
    expect(parseArgs([])).toEqual({ projectDir: undefined, help: false });
  });

  it('parses `--project <dir>` (space-separated)', () => {
    expect(parseArgs(['--project', '/abs/path'])).toEqual({
      projectDir: '/abs/path',
      help: false,
    });
  });

  it('parses `--project=<dir>` (equals form)', () => {
    expect(parseArgs(['--project=/abs/path'])).toEqual({
      projectDir: '/abs/path',
      help: false,
    });
  });

  it('parses `--help` / `-h`', () => {
    expect(parseArgs(['--help']).help).toBe(true);
    expect(parseArgs(['-h']).help).toBe(true);
  });

  it('tolerates unknown flags (forward-compat)', () => {
    expect(parseArgs(['--unknown', 'value', '--project=/p', '--also-unknown'])).toEqual({
      projectDir: '/p',
      help: false,
    });
  });

  it('last `--project` wins when given twice', () => {
    expect(parseArgs(['--project', '/first', '--project=/second']).projectDir).toBe('/second');
  });
});

// ── resolveProjectDir (the precedence chain MCP clients depend on) ─────────

describe('resolveProjectDir', () => {
  const noEnv: Record<string, string | undefined> = {};
  const envWithDir: Record<string, string | undefined> = {
    POS_SUPERVISOR_PROJECT_DIR: '/from/env',
  };

  it('returns CLI arg when present (wins over env + cwd)', () => {
    expect(
      resolveProjectDir({ projectDir: '/from/cli', help: false }, envWithDir, () => '/from/cwd'),
    ).toBe('/from/cli');
  });

  it('returns env var when CLI arg is absent', () => {
    expect(
      resolveProjectDir({ projectDir: undefined, help: false }, envWithDir, () => '/from/cwd'),
    ).toBe('/from/env');
  });

  it('returns cwd when neither CLI nor env is set (the MCP-client default path)', () => {
    expect(
      resolveProjectDir({ projectDir: undefined, help: false }, noEnv, () => '/from/cwd'),
    ).toBe('/from/cwd');
  });

  it('treats empty-string CLI arg as absent (falls through to env / cwd)', () => {
    // Defensive: a poorly-quoted shell expansion could pass `''`. The
    // resolver must NOT pick it as the project dir — it would break
    // every downstream `path.resolve` call.
    expect(resolveProjectDir({ projectDir: '', help: false }, envWithDir, () => '/from/cwd')).toBe(
      '/from/env',
    );
  });

  it('treats empty-string env var as absent', () => {
    expect(
      resolveProjectDir(
        { projectDir: undefined, help: false },
        { POS_SUPERVISOR_PROJECT_DIR: '' },
        () => '/from/cwd',
      ),
    ).toBe('/from/cwd');
  });

  it('treats missing env entry as absent', () => {
    expect(
      resolveProjectDir(
        { projectDir: undefined, help: false },
        { POS_SUPERVISOR_PROJECT_DIR: undefined },
        () => '/from/cwd',
      ),
    ).toBe('/from/cwd');
  });
});
