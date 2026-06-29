/**
 * Machine-enforced architectural invariants for @platformos/platformos-mcp-supervisor.
 *
 * These guards encode the non-goals from the rebuild epic (TASK-7) so the
 * sound design cannot silently rot as later tasks add modules. They run under
 * the repo-root vitest (which globs every package and excludes `dist/`), so no
 * package-local vitest config is required.
 *
 * Two kinds of assertion live here:
 *   1. REAL-SOURCE guards — scan the package's actual `src/**` and
 *      `package.json`. They pass vacuously while a layer is un-scaffolded and
 *      bite the moment a violating import / pattern is introduced.
 *   2. SELF-TESTS — exercise the pure detectors against inline good/bad
 *      fixtures, pinning the "a test fails on violation" behaviour
 *      deterministically, independent of what currently lives in `src/`.
 *
 * Invariants enforced (see ARCHITECTURE.md §Invariants):
 *   #1 No in-process language server on the lint path.
 *   #2 No string round-trip: enrich/ never regex-parses diagnostic messages.
 *   #5 enrich/ and result/ are PURE — no fs / process / I/O, no dependency on lint/.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  extractImportSpecifiers,
  hasMessageRegexParsing,
  isIoSpecifier,
  isLanguageServerSpecifier,
  listSourceFiles,
  type SourceFile,
  usesLegacyParamExtraction,
  usesProcessGlobal,
} from './scan';

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SRC = join(PACKAGE_ROOT, 'src');

/** The whole validate_code request path — none of it may reach for a language server. */
const LINT_PATH_LAYERS = ['lint', 'enrich', 'advise', 'result', 'transport'];
/** The layers contractually required to be pure (no I/O). */
const PURE_LAYERS = ['enrich', 'result'];

function filesIn(...layers: string[]): SourceFile[] {
  return layers.flatMap((layer) => listSourceFiles(join(SRC, layer), PACKAGE_ROOT));
}

describe('Architecture invariant #1 — no language server on the lint path', () => {
  it('package.json declares no platformos-language-server-* dependency', () => {
    const pkgPath = join(PACKAGE_ROOT, 'package.json');
    if (!existsSync(pkgPath)) return; // package.json is scaffolded in TASK-7.4
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as Record<string, Record<string, string>>;
    const deps = Object.keys({
      ...(pkg.dependencies ?? {}),
      ...(pkg.devDependencies ?? {}),
      ...(pkg.peerDependencies ?? {}),
      ...(pkg.optionalDependencies ?? {}),
    });
    const offenders = deps.filter((d) => isLanguageServerSpecifier(d));
    expect(offenders, `language-server dependency declared: ${offenders.join(', ')}`).toEqual([]);
  });

  it('no src/ lint-path module imports a platformos-language-server-* package', () => {
    const offenders: string[] = [];
    for (const file of filesIn(...LINT_PATH_LAYERS)) {
      for (const spec of extractImportSpecifiers(file.text)) {
        if (isLanguageServerSpecifier(spec)) offenders.push(`${file.rel} -> ${spec}`);
      }
    }
    expect(offenders, `language-server import on the lint path:\n${offenders.join('\n')}`).toEqual(
      [],
    );
  });

  it('SELF-TEST: detects a language-server specifier', () => {
    expect(isLanguageServerSpecifier('@platformos/platformos-language-server-node')).toBe(true);
    expect(isLanguageServerSpecifier('@platformos/platformos-language-server-common')).toBe(true);
    expect(isLanguageServerSpecifier('@platformos/platformos-check-node')).toBe(false);
    expect(isLanguageServerSpecifier('@platformos/platformos-graph')).toBe(false);
  });
});

describe('Architecture invariant #5 — enrich/ and result/ are pure', () => {
  it('pure layers import no fs / child_process / net / http / os / … I/O module', () => {
    const offenders: string[] = [];
    for (const file of filesIn(...PURE_LAYERS)) {
      for (const spec of extractImportSpecifiers(file.text)) {
        if (isIoSpecifier(spec)) offenders.push(`${file.rel} -> ${spec}`);
      }
    }
    expect(offenders, `I/O import in a pure layer:\n${offenders.join('\n')}`).toEqual([]);
  });

  it('pure layers do not touch the process global', () => {
    const offenders = filesIn(...PURE_LAYERS)
      .filter((f) => usesProcessGlobal(f.text))
      .map((f) => f.rel);
    expect(offenders, `process.* used in a pure layer:\n${offenders.join('\n')}`).toEqual([]);
  });

  it('pure layers do not import the I/O-bound lint/ layer', () => {
    const offenders: string[] = [];
    for (const file of filesIn(...PURE_LAYERS)) {
      for (const spec of extractImportSpecifiers(file.text)) {
        if (/(^|\/)lint(\/|$)/.test(spec)) offenders.push(`${file.rel} -> ${spec}`);
      }
    }
    expect(offenders, `pure layer imports lint/:\n${offenders.join('\n')}`).toEqual([]);
  });

  it('SELF-TEST: detects forbidden I/O specifiers and allows path', () => {
    expect(isIoSpecifier('node:fs')).toBe(true);
    expect(isIoSpecifier('fs')).toBe(true);
    expect(isIoSpecifier('node:fs/promises')).toBe(true);
    expect(isIoSpecifier('child_process')).toBe(true);
    expect(isIoSpecifier('node:os')).toBe(true);
    expect(isIoSpecifier('node:path')).toBe(false);
    expect(isIoSpecifier('path')).toBe(false);
    expect(isIoSpecifier('@platformos/platformos-graph')).toBe(false);
  });

  it('SELF-TEST: detects process-global use', () => {
    expect(usesProcessGlobal('const dir = process.cwd();')).toBe(true);
    expect(usesProcessGlobal('const v = process.env.FOO;')).toBe(true);
    expect(usesProcessGlobal('const processed = items.map(x => x);')).toBe(false);
  });
});

describe('Architecture invariant #2 — enrich/ never regex-parses diagnostic messages', () => {
  it('no src/enrich module extracts data by regex over a diagnostic .message', () => {
    const offenders: string[] = [];
    for (const file of filesIn('enrich')) {
      const hit = hasMessageRegexParsing(file.text);
      if (hit) offenders.push(`${file.rel}:${hit.line} -> ${hit.snippet}`);
    }
    expect(offenders, `regex-over-message in enrich/:\n${offenders.join('\n')}`).toEqual([]);
  });

  it('no src/enrich module reintroduces the legacy extractParams / templateOf / diagnostic-record layer', () => {
    const offenders = filesIn('enrich')
      .filter((f) => usesLegacyParamExtraction(f.text))
      .map((f) => f.rel);
    expect(offenders, `legacy param-extraction in enrich/:\n${offenders.join('\n')}`).toEqual([]);
  });

  it('SELF-TEST: flags regex-over-message and clears structured-field reads', () => {
    expect(
      hasMessageRegexParsing(`const name = diag.message.match(/'(.+?)'/)?.[1];`),
    ).not.toBeNull();
    expect(hasMessageRegexParsing(`const m = /'(.+?)'/.exec(diag.message);`)).not.toBeNull();
    expect(
      hasMessageRegexParsing(`const name = diag.message\n  .match(/'(.+?)'/)?.[1];`),
      'fluent chain split across lines must be flagged',
    ).not.toBeNull();
    // Reading the structured `data` field — the sanctioned path — is clean.
    expect(hasMessageRegexParsing(`const name = diag.data.identifier;`)).toBeNull();
    expect(hasMessageRegexParsing(`const label = diag.message; // displayed verbatim`)).toBeNull();
  });

  it('SELF-TEST: flags legacy param-extraction by name', () => {
    expect(usesLegacyParamExtraction(`const p = extractParams(check, msg);`)).toBe(true);
    expect(usesLegacyParamExtraction(`import { templateOf } from './diagnostic-record';`)).toBe(
      true,
    );
    expect(usesLegacyParamExtraction(`const hint = renderHint(diag.check, diag.data);`)).toBe(
      false,
    );
  });
});
