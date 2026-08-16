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
 * Resolve the file under edit to an absolute path: returned as-is when already absolute,
 * else joined onto the project root.
 *
 * Both branches normalize `.`/`..` segments — `join` directly, and
 * {@link fileApplicability}'s `relative` by resolving its arguments — so a traversal
 * cannot survive the containment check by hiding inside an unnormalized string.
 */
export function toAbsoluteFilePath(projectDir: string, filePath: string): string {
  return isAbsolute(filePath) ? filePath : join(projectDir, filePath);
}

/** Whether `validate_code` has anything to say about a file — and if not, why. */
export type FileApplicability = { applicable: true } | ({ applicable: false } & Declined);

/**
 * Decide whether the buffer is a file this server can validate.
 *
 * A declined file gets its own terminal status (`not_applicable`) rather than an `ok` or an
 * `error`: the only honest answer is "not mine to judge", which neither blocks nor approves
 * the write. Without this gate every path is linted, and since check-common's
 * `toSourceCode` types an unrecognized extension as JSON, an off-project file holding `{}`
 * comes back `ok` — the false approval this status exists to prevent.
 *
 * THREE INDEPENDENT RULES, in order:
 *
 * 1. CONTAINMENT. The resolved path must lie strictly inside `projectDir`. Checked on the
 *    `relative()` result rather than by string prefix, which would accept a sibling root
 *    whose name merely extends the project's (`/srv/app-backup` vs `/srv/app`). A leading
 *    `..` means the path climbed out; an empty result means the path IS the root; an
 *    absolute result means a different Windows drive. This is a correctness gate, not a
 *    security boundary — the server only ever READS — so symlinks are not resolved.
 *
 * 2. NOT AN ASSET. Assets are deployed and served, never rendered.
 *
 * 3. SUPPORTED TYPE. Reuses platformos-common's `sourceCodeTypeOf`, so the gate cannot
 *    drift away from what the linter would have looked at.
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

  // 2. AN ASSET IS NEVER JUDGED. It is SERVED, not rendered, so there is no template in it
  //    to check. A TYPE question, not an extension one: `app/assets/x.liquid` is an asset
  //    the platform hands back verbatim, while `theme.css.liquid` is processed.
  //    `platformos-common` owns the rule as `isParsedFileType`; asking IT is what keeps
  //    this gate and the lint from disagreeing about a path.
  const rootUri = pathUtils.toUri(projectDir);
  const fileType = getFileType(uri, rootUri);
  if (fileType !== undefined && !isParsedFileType(fileType)) {
    return { applicable: false, ...assetNotLinted(displayPathOf(uri, projectDir)) };
  }

  // 3. SUPPORTED TYPE — extension-only, and deliberately NOT the anchored
  //    `isSupportedSourceFile(uri, root)`: this asks "is this a type we parse at all", and
  //    a `.liquid` in an undeployed subtree IS one. Anchoring here would answer
  //    `unsupported_type` where check-node's classifier says `misplaced-source`, which is
  //    what the agent needs to hear. See `NotApplicableReason`.
  if (sourceCodeTypeOf(uri) === undefined) {
    return { applicable: false, ...notPlatformOSFile(displayPathOf(uri, projectDir)) };
  }

  return { applicable: true };
}

/**
 * A path as the agent should SEE it: project-relative, forward slashes on every platform.
 *
 * `node:path.relative` is right for the containment decision above but yields
 * `app\notes.txt` on Windows; check-common's `relative` is URI-based and forward-slash by
 * construction.
 */
function displayPathOf(uri: string, projectDir: string): string {
  return pathUtils.relative(uri, pathUtils.toUri(projectDir));
}

/**
 * Largest buffer this server will validate, in bytes.
 *
 * MEASURED against the FULL LINT, not the parse alone — every enabled check walks the AST
 * after it. `lintBuffer` over a real 162-file project, warm cache, runs ~61 ms/KiB, so this
 * bound costs ~7 s isolated; further out the parser itself falls apart (~30 s at 1 MiB, a
 * stack overflow at 2 MiB, a native V8 abort at 4 MiB). It still admits 1.7x the largest
 * real source file found across local projects.
 *
 * THIS BOUND, NOT THE DEADLINE, IS THE GUARD against CPU-bound input: a deadline cannot
 * interrupt a synchronous parse and its timer cannot even fire during one. `cost-model.ts`
 * is an independent measurement; `cost-model.spec.ts` pins that the two agree.
 */
export const MAX_BUFFER_BYTES = 128 * 1024;

/**
 * A refusal when the buffer is too large to validate, else `undefined`.
 *
 * Measured in BYTES, not string length: `content.length` under-counts multi-byte content
 * by up to 3x, admitting a buffer three times the intended cost.
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
 * Not an error and not an `ok`: `check()` skips ignored files silently, so "no offenses"
 * for one means "never looked at", and reporting that as `ok` would approve an ignored page
 * containing unparseable Liquid.
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

/** The subtrees the platform deploys from, as prose. DERIVED, never spelled out. */
const DEPLOYED = APP_SOURCE_SUBTREES.map((subtree) => `${subtree}/`).join(', ');

/**
 * Where an agent can read the whole rule rather than infer it from one message. In the
 * prose because `see_also` hangs off a diagnostic, and "the file is in the wrong place"
 * produces none.
 */
const DIRECTORY_STRUCTURE =
  'Directory structure: ' +
  'https://documentation.platformos.com/developer-guide/platformos-workflow/directory-structure';

/**
 * The refusal for a path that is not a platformOS source at all.
 *
 * ROUTINE, and the prose is deliberately mild: a project legitimately holds READMEs, `.jsx`
 * components, CI config and build output. This must never advise moving the file anywhere —
 * see {@link misplacedSource}, the opposite advice.
 *
 * Reached both from this server's pre-lint gate ({@link fileApplicability}) and from
 * check-node's `not-a-platformos-file` classification. One factory, so the two cannot
 * describe the same situation differently.
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
 * The same machine-readable code as {@link notPlatformOSFile}, since an agent does not act
 * differently on the two, but its own prose: an asset IS part of the app and is deployed,
 * so calling `app/assets/logo.png` "not a platformOS file" would be false.
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
 * THE OPPOSITE ADVICE FROM {@link notPlatformOSFile}, which is why the two are separate
 * codes: this file IS something the toolchain parses, but it is outside every deployed
 * subtree, so it is dead code.
 *
 * IT DOES NOT BLOCK THE WRITE, and is not a `warning` either: someone may be authoring a
 * module, generator template or fixture on purpose. `not_applicable` states the honest
 * thing — nothing was checked — while the prose carries the warning.
 *
 * KNOWN OVER-BROAD FOR `.yml`: the classification behind it treats any parseable extension
 * outside the deployed subtrees as misplaced, so a repository's CI or container config is
 * told "likely misplaced". Narrowing it belongs in check-node, where classification happens.
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
