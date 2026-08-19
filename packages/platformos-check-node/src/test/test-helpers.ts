import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Offense, path as pathUtils } from '@platformos/platformos-check-common';
import { Parser, uriFromPath } from '@platformos/platformos-common';
import { lintBuffer, LintBufferParams, nodeParsers } from '../index';

export async function makeTmpFolder() {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'test-'));
  await fs.mkdir(path.join(tmpDir, '.git'));
  return tmpDir;
}

export async function removeTmpFolder(tempDir: string) {
  return fs.rm(tempDir, { recursive: true, force: true });
}

export async function createMockConfigFile(
  tempDir: string,
  contents: string = 'dummy content',
  relativePath: string = '.platformos-check.yml',
): Promise<string> {
  const filePath = path.join(tempDir, relativePath);
  await fs.writeFile(filePath, contents, 'utf8');
  return filePath;
}

export const mockNodeModuleCheck = `
  const NodeModuleCheck = {
    meta: {
      name: 'NodeModuleCheck',
      code: 'NodeModuleCheck',
      docs: { description: '...' },
      schema: {},
      severity: 0,
      targets: [],
      type: 'LiquidHtml',
    },
    create() {
      return {};
    },
  };

  exports.checks = [
    NodeModuleCheck,
  ];
`;

export async function createMockNodeModule(
  tempDir: string,
  moduleName: string,
  moduleContent: string = mockNodeModuleCheck,
): Promise<string> {
  const nodeModuleRoot = path.join(tempDir, 'node_modules', ...moduleName.split('/'));
  await fs.mkdir(nodeModuleRoot, { recursive: true });
  await fs.writeFile(
    path.join(nodeModuleRoot, 'package.json'),
    JSON.stringify({
      name: moduleName,
      main: './index.js',
    }),
    'utf8',
  );
  await fs.writeFile(path.join(nodeModuleRoot, 'index.js'), moduleContent);
  return nodeModuleRoot;
}

export type Tree = {
  [k in string]: Tree | string;
};

export interface Workspace {
  rootUri: string;
  /** Absolute filesystem path of the workspace root — what `root`-taking APIs want. */
  root: string;
  uri(relativePath: string): string;
  clean(): Promise<any>;
}

/**
 * How many of a workspace's files are written at once.
 *
 * Not a tuning knob. Every queued `writeFile` opens its descriptor before any of them closes,
 * so one unbounded `Promise.all` holds ONE PER FILE — measured at a peak of 20 021 for a
 * 20 000-file tree, against 85 in batches of 64, for the same wall-clock. Linux tolerates
 * that (Node raises its own soft limit at startup, so `ulimit -n 256` does not even bite),
 * which is exactly why it is invisible until Windows CI: the CRT caps a process at 8192, and
 * a 10 010-file fixture died there with `EMFILE` on file 8188.
 */
const WRITE_CONCURRENCY = 64;

export async function makeTempWorkspace(structure: Tree): Promise<Workspace> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'platformos-check-'));
  if (!root) throw new Error('Could not create temp dir for temp workspace');

  const writes: (() => Promise<void>)[] = [];
  await createDirectories(structure, [root], writes);
  for (let i = 0; i < writes.length; i += WRITE_CONCURRENCY) {
    await Promise.all(writes.slice(i, i + WRITE_CONCURRENCY).map((write) => write()));
  }

  // `uriFromPath`, not `'file:' + root`: on Windows the concatenation keeps the drive
  // and the backslashes, so a test would hand the API under test a root spelled
  // differently from the one it produces itself.
  const rootUri = uriFromPath(root);

  return {
    rootUri,
    root,
    uri: (relativePath) => pathUtils.join(rootUri, ...relativePath.split('/')),
    clean: async () => fs.rm(root, { recursive: true, force: true }),
  };

  /** Create every directory of the tree, collecting the file writes to run afterwards. */
  async function createDirectories(
    tree: Tree,
    ancestors: string[],
    writes: (() => Promise<void>)[],
  ): Promise<void> {
    for (const [pathEl, value] of Object.entries(tree)) {
      const target = path.join(...ancestors, pathEl);
      if (typeof value === 'string') {
        writes.push(() => fs.writeFile(target, value, 'utf8'));
      } else {
        await fs.mkdir(target);
        await createDirectories(value, ancestors.concat(pathEl), writes);
      }
    }
  }
}

/**
 * `lintBuffer` for a test that is about the OFFENSES, asserting on the way through
 * that the file was actually checked.
 *
 * `lintBuffer` answers with a status as well as offenses, because an empty list
 * means "clean" only when the status says the checks ran. A test that reads the
 * offenses and ignores the status would pass just as happily against a file the
 * config excludes — which is the confusion the status exists to remove.
 */
export async function lintBufferOffenses(params: LintBufferParams): Promise<Offense[]> {
  const result = await lintBuffer(params);
  if (result.status !== 'checked') {
    throw new Error(`Expected ${params.filePath} to be checked, but it was ${result.status}`);
  }
  return result.offenses;
}

/**
 * Run `lint` with the injected Liquid parser wrapped, and report which files it
 * parsed.
 *
 * Spying on the PARSER rather than on the filesystem is what isolates AST cost
 * from the reads some checks make for their own reasons — `RouteTable` reading
 * page frontmatter, translation files being loaded as YAML.
 */
export async function withCountedLiquidParses<T>(
  lint: () => Promise<T>,
): Promise<{ result: T; parsedUris: string[] }> {
  const parsers = nodeParsers as Record<string, Parser | undefined>;
  const original = parsers.LiquidHtml!;
  const parsedUris: string[] = [];

  parsers.LiquidHtml = (source, uri) => {
    parsedUris.push(uri);
    return original(source, uri);
  };

  try {
    return { result: await lint(), parsedUris };
  } finally {
    parsers.LiquidHtml = original;
  }
}
