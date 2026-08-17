/**
 * Machine-enforced architectural invariants for @platformos/platformos-mcp-supervisor
 * (see ARCHITECTURE.md §Invariants), so the design cannot silently rot as modules are added.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  declaredSymbols,
  extractImports,
  extractImportSpecifiers,
  hasMessageRegexParsing,
  isIoSpecifier,
  isLanguageServerRuntimeSpecifier,
  isLanguageServerSpecifier,
  isLspProtocolSpecifier,
  listSourceFiles,
  pathExists,
  stripComments,
  type SourceFile,
  usesLegacyParamExtraction,
  usesProcessGlobal,
} from './scan.js';

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SRC = join(PACKAGE_ROOT, 'src');

/**
 * The lint path — none of it may reach for a language server at all.
 *
 * `enrich/` is deliberately ABSENT. It is the one layer permitted to import the
 * language-server LIBRARY, and then only the bindings on {@link LSP_LIBRARY_ALLOWLIST}.
 * It does not lint; it explains what the lint found.
 */
const LINT_PATH_LAYERS = ['lint', 'impact', 'result', 'transport'];
/** The layers contractually required to be pure (no I/O). */
const PURE_LAYERS = ['enrich', 'result'];

/**
 * The ONLY bindings importable from `@platformos/platformos-language-server-common`.
 */
const LSP_LIBRARY_ALLOWLIST: ReadonlySet<string> = new Set([
  'render',
  'renderHtmlEntry',
  'renderParameter',
  'DocsetEntryType',
]);

function filesIn(...layers: string[]): SourceFile[] {
  return layers.flatMap((layer) => listSourceFiles(join(SRC, layer), PACKAGE_ROOT));
}

describe('Architecture invariant #1 — the supervisor never speaks the LSP protocol', () => {
  it('package.json declares no language-server RUNTIME dependency', () => {
    const pkgPath = join(PACKAGE_ROOT, 'package.json');
    if (!existsSync(pkgPath)) return; // package.json is scaffolded in TASK-7.4
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as Record<string, Record<string, string>>;
    const deps = Object.keys({
      ...(pkg.dependencies ?? {}),
      ...(pkg.devDependencies ?? {}),
      ...(pkg.peerDependencies ?? {}),
      ...(pkg.optionalDependencies ?? {}),
    });
    const offenders = deps.filter(
      (d) => isLanguageServerRuntimeSpecifier(d) || isLspProtocolSpecifier(d),
    );
    expect(
      offenders,
      `a language-server runtime or LSP protocol package is declared: ${offenders.join(', ')}`,
    ).toEqual([]);
  });

  it('no src/ module imports an LSP protocol / transport / document-manager package', () => {
    const offenders: string[] = [];
    for (const file of listSourceFiles(SRC, PACKAGE_ROOT)) {
      for (const spec of extractImportSpecifiers(file.text)) {
        if (isLspProtocolSpecifier(spec)) offenders.push(`${file.rel} -> ${spec}`);
      }
    }
    expect(offenders, `LSP protocol import:\n${offenders.join('\n')}`).toEqual([]);
  });

  it('no src/ module imports a language-server RUNTIME package', () => {
    const offenders: string[] = [];
    for (const file of listSourceFiles(SRC, PACKAGE_ROOT)) {
      for (const spec of extractImportSpecifiers(file.text)) {
        if (isLanguageServerRuntimeSpecifier(spec)) offenders.push(`${file.rel} -> ${spec}`);
      }
    }
    expect(offenders, `language-server runtime import:\n${offenders.join('\n')}`).toEqual([]);
  });

  it('no lint-path module imports any platformos-language-server package', () => {
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

  it('imports from the language-server library are limited to the allowlisted pure helpers', () => {
    const offenders: string[] = [];
    for (const file of listSourceFiles(SRC, PACKAGE_ROOT)) {
      for (const imported of extractImports(file.text)) {
        if (!isLanguageServerSpecifier(imported.spec)) continue;
        if (imported.wildcard) {
          offenders.push(`${file.rel} -> namespace/default import of ${imported.spec}`);
          continue;
        }
        for (const name of imported.named) {
          if (!LSP_LIBRARY_ALLOWLIST.has(name)) {
            offenders.push(`${file.rel} -> ${name} from ${imported.spec}`);
          }
        }
      }
    }
    expect(
      offenders,
      `binding imported from the language-server package but not on the allowlist:\n${offenders.join('\n')}`,
    ).toEqual([]);
  });

  it('SELF-TEST: separates the LSP wire from vscode-uri and from the library', () => {
    expect(isLspProtocolSpecifier('vscode-languageserver')).toBe(true);
    expect(isLspProtocolSpecifier('vscode-languageserver/node')).toBe(true);
    expect(isLspProtocolSpecifier('vscode-languageserver-protocol')).toBe(true);
    expect(isLspProtocolSpecifier('vscode-languageserver-textdocument')).toBe(true);
    expect(isLspProtocolSpecifier('vscode-jsonrpc')).toBe(true);
    // The URI helper platformos-common already depends on carries no protocol.
    expect(isLspProtocolSpecifier('vscode-uri')).toBe(false);
    expect(isLspProtocolSpecifier('@platformos/platformos-language-server-common')).toBe(false);
  });

  it('SELF-TEST: separates a language-server runtime from the library', () => {
    expect(isLanguageServerRuntimeSpecifier('@platformos/platformos-language-server-node')).toBe(
      true,
    );
    expect(isLanguageServerRuntimeSpecifier('@platformos/platformos-language-server-browser')).toBe(
      true,
    );
    expect(isLanguageServerRuntimeSpecifier('@platformos/platformos-language-server-common')).toBe(
      false,
    );
    expect(isLanguageServerRuntimeSpecifier('@platformos/platformos-check-node')).toBe(false);
  });

  it('SELF-TEST: detects a language-server specifier', () => {
    expect(isLanguageServerSpecifier('@platformos/platformos-language-server-node')).toBe(true);
    expect(isLanguageServerSpecifier('@platformos/platformos-language-server-common')).toBe(true);
    expect(isLanguageServerSpecifier('@platformos/platformos-check-node')).toBe(false);
    expect(isLanguageServerSpecifier('@platformos/platformos-graph')).toBe(false);
  });

  it('SELF-TEST: extractImports reads named bindings and flags namespace/default imports', () => {
    expect(
      extractImports(`import { render, renderParameter as rp } from '@platformos/x';`),
    ).toEqual([{ spec: '@platformos/x', named: ['render', 'renderParameter'], wildcard: false }]);
    expect(extractImports(`import type { DocsetEntryType } from '@platformos/x';`)).toEqual([
      { spec: '@platformos/x', named: ['DocsetEntryType'], wildcard: false },
    ]);
    expect(extractImports(`import * as ls from '@platformos/x';`)).toEqual([
      { spec: '@platformos/x', named: [], wildcard: true },
    ]);
    expect(extractImports(`import def, { render } from '@platformos/x';`)).toEqual([
      { spec: '@platformos/x', named: ['render'], wildcard: true },
    ]);
    expect(extractImports(`export { render } from '@platformos/x';`)).toEqual([
      { spec: '@platformos/x', named: ['render'], wildcard: false },
    ]);
  });

  it('SELF-TEST: the allowlist rejects a server binding taken from the same package', () => {
    const allowed = extractImports(
      `import { render } from '@platformos/platformos-language-server-common';`,
    );
    const refused = extractImports(
      `import { startServer } from '@platformos/platformos-language-server-common';`,
    );
    expect(allowed[0].named.every((n) => LSP_LIBRARY_ALLOWLIST.has(n))).toBe(true);
    expect(refused[0].named.every((n) => LSP_LIBRARY_ALLOWLIST.has(n))).toBe(false);
  });
});

/**
 * Invariant #3 — one graph, one docset, one root finder.
 */
describe('Architecture invariant #3 — no re-implementation of an owned capability', () => {
  /** Declared names that mean a capability has been rebuilt here. Case-insensitive. */
  const FORBIDDEN_DECLARATIONS = [
    'ProjectScanner',
    'ProjectFactGraph',
    'DependencyGraph',
    'FiltersIndex',
    'ObjectsIndex',
    'TagsIndex',
    // The single docset wrapper lives in check-common; a second one here would be a
    // second place alias expansion and memoization could disagree.
    'AugmentedPlatformOSDocset',
    // Project-root resolution is check-common's `findRoot`. A second finder is how two
    // layers end up disagreeing about which project a file belongs to.
    'findRoot',
    'findProjectRoot',
    'locateProjectRoot',
  ].map((name) => name.toLowerCase());

  it('declares no project scanner, fact graph, dependency graph, docset wrapper or root finder', () => {
    const offenders: string[] = [];
    for (const file of listSourceFiles(SRC, PACKAGE_ROOT)) {
      for (const name of declaredSymbols(file.text)) {
        if (FORBIDDEN_DECLARATIONS.includes(name.toLowerCase())) {
          offenders.push(`${file.rel} declares ${name}`);
        }
      }
    }
    expect(
      offenders,
      `a capability another package owns has been re-implemented:\n${offenders.join('\n')}`,
    ).toEqual([]);
  });

  /**
   * The docset arrives through check-node's `getPlatformOSDocset()` — the same object the
   * lint reads from — and this package neither imports nor declares the docs-updater.
   */
  it('does not depend on the docs-updater — the docset comes from check-node', () => {
    const pkg = JSON.parse(readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8')) as Record<
      string,
      Record<string, string>
    >;
    const declared = Object.keys({
      ...(pkg.dependencies ?? {}),
      ...(pkg.devDependencies ?? {}),
      ...(pkg.peerDependencies ?? {}),
      ...(pkg.optionalDependencies ?? {}),
    }).filter((dep) => dep.includes('check-docs-updater'));

    const imported: string[] = [];
    for (const file of listSourceFiles(SRC, PACKAGE_ROOT)) {
      for (const spec of extractImportSpecifiers(file.text)) {
        if (spec.includes('check-docs-updater')) imported.push(`${file.rel} -> ${spec}`);
      }
    }

    expect({ declared, imported }).toEqual({ declared: [], imported: [] });
  });

  it('SELF-TEST: flags a declaration and clears an import of the same name', () => {
    expect(declaredSymbols(`export class FiltersIndex {}`)).toEqual(['FiltersIndex']);
    expect(declaredSymbols(`function findRoot(uri: string) { return uri; }`)).toEqual(['findRoot']);
    expect(declaredSymbols(`const dependencyGraph = build();`)).toEqual(['dependencyGraph']);
    // Importing the real one, or naming it in a type position, is the sanctioned path.
    expect(declaredSymbols(`import { findRoot } from '@platformos/platformos-check-common';`)).toEqual(
      [],
    );
    expect(
      declaredSymbols(`import { AugmentedPlatformOSDocset } from '@platformos/platformos-check-node';`),
    ).toEqual([]);
  });
});

/**
 * Invariant #4 — ONE detector framework, and it is check-common.
 */
describe('Architecture invariant #4 — the supervisor detects nothing itself', () => {
  it('has no advise/ directory', () => {
    expect(pathExists(join(SRC, 'advise')), 'an advise/ layer was added').toBe(false);
  });

  it('emits no pos-supervisor: diagnostic code', () => {
    // Scanned over code with comments stripped, so the ADR references and this file's own
    // explanations do not trip it — only a live string would.
    const offenders = listSourceFiles(SRC, PACKAGE_ROOT)
      .filter((file) => stripComments(file.text).includes('pos-supervisor:'))
      .map((file) => file.rel);

    expect(
      offenders,
      `a pos-supervisor: code is being emitted; detectors belong in check-common:\n${offenders.join('\n')}`,
    ).toEqual([]);
  });

  it('SELF-TEST: the namespace detector reads code, not commentary', () => {
    expect(stripComments(`const c = 'pos-supervisor:HtmlInPage';`)).toContain('pos-supervisor:');
    expect(stripComments(`// pos-supervisor:HtmlInPage was dropped, see ADR 002\n`)).not.toContain(
      'pos-supervisor:',
    );
  });
});

/**
 * Invariant #6 — the supervisor ships NO documentation.
 */
describe('Architecture invariant #6 — no documentation lives in this package', () => {
  /**
   * A declaration under any of these names is a vocabulary table by another spelling.
   * Matched case-insensitively and without underscores, so `KNOWN_FILTERS`, `knownFilters`
   * and `FiltersTable` are all the same offence.
   */
  const VOCABULARY_TABLE_NAMES = [
    'filters',
    'knownfilters',
    'liquidfilters',
    'filtertable',
    'filterstable',
    'tags',
    'knowntags',
    'liquidtags',
    'tagtable',
    'tagstable',
    'objects',
    'knownobjects',
    'liquiddrops',
    'objecttable',
    'objectstable',
    'properties',
    'knownproperties',
    'deprecatedfilters',
    'deprecatedtags',
    'shopifyobjects',
    'shopifytags',
  ];

  const normalise = (name: string) => name.toLowerCase().replace(/_/g, '');

  it('declares no filter / tag / object / property vocabulary table', () => {
    const offenders: string[] = [];
    for (const file of listSourceFiles(SRC, PACKAGE_ROOT)) {
      for (const name of declaredSymbols(file.text)) {
        if (VOCABULARY_TABLE_NAMES.includes(normalise(name))) {
          offenders.push(`${file.rel} declares ${name}`);
        }
      }
    }
    expect(
      offenders,
      `a platform vocabulary table has been declared here; it belongs in the docset:\n${offenders.join('\n')}`,
    ).toEqual([]);
  });

  it('ships no data/ directory and no prose asset', () => {
    expect(pathExists(join(PACKAGE_ROOT, 'data')), 'a data/ directory was added').toBe(false);
    expect(pathExists(join(SRC, 'data')), 'a src/data directory was added').toBe(false);

    // ...and nothing packs one either. `files` used to list `dist/data/**/*`, which is the
    // shape of the knowledge directory this invariant forbids.
    const pkg = JSON.parse(readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8')) as {
      files?: string[];
    };
    expect((pkg.files ?? []).filter((entry) => entry.includes('data'))).toEqual([]);
  });

  it('SELF-TEST: the table detector spans the spellings a table can arrive under', () => {
    expect(declaredSymbols('const KNOWN_FILTERS = ["a"];').map(normalise)).toEqual(['knownfilters']);
    expect(VOCABULARY_TABLE_NAMES).toContain(normalise('KNOWN_FILTERS'));
    expect(VOCABULARY_TABLE_NAMES).toContain(normalise('liquidTags'));
    // A name that merely mentions a docset concept is NOT a table: reading the docset is
    // the sanctioned path, and only a declared collection of names is the violation.
    expect(VOCABULARY_TABLE_NAMES).not.toContain(normalise('filterEntryFor'));
    expect(VOCABULARY_TABLE_NAMES).not.toContain(normalise('renderTagEntry'));
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

/**
 * No false-positive CORRECTION layer.
 */
describe('Architecture invariant — no false-positive suppression pass', () => {
  /** Declaration names that mean findings are being second-guessed after the fact. */
  const SUPPRESSION_PATTERNS = [/^verify.*OnDisk$/i, /^suppress/i, /^dropFalsePositives?$/i];

  it('declares no verify*OnDisk / suppress* / dropFalsePositive step', () => {
    const offenders: string[] = [];
    for (const file of listSourceFiles(SRC, PACKAGE_ROOT)) {
      for (const name of declaredSymbols(file.text)) {
        if (SUPPRESSION_PATTERNS.some((pattern) => pattern.test(name))) {
          offenders.push(`${file.rel} declares ${name}`);
        }
      }
    }
    expect(
      offenders,
      `a false-positive suppression pass has reappeared; fix the CHECK instead:\n${offenders.join('\n')}`,
    ).toEqual([]);
  });

  it('SELF-TEST: flags the v1 names and clears ordinary ones', () => {
    const flags = (name: string) => SUPPRESSION_PATTERNS.some((pattern) => pattern.test(name));
    expect([
      flags('verifyMissingPartialOnDisk'),
      flags('suppressKnownFalsePositives'),
      flags('dropFalsePositives'),
      // Not suppression: bounding a response is about SIZE, and it never changes the
      // gate — `response-budget.ts` runs on finished results for exactly that reason.
      flags('capToBudget'),
      flags('assembleResult'),
      flags('blocksWrite'),
    ]).toEqual([true, true, true, false, false, false]);
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
