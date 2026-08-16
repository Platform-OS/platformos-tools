import { describe, expect, it } from 'vitest';
import { SourceCodeType, sourceCodeTypeOf } from '@platformos/platformos-common';
import { toSourceCode } from './to-source-code';
import { isError } from './utils';

/**
 * The JSON arm of `toSourceCode` is the ONE piece of JSON machinery that survived the
 * removal of the JSON check pipeline, and it survived for a reason no check-level test
 * can express: the language server's `DocumentManager` holds every buffer the editor
 * opens, `.json` included, so the JSON language service can answer hover and completion
 * for one. `App` still contains no JSON file and no check ever sees one.
 */
describe('Unit: toSourceCode — the editor-buffer JSON fallback', () => {
  const JSON_URI = 'file:///project/tsconfig.json';

  it('models a file with no platformOS source type as JSON, and PARSES it', () => {
    // The premise: nothing classifies this as a platformOS source.
    expect(sourceCodeTypeOf(JSON_URI)).toBe(undefined);

    const sourceCode = toSourceCode(JSON_URI, '{ "compilerOptions": { "strict": true } }');

    expect(sourceCode.type).toBe(SourceCodeType.JSON);
    // The half a `type`-only assertion cannot see: the fallback ran a real parser.
    expect(isError(sourceCode.ast)).toBe(false);
    expect((sourceCode.ast as { type: string }).type).toBe('Object');
  });

  it('reports unparseable JSON as an Error ast rather than throwing', () => {
    const sourceCode = toSourceCode(JSON_URI, '{ "unterminated": ');

    expect(sourceCode.type).toBe(SourceCodeType.JSON);
    expect(isError(sourceCode.ast)).toBe(true);
  });

  /**
   * The control. Without it, a "JSON fallback works" test passes just as well when the
   * fallback has swallowed EVERY extension — which would silently stop parsing Liquid,
   * GraphQL and YAML as themselves. The fallback must be reached only on a miss.
   */
  it('does not reach the fallback for a type platformOS does classify', () => {
    expect([
      toSourceCode('file:///project/app/views/partials/card.liquid', '{{ x }}').type,
      toSourceCode('file:///project/app/graphql/q.graphql', 'query { x }').type,
      toSourceCode('file:///project/app/translations/en.yml', 'en:\n  a: b\n').type,
    ]).toEqual([SourceCodeType.LiquidHtml, SourceCodeType.GraphQL, SourceCodeType.YAML]);
  });
});
