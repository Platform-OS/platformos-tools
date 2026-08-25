/**
 * Which files depend on the one being edited — the input to the lint diff, and nothing more.
 *
 * This module answers only "which files should I lint to find out what this change broke".
 * It never decides whether something IS broken: that is the check engine's job, and the
 * whole point of the diff is to stop reimplementing it here.
 *
 * NO EDGE-KIND FILTER, deliberately. An earlier version kept only `render`/`include`/
 * `function` because it compared arguments by hand and any other kind produced false
 * positives. The engine has no such problem — a `{% background %}` caller, a layout edge or
 * an asset reference can each be broken by an edit — so every kind is a dependant here.
 *
 * `null` means NOT LOOKED AT: too much candidate text to examine inside the deadline. It is
 * not "no dependants" and must never be reported as one.
 *
 * SOUND, NOT COMPLETE, and the gap is not closable. Every edge platformos-graph records
 * names its target with a STATIC STRING LITERAL, so a dependant's text must contain the
 * target's logical name; filtering on that is a sound over-approximation leaving few
 * survivors (measured p50 1, p90 6 candidates on a 2,615-file project), and 0 of 8,464 real
 * edges were dropped by it. What it cannot see is a caller that names its target at runtime
 * or does not parse — see `frontier.ts`, which reports exactly that gap rather than hiding
 * it.
 */
import { path, SourceCodeType, type UriString } from '@platformos/platformos-check-common';

import { MAX_CANDIDATE_BYTES } from '../cost-model.js';
import { sourceCodeTypeOf, uriToName } from '@platformos/platformos-common';
import { extractFileReferences, toSourceCode } from '@platformos/platformos-graph';

import type { ProjectScan } from './project-scan.js';

/**
 * Whether this file could have dependants AT ALL — decidable from its path alone, with no
 * project read and no parse.
 *
 * TWO CONDITIONS, and both are load-bearing:
 *
 *   - it must be a resolvable edge TARGET, which means Liquid or GraphQL. Schema,
 *     custom-model-type and translation YAML are deliberately excluded: they are wired by
 *     model, table or translation-key NAME rather than by file reference (ADR 004), so the
 *     graph holds no edge to them and asking would silently answer "nothing depends on this".
 *     Giving those files real dependants is TASK-95, in the graph rather than here.
 *   - it must have a logical NAME, since a reference spells one. A source in no platformOS
 *     directory has none and so cannot be referenced.
 *
 * Asked twice on purpose: by the orchestrator, to skip reading the project for a changeset
 * that cannot use it, and by impact itself. One predicate, so the two cannot disagree about
 * whether that read was needed.
 */
export function canHaveDependants(uri: UriString, rootUri: UriString): boolean {
  const type = sourceCodeTypeOf(uri);
  const isEdgeTarget = type === SourceCodeType.LiquidHtml || type === SourceCodeType.GraphQL;
  return isEdgeTarget && uriToName(uri, rootUri)?.name !== undefined;
}

/**
 * The distinct files that reference `fileUri`, excluding anything in `exclude`.
 *
 * `exclude` carries the changeset: a file being edited is already reported on its own terms,
 * and linting it again as somebody's dependant would report the same finding twice. It also
 * makes the scan's text the DISK text for every dependant returned, which is exactly what
 * the diff's baseline pass needs — the scan overlays buffers, so excluding them is what
 * keeps the baseline honest without a second read.
 */
export async function dependantsOf(
  scan: ProjectScan,
  fileUri: UriString,
  name: string,
  exclude: ReadonlySet<UriString>,
): Promise<UriString[] | null> {
  const sources = await scan.sources();
  const candidates = [...sources].filter(
    ([uri, source]) => !exclude.has(uri) && uri !== fileUri && source.includes(name),
  );

  // BOUNDED BEFORE THE EXPENSIVE PART. Parsing is what discovery costs, and the byte total
  // is known from the substring scan already done — so a file referenced from too much text
  // to examine says so in milliseconds instead of spending seconds to reach the same answer.
  const bytes = candidates.reduce((total, [, source]) => total + Buffer.byteLength(source), 0);
  if (bytes > MAX_CANDIDATE_BYTES) return null;

  const perCandidate = await Promise.all(
    candidates.map(async ([uri, source]) => {
      const sourceCode = await toSourceCode(uri, source);
      const references = await extractFileReferences(scan.rootUri, uri, sourceCode, {
        fs: scan.fs,
      });
      // The name filter over-approximates; resolving through the graph's OWN resolver is
      // what makes the answer exact. A file that merely mentions the name contributes
      // nothing.
      return references.some((reference) => reference.target.uri === fileUri) ? uri : undefined;
    }),
  );

  return perCandidate
    .filter((uri): uri is UriString => uri !== undefined)
    .sort((a, b) => a.localeCompare(b));
}

/**
 * A dependant as the lint takes it: an absolute path and the text on disk.
 *
 * Carries its own `uri` rather than relying on position, because {@link toDependantBuffers}
 * can DROP an entry — zipping the result back against the input by index would then pair
 * every later buffer with the wrong file, silently.
 */
export interface DependantBuffer {
  uri: UriString;
  filePath: string;
  content: string;
}

/**
 * Turn dependant URIs into lint buffers, reading their text from the scan the discovery
 * already paid for rather than going back to disk.
 */
export function toDependantBuffers(
  uris: readonly UriString[],
  sources: ReadonlyMap<UriString, string>,
): DependantBuffer[] {
  const buffers: DependantBuffer[] = [];
  for (const uri of uris) {
    const content = sources.get(uri);
    // A URI the scan does not hold cannot be linted from it. Unreachable — every dependant
    // came OUT of this map — but defaulting to empty text would lint a file as blank and
    // report every one of its findings as newly caused.
    if (content === undefined) continue;
    buffers.push({ uri, filePath: path.URI.parse(uri).fsPath, content });
  }
  return buffers;
}
