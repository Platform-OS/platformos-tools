/**
 * Public entry point for the `@platformos/platformos-mcp-supervisor`
 * package. Re-exports the small surface that programmatic consumers
 * (server hosts, integration tests, embedded usage) actually need.
 *
 * v1 deliberately keeps this lean. The MCP protocol is exposed via the
 * bin entrypoint (`platformos-mcp-supervisor`); this module exists so
 * consumers can drive the server in-process if they need to.
 */

export { startServer, type ServerOptions, type ServerHandle } from './server';
export { createLogger, type Logger } from './core/logger';
export { PlatformOSLSPClient } from './core/lsp-client';

export {
  validateCodeTool,
  type ValidateCodeContext,
  type ValidateCodeParams,
  type ValidateCodeResult,
  type ValidateCodeMode,
  type ValidateCodeStatus,
  type ValidateCodeDiagnostic,
  type ValidateCodeStructuralSnapshot,
  type ProposedFix,
  type DomainGuide,
  type DomainGuideGotcha,
  type TipEntry,
} from './tools/validate-code';
