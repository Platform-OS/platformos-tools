/**
 * Symbol resolution is a pure function of a tree and an offset, so these run without a
 * project, a docset or a lint.
 */
import { toLiquidHtmlAST } from '@platformos/liquid-html-parser';
import { describe, expect, it } from 'vitest';

import { documentedSymbolAt } from './symbol.js';

/**
 * Resolve one character INTO `needle`, so the offsets read as source rather than
 * arithmetic.
 */
const symbolAt = (source: string, needle: string) =>
  documentedSymbolAt(toLiquidHtmlAST(source), source.indexOf(needle) + 1);

describe('Unit: documentedSymbolAt', () => {
  it('resolves the FILTER an offense inside a filtered output is about', () => {
    expect(symbolAt('{{ null | hash_merge }}', 'hash_merge')).toEqual({
      kind: 'filter',
      name: 'hash_merge',
    });
  });

  it('prefers the nearest symbol, so a filter wins over the tag containing it', () => {
    // The whole reason the walk stops at the first match: every filter is inside
    // something, and the something is never the better answer.
    expect(symbolAt('{% if true %}{{ x | hash_merge }}{% endif %}', 'hash_merge')).toEqual({
      kind: 'filter',
      name: 'hash_merge',
    });
  });

  it('reaches an enclosing TAG when the offense lands on one of its arguments', () => {
    // `'ten'` is a String inside a NamedArgument inside a ForMarkup inside the LiquidTag —
    // three levels up, which is why this walks ancestors rather than reading one node.
    expect(symbolAt("{% for x in (1..3) limit: 'ten' %}{% endfor %}", "'ten'")).toEqual({
      kind: 'tag',
      name: 'for',
    });
  });

  it('resolves a RAW tag by name, exactly as an ordinary one', () => {
    // A separate node type with a separate branch: `{% raw %}` is a `LiquidRawTag`, and
    // the docset publishes it under the same `tags` list as `for`.
    expect(symbolAt('{% raw %}x{% endraw %}', 'raw')).toEqual({ kind: 'tag', name: 'raw' });
  });

  it('resolves an OBJECT from a bare variable lookup, ignoring what is looked up on it', () => {
    // `context.params.id` is ONE lookup named `context`; the docset publishes the drop,
    // not each property path through it.
    expect(symbolAt('{{ context.params.id }}', 'context')).toEqual({
      kind: 'object',
      name: 'context',
    });
  });

  /**
   * A `VariableLookup` whose `name` is null must resolve to NOTHING, not to the string
   * `"null"`. `{{ ["a"][0] }}` subscripts an array literal, so the lookup carries a position
   * and no name; deleting the null guard in `symbolOf` returns
   * `{kind: 'object', name: 'null'}`, and a docset entry published under that name would be
   * rendered as the explanation for an unrelated finding.
   */
  it('resolves nothing for a lookup that has no name', () => {
    expect(documentedSymbolAt(toLiquidHtmlAST('{{ ["a"][0] }}'), 8)).toBeUndefined();
  });

  /**
   * The CONTROL for the case above: the same subscript shape, with a name, does resolve.
   * Without it, a guard wide enough to reject every lookup would pass.
   */
  it('CONTROL: the same subscript shape resolves when the lookup is named', () => {
    expect(symbolAt('{{ a["k"] }}', 'a[')).toEqual({ kind: 'object', name: 'a' });
  });

  it('resolves nothing outside every construct, and nothing for plain markup', () => {
    expect({
      // What an out-of-range offset actually does — it is not an error, it answers the
      // Document. `enrich` therefore checks for a MISSING offset rather than passing a
      // sentinel, because a sentinel's silence here is an accident of this switch.
      beforeTheDocument: documentedSymbolAt(toLiquidHtmlAST('{{ null | hash_merge }}'), -1),
      plainHtml: symbolAt('<div>hello</div>', 'hello'),
    }).toEqual({ beforeTheDocument: undefined, plainHtml: undefined });
  });
});
