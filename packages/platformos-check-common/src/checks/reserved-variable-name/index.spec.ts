import { describe, expect, it } from 'vitest';
import { highlightedOffenses, runLiquidCheck } from '../../test';
import { ReservedVariableName } from './index';

const message = (name: string) =>
  `'${name}' is a reserved Liquid literal and cannot be used as a variable name — reading '${name}' always returns the literal, never the assigned value`;

async function expectReservedOffense(sourceCode: string, name: string, highlight = name) {
  const offenses = await runLiquidCheck(ReservedVariableName, sourceCode);

  expect(offenses.map((offense) => offense.message)).toEqual([message(name)]);
  expect(highlightedOffenses(sourceCode, offenses)).toEqual([highlight]);
}

describe('Module: ReservedVariableName', () => {
  it('reports assigning to empty even when the name is referenced later', async () => {
    const sourceCode = [
      '{% liquid',
      "  assign empty = '{}' | parse_json",
      "  function invalid = 'modules/blog/commands/blog_instances/build', object: empty",
      '%}',
    ].join('\n');

    await expectReservedOffense(sourceCode, 'empty');
  });

  it('reports every reserved literal as an assign target', async () => {
    const sourceCode = [
      '{% liquid',
      "  assign true = 'a'",
      "  assign false = 'a'",
      "  assign nil = 'a'",
      "  assign null = 'a'",
      "  assign empty = 'a'",
      "  assign blank = 'a'",
      '%}',
    ].join('\n');

    const offenses = await runLiquidCheck(ReservedVariableName, sourceCode);

    expect(offenses.map((offense) => offense.message)).toEqual([
      message('true'),
      message('false'),
      message('nil'),
      message('null'),
      message('empty'),
      message('blank'),
    ]);
    expect(highlightedOffenses(sourceCode, offenses)).toEqual([
      'true',
      'false',
      'nil',
      'null',
      'empty',
      'blank',
    ]);
  });

  it('reports a reserved name as a capture target', async () => {
    await expectReservedOffense('{% capture blank %}hello{% endcapture %}', 'blank');
  });

  it('reports a reserved name as a function result target', async () => {
    await expectReservedOffense("{% function null = 'lib/queries/find', id: 1 %}", 'null');
  });

  it('reports a reserved name as a graphql result target', async () => {
    await expectReservedOffense("{% graphql empty = 'my/query' %}", 'empty');
  });

  it('reports a reserved name as an inline graphql result target', async () => {
    await expectReservedOffense(
      '{% graphql blank %}query { records { id } }{% endgraphql %}',
      'blank',
    );
  });

  it('reports a reserved name as a parse_json target', async () => {
    await expectReservedOffense('{% parse_json empty %}{ "a": 1 }{% endparse_json %}', 'empty');
  });

  it('reports a reserved name as a hash_assign target', async () => {
    await expectReservedOffense(
      "{% hash_assign empty['key'] = 'value' %}",
      'empty',
      "empty['key']",
    );
  });

  it('reports a reserved name as a for loop variable', async () => {
    await expectReservedOffense('{% for empty in items %}{{ empty }}{% endfor %}', 'empty');
  });

  it('reports a reserved name as a background job id', async () => {
    await expectReservedOffense("{% background nil = 'lib/jobs/cleanup' %}", 'nil');
  });

  it('reports a reserved name as a catch error variable', async () => {
    await expectReservedOffense('{% try %}{% catch empty %}{{ empty }}{% endtry %}', 'empty');
  });

  it('reports a reserved name as an increment target', async () => {
    await expectReservedOffense('{% increment empty %}', 'empty');
  });

  it('does not report non-reserved variable names', async () => {
    const sourceCode = [
      '{% liquid',
      "  assign my_empty = '{}' | parse_json",
      "  function result = 'lib/queries/find', object: my_empty",
      '  echo result',
      '%}',
    ].join('\n');

    const offenses = await runLiquidCheck(ReservedVariableName, sourceCode);

    expect(offenses).toEqual([]);
  });

  it('does not report reading reserved literals', async () => {
    const sourceCode = [
      '{% liquid',
      '  if items == empty or name == blank',
      '    echo "nothing"',
      '  endif',
      '  assign flag = true',
      '%}',
    ].join('\n');

    const offenses = await runLiquidCheck(ReservedVariableName, sourceCode);

    expect(offenses).toEqual([]);
  });

  it('does not report names that merely contain a reserved word', async () => {
    const sourceCode = "{% assign empty_result = '{}' | parse_json %}{{ empty_result }}";

    const offenses = await runLiquidCheck(ReservedVariableName, sourceCode);

    expect(offenses).toEqual([]);
  });
});
