/**
 * Impact — what this change breaks in files the agent is NOT editing.
 *
 * Lint is per-file and forward-looking: it visits only the buffers it was sent, so a page
 * that the edited partial has just broken is never even looked at. This stage looks at it,
 * and it does so by ASKING THE CHECK ENGINE rather than by re-deriving the answer:
 *
 *   pass A   the dependants, linted with the changeset overlaid
 *   pass B   the same dependants, linted with nothing overlaid
 *   report   A \ B — exactly the findings this change introduced
 *
 * WHY A DIFF AND NOT A CHECK-CODE ALLOWLIST. An earlier version compared `{% doc %}`
 * parameters by hand, which reimplemented `MissingRenderPartialArguments` with no message,
 * no documentation link and an invented severity. The diff needs no list of "cross-file
 * relevant" codes, because relevance is CAUSAL: a `DeprecatedFrontmatterField` already in a
 * dependant is irrelevant for having been there BEFORE, not for its code. A check added
 * upstream is covered on the day it ships, with no edit here.
 *
 * SERIALIZED, BY NECESSITY. `lintBuffers` overlays buffers into check-node's process-shared
 * `App` and reverts them on the way out, and that App has no lock. Two lint passes therefore
 * cannot overlap — with each other, or with the request's primary lint. The orchestrator
 * runs the primary lint concurrently with the project SCAN (pure fs reads, no App) and only
 * then runs these two passes, so the write gate is never delayed by, or lost to, impact.
 *
 * BOUNDED BY INPUT, NOT BY THE DEADLINE. `IMPACT_DEADLINE_MS` cannot bound this: a lint is
 * synchronous CPU work and no timer preempts it. `MAX_CANDIDATE_BYTES` caps the text
 * discovery will parse and `MAX_DEPENDANTS_LINTED` caps how many dependants are linted, both
 * derived in `cost-model.ts` to fit inside that deadline. Hitting either is REPORTED —
 * `status: unavailable` or `unchecked_dependants` — never silently absorbed.
 *
 * NOTHING HERE IS A CLEARANCE. A dependant that names its target at runtime, or that does
 * not parse, is invisible to discovery — so an empty answer means no break was FOUND among
 * the dependants that are visible, never that none exists.
 */
import { path, type UriString } from '@platformos/platformos-check-common';
import { uriToName } from '@platformos/platformos-common';

import { toAbsoluteFilePath } from '../adapter-input.js';
import { MAX_DEPENDANTS_LINTED } from '../cost-model.js';
import { enrichBatch, type DocsetVocabulary } from '../enrich/enrich.js';
import type { BatchBuffer, BatchLintResult, runBatchLint } from '../lint/lint-batch.js';
import { NOT_APPLICABLE_IMPACT, UNAVAILABLE_IMPACT } from '../result/impact-states.js';
import type { ValidateCodeDiagnostic, ValidateCodeImpact } from '../result/types.js';
import { canHaveDependants, dependantsOf, toDependantBuffers } from './dependants.js';
import { introducedDiagnostics } from './diff.js';
import type { ProjectScan } from './project-scan.js';

/** Everything one impact pass needs. The lint seam is injected so the contract is testable. */
export interface ImpactInput {
  projectDir: string;
  /** The changeset, exactly as the primary lint received it. */
  buffers: readonly BatchBuffer[];
  scan: ProjectScan;
  lint: typeof runBatchLint;
  docset: () => Promise<DocsetVocabulary>;
  log: (message: string) => void;
}

/**
 * The impact of the whole changeset, per requested buffer key.
 *
 * Throws only on real I/O failure — the caller degrades that to `unavailable` for every
 * buffer, because a failure here says nothing about any of them.
 */
export async function runImpact(input: ImpactInput): Promise<Map<string, ValidateCodeImpact>> {
  const { projectDir, buffers, scan } = input;
  const rootUri = path.normalize(path.URI.file(projectDir));

  const uriOf = (buffer: BatchBuffer) =>
    path.normalize(path.URI.file(toAbsoluteFilePath(projectDir, buffer.filePath)));

  // A file in the changeset is reported on its own terms. Excluding the whole changeset from
  // every dependant set is also what makes the scan's text the DISK text for each dependant,
  // which is exactly what pass B's baseline needs.
  const changeset = new Set(buffers.map(uriOf));

  const byBuffer = new Map<string, ValidateCodeImpact>();
  const dependantsPerBuffer = new Map<string, UriString[]>();

  for (const buffer of buffers) {
    const uri = uriOf(buffer);
    // Applicability is a property of the FILE and needs no scan. The name is read separately
    // because discovery needs the STRING while `canHaveDependants` answers a boolean; the
    // second condition below narrows that string and is not a second rule.
    const name = uriToName(uri, rootUri)?.name;
    if (!canHaveDependants(uri, rootUri) || name === undefined) {
      byBuffer.set(buffer.filePath, NOT_APPLICABLE_IMPACT());
      continue;
    }
    const dependants = await dependantsOf(scan, uri, name, changeset);
    // `null` is "too much candidate text to examine", NOT "no dependants". Reported as
    // `unavailable`, which is what it is: the comparison did not run.
    if (dependants === null) {
      byBuffer.set(buffer.filePath, UNAVAILABLE_IMPACT());
      continue;
    }
    dependantsPerBuffer.set(buffer.filePath, dependants);
    byBuffer.set(buffer.filePath, { status: 'computed' });
  }

  const found = [...new Set([...dependantsPerBuffer.values()].flat())].sort((a, b) =>
    a.localeCompare(b),
  );
  if (found.length === 0) return byBuffer;

  // BOUNDED INPUT, not a deadline: a lint is synchronous CPU work and no timer preempts it
  // (see `deadline.ts`), so the only defence is refusing to start more of it than fits.
  // Sorted first, so which dependants survive the bound is deterministic rather than
  // whichever order a directory walk happened to produce.
  const linted = new Set(found.slice(0, MAX_DEPENDANTS_LINTED));
  const introduced = await introducedByDependant(input, [...linted]);

  for (const [key, dependants] of dependantsPerBuffer) {
    const checked = dependants.filter((uri) => linted.has(uri));
    const breaks = checked
      .map((uri) => ({ uri, diagnostics: introduced.get(uri) ?? [] }))
      .filter(({ diagnostics }) => diagnostics.length > 0)
      .map(({ uri, diagnostics }) => ({ file: path.relative(uri, rootUri), diagnostics }));

    const impact: ValidateCodeImpact = { status: 'computed' };
    // Omitted when empty. An empty list reads as "checked, nothing depends on this that
    // could break", which a scan of the dependants that happen to be VISIBLE cannot earn.
    if (breaks.length > 0) impact.breaks = breaks;
    // Reported per buffer rather than per request: the bound is global, but whether it cost
    // THIS buffer anything depends on how many of its own dependants fell past it.
    if (checked.length < dependants.length) {
      impact.unchecked_dependants = { returned: checked.length, total: dependants.length };
    }
    byBuffer.set(key, impact);
  }

  return byBuffer;
}

/**
 * The findings each dependant gained because of the changeset, keyed by its URI.
 *
 * The two passes are AWAITED IN SEQUENCE, never raced: they share check-node's process-wide
 * `App`, and an overlay installed by one while the other is reverting would corrupt both.
 */
async function introducedByDependant(
  input: ImpactInput,
  dependants: readonly UriString[],
): Promise<Map<UriString, ValidateCodeDiagnostic[]>> {
  const { projectDir, buffers, scan, lint, docset, log } = input;
  const sources = await scan.sources();
  const dependantBuffers = toDependantBuffers(dependants, sources);
  const keyOf = new Map(dependantBuffers.map((buffer) => [buffer.filePath, buffer.uri]));

  // WITH the changeset overlaid. The changeset's own buffers are included because a
  // dependant must see the edit to be broken by it; their results are discarded here, since
  // the primary lint already reported them.
  const after = await lint({ projectDir, buffers: [...buffers, ...dependantBuffers] });

  // Only a dependant that found something in pass A needs a baseline: the diff is A \ B, so
  // an empty A is empty whatever B holds. Worth less than it looks — measured, a page
  // reports `DeprecatedFrontmatterField` whatever it contains, so only partial dependants
  // are ever clean enough to skip.
  const withFindings = dependantBuffers.filter(
    (buffer) => (after.diagnostics.get(buffer.filePath)?.length ?? 0) > 0,
  );
  const before: BatchLintResult | undefined = withFindings.length
    ? await lint({ projectDir, buffers: withFindings })
    : undefined;

  const enriched = await enrichBatch(onlyDependants(after, keyOf), docset, log);

  const introduced = new Map<UriString, ValidateCodeDiagnostic[]>();
  for (const [filePath, uri] of keyOf) {
    const gained = introducedDiagnostics(
      enriched.get(filePath) ?? [],
      before?.diagnostics.get(filePath) ?? [],
    );
    if (gained.length > 0) introduced.set(uri, gained);
  }
  return introduced;
}

/**
 * Pass A narrowed to the dependants, so enrichment is not paid a second time for the
 * changeset's own findings — the primary lint has already enriched those.
 */
function onlyDependants(
  pass: BatchLintResult,
  keyOf: ReadonlyMap<string, UriString>,
): BatchLintResult {
  const diagnostics = new Map<string, ValidateCodeDiagnostic[]>();
  const sources: NonNullable<BatchLintResult['sources']> = new Map();
  for (const key of keyOf.keys()) {
    const found = pass.diagnostics.get(key);
    // A dependant the lint DECLINED (excluded by config, say) has no diagnostics entry.
    // Skipped rather than defaulted to `[]`, which would report it as checked and clean.
    if (found === undefined) continue;
    diagnostics.set(key, found);
    const source = pass.sources?.get(key);
    if (source) sources.set(key, source);
  }
  return { diagnostics, sources, notChecked: pass.notChecked };
}
