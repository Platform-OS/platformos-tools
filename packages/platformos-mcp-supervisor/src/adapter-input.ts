/**
 * Shared input for the request-path I/O adapters (`lint/`, `impact/`).
 *
 * Both adapters receive the identical `{ projectDir, filePath, content }` and
 * must agree on the buffer's absolute path, so the shape, the absolute-path
 * resolution, and the "is this file ours to judge?" decision all live here
 * rather than being duplicated per adapter.
 */
import { isAbsolute, join, relative, sep } from 'node:path';

import { path as pathUtils } from '@platformos/platformos-check-common';
import {
  APP_SOURCE_SUBTREES,
  getFileType,
  isParsedFileType,
  sourceCodeTypeOf,
} from '@platformos/platformos-common';

import { LINT_MS_PER_KIB } from './cost-model.js';
import type { Declined } from './result/types.js';

export interface AdapterInput {
  /** Absolute project root the buffer is validated against. */
  projectDir: string;
  /** File under edit — absolute, or relative to `projectDir`. */
  filePath: string;
  /** In-memory buffer contents. */
  content: string;
}

/**
 * Resolve the file under edit to an absolute path: returned as-is when already
 * absolute, else joined onto the project root.
 *
 * Both branches normalize `.`/`..` segments — `join` does so directly, and
 * {@link fileApplicability}'s `relative` call resolves its arguments — so a
 * traversal like `../../../etc/passwd` cannot survive the containment check
 * below by hiding inside an unnormalized string.
 */
export function toAbsoluteFilePath(projectDir: string, filePath: string): string {
  return isAbsolute(filePath) ? filePath : join(projectDir, filePath);
}

/** Whether `validate_code` has anything to say about a file — and if not, why. */
export type FileApplicability = { applicable: true } | ({ applicable: false } & Declined);

/**
 * Decide whether the buffer is a file this server can validate.
 *
 * WHY THIS GATE EXISTS. Without it every path is linted, and because
 * check-common's `toSourceCode` types any unrecognized extension as
 * `SourceCodeType.JSON`, the file is JSON-linted — so `/etc/passwd` came back
 * as `ValidJSON: Expected a JSON object, array or literal.` with
 * `must_fix_before_write: true`. That is wrong in BOTH directions, and the
 * second is the dangerous one:
 *
 *   - FALSE BLOCK: a legitimate in-project `README.md` edit is reported as an
 *     error the agent must fix before writing.
 *   - FALSE APPROVAL: `/etc/shadow` containing `{}` is valid JSON, so the call
 *     returned `status: 'ok'` — an agent that trusts the write gate reads that
 *     as "validated, safe to write" for a path outside the project entirely.
 *
 * A declined file therefore gets its own terminal status (`not_applicable`)
 * rather than an `ok` or an `error`: the only honest answer is "not mine to
 * judge", which neither blocks nor approves the write.
 *
 * THREE INDEPENDENT RULES, in order (each documented at its own branch below):
 *
 * 1. CONTAINMENT. The resolved path must lie strictly inside `projectDir`.
 *    Checked on the `relative()` result rather than by string prefix, because a
 *    prefix test accepts a sibling root whose name merely extends the project's
 *    (`/srv/app-backup` vs `/srv/app`). The first segment being `..` means the
 *    path climbed out; an empty result means the path IS the root (a directory —
 *    what an empty `file_path` used to resolve to); an absolute result means a
 *    different Windows drive. This is a correctness gate, not a security
 *    boundary — the server only ever READS, and the caller supplies the buffer
 *    contents anyway — so no symlink resolution is attempted (that would be I/O
 *    on the request path for no gain).
 *
 * 2. NOT AN ASSET. Assets are deployed and served, never read.
 *
 * 3. SUPPORTED TYPE. Reuses platformos-common's `sourceCodeTypeOf`, so the gate cannot
 *    drift away from what the linter would actually have looked at — if lint would not
 *    have visited the file, saying so beats inventing a diagnostic about it.
 */
export function fileApplicability(projectDir: string, filePath: string): FileApplicability {
  const absolute = toAbsoluteFilePath(projectDir, filePath);
  const relativeToRoot = relative(projectDir, absolute);

  if (
    relativeToRoot === '' ||
    isAbsolute(relativeToRoot) ||
    relativeToRoot.split(sep)[0] === '..'
  ) {
    return {
      applicable: false,
      code: 'outside_project',
      reason:
        `\`${filePath}\` resolves outside the project root (${projectDir}), so there is no ` +
        `project context to validate it against. This server validates only files inside the ` +
        `project it was started for. Nothing was checked — treat this as "unknown", not as approval.`,
    };
  }

  const uri = pathUtils.toUri(absolute);

  // 2. AN ASSET IS NEVER JUDGED. An asset is SERVED, not rendered, so there is no
  //    template in it to check — `platformos-common` owns that rule as `isParsedFileType`
  //    and this asks IT rather than spelling the comparison again. That matters more than
  //    it looks: this gate and the lint must agree about every path, and the only way to
  //    guarantee agreement is for both to consult the same predicate.
  //
  //    The rule is a TYPE question, not an extension one, which is why it was missed for
  //    so long. Measured before it existed: `app/assets/x.liquid` holding `{% if unclosed`
  //    came back `must_fix_before_write: true` with `LiquidHTMLSyntaxError`, because a bare
  //    `.liquid` has no response format so the key falls back to `html.liquid`, which has a
  //    parser row. A FALSE BLOCK on a file the platform hands back verbatim — and backwards
  //    besides, since `theme.css.liquid`, the asset form the platform DOES process, was
  //    exempt all along.
  //
  //    KEPT even though `lintBuffers` would now answer `not-a-source-file` for the same
  //    file, and not as belt-and-braces: refusing here costs no I/O, while reaching the
  //    lint means resolving the config and reconciling the app first. Two gates that
  //    cannot disagree — because they share the predicate — is the cheap version of one.
  const rootUri = pathUtils.toUri(projectDir);
  const fileType = getFileType(uri, rootUri);
  if (fileType !== undefined && !isParsedFileType(fileType)) {
    return { applicable: false, ...assetNotLinted(displayPathOf(uri, projectDir)) };
  }

  // 3. SUPPORTED TYPE — extension-only, and deliberately NOT the anchored
  //    `isSupportedSourceFile(uri, root)`: this asks "is this a type we parse at all", and
  //    a `.liquid` in an undeployed subtree IS one. Anchoring here would answer
  //    `unsupported_type` for it — "not a platformOS source", the opposite of the truth —
  //    where check-node's classifier says `misplaced-source` and the agent needs to hear
  //    THAT. See `NotApplicableReason`.
  if (sourceCodeTypeOf(uri) === undefined) {
    return { applicable: false, ...notPlatformOSFile(displayPathOf(uri, projectDir)) };
  }

  return { applicable: true };
}

/**
 * A path as the agent should SEE it: project-relative, forward slashes on every
 * platform.
 *
 * `node:path.relative` is right for the containment decision above but yields
 * `app\notes.txt` on Windows — echoing back a separator the agent never sent, for a
 * path it has to recognize as its own. check-common's `relative` is URI-based and
 * forward-slash by construction.
 */
function displayPathOf(uri: string, projectDir: string): string {
  return pathUtils.relative(uri, pathUtils.toUri(projectDir));
}

/**
 * Largest buffer this server will validate, in bytes.
 *
 * CHOSEN FROM MEASUREMENT of the FULL LINT, not the parse alone — an earlier
 * version of this constant was sized against `toLiquidHtmlAST` in isolation and
 * was 4x too generous, which let a *legal* 400 KiB buffer blow the 30 s deadline
 * in an end-to-end run. Parsing is only part of the cost; every enabled check then
 * walks the AST.
 *
 * `lintBuffer` against a real 162-file project, warm cache:
 *
 *   ```
 *      16 KiB ->   1.2 s
 *      32 KiB ->   2.7 s
 *      64 KiB ->   3.7 s
 *     128 KiB ->   7.1 s     <- the bound
 *     192 KiB ->  11.7 s
 *     256 KiB ->  15.6 s
 *   ```
 *
 * ~61 ms/KiB. And the parser alone falls off a cliff further out: 1 MiB takes
 * ~30 s, 2 MiB throws `RangeError: Maximum call stack size exceeded` inside ohm's
 * CST->AST recursion, and 4 MiB produced a native V8 abort.
 *
 * 128 KiB keeps the worst LEGAL buffer at ~7 s isolated (roughly 15 s under
 * contention with a graph build), comfortably inside the deadline it is granted,
 * while still admitting 1.7x the largest real source file found across local
 * projects (a 76 KiB icon-sprite partial). A Liquid template past this size is
 * pathological on its own terms, and the refusal says so.
 *
 * This bound is NOT derived from `cost-model.ts` — it is the older, independent
 * measurement, and it answers a different question: how large a SINGLE file may be
 * before the parser itself becomes the problem, which is a property of the parser
 * rather than of any deadline. It is nonetheless checked against the model, and the
 * two agree: `lintDeadlineMs(MAX_BUFFER_BYTES)` is exactly `MIN_LINT_DEADLINE_MS`,
 * so a maximal single buffer sits precisely at the floor the model would have
 * granted it anyway. `cost-model.spec.ts` pins that agreement, so the two stop
 * being independent numbers that happen to be compatible today.
 *
 * WHY THE BOUND IS THE REAL GUARD, NOT THE DEADLINE. Verified end to end: a
 * deadline cannot interrupt a synchronous parse, and the timer cannot even FIRE
 * during one — a 400 KiB buffer returned after 45 s against a 30 s deadline,
 * because the event loop was blocked until the parse finished. The deadline is a
 * backstop for ASYNC stalls (a wedged fs call, a hung graph lookup); only this
 * bound protects against CPU-bound input. And a native V8 abort is not catchable
 * from JS at all, so nothing downstream could help there.
 */
export const MAX_BUFFER_BYTES = 128 * 1024;

/**
 * A refusal when the buffer is too large to validate, else `undefined`.
 *
 * Measured in BYTES, not string length: parse cost tracks byte size, and
 * `content.length` would under-count multi-byte content by up to 3x — admitting a
 * buffer three times the intended cost.
 */
export function bufferTooLarge(content: string): Declined | undefined {
  const bytes = Buffer.byteLength(content, 'utf8');
  if (bytes <= MAX_BUFFER_BYTES) return undefined;

  return {
    code: 'too_large',
    reason:
      `The buffer is ${Math.round(bytes / 1024)} KiB, above the ${Math.round(
        MAX_BUFFER_BYTES / 1024,
      )} KiB limit this server will validate, so it was refused before parsing. ` +
      `Liquid validation costs about ${LINT_MS_PER_KIB} ms per KiB and the parser stops ` +
      `completing at all a few ` +
      `MiB out, so checking this would risk hanging the server rather than answering. Nothing ` +
      `was checked — consider splitting the file, which is almost certainly worth doing at this ` +
      `size regardless.`,
  };
}

/**
 * The refusal for a file the project's config excludes from linting.
 *
 * Not an error and not an `ok`: `check()` skips ignored files silently, so "no
 * offenses" for one means "never looked at". Reporting that as `ok` made the write
 * gate approve, for example, an ignored page containing unparseable Liquid — the
 * same false approval an off-project path used to produce.
 */
export function ignoredByProjectConfig(relativePath: string): Declined {
  return {
    code: 'ignored',
    reason:
      `\`${relativePath}\` is excluded by the \`ignore\` list in this project's ` +
      `\`.platformos-check.yml\`, so no check ran against it. Nothing was checked — this is not ` +
      `a pass. Remove it from \`ignore\` if you want this file validated.`,
  };
}

/**
 * The subtrees the platform deploys from, as prose.
 *
 * DERIVED, never spelled out. An earlier draft of the messages below hand-wrote
 * "`app/` (or `modules/<name>/public/` …)", which is a copy of a list that lives in
 * `platformos-common` and would have gone quietly stale the first time a subtree was
 * added — while continuing to sound authoritative to the agent reading it.
 */
const DEPLOYED = APP_SOURCE_SUBTREES.map((subtree) => `${subtree}/`).join(', ');

/**
 * Where an agent can read the whole rule rather than infer it from one message.
 *
 * A URL is the crudest form of the `hint` / `see_also` enrichment the result contract
 * reserves (`ValidateCodeDiagnostic`) — those fields hang off a diagnostic, and "the file
 * is in the wrong place" produces none. Making documentation links first-class is
 * separate work; until then the pointer goes in the prose, because an agent that guesses
 * at the directory structure keeps guessing.
 */
const DIRECTORY_STRUCTURE =
  'Directory structure: ' +
  'https://documentation.platformos.com/developer-guide/platformos-workflow/directory-structure';

/**
 * The refusal for a path that is not a platformOS source at all.
 *
 * ROUTINE, and the prose is deliberately mild: a project legitimately holds README
 * files, `.jsx` components, CI config and build output, none of which are platformOS
 * sources and none of which are MEANT to be. This must never advise moving the file
 * anywhere — see {@link misplacedSource}, which is the opposite advice, and which exists
 * precisely so this one can stay neutral.
 *
 * Reached from TWO places asking the same question of the same predicate: this server's
 * pre-lint gate ({@link fileApplicability}, which spends no I/O on a file it will not
 * judge) and check-node's `not-a-platformos-file` classification. One factory, so the two
 * cannot describe the same situation differently.
 */
export function notPlatformOSFile(relativePath: string): Declined {
  return {
    code: 'unsupported_type',
    reason:
      `\`${relativePath}\` is not a platformOS source file, so there is nothing to check. ` +
      `The platform deploys ${DEPLOYED} only. Nothing was checked — writing this file is ` +
      `your call, not a validated pass. ${DIRECTORY_STRUCTURE}`,
  };
}

/**
 * The refusal for an ASSET: an app file the toolchain has no parser for.
 *
 * The same machine-readable code as {@link notPlatformOSFile} — an agent does not act
 * differently on the two, and two codes with one remedy is a branch nobody can take — but
 * its own prose, because the two situations are not the same fact. An asset IS part of
 * the app and is deployed; it simply is not a source. Saying "not a platformOS file"
 * about `app/assets/logo.png` would be false, and a message an author can tell is false
 * is a message they stop reading.
 */
export function assetNotLinted(relativePath: string): Declined {
  return {
    code: 'unsupported_type',
    reason:
      `\`${relativePath}\` is an asset, not a source file the linter understands — it ` +
      `checks Liquid, GraphQL and YAML — so no check ran against it. The file is still ` +
      `deployed and served; there is simply nothing here to validate. Nothing was ` +
      `checked, which is not the same as a pass.`,
  };
}

/**
 * The refusal for a real platformOS source sitting where the platform will never load it.
 *
 * THE OPPOSITE ADVICE FROM {@link notPlatformOSFile}, which is the whole reason the two
 * are separate codes. This file IS something the toolchain parses — a partial, a page, a
 * query — but it is outside every subtree the platform deploys, so it is dead code: it
 * will not be served, and nothing that renders by name will find it. An agent told merely
 * "unsupported type" files that under "fine, not my problem" and moves on, which is
 * exactly wrong here.
 *
 * IT DOES NOT BLOCK THE WRITE, deliberately: someone may be authoring a module, a
 * generator template or a fixture on purpose, and this server cannot know. `not_applicable`
 * states the honest thing — nothing was checked — while the prose carries the warning.
 * Making it block would turn a guess about intent into a veto, and a write gate that
 * vetoes legitimate work gets switched off.
 *
 * NOT `status: 'warning'` either, tempting as it reads: `warning` in this contract means
 * "the file WAS checked and something objected". Nothing checked this file, and claiming
 * otherwise is the false approval the whole `not_applicable` status exists to prevent.
 *
 * KNOWN OVER-BROAD FOR `.yml`, and preserved as-is rather than quietly narrowed. The
 * classification behind it treats any parseable extension outside the deployed subtrees
 * as misplaced, and while a stray `.liquid` really is almost always a mistake, a stray
 * `.yml` usually is not — a repository's CI, container and linter configs are all `.yml`,
 * including this toolchain's own `.platformos-check.yml`. Those get told "likely
 * misplaced", which is wrong advice, though never a block. Narrowing it means deciding
 * which extensions carry a platformOS signal at the point where classification happens
 * (check-node), not papering over it here; filed as its own change rather than folded
 * into a merge.
 */
export function misplacedSource(relativePath: string): Declined {
  return {
    code: 'misplaced_source',
    reason:
      `\`${relativePath}\` is a platformOS source file outside every subtree the platform ` +
      `deploys (${DEPLOYED}). Nothing checked it, and nothing will load it either — a ` +
      `partial, page or query here is dead code. Move it under one of those directories ` +
      `unless it is deliberately a fixture or a build input. This is neither a pass nor a ` +
      `block. ${DIRECTORY_STRUCTURE}`,
  };
}
