/**
 * Source-scanning helpers for the architecture-invariant guards.
 *
 * TEST infrastructure, so `node:fs` is intentionally allowed: the purity invariant
 * constrains `src/enrich` and `src/result`, not the guards that police them.
 *
 * The detectors below are exported as pure string functions so the spec can pin their
 * failure behaviour against inline fixtures, without needing real violating source.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

export interface SourceFile {
  /** Absolute path on disk. */
  path: string;
  /** Path relative to the package root, normalised to forward slashes. */
  rel: string;
  /** File contents. */
  text: string;
}

const DEFAULT_SKIP_DIRS = new Set(['node_modules', 'dist', '.git']);

/**
 * Recursively collect `.ts` source files under `dir`, excluding `*.spec.ts`
 * and the build/dependency directories. Returns `[]` when `dir` does not yet
 * exist (so guards pass vacuously over an un-scaffolded layer and only bite
 * once the layer is populated).
 */
export function listSourceFiles(dir: string, packageRoot: string): SourceFile[] {
  let entries: ReturnType<typeof readdirSync>;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }

  const files: SourceFile[] = [];
  for (const entry of entries) {
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (DEFAULT_SKIP_DIRS.has(entry.name)) continue;
      files.push(...listSourceFiles(abs, packageRoot));
      continue;
    }
    if (!entry.isFile()) continue;
    if (!entry.name.endsWith('.ts')) continue;
    if (entry.name.endsWith('.spec.ts') || entry.name.endsWith('.d.ts')) continue;
    files.push({
      path: abs,
      rel: relative(packageRoot, abs).split(sep).join('/'),
      text: readFileSync(abs, 'utf8'),
    });
  }
  return files;
}

/** True when `path` exists on disk (file or directory). */
export function pathExists(path: string): boolean {
  try {
    statSync(path);
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw err;
  }
}

/**
 * Remove `//` line comments and block comments from TS source while leaving string and
 * template literals intact, so the import/regex detectors do not trip on commented-out
 * examples or on `//` inside URLs.
 *
 * A small char-state scanner, sufficient for our own controlled source. Regex literals are
 * NOT specially tracked, so a `/*` inside one could be mis-stripped — a pattern we do not
 * write.
 */
export function stripComments(text: string): string {
  let out = '';
  let i = 0;
  const n = text.length;
  type Mode = 'code' | 'line' | 'block' | 'single' | 'double' | 'template';
  let mode: Mode = 'code';

  while (i < n) {
    const c = text[i];
    const next = i + 1 < n ? text[i + 1] : '';

    switch (mode) {
      case 'code':
        if (c === '/' && next === '/') {
          mode = 'line';
          i += 2;
        } else if (c === '/' && next === '*') {
          mode = 'block';
          i += 2;
        } else if (c === "'") {
          mode = 'single';
          out += c;
          i += 1;
        } else if (c === '"') {
          mode = 'double';
          out += c;
          i += 1;
        } else if (c === '`') {
          mode = 'template';
          out += c;
          i += 1;
        } else {
          out += c;
          i += 1;
        }
        break;
      case 'line':
        if (c === '\n') {
          mode = 'code';
          out += c;
        }
        i += 1;
        break;
      case 'block':
        if (c === '*' && next === '/') {
          mode = 'code';
          i += 2;
        } else {
          // Preserve newlines so line numbers stay accurate.
          if (c === '\n') out += c;
          i += 1;
        }
        break;
      case 'single':
      case 'double':
      case 'template': {
        out += c;
        const quote = mode === 'single' ? "'" : mode === 'double' ? '"' : '`';
        if (c === '\\') {
          // Copy the escaped character verbatim.
          if (next) {
            out += next;
            i += 2;
            break;
          }
        }
        if (c === quote) mode = 'code';
        i += 1;
        break;
      }
    }
  }
  return out;
}

const IMPORT_PATTERNS: RegExp[] = [
  // import ... from 'x' / export ... from 'x'
  /\b(?:import|export)\b[^'"]*?\bfrom\s*['"]([^'"]+)['"]/g,
  // bare side-effect import 'x'
  /\bimport\s*['"]([^'"]+)['"]/g,
  // dynamic import('x')
  /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  // require('x')
  /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
];

/** Extract module specifiers from import / export-from / require / dynamic-import. */
export function extractImportSpecifiers(text: string): string[] {
  const code = stripComments(text);
  const found = new Set<string>();
  for (const re of IMPORT_PATTERNS) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(code)) !== null) found.add(m[1]);
  }
  return [...found];
}

/** True when the specifier targets a platformOS language-server package. */
export function isLanguageServerSpecifier(spec: string): boolean {
  return /(?:^|\/)platformos-language-server(?:-[a-z]+)?(?:$|\/)/.test(spec);
}

/**
 * True when the specifier is the LSP WIRE — the protocol, transport, JSON-RPC and
 * document-manager packages, which is the surface invariant #1 actually bans. An LSP
 * `Diagnostic`, `Connection` or `TextDocuments` anywhere here means a second protocol has
 * been introduced.
 *
 * `vscode-uri` is deliberately NOT matched: a URI helper `platformos-common` already
 * depends on, carrying no protocol.
 */
export function isLspProtocolSpecifier(spec: string): boolean {
  const pkg = spec.split('/')[0];
  return /^vscode-(?:languageserver|jsonrpc)(?:-[a-z]+)*$/.test(pkg);
}

/**
 * True when the specifier is a language-server RUNTIME — a package whose job is to boot a
 * server over a transport. Distinguished from `-common`, which is a LIBRARY of pure
 * functions over check-common types.
 */
export function isLanguageServerRuntimeSpecifier(spec: string): boolean {
  return /(?:^|\/)platformos-language-server-(?:node|browser)(?:$|\/)/.test(spec);
}

/** One `import`/`export ... from` statement, reduced to what an allowlist needs to judge it. */
export interface ModuleImport {
  /** The module specifier. */
  spec: string;
  /** Named bindings, in SOURCE spelling (`render` for `render as r`). */
  named: string[];
  /**
   * True for a namespace (`* as ns`) or default binding. An allowlist cannot constrain
   * either — `ns.createConnection` is reachable without naming it at the import — so
   * these are refused outright for the packages that carry an allowlist.
   */
  wildcard: boolean;
}

const IMPORT_CLAUSE = /\b(?:import|export)\s+(?:type\s+)?([^'";]*?)\s*\bfrom\s*['"]([^'"]+)['"]/g;

/**
 * Parse `import`/`export ... from` statements into {@link ModuleImport}s.
 *
 * Deliberately narrower than {@link extractImportSpecifiers}, which answers "is this module
 * reachable at all"; this answers "and WHICH bindings were taken from it", which is what
 * lets one package be allowed for its pure helpers and refused for its server.
 */
export function extractImports(text: string): ModuleImport[] {
  const code = stripComments(text);
  const imports: ModuleImport[] = [];
  IMPORT_CLAUSE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = IMPORT_CLAUSE.exec(code)) !== null) {
    const [, clause, spec] = m;
    const braces = /\{([^}]*)\}/.exec(clause);
    const named = braces
      ? braces[1]
          .split(',')
          .map((binding) => binding.trim().split(/\s+as\s+/)[0].trim())
          .filter((name) => name.length > 0 && name !== 'type')
      : [];
    // Anything outside the braces that is not whitespace or a comma is a namespace or
    // default binding.
    const outsideBraces = clause.replace(/\{[^}]*\}/, '').trim();
    const wildcard = outsideBraces.replace(/,/g, '').trim().length > 0;
    imports.push({ spec, named, wildcard });
  }
  return imports;
}

/** Node core / I/O modules that a PURE layer must never import. `path` is intentionally allowed (string ops, no I/O). */
export const IO_MODULES: ReadonlySet<string> = new Set([
  'fs',
  'child_process',
  'net',
  'http',
  'http2',
  'https',
  'os',
  'readline',
  'worker_threads',
  'dgram',
  'tls',
  'cluster',
  'inspector',
  'vm',
  'dns',
  'repl',
]);

/** True when the specifier resolves to a forbidden I/O core module (handles `node:` prefix and subpaths like `fs/promises`). */
export function isIoSpecifier(spec: string): boolean {
  const withoutProtocol = spec.startsWith('node:') ? spec.slice('node:'.length) : spec;
  const root = withoutProtocol.split('/')[0];
  return IO_MODULES.has(root);
}

/** True when the (pure-layer) source touches the `process` global (env, cwd, exit, …). */
export function usesProcessGlobal(text: string): boolean {
  return /\bprocess\s*\./.test(stripComments(text));
}

const MESSAGE_REGEX_OPS =
  /(\.match\s*\(|\.matchAll\s*\(|\.exec\s*\(|\.test\s*\(|\.replace\s*\(|\.replaceAll\s*\(|\.split\s*\(\s*\/|new\s+RegExp\b|RegExp\s*\()/;

/**
 * Heuristic detector for the no-regex-message-parsing invariant: flags source
 * that applies a regex operation in proximity to a diagnostic `.message`
 * access (the old "parse the English message back into params" anti-pattern).
 *
 * Matches a `.message` access and a regex op within the same line or the
 * immediately following line (to catch fluent chains split across lines).
 * Returns the 1-based line + snippet of the first offence, or `null`.
 */
export function hasMessageRegexParsing(text: string): { line: number; snippet: string } | null {
  const lines = stripComments(text).split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!/\.message\b/.test(line)) continue;
    const window = line + '\n' + (lines[i + 1] ?? '');
    if (MESSAGE_REGEX_OPS.test(window)) {
      return { line: i + 1, snippet: window.trim() };
    }
  }
  return null;
}

const DECLARATION =
  /\b(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:abstract\s+)?(?:class|function|interface|enum|const|let|var|type)\s+([A-Za-z_$][\w$]*)/g;

/**
 * Names DECLARED by this source — classes, functions, types, consts.
 *
 * Deliberately not "names mentioned": the invariant is about re-implementing a
 * capability another package owns, and IMPORTING `findRoot` or naming
 * `AugmentedPlatformOSDocset` in a comment is the opposite of the violation. Only a
 * declaration creates a second implementation.
 */
export function declaredSymbols(text: string): string[] {
  const code = stripComments(text);
  const names = new Set<string>();
  DECLARATION.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = DECLARATION.exec(code)) !== null) names.add(m[1]);
  return [...names];
}

/** True when the source reintroduces the old regex re-parsing layer by name. */
export function usesLegacyParamExtraction(text: string): boolean {
  const code = stripComments(text);
  return (
    /\b(?:extractParams|templateOf)\s*\(/.test(code) ||
    /['"][^'"]*diagnostic-record[^'"]*['"]/.test(code)
  );
}
