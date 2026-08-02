/**
 * Registration of the `validate_code` MCP tool.
 *
 * Current slice: the handler runs the real lint (`check()` via the check-node
 * seam) and returns the detection results mapped into `ValidateCodeResult`.
 * The ergonomic stages (enrich → advise → richer result assembly) are layered
 * in by later tasks; the handler shape stays the same.
 */
import { z, type ZodRawShape } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { APP_SOURCE_SUBTREES } from '@platformos/platformos-check-node';

import { runLint } from '../lint/lint.js';
import { assembleResult } from '../result/assemble.js';
import type { Logger } from '../logger.js';
import type { ValidateCodeParams, ValidateCodeResult } from '../result/types.js';

/** Per-server context threaded into the handler. */
export interface SupervisorContext {
  /** Absolute project root the buffer is validated against. */
  projectDir: string;
  log: Logger;
}

/**
 * zod raw shape for the tool input (validated by the MCP SDK before dispatch).
 *
 * Typed as `ZodRawShape` (not the inferred literal shape) so the SDK's
 * `registerTool` does not perform excessively deep type instantiation over the
 * schema; the handler casts the validated args to `ValidateCodeParams`.
 */
export const VALIDATE_CODE_INPUT: ZodRawShape = {
  file_path: z
    .string()
    .describe('Path of the file under edit (absolute, or relative to the project root).'),
  content: z.string().describe('The file contents to validate (the in-memory buffer).'),
};

const DESCRIPTION =
  'Validate a platformOS Liquid/GraphQL/YAML file before writing it. Returns structured errors, ' +
  'warnings, infos, proposed fixes, and a must_fix_before_write gate.';

/** The MCP text-content envelope every tool result is serialized into. */
interface ToolTextResult {
  content: Array<{ type: 'text'; text: string }>;
}

/**
 * Minimal local signature for `server.registerTool`. The SDK's real generic
 * computes the handler's args type from the zod shape (`ShapeOutput<Args>`),
 * which instantiates excessively deep under zod 3.25 (TS2589). We validate at
 * runtime via the shape and cast the parsed args to `ValidateCodeParams`, so
 * the precise inferred arg type buys nothing here — casting the method to this
 * shallow signature sidesteps the blow-up without changing runtime behaviour.
 */
type RegisterTool = (
  name: string,
  config: { description: string; inputSchema: ZodRawShape },
  cb: (args: Record<string, unknown>) => Promise<ToolTextResult>,
) => unknown;

export function registerValidateCode(server: McpServer, ctx: SupervisorContext): void {
  (server.registerTool as unknown as RegisterTool)(
    'validate_code',
    { description: DESCRIPTION, inputSchema: VALIDATE_CODE_INPUT },
    async (args) => toToolResult(await runValidateCode(ctx, args as unknown as ValidateCodeParams)),
  );
}

/** Lint the buffer via the check-node seam and assemble the result. */
async function runValidateCode(
  ctx: SupervisorContext,
  params: ValidateCodeParams,
): Promise<ValidateCodeResult> {
  ctx.log(`validate_code: ${params.file_path}`);
  const { diagnostics, notChecked } = await runLint({
    projectDir: ctx.projectDir,
    filePath: params.file_path,
    content: params.content,
  });

  const result = assembleResult(diagnostics);

  // An empty result means "nothing to report" only when something was reported ON.
  // Until the contract has a status of its own for this, the reason goes
  // where the agent is told what to do next, rather than being dropped.
  if (notChecked) {
    ctx.log(`validate_code: ${params.file_path} not checked (${notChecked})`);
    return { ...result, next_step: notCheckedNextStep(notChecked) };
  }

  return result;
}

/** The subtrees the platform deploys from, as prose. */
const DEPLOYED = APP_SOURCE_SUBTREES.map((subtree) => `${subtree}/`).join(', ');

/**
 * Where an agent can read the whole rule rather than infer it from one message.
 *
 * A URL is the crudest form of the `hint` / `see_also` enrichment the result
 * contract reserves (`ValidateCodeDiagnostic`) — those fields hang off a
 * diagnostic, and "the file is in the wrong place" produces none. Making
 * documentation links first-class is separate work; until then the pointer goes in the prose,
 * because an agent that guesses at the directory structure keeps guessing.
 */
const DIRECTORY_STRUCTURE =
  'Directory structure: https://documentation.platformos.com/developer-guide/platformos-workflow/directory-structure';

/**
 * What the agent is told when `validate_code` did not look at the file.
 *
 * Every one of these starts with NOT VALIDATED, because the result body is empty and
 * an empty body otherwise reads as "clean". Beyond that they differ in what the agent
 * should DO — and the out-of-app case comes pre-split by `lintBuffer`, which drew the
 * distinction where the classification happened:
 *
 * - `misplaced-source`: a `.liquid` / `.graphql` / `.yml` outside every deployed
 *   subtree is almost always a mistake — the platform will never load that file, so
 *   writing it there does nothing;
 * - `not-a-platformos-file`: routine. A project holds plenty of files that are not
 *   platformOS sources and are not meant to be, so telling an agent to "move it
 *   under app/" would be wrong advice. It gets the directory rule and a link,
 *   nothing more.
 *
 * This function maps status to prose and nothing else — it imports no classifier.
 * The `default` arm is the exhaustiveness guard: a new `LintBufferStatus` fails to
 * compile here instead of silently losing its advice.
 */
function notCheckedNextStep(reason: NotCheckedReason): string {
  switch (reason) {
    case 'excluded-by-config':
      return (
        'NOT VALIDATED: this path is excluded by the project\'s .platformos-check.yml "ignore" ' +
        'list, so no check ran against it. An empty result here is not a clean bill of health. ' +
        'Remove the path from "ignore" if it should be validated.'
      );

    case 'not-a-platformos-file':
      return (
        'NOT VALIDATED: this is not a platformOS source file, so there is nothing to ' +
        `check. The platform deploys ${DEPLOYED} only. ${DIRECTORY_STRUCTURE}`
      );

    case 'misplaced-source':
      return (
        'NOT VALIDATED, AND LIKELY MISPLACED: this is a platformOS source file outside ' +
        `every subtree the platform deploys (${DEPLOYED}). Nothing checked it, and ` +
        'nothing will load it either — a partial, page or query here is dead code. Move ' +
        'it under one of those directories unless it is deliberately a fixture or a ' +
        `build input. ${DIRECTORY_STRUCTURE}`
      );

    case 'not-a-source-file':
      return (
        'NOT VALIDATED: this is an asset, not a source file the linter understands ' +
        '(it checks Liquid, GraphQL and YAML), so no check ran against it.'
      );

    default: {
      const unhandled: never = reason;
      throw new Error(`validate_code has no advice for lint status: ${String(unhandled)}`);
    }
  }
}

type NotCheckedReason = NonNullable<Awaited<ReturnType<typeof runLint>>['notChecked']>;

/** Wrap a result in the MCP text-content envelope (every result is one JSON text block). */
function toToolResult(result: ValidateCodeResult): ToolTextResult {
  return { content: [{ type: 'text', text: JSON.stringify(result) }] };
}
