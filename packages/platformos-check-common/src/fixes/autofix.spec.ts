import { expect, describe, it } from 'vitest';
import { autofix } from '../test';
import { Offense, SourceCodeType } from '../types';

describe('Module: autofix', () => {
  it('should apply a list of all safe changes', async () => {
    // Two files of two different source types, so this covers autofix picking the
    // right corrector per file as well as applying the fixes. JSON is not one of
    // them: a platformOS app has no JSON source, so no `.json` file is ever in the
    // app for autofix to reach. `JSONCorrector` is covered directly in
    // `correctors/json-corrector.spec.ts`.
    const mockApp = {
      'app/views/partials/a.liquid': 'Banana world',
      'app/graphql/b.graphql': 'query { id }',
    };

    const offenses: Offense[] = [
      {
        type: SourceCodeType.LiquidHtml,
        fix: (corrector) => corrector.insert(2, 'nanana'),
        uri: 'file:///app/views/partials/a.liquid',
        check: 'Mock Check',
        message: 'Mock check message',
        severity: 0,
        start: { line: 0, character: 0, index: 0 },
        end: { line: 0, character: 0, index: 0 },
      },
      {
        type: SourceCodeType.LiquidHtml,
        suggest: [
          {
            message: 'unsafe change',
            fix: (corrector) => {
              corrector.replace(0, 5, 'nooooo');
            },
          },
        ],
        uri: 'file:///app/views/partials/a.liquid',
        check: 'Mock Check',
        message: 'Mock check message',
        severity: 0,
        start: { line: 0, character: 0, index: 0 },
        end: { line: 0, character: 0, index: 0 },
      },
      {
        type: SourceCodeType.GraphQL,
        fix: (corrector) => corrector.insert(8, 'name '),
        uri: 'file:///app/graphql/b.graphql',
        check: 'Mock Check',
        message: 'Mock check message',
        severity: 0,
        start: { line: 0, character: 0, index: 0 },
        end: { line: 0, character: 0, index: 0 },
      },
      {
        type: SourceCodeType.GraphQL,
        suggest: [
          {
            message: 'unsafe change',
            fix: (corrector) => {
              corrector.remove(0, 5);
            },
          },
        ],
        uri: 'file:///app/graphql/b.graphql',
        check: 'Mock Check',
        message: 'Mock check message',
        severity: 0,
        start: { line: 0, character: 0, index: 0 },
        end: { line: 0, character: 0, index: 0 },
      },
    ];

    const fixed = await autofix(mockApp, offenses);
    expect(fixed).to.eql({
      'app/views/partials/a.liquid': 'Bananananana world',
      'app/graphql/b.graphql': 'query { name id }',
    });
  });
});
