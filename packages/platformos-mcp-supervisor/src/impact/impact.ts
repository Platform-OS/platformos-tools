/**
 * Impact (blast-radius) adapter — an I/O boundary on the request path (sibling
 * to `lint/`).
 *
 * Answers the one question lint structurally cannot: "who DEPENDS ON the file
 * being edited?" — its incoming references across the project. Derived from the
 * cached project graph via platformos-graph's `dependentsOf`; the supervisor
 * owns only the shaping, never the reverse-index logic.
 *
 * The graph is NEVER served stale (see {@link GraphCache}): if the project
 * changed since the last build, this reports `computing` rather than a possibly
 * out-of-date answer. The dependents list does NOT depend on the in-flight
 * buffer — who points AT the file lives in OTHER files — so no buffer overlay is
 * needed here (the buffer matters only to signature-impact, added separately).
 */
import {
  extractDocDefinition,
  isKnownGraphQLFile,
  isKnownLiquidFile,
  path,
  SourceCodeType,
  type UriString,
} from '@platformos/platformos-check-common';
import {
  type AppGraph,
  dependentsOf,
  type ReferenceKind,
  toSourceCode,
} from '@platformos/platformos-graph';

import { toAbsoluteFilePath, type AdapterInput } from '../adapter-input';
import type { GraphCache } from '../graph-cache/graph-cache';
import type { ValidateCodeImpact, ValidateCodeSignatureRisk } from '../result/types';

/** Number of referencing files listed in `sample`/`signature_risk` before truncating. */
const SAMPLE_LIMIT = 10;

/**
 * The edge kinds whose call-site arguments are validated against a partial's
 * `{% doc %}` `@param` contract — EXACTLY the kinds the `PartialCallArguments`
 * lint check validates (`render`/`include` via its `RenderMarkup` handler,
 * `function` via `FunctionMarkup`). `background`/`graphql`/`layout`/`asset` edges
 * carry scheduling/operation arguments that are NOT `@param`s, so signature-impact
 * must ignore them or it would flag correct calls (a false positive that the
 * forward `PartialCallArguments` check never produces).
 */
const SIGNATURE_EDGE_KINDS: ReadonlySet<ReferenceKind> = new Set(['render', 'include', 'function']);

/**
 * Whether the graph can model incoming references to `uri` — i.e. `uri` can be a
 * resolvable edge TARGET (a Liquid page/layout/partial, or a GraphQL operation).
 * Reuses check-common's canonical classifiers so this cannot drift from the
 * graph's own edge resolution.
 *
 * Files that are NOT edge targets — schema / custom-model-type / translation YAML,
 * or any unclassified file — are wired by model/table NAME, not by file reference
 * (ADR 004), so the graph has no dependents for them and `total: 0` would be a
 * false "safe to change". Those get `status: 'not_applicable'` instead.
 */
function isGraphTrackable(uri: UriString): boolean {
  return isKnownLiquidFile(uri) || isKnownGraphQLFile(uri);
}

/** A fresh zeroed dependents shape for every non-`computed` status. */
const noDependents = (): ValidateCodeImpact['dependents'] => ({
  total: 0,
  by_kind: {},
  sample: [],
});

/**
 * Compute the edited file's blast radius from the cached project graph. Reports
 * `computing`/`unavailable` (with zeroed dependents) when a fresh graph is not
 * available — never a stale answer.
 */
export async function runImpact(
  params: AdapterInput,
  cache: GraphCache,
): Promise<ValidateCodeImpact> {
  const { projectDir, filePath, content } = params;
  const rootUri = path.normalize(path.URI.file(projectDir));
  const fileUri = path.normalize(path.URI.file(toAbsoluteFilePath(projectDir, filePath)));

  // Applicability is a property of the FILE TYPE, independent of graph freshness:
  // a non-trackable file (schema/translation YAML, etc.) has no dependency edges,
  // so short-circuit before touching the graph — `total: 0` here would be a false
  // "safe to change" (see {@link isGraphTrackable}).
  if (!isGraphTrackable(fileUri)) {
    return { scope: 'direct', status: 'not_applicable', dependents: noDependents() };
  }

  const lookup = await cache.lookup();
  if (!lookup.graph) {
    const status = lookup.reason === 'unavailable' ? 'unavailable' : 'computing';
    return { scope: 'direct', status, dependents: noDependents() };
  }

  const signature = await docSignature(fileUri, content);
  const signature_risk =
    signature && computeSignatureRisk(lookup.graph, fileUri, rootUri, signature);

  return {
    scope: 'direct',
    status: 'computed',
    dependents: summarizeDependents(lookup.graph, fileUri, rootUri),
    ...(signature_risk ? { signature_risk } : {}),
  };
}

/**
 * Reduce the incoming reference edges of `fileUri` to the agent-facing summary:
 * distinct referencing FILES (`total`), distinct files per edge kind
 * (`by_kind`), and a capped, sorted `sample` of project-relative caller paths.
 */
function summarizeDependents(
  graph: Parameters<typeof dependentsOf>[0],
  fileUri: UriString,
  rootUri: UriString,
): ValidateCodeImpact['dependents'] {
  // caller path (project-relative) → the edge kinds by which it references the file
  const callers = new Map<string, Set<string>>();
  for (const ref of dependentsOf(graph, fileUri)) {
    if (!ref.kind) continue; // every graph edge carries a kind; defensive only
    const caller = path.relative(ref.source.uri, rootUri);
    const kinds = callers.get(caller) ?? new Set<string>();
    kinds.add(ref.kind);
    callers.set(caller, kinds);
  }

  const by_kind: Record<string, number> = {};
  for (const kinds of callers.values()) {
    for (const kind of kinds) by_kind[kind] = (by_kind[kind] ?? 0) + 1;
  }

  const sample = [...callers.keys()].sort((a, b) => a.localeCompare(b)).slice(0, SAMPLE_LIMIT);

  return { total: callers.size, by_kind, sample };
}

/** The `{% doc %}` parameter contract of the in-flight buffer, or `null` when it declares none. */
interface DocSignature {
  required: string[];
  allowed: string[];
}

/**
 * The edited buffer's `{% doc %}` parameter contract (required + all declared
 * names), or `null` when the buffer is non-Liquid, unparseable, or declares no
 * `{% doc %}` block. Reuses check-common's `extractDocDefinition` — the same
 * primitive the `PartialCallArguments` check reads for the doc case — so the
 * two never diverge. `null` deliberately disables signature-impact: without an
 * explicit contract we do NOT guess a signature (no false positives).
 */
async function docSignature(fileUri: UriString, content: string): Promise<DocSignature | null> {
  const sourceCode = await toSourceCode(fileUri, content);
  if (sourceCode.type !== SourceCodeType.LiquidHtml || sourceCode.ast instanceof Error) return null;

  const definition = await extractDocDefinition(fileUri, sourceCode.ast);
  const parameters = definition.liquidDoc?.parameters;
  if (!parameters || parameters.length === 0) return null;

  return {
    required: parameters.filter((p) => p.required).map((p) => p.name),
    allowed: parameters.map((p) => p.name),
  };
}

/**
 * The dependent callers whose passed arguments violate `signature` — missing a
 * required `@param`, or passing one the `{% doc %}` block does not declare. The
 * cross-file inverse of `PartialCallArguments`: it checks the edited file's
 * contract against every existing caller at once. Deduplicated per caller,
 * sorted, and capped.
 */
function computeSignatureRisk(
  graph: AppGraph,
  fileUri: UriString,
  rootUri: UriString,
  signature: DocSignature,
): ValidateCodeSignatureRisk[] {
  const byCaller = new Map<string, { missing: Set<string>; unexpected: Set<string> }>();

  for (const ref of dependentsOf(graph, fileUri)) {
    // Only the kinds whose args ARE `@param`s (see {@link SIGNATURE_EDGE_KINDS}) —
    // a `{% background %}`/`{% graphql %}`/layout edge's args are not, and flagging
    // them would be a false positive the forward check never makes.
    if (!ref.kind || !SIGNATURE_EDGE_KINDS.has(ref.kind)) continue;
    const args = ref.args ?? [];
    const missing = signature.required.filter((param) => !args.includes(param));
    const unexpected = args.filter((arg) => !signature.allowed.includes(arg));
    if (missing.length === 0 && unexpected.length === 0) continue;

    const caller = path.relative(ref.source.uri, rootUri);
    const entry = byCaller.get(caller) ?? { missing: new Set(), unexpected: new Set() };
    for (const m of missing) entry.missing.add(m);
    for (const u of unexpected) entry.unexpected.add(u);
    byCaller.set(caller, entry);
  }

  return [...byCaller.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(0, SAMPLE_LIMIT)
    .map(([caller, { missing, unexpected }]) => ({
      caller,
      missing_required: [...missing].sort((a, b) => a.localeCompare(b)),
      unexpected_args: [...unexpected].sort((a, b) => a.localeCompare(b)),
    }));
}
