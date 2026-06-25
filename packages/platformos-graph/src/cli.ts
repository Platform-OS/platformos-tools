import nodePath from 'node:path';
import fs from 'node:fs/promises';
import { findRoot, makeFileExists, path } from '@platformos/platformos-check-common';
import { AbstractFileSystem, FileStat, FileTuple, FileType } from '@platformos/platformos-common';
import { URI } from 'vscode-uri';
import { buildAppGraph } from './graph/build';
import { serializeAppGraph } from './graph/serialize';
import { Reference, SerializableGraph } from './types';

/**
 * A self-contained {@link AbstractFileSystem} backed by `node:fs`.
 *
 * The graph driver speaks file URIs, so every method converts the incoming URI
 * to a native path with `path.fsPath` and re-emits child URIs with `path.join`
 * (which preserves the `file://` scheme). This mirrors `NodeFileSystem` from
 * `@platformos/platformos-check-node` exactly, but is inlined here so the CLI
 * runs with only this package's own dependencies — `platformos-check-node` is a
 * dev-only dependency and must not be required at runtime.
 */
export const nodeFileSystem: AbstractFileSystem = {
  async readFile(uri: string): Promise<string> {
    return fs.readFile(path.fsPath(uri), 'utf8');
  },

  async readDirectory(uri: string): Promise<FileTuple[]> {
    const entries = await fs.readdir(path.fsPath(uri), { withFileTypes: true });
    return entries.map((entry) => [
      path.join(uri, entry.name),
      entry.isDirectory() ? FileType.Directory : FileType.File,
    ]);
  },

  async stat(uri: string): Promise<FileStat> {
    try {
      const stats = await fs.stat(path.fsPath(uri));
      return {
        type: stats.isDirectory() ? FileType.Directory : FileType.File,
        size: stats.size,
      };
    } catch (e) {
      throw new Error(`Failed to get file stat: ${e}`);
    }
  },
};

/**
 * The dependency and reference edges of a single module, as produced for the
 * CLI's single-file mode.
 */
export interface SerializableFileDependencies {
  /** The resolved file URI, as keyed in the graph. */
  uri: string;
  /** Outgoing edges — the modules this file renders/includes/runs/queries. */
  dependencies: Reference[];
  /** Incoming edges — the modules that render/include/run/query this file. */
  references: Reference[];
}

/**
 * Resolves the given root path (absolute, or relative to `process.cwd()`) to the
 * forward-slash-normalized `file://` URI of the enclosing platformOS project,
 * using the same `findRoot` heuristic as the language server (an `app/`,
 * `modules/`, `.pos`, or `.platformos-check.yml` marker at or above the path).
 *
 * Throws when no project is found, so a typo'd or non-platformOS directory fails
 * loudly instead of silently producing an empty graph. Resolving via `findRoot`
 * also lets the CLI be pointed anywhere inside a project, not just at its root.
 *
 * Normalization is load-bearing: the graph keys every module via `path.join` /
 * `path.normalize` (forward slashes), so any lookup must key the same way or it
 * silently misses on Windows, where raw URIs keep backslashes.
 */
async function resolveProjectRoot(root: string, fs: AbstractFileSystem): Promise<string> {
  const absolute = nodePath.isAbsolute(root) ? root : nodePath.resolve(process.cwd(), root);
  const startUri = path.normalize(URI.file(absolute));

  const rootUri = await findRoot(startUri, makeFileExists(fs));
  if (!rootUri) {
    throw new Error(
      `Not a platformOS project: ${startUri}\n` +
        `No app/, modules/, .pos, or .platformos-check.yml found at or above this path. ` +
        `Pass the path to a platformOS app directory.`,
    );
  }
  return rootUri;
}

/**
 * Resolves the single-file argument to a graph module key. An absolute path is
 * taken as-is; a relative path is resolved against the project **root** (not
 * `process.cwd()`), matching the natural "a file within this project" mental
 * model — only files under the root can appear in the graph anyway.
 */
function resolveFileUri(rootUri: string, file: string): string {
  if (nodePath.isAbsolute(file)) {
    return path.normalize(URI.file(file));
  }
  return path.join(rootUri, ...file.split(/[\\/]+/).filter(Boolean));
}

/**
 * Builds the platformOS app graph for the project rooted at `root` (a native
 * filesystem path, absolute or relative to `process.cwd()`) and returns it in
 * serializable JSON form.
 *
 * `fs` is injectable for testing; it defaults to the node-backed filesystem.
 */
export async function buildSerializedGraph(
  root: string,
  fs: AbstractFileSystem = nodeFileSystem,
): Promise<SerializableGraph> {
  const graph = await buildAppGraph(await resolveProjectRoot(root, fs), { fs });
  return serializeAppGraph(graph);
}

/**
 * Builds the full app graph for `root` and returns the dependency and reference
 * edges of the single module at `file`.
 *
 * The graph is built from its real entry points (every layout and page), not
 * seeded from `file`, so that incoming `references` are complete — the same
 * approach the language server's `AppGraphManager` takes. A file that is not
 * reachable from any entry point therefore has no node in the graph; rather
 * than reporting a misleading empty edge set, this throws.
 *
 * `fs` is injectable for testing; it defaults to the node-backed filesystem.
 */
export async function buildSerializedFileDependencies(
  root: string,
  file: string,
  fs: AbstractFileSystem = nodeFileSystem,
): Promise<SerializableFileDependencies> {
  const rootUri = await resolveProjectRoot(root, fs);
  const fileUri = resolveFileUri(rootUri, file);
  const graph = await buildAppGraph(rootUri, { fs });

  const module = graph.modules[fileUri];
  if (!module) {
    throw new Error(
      `File is not part of the app graph: ${fileUri}\n` +
        `It must exist and be reachable from a layout or page entry point. ` +
        `Check the path is correct and inside the project root (${rootUri}).`,
    );
  }

  return {
    uri: module.uri,
    dependencies: module.dependencies,
    references: module.references,
  };
}
