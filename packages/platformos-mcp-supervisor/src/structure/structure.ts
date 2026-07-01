/**
 * Structure adapter — an I/O boundary on the request path (sibling to `lint/`).
 *
 * From the validated buffer it derives two agent-facing facts via
 * platformos-graph's per-file primitives, sharing a SINGLE parse:
 * - `dependencies`: the outgoing edges (`extractFileReferences`), mapped to
 *   `ValidateCodeDependency[]`;
 * - `structural`: the file's own declarations (`extractStructural`), mapped to
 *   `ValidateCodeStructuralSnapshot`.
 *
 * The supervisor owns ONLY the mapping. Graph resolution/extraction lives in
 * platformos-graph; offset→line/col and uri→project-relative math are REUSED
 * from platformos-check-common (`getPosition`, `path.relative`). No graph or
 * path logic is re-implemented here.
 *
 * Like `lint/`, this parses the IN-FLIGHT buffer (not disk), so it works for a
 * file the agent is about to write that does not exist yet. Only the on-disk
 * project is touched (via `fs`) to resolve targets.
 */
import { getPosition, path } from '@platformos/platformos-check-common';
import { NodeFileSystem } from '@platformos/platformos-check-node';
import {
  extractFileReferences,
  extractStructural,
  toSourceCode,
  type ModuleStructural,
  type Reference,
  type ReferenceKind,
} from '@platformos/platformos-graph';

import { toAbsoluteFilePath, type AdapterInput } from '../adapter-input';
import type {
  ValidateCodeDependency,
  ValidateCodeDependencyKind,
  ValidateCodeStructuralSnapshot,
} from '../result/types';

/**
 * The seam mapping the upstream graph `ReferenceKind` onto the agent-facing
 * `ValidateCodeDependencyKind`. Exhaustive by construction (`Record<ReferenceKind,
 * …>`): if the graph adds or renames a kind, this table fails to compile — the
 * agent surface never drifts silently. The names are 1:1 today; the table is the
 * insulation point, not a rename.
 */
const DEPENDENCY_KIND: Record<ReferenceKind, ValidateCodeDependencyKind> = {
  render: 'render',
  include: 'include',
  function: 'function',
  background: 'background',
  graphql: 'graphql',
  asset: 'asset',
  layout: 'layout',
};

export interface StructureResult {
  /** The file's resolved outgoing dependency edges. */
  dependencies: ValidateCodeDependency[];
  /** The file's own structural declarations, or `null` for a non-Liquid/unparseable buffer. */
  structural: ValidateCodeStructuralSnapshot | null;
}

/** Derive the buffer's dependency edges + self-structural, sharing one parse. */
export async function runStructure(params: AdapterInput): Promise<StructureResult> {
  const { projectDir, filePath, content } = params;
  const absoluteFilePath = toAbsoluteFilePath(projectDir, filePath);

  // Normalized file URIs (forward slashes) so the graph's normalized target
  // URIs share this exact root prefix — `path.relative` strips it cleanly on
  // every platform.
  const rootUri = path.normalize(path.URI.file(projectDir));
  const sourceUri = path.normalize(path.URI.file(absoluteFilePath));

  // One parse of the in-flight buffer, shared by both graph primitives.
  const sourceCode = await toSourceCode(sourceUri, content);
  const [references, structural] = await Promise.all([
    extractFileReferences(rootUri, sourceUri, sourceCode, { fs: NodeFileSystem }),
    extractStructural(sourceCode, sourceUri),
  ]);

  return {
    dependencies: references.flatMap((ref) => toDependency(ref, rootUri, content)),
    structural: structural ? toStructuralSnapshot(structural) : null,
  };
}

/**
 * Map the graph's `ModuleStructural` to the agent-facing snapshot: usage arrays
 * pass through (always present), and the optional routing facts become `null`
 * when the file does not declare them.
 */
function toStructuralSnapshot(structural: ModuleStructural): ValidateCodeStructuralSnapshot {
  return {
    renders_used: structural.renders_used,
    graphql_queries_used: structural.graphql_queries_used,
    filters_used: structural.filters_used,
    tags_used: structural.tags_used,
    translation_keys: structural.translation_keys,
    doc_params: structural.doc_params,
    slug: structural.slug ?? null,
    layout: structural.layout ?? null,
    method: structural.method ?? null,
  };
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
      kind: DEPENDENCY_KIND[ref.kind],
      target: path.relative(ref.target.uri, rootUri),
      line: line + 1,
      column: character + 1,
    },
  ];
}
