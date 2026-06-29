/**
 * Structure adapter — an I/O boundary on the request path (sibling to `lint/`).
 *
 * Resolves the validated buffer's outgoing dependency edges via
 * platformos-graph's per-file primitive `extractFileReferences`, then maps the
 * resulting `Reference[]` into the agent-facing `ValidateCodeDependency[]`.
 *
 * The supervisor owns ONLY the mapping. Graph resolution lives in
 * platformos-graph; offset→line/col and uri→project-relative math are REUSED
 * from platformos-check-common (`getPosition`, `path.relative`). No graph or
 * path logic is re-implemented here.
 *
 * Like `lint/`, this parses the IN-FLIGHT buffer (not disk), so it works for a
 * file the agent is about to write that does not exist yet. Only the on-disk
 * project is touched (via `fs`) to resolve targets.
 */
import { isAbsolute, join } from 'node:path';

import { getPosition, path } from '@platformos/platformos-check-common';
import { NodeFileSystem } from '@platformos/platformos-check-node';
import { extractFileReferences, toSourceCode, type Reference } from '@platformos/platformos-graph';

import type { ValidateCodeDependency } from '../result/types';

export interface RunStructureParams {
  /** Absolute project root the buffer is resolved against. */
  projectDir: string;
  /** File under edit — absolute, or relative to `projectDir`. */
  filePath: string;
  /** In-memory buffer contents. */
  content: string;
}

/** Resolve the buffer's outgoing dependency edges and map them for the agent. */
export async function runStructure(params: RunStructureParams): Promise<ValidateCodeDependency[]> {
  const { projectDir, filePath, content } = params;
  const absoluteFilePath = isAbsolute(filePath) ? filePath : join(projectDir, filePath);

  // Normalized file URIs (forward slashes) so the graph's normalized target
  // URIs share this exact root prefix — `path.relative` strips it cleanly on
  // every platform.
  const rootUri = path.normalize(path.URI.file(projectDir));
  const sourceUri = path.normalize(path.URI.file(absoluteFilePath));

  const sourceCode = await toSourceCode(sourceUri, content);
  const references = await extractFileReferences(rootUri, sourceUri, sourceCode, {
    fs: NodeFileSystem,
  });

  return references.flatMap((ref) => toDependency(ref, rootUri, content));
}

/**
 * Map one graph `Reference` to a `ValidateCodeDependency`. `kind` and
 * `source.range` are always populated by `extractFileReferences`; the guards
 * keep the mapping total and defensive. check-common's `getPosition` yields
 * 0-based line/character — the agent surface is 1-based, so both get `+ 1`.
 */
function toDependency(ref: Reference, rootUri: string, content: string): ValidateCodeDependency[] {
  if (!ref.kind || !ref.source.range) return [];
  const { line, character } = getPosition(content, ref.source.range[0]);
  return [
    {
      kind: ref.kind,
      target: path.relative(ref.target.uri, rootUri),
      line: line + 1,
      column: character + 1,
    },
  ];
}
