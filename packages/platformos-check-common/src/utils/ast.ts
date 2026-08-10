import { LiquidHtmlNode, NodeTypes } from '@platformos/liquid-html-parser';

/**
 * Whether an `AppFile`'s parse is a Liquid document.
 *
 * `AppFile.ast` is typed `unknown` — `platformos-common` sits below the parsers — and holds
 * an `Error` for a file that did not parse, so it is NARROWED rather than asserted.
 *
 * One spelling of that narrowing for the whole monorepo, and it lives here rather than beside
 * `isGraphqlDocument` (which `platformos-common` owns) for exactly the reason the type is
 * `unknown` in the first place: this one needs the Liquid parser, and that package must stay
 * below it. check-common is the lowest package that can hold it, and the language server
 * consumes it from here.
 */
export function isLiquidDocument(ast: unknown): ast is LiquidHtmlNode {
  return (
    typeof ast === 'object' &&
    ast !== null &&
    (ast as { type?: unknown }).type === NodeTypes.Document
  );
}
