/**
 * Impact (blast-radius) adapter — an I/O boundary on the request path (sibling
 * to `lint/`).
 *
 * Answers the one question lint structurally cannot: "who DEPENDS ON the file
 * being edited?" — its incoming references across the project.
 *
 * HOW, AND WHY IT IS NOT A GRAPH. Every edge platformos-graph records names its target with
 * a STATIC STRING LITERAL: the operand of `render`/`include`/`function`/`background`/
 * `graphql`, the operand of `asset_url`, or an explicit frontmatter `layout:` (an omitted
 * `layout:` synthesizes no edge — see `traverse.ts`). So a file's dependents can only be
 * among the edge sources whose TEXT contains its logical name, and filtering on that name is
 * a sound over-approximation leaving few survivors (measured p50 1, p90 6 candidates on a
 * 2,615-file project). Those are parsed and resolved with {@link extractFileReferences}, the
 * SAME resolver `buildAppGraph` runs, so this answer cannot drift from the graph's — 80
 * targets sampled across two real projects produced 0 mismatches on `(source, kind, args)`.
 *
 * THERE IS NO `computing` STATE. The answer is derived from the project as it is at request
 * time, so it is fresh by construction. A failure or the deadline yields `unavailable`; a
 * file the graph cannot model yields `not_applicable`; everything else is `computed`.
 *
 * The dependents list reads the CHANGESET, not just disk: `ProjectScan` overlays the buffers
 * under validation, so a caller a buffer has just added or removed is counted.
 */
import {
  extractDocDefinition,
  path,
  SourceCodeType,
  type UriString,
} from '@platformos/platformos-check-common';
import { sourceCodeTypeOf, uriToName } from '@platformos/platformos-common';
import {
  extractFileReferences,
  toSourceCode,
  type Reference,
  type ReferenceKind,
} from '@platformos/platformos-graph';

import { toAbsoluteFilePath, type AdapterInput } from '../adapter-input.js';
import { NOT_APPLICABLE_IMPACT } from '../result/impact-states.js';
import type { ValidateCodeImpact, ValidateCodeSignatureRisk } from '../result/types.js';
import type { ProjectScan } from './project-scan.js';

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
  // The graph's edge-target types, asked by extension. Naming the two explicitly keeps the
  // YAML case visibly excluded, which is the distinction the docblock above turns on.
  const type = sourceCodeTypeOf(uri);
  return type === SourceCodeType.LiquidHtml || type === SourceCodeType.GraphQL;
}

/**
 * Compute the edited file's blast radius from the project as it is right now.
 * Reports `not_applicable` when nothing could reference the file by name, and
 * throws only on real I/O failure — the caller degrades that to `unavailable`.
 */
export async function runImpact(
  params: AdapterInput,
  scan: ProjectScan,
): Promise<ValidateCodeImpact> {
  const { projectDir, filePath, content } = params;
  const rootUri = path.normalize(path.URI.file(projectDir));
  const fileUri = path.normalize(path.URI.file(toAbsoluteFilePath(projectDir, filePath)));

  // Applicability is a property of the FILE, independent of any scan: a non-trackable file
  // has no dependency edges, and a file in no platformOS directory has no logical NAME for
  // a reference to spell. `total: 0` for either would be a false "safe to change".
  const name = uriToName(fileUri, rootUri)?.name;
  if (!isGraphTrackable(fileUri) || name === undefined) {
    return NOT_APPLICABLE_IMPACT();
  }

  const dependents = await incomingReferences(scan, fileUri, name);

  // `signature_risk: []` claims "checked, every caller matches". With no dependents found AND
  // the file not on disk, nothing was checked — the callers may have been sent in a different
  // call — so the affirmative is withheld rather than earned falsely.
  //
  // `dependents` itself stands. It is a true statement about the project as it is, and a file
  // that is not yet on disk is the NORMAL case for this tool, which exists to be called
  // before the write.
  const callersAreKnowable = dependents.length > 0 || (await existsOnDisk(scan, fileUri));

  const signature = callersAreKnowable ? await docSignature(fileUri, content) : null;
  const signature_risk = signature && computeSignatureRisk(dependents, rootUri, signature);

  return {
    scope: 'direct',
    status: 'computed',
    dependents: summarizeDependents(dependents, rootUri),
    ...(signature_risk ? { signature_risk } : {}),
  };
}

/** Whether the edited file exists on disk, as opposed to existing only as an in-flight buffer. */
async function existsOnDisk(scan: ProjectScan, fileUri: UriString): Promise<boolean> {
  return scan.fs
    .stat(fileUri)
    .then(() => true)
    .catch(() => false);
}

/**
 * Every reference in the project that resolves to `fileUri`.
 *
 * The name filter is what keeps this cheap, and it is sound rather than heuristic: an edge
 * exists only where a static literal spells the target's logical name. Everything past the
 * filter is exact — the survivors are resolved by the graph's own resolver, so a candidate
 * that merely MENTIONS the name contributes no reference.
 */
async function incomingReferences(
  scan: ProjectScan,
  fileUri: UriString,
  name: string,
): Promise<Reference[]> {
  const sources = await scan.sources();
  const candidates = [...sources].filter(([, source]) => source.includes(name));

  const perCandidate = await Promise.all(
    candidates.map(async ([uri, source]) => {
      const sourceCode = await toSourceCode(uri, source);
      return extractFileReferences(scan.rootUri, uri, sourceCode, { fs: scan.fs });
    }),
  );

  return perCandidate.flat().filter((reference) => reference.target.uri === fileUri);
}

/**
 * Reduce the incoming reference edges of the edited file to the agent-facing
 * summary: distinct referencing FILES (`total`), distinct files per edge kind
 * (`by_kind`), and a capped, sorted `sample` of project-relative caller paths.
 */
function summarizeDependents(
  references: readonly Reference[],
  rootUri: UriString,
): ValidateCodeImpact['dependents'] {
  // caller path (project-relative) → the edge kinds by which it references the file
  const callers = new Map<string, Set<string>>();
  for (const ref of references) {
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
  references: readonly Reference[],
  rootUri: UriString,
  signature: DocSignature,
): ValidateCodeSignatureRisk[] {
  const byCaller = new Map<string, { missing: Set<string>; unexpected: Set<string> }>();

  for (const ref of references) {
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
