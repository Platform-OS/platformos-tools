/**
 * Which documented symbol a diagnostic is ABOUT, resolved from the syntax tree.
 *
 * FROM THE TREE, never from the message: parsing names out of English wording this package
 * does not own is forbidden (ARCHITECTURE.md §Invariants #2). The offense carries an offset
 * and the buffer's tree comes back with it, so the name is read from the node the engine
 * pointed at.
 *
 * `findCurrentNode` is check-common's, the same primitive the language server's hover,
 * definition and highlight providers use, asked of the same tree the offense came from
 * (`LintBufferResult.ast`, captured inside the buffer overlay for this).
 */
import { NodeTypes } from '@platformos/liquid-html-parser';
import { findCurrentNode, type LiquidHtmlNode } from '@platformos/platformos-check-common';

/** A symbol the docset may publish an entry for. */
export interface DocumentedSymbol {
  kind: 'filter' | 'tag' | 'object';
  name: string;
}

/**
 * The nearest enclosing node that names something the docset documents.
 *
 * Searched from the node the offset lands on OUTWARDS through its ancestors, nearest
 * first, because an offense range often points INSIDE the construct it is about: the
 * argument of a filter, the markup of a tag. Stopping at the first match is what makes
 * `{{ x | hash_add_key: 'k' }}` resolve to the filter rather than to the tag or the
 * output that contains it.
 */
export function documentedSymbolAt(
  ast: LiquidHtmlNode,
  offset: number,
): DocumentedSymbol | undefined {
  const [node, ancestors] = findCurrentNode(ast, offset);
  // Nearest first: `ancestors` is root-to-parent, so it is walked backwards.
  for (const candidate of [node, ...[...ancestors].reverse()]) {
    const symbol = symbolOf(candidate);
    if (symbol) return symbol;
  }
  return undefined;
}

/**
 * The symbol a single node names, if it names one.
 *
 * Only three node types qualify, matching the three things the docset publishes. A tag's
 * `name` can be a `NamedTags` enum member rather than a plain string, and a variable
 * lookup's can be `null` — `{{ ["a"][0] }}` subscripts an array literal, so the lookup has
 * a position and no name — so both are checked rather than assumed. Unchecked, that null
 * would be looked up in the docset as the string `"null"`.
 */
function symbolOf(node: LiquidHtmlNode): DocumentedSymbol | undefined {
  switch (node.type) {
    case NodeTypes.LiquidFilter:
      return typeof node.name === 'string' ? { kind: 'filter', name: node.name } : undefined;
    case NodeTypes.LiquidTag:
    case NodeTypes.LiquidRawTag:
      return typeof node.name === 'string' ? { kind: 'tag', name: node.name } : undefined;
    case NodeTypes.VariableLookup:
      return typeof node.name === 'string' && node.name.length > 0
        ? { kind: 'object', name: node.name }
        : undefined;
    default:
      return undefined;
  }
}
