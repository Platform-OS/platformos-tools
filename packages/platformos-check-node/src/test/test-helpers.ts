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

export async function makeTempWorkspace(structure: Tree): Promise<Workspace> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'platformos-check-'));
  if (!root) throw new Error('Could not create temp dir for temp workspace');

  await createFiles(structure, [root]);

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

  function createFiles(tree: Tree, ancestors: string[]): Promise<any> {
    const promises: Promise<any>[] = [];
    for (const [pathEl, value] of Object.entries(tree)) {
      if (typeof value === 'string') {
        promises.push(fs.writeFile(path.join(...ancestors, pathEl), value, 'utf8'));
      } else {
        promises.push(
          fs
            .mkdir(path.join(...ancestors, pathEl))
            .then(() => createFiles(value, ancestors.concat(pathEl))),
        );
      }
    }
    return Promise.all(promises);
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
