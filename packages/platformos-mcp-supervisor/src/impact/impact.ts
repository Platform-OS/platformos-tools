/**
 * Signature impact — an I/O boundary on the request path (sibling to `lint/`).
 *
 * Answers ONE cross-file question lint structurally cannot, because lint is per-file and
 * forward-looking: which EXISTING CALLERS does the `{% doc %}` contract in this buffer
 * break? The inverse of the `PartialCallArguments` check — that one validates a call
 * against a partial's contract, this validates a contract against its calls.
 *
 * IT NEVER ANSWERS "WHO DEPENDS ON THIS FILE", and the omission is the design. A file's
 * caller set is not decidable: `{% render partial_name %}` names its target at runtime, so
 * one variable anywhere makes "nothing references this" unprovable, and a caller that does
 * not parse contributes nothing either. Listing the callers we CAN see would be sound;
 * publishing a COUNT an agent reads as "safe to change" is not, and the two are one field.
 * So only mismatches are reported — each carried by the caller's own text — and their
 * absence is never published as a clearance.
 *
 * IT COSTS NOTHING WHEN THERE IS NO CONTRACT. The contract is read from the buffer already
 * in hand, and only if one exists is the project read at all. Measured on a real 2,768-file
 * app, no file declares `{% doc %}`, so that read never happens.
 *
 * HOW THE CALLERS ARE FOUND. Every edge platformos-graph records names its target with a
 * STATIC STRING LITERAL, so a caller's text must contain the target's logical name, and
 * filtering on that is a sound over-approximation leaving few survivors (measured p50 1,
 * p90 6 candidates on a 2,615-file project). Those are resolved with
 * {@link extractFileReferences}, the SAME resolver `buildAppGraph` runs, so this answer
 * cannot drift from the graph's.
 *
 * Callers are read from the CHANGESET, not just disk: `ProjectScan` overlays the buffers
 * under validation, so a call a buffer has just added or removed counts as it now stands.
 * Being derived per request the answer cannot be stale, which is why there is no
 * `computing` state. A failure or the deadline yields `unavailable`; no contract to compare
 * against yields `not_applicable`; a comparison that ran yields `computed`.
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

/** Number of mismatching callers reported before truncating. */
const MAX_REPORTED_CALLERS = 10;

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
 * Compare the edited buffer's `{% doc %}` contract against every caller the project's text
 * makes visible. Reports `not_applicable` when there is no contract to compare, and throws
 * only on real I/O failure — the caller degrades that to `unavailable`.
 */
export async function runImpact(
  params: AdapterInput,
  scan: ProjectScan,
): Promise<ValidateCodeImpact> {
  const { projectDir, filePath, content } = params;
  const rootUri = path.normalize(path.URI.file(projectDir));
  const fileUri = path.normalize(path.URI.file(toAbsoluteFilePath(projectDir, filePath)));

  // Cheapest question first, each step below costlier than the one above it: only a Liquid
  // file can declare a contract (an extension), only a file with a logical name can be
  // called (a string), reading the contract costs one parse of the buffer already in hand —
  // and ONLY THEN is the project read.
  if (sourceCodeTypeOf(fileUri) !== SourceCodeType.LiquidHtml) return NOT_APPLICABLE_IMPACT();

  const name = uriToName(fileUri, rootUri)?.name;
  if (name === undefined) return NOT_APPLICABLE_IMPACT();

  const signature = await docSignature(fileUri, content);
  if (signature === null) return NOT_APPLICABLE_IMPACT();

  const callers = await incomingReferences(scan, fileUri, name);
  const signature_risk = computeSignatureRisk(callers, rootUri, signature);

  return {
    scope: 'direct',
    status: 'computed',
    // Omitted when empty: an empty list reads as "checked, every caller matches", which a
    // scan of the callers that happen to be VISIBLE can never earn.
    ...(signature_risk.length > 0 ? { signature_risk } : {}),
  };
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

/** The `{% doc %}` parameter contract of the in-flight buffer, or `null` when it declares none. */
interface DocSignature {
  required: string[];
  allowed: string[];
}

/**
 * The edited buffer's `{% doc %}` parameter contract (required + all declared
 * names), or `null` when the buffer is unparseable or declares no `{% doc %}`
 * block. Reuses check-common's `extractDocDefinition` — the same primitive the
 * `PartialCallArguments` check reads for the doc case — so the two never diverge.
 * `null` deliberately disables signature-impact: without an explicit contract we
 * do NOT guess a signature (no false positives).
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
 * The callers whose passed arguments violate `signature` — missing a required
 * `@param`, or passing one the `{% doc %}` block does not declare. Deduplicated
 * per caller, sorted, and capped at {@link MAX_REPORTED_CALLERS}.
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
    .slice(0, MAX_REPORTED_CALLERS)
    .map(([caller, { missing, unexpected }]) => ({
      caller,
      missing_required: [...missing].sort((a, b) => a.localeCompare(b)),
      unexpected_args: [...unexpected].sort((a, b) => a.localeCompare(b)),
    }));
}
