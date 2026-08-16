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

/**
 * The innermost conditional branch enclosing a node, or `undefined` on the straight-line
 * path. Loop bodies count: a write in a loop that may run zero times is as uncertain.
 *
 * `{% tablerow %}` is the one loop this does NOT answer for, and the omission is the
 * parser's rather than a choice — measured, a `for` body is wrapped in a `LiquidBranch`
 * and a `tablerow` body is not, so its children have no branch ancestor to find. Both
 * consumers still scope the loop VARIABLE correctly, since that comes from the tag; only
 * a write inside a `tablerow` body outlives its loop.
 *
 * Shared by the two per-file models that track what a name holds — `shape-analysis` for
 * its structure and `variable-types` for its type — so neither can drift from the other
 * on where a write stops being a fact.
 */
export function enclosingBranchEnd(ancestors: LiquidHtmlNode[]): number | undefined {
  for (let i = ancestors.length - 1; i >= 0; i--) {
    if (ancestors[i].type === NodeTypes.LiquidBranch) return ancestors[i].position.end;
  }
  return undefined;
}
