/**
 * Registration of the `validate_code` MCP tool.
 *
 * The handler is a typed STUB for now (TASK-7.4): it returns a well-formed
 * `ValidateCodeResult` so the transport, schema, and serialization can be
 * exercised end to end over stdio. The real `lint → enrich → advise → result`
 * composition replaces the stub body in TASK-7.10.
 */
import { z, type ZodRawShape } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import type { Logger } from '../logger';
import type { ValidateCodeParams, ValidateCodeResult } from '../result/types';

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
  mode: z
    .enum(['full', 'quick'])
    .optional()
    .describe(
      'Analysis depth. `full` (default) runs the heavier ergonomic stages; `quick` is lint + enrichment.',
    ),
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

/**
 * STUB. Returns an empty, well-formed result. Replaced by the real pipeline in
 * TASK-7.10.
 */
async function runValidateCode(
  ctx: SupervisorContext,
  params: ValidateCodeParams,
): Promise<ValidateCodeResult> {
  ctx.log(`validate_code: ${params.file_path} (${params.mode ?? 'full'})`);
  return {
    status: 'ok',
    must_fix_before_write: false,
    errors: [],
    warnings: [],
    infos: [],
    proposed_fixes: [],
    clusters: [],
    scorecard: [],
    next_step: 'Stub handler — real validation lands in TASK-7.10.',
    parse_error: null,
    tips: [],
    domain_guide: null,
    structural: null,
  };
}

/** Wrap a result in the MCP text-content envelope (every result is one JSON text block). */
function toToolResult(result: ValidateCodeResult): ToolTextResult {
  return { content: [{ type: 'text', text: JSON.stringify(result) }] };
}
