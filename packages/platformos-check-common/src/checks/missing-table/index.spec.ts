import { describe, expect, it } from 'vitest';
import { MissingTable } from './index';
import { check } from '../../test';

const APP_SCHEMA = 'name: blog_post\nproperties:\n  - name: title\n    type: string\n';
const MODULE_SCHEMA = 'name: module_table\nproperties:\n  - name: body\n    type: string\n';

/** A project that declares one app table and one module table. */
const withSchemas = (graphql: Record<string, string>) => ({
  'app/schema/blog_post.yml': APP_SCHEMA,
  'modules/blog/public/schema/module_table.yml': MODULE_SCHEMA,
  ...graphql,
});

const messageFor = (table: string) => `'${table}' is not declared by any schema file`;

describe('Module: MissingTable', () => {
  it('reports a table no schema declares, pointing at the string that named it', async () => {
    const source =
      'query q { records(per_page: 1, filter: { table: { value: "nope" } }) { results { id } } }';
    const offenses = await check(withSchemas({ 'app/graphql/q.graphql': source }), [MissingTable]);

    expect(offenses).to.have.length(1);
    expect(offenses[0].message).to.equal(messageFor('nope'));
    expect(source.slice(offenses[0].start.index, offenses[0].end.index)).to.equal('"nope"');
  });

  it('reports a table named by the argument form, which only a mutation uses', async () => {
    const offenses = await check(
      withSchemas({
        'app/graphql/m.graphql': 'mutation m { record_delete(id: 1, table: "nope") { id } }',
      }),
      [MissingTable],
    );

    expect(offenses.map((offense) => offense.message)).to.eql([messageFor('nope')]);
  });

  it('reports every unmatched occurrence, each at its own position', async () => {
    const source = `query q {
  a: records(per_page: 1, filter: { table: { value: "one" } }) { results { id } }
  b: records(per_page: 1, filter: { table: { value: "two" } }) { results { id } }
}`;
    const offenses = await check(withSchemas({ 'app/graphql/q.graphql': source }), [MissingTable]);

    expect(offenses.map((offense) => offense.message)).to.eql([
      messageFor('one'),
      messageFor('two'),
    ]);
    expect(offenses.map((offense) => source.slice(offense.start.index, offense.end.index))).to.eql([
      '"one"',
      '"two"',
    ]);
  });

  /**
   * The controls. Each is a table the project really can query, or one this check cannot
   * attribute, so reporting any of them trades a false approval for a false block.
   */
  it.each([
    [
      'a table an app schema declares',
      'query q { records(per_page: 1, filter: { table: { value: "blog_post" } }) { results { id } } }',
    ],
    [
      'a module table spelled the way the platform names it',
      'query q { records(per_page: 1, filter: { table: { value: "modules/blog/module_table" } }) { results { id } } }',
    ],
    [
      'a dynamic table',
      'query q($t: String) { records(per_page: 1, filter: { table: { value: $t } }) { results { id } } }',
    ],
    [
      'a table on another instance',
      'query q { remote_records(per_page: 1, endpoint: { url: "https://other" }, filter: { table: { value: "elsewhere" } }) { results { id } } }',
    ],
    ['an operation naming no table at all', 'query q { users(per_page: 1) { results { id } } }'],
  ])('stays silent for %s', async (_name, source) => {
    const offenses = await check(withSchemas({ 'app/graphql/q.graphql': source }), [MissingTable]);

    expect(offenses).to.eql([]);
  });

  /**
   * The platform runs a schema's `name:` through `ParameterizedName`, which prefixes
   * `modules/<module>/` for a module schema — so the BARE name is not a table. Saying so is
   * the whole reason every module table in a real project was reported before this.
   */
  it('reports a module table referenced by its bare name', async () => {
    const source =
      'query q { records(per_page: 1, filter: { table: { value: "module_table" } }) { results { id } } }';
    const offenses = await check(withSchemas({ 'app/graphql/q.graphql': source }), [MissingTable]);

    expect(offenses.map((offense) => offense.message)).to.eql([messageFor('module_table')]);
  });

  /**
   * A project with no schema cannot be told apart from one whose schemas this run never saw,
   * and the second would be a wall of false positives. The pair is the point: the SAME query
   * reports once a schema exists, so the silence is the guard rather than a broken check.
   */
  describe('a project with no schema at all', () => {
    const source =
      'query q { records(per_page: 1, filter: { table: { value: "nope" } }) { results { id } } }';

    it('reports nothing', async () => {
      const offenses = await check({ 'app/graphql/q.graphql': source }, [MissingTable]);

      expect(offenses).to.eql([]);
    });

    it('CONTROL: the same query reports as soon as one schema exists', async () => {
      const offenses = await check(withSchemas({ 'app/graphql/q.graphql': source }), [
        MissingTable,
      ]);

      expect(offenses.map((offense) => offense.message)).to.eql([messageFor('nope')]);
    });
  });

  describe('ignoreMissing', () => {
    const source = `query q {
  a: records(per_page: 1, filter: { table: { value: "from_elsewhere" } }) { results { id } }
  b: records(per_page: 1, filter: { table: { value: "typo" } }) { results { id } }
}`;

    it('suppresses only the tables it names', async () => {
      const offenses = await check(
        withSchemas({ 'app/graphql/q.graphql': source }),
        [MissingTable],
        {},
        { MissingTable: { enabled: true, ignoreMissing: ['from_elsewhere'] } },
      );

      expect(offenses.map((offense) => offense.message)).to.eql([messageFor('typo')]);
    });

    it('CONTROL: both are reported when it is empty', async () => {
      const offenses = await check(withSchemas({ 'app/graphql/q.graphql': source }), [
        MissingTable,
      ]);

      expect(offenses.map((offense) => offense.message)).to.eql([
        messageFor('from_elsewhere'),
        messageFor('typo'),
      ]);
    });
  });
});
