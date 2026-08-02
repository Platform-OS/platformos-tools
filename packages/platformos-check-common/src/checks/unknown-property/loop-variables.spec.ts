import { describe, expect, it } from 'vitest';

import { MockApp, runLiquidCheck } from '../../test';
import { UnknownProperty } from './index';

const messagesOf = (offenses: { message: string }[]) => offenses.map((offense) => offense.message);

/**
 * The reporter's file, reduced: a query result, a `group_by` the check cannot see into,
 * and a loop whose variable REUSES the query result's name.
 *
 * `r.l_id` is correct Liquid — inside the loop `r` is a relationship. The offense was
 * the `graphql r` shape from four lines earlier being applied to the loop item, and it
 * is why six `platformos-check-disable UnknownProperty` directives had to stay in
 * pos-module-community.
 */
const AUDIENCE_GRAPHQL = `query audience {
  tags(per_page: 10) {
    results {
      id
      relationships { name l_id }
    }
  }
}`;

const app: MockApp = { 'app/graphql/audience.graphql': AUDIENCE_GRAPHQL };

const runPage = (body: string, files: MockApp = app) =>
  runLiquidCheck(
    UnknownProperty,
    `{% liquid\n${body}\n%}`,
    'app/views/pages/probe.liquid',
    {},
    files,
  );

describe('Module: UnknownProperty — loop variables', () => {
  it('should claim nothing about a loop variable that shadows a variable with a shape', async () => {
    const offenses = await runPage(`  graphql r = 'audience'
  assign grouped = r.tags.results | group_by: 'name'
  for r in grouped['followship:tag']
    assign x = r.l_id
  endfor`);
    expect(messagesOf(offenses)).toEqual([]);
  });

  it('should behave identically when the loop variable has its own name', async () => {
    const offenses = await runPage(`  graphql r = 'audience'
  assign grouped = r.tags.results | group_by: 'name'
  for rel in grouped['followship:tag']
    assign x = rel.l_id
  endfor`);
    expect(messagesOf(offenses)).toEqual([]);
  });

  it('should keep reporting the same read off the query result itself', async () => {
    const offenses = await runPage(`  graphql r = 'audience'
  assign x = r.l_id`);
    expect(messagesOf(offenses)).toEqual(["Unknown property 'l_id' on 'r'."]);
  });

  it('should restore the shadowed variable after the loop ends', async () => {
    const offenses = await runPage(`  graphql r = 'audience'
  assign grouped = r.tags.results | group_by: 'name'
  for r in grouped['followship:tag']
    assign x = r.l_id
  endfor
  assign y = r.tags.results
  assign z = r.bogus`);
    expect(messagesOf(offenses)).toEqual(["Unknown property 'bogus' on 'r'."]);
  });

  it('should report a genuinely absent property on an item whose shape is known', async () => {
    const offenses = await runPage(`  assign rows = [{ "id": 1 }, { "id": 2 }]
  for row in rows
    assign a = row.id
    assign b = row.bogus
  endfor`);
    expect(messagesOf(offenses)).toEqual(["Unknown property 'bogus' on 'row'."]);
  });

  it('should claim nothing when the iterated value is not a list this check can see into', async () => {
    const offenses = await runPage(`  assign hash = { "a": 1 }
  for pair in hash
    assign x = pair.anything
  endfor`);
    expect(messagesOf(offenses)).toEqual([]);
  });

  it('should claim nothing when the list has no known item shape', async () => {
    const offenses = await runPage(`  assign rows = []
  for row in rows
    assign x = row.anything
  endfor`);
    expect(messagesOf(offenses)).toEqual([]);
  });

  it('should bind a tablerow variable exactly as for does', async () => {
    const shadowing = await runPage(`  graphql r = 'audience'
  assign grouped = r.tags.results | group_by: 'name'
  tablerow r in grouped['followship:tag']
    assign x = r.l_id
  endtablerow
  assign y = r.tags.results`);
    const knownItem = await runPage(`  assign rows = [{ "id": 1 }]
  tablerow row in rows
    assign a = row.bogus
  endtablerow`);

    expect({ shadowing: messagesOf(shadowing), knownItem: messagesOf(knownItem) }).toEqual({
      shadowing: [],
      knownItem: ["Unknown property 'bogus' on 'row'."],
    });
  });

  it('should claim nothing at all when the loop markup cannot be read', async () => {
    const offenses = await runPage(`  assign rows = [{ "id": 1 }]
  for row in
    assign x = row.anything
  endfor
  assign y = rows.first.anything`);
    expect(messagesOf(offenses)).toEqual([]);
  });

  /**
   * TASK-58's alias rule, which this must not regress: a loop item is a REFERENCE into
   * the collection, so a partial that writes through one returns a shape that may carry
   * fields nobody saw assigned — `deepOpen`, not "no such field".
   */
  it('should keep a partial that mutates through a loop item from claiming a closed shape', async () => {
    const offenses = await runLiquidCheck(
      UnknownProperty,
      `{% liquid
  function rows = 'lib/queries/rows'
  assign a = rows.first.id
  assign b = rows.first.total
%}`,
      'app/views/pages/probe.liquid',
      {},
      {
        'app/lib/queries/rows.liquid': `{% liquid
  assign rows = [{ "id": 1 }]
  for row in rows
    hash_assign row['total'] = 1
  endfor
  return rows
%}`,
      },
    );
    expect(messagesOf(offenses)).toEqual([]);
  });
});
