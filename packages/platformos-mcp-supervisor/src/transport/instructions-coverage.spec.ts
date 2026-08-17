/**
 * The safety net for what was DELETED from the server instructions.
 */
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { runBatchLint } from '../lint/lint-batch.js';
import { SERVER_INSTRUCTIONS } from './instructions.js';

let projectDir: string;

beforeAll(() => {
  projectDir = mkdtempSync(join(tmpdir(), 'mcp-sup-claims-'));
  mkdirSync(join(projectDir, '.git'));
});

afterAll(() => {
  rmSync(projectDir, { recursive: true, force: true });
});

/**
 * One deleted claim: the pattern it warned about, and the checks that must still report
 * it. Measured, not predicted — several of these are owned by a different check than the
 * prose implied (a filter inside a condition is a PARSE error, not a filter check).
 */
const DELETED_CLAIMS: Array<{ claim: string; file: string; source: string; checks: string[] }> = [
  {
    claim: 'a JSON literal in {% assign %} must use double quotes',
    file: 'app/views/pages/json_quotes.liquid',
    source: "{% assign o = {'k': 1} %}{{ o }}",
    checks: ['JsonLiteralQuoteStyle'],
  },
  {
    claim: 'a subscript write needs a Hash or an Array, not a number',
    file: 'app/views/pages/write_target.liquid',
    source: '{% assign n = 5 %}{% assign n["k"] = 1 %}{{ n }}',
    checks: ['InvalidWriteTarget'],
  },
  {
    claim: '{% assign x << v %} needs an Array; a Hash is refused',
    file: 'app/views/pages/append_hash.liquid',
    source: '{% assign h = {"a": 1} %}{% assign h << 2 %}{{ h }}',
    checks: ['InvalidWriteTarget'],
  },
  {
    claim: "hash_assign's target must end in a bracket",
    file: 'app/views/pages/hash_assign_target.liquid',
    source: '{% assign h = {"a": 1} %}{% hash_assign h.k = 2 %}{{ h }}',
    // A PARSE error, not a write-target one: the grammar rejects the form outright.
    checks: ['DeprecatedTag', 'LiquidHTMLSyntaxError'],
  },
  {
    claim: 'a filter inside a condition is rejected by the converter',
    file: 'app/views/pages/filter_in_if.liquid',
    source: "{% assign a = 'x' %}{% if a | upcase == 'A' %}y{% endif %}",
    checks: ['LiquidHTMLSyntaxError'],
  },
  {
    claim: 'a filter on a {% for %} operand must be assigned first',
    file: 'app/views/pages/filter_in_for.liquid',
    source: '{% assign l = "a,b" | split: "," %}{% for x in l | reverse %}{{ x }}{% endfor %}',
    checks: ['LiquidHTMLSyntaxError', 'UndefinedObject'],
  },
  {
    claim: 'a filter elsewhere in a platformOS tag is silently ignored by the platform',
    file: 'app/views/pages/filter_on_cache.liquid',
    source: "{% cache 'k' | upcase %}x{% endcache %}",
    checks: ['FilterWithoutEffect'],
  },
  {
    claim: "{% for x in y limit: 'ten' %} warns on the argument type",
    file: 'app/views/pages/tag_arg_type.liquid',
    source: "{% for x in (1..3) limit: 'ten' %}{{ x }}{% endfor %}",
    checks: ['ValidTagArgumentTypes'],
  },
  {
    claim: 'a Hash filter given a number warns (a hard 500 at render time)',
    file: 'app/views/pages/filter_arg_type.liquid',
    source: "{{ 123 | hash_add_key: 'k', 1 }}",
    checks: ['ValidFilterArgumentTypes'],
  },
  {
    claim: 'a key defined twice in one YAML mapping is reported and does not block',
    file: 'app/translations/dup.yml',
    source: 'en:\n  a: 1\n  a: 2\n',
    checks: ['DuplicateYAMLKey'],
  },
  {
    claim: 'YAML 1.1 look-alikes (yes:/true:) are ONE key',
    file: 'app/translations/lookalike.yml',
    source: 'fr:\n  yes: 1\n  true: 2\n',
    checks: ['DuplicateYAMLKey'],
  },
  {
    claim: 'YAML that does not parse is reported and blocks',
    file: 'app/schema/broken.yml',
    source: 'a: [1, 2\n',
    checks: ['YAMLSyntaxError'],
  },
];

/** The claims that were KEPT, because nothing fires and so nothing else could say it. */
const KEPT_SILENCES: Array<{ claim: string; file: string; source: string }> = [
  {
    claim: 'a core Liquid filter given an odd type coerces, and is never reported',
    file: 'app/views/pages/core_filter.liquid',
    source: '{{ 5 | upcase }}',
  },
  {
    claim: 'the SHAPE of a model schema is not checked',
    file: 'app/schema/shape.yml',
    source: 'name: thing\nproperties:\n  - name: a\n    type: string\n    bogus: 1\n',
  },
  /**
   * The half of duplicate-key detection that does NOT fire, and why the prose says the
   * comparison is not exhaustive.
   */
  {
    claim: 'a YAML 1.1 sexagesimal colliding with its own value is NOT reported',
    file: 'app/translations/sexagesimal.yml',
    source: 'en:\n  1:30: a\n  5400: b\n',
  },
];

const checksFor = async (file: string, source: string): Promise<string[]> => {
  const { diagnostics } = await runBatchLint({
    projectDir,
    buffers: [{ filePath: file, content: source }],
  });
  return [...new Set((diagnostics.get(file) ?? []).map((d) => d.check))].sort();
};

describe('Every claim removed from the instructions is still caught by a check', () => {
  it.each(DELETED_CLAIMS)('$claim', async ({ file, source, checks }) => {
    expect(await checksFor(file, source)).toEqual([...checks].sort());
  });
});

describe('The claims that were KEPT are the ones no diagnostic can deliver', () => {
  it.each(KEPT_SILENCES)('$claim', async ({ file, source }) => {
    // Nothing fires — which is exactly why the prose has to say it. This is the control
    // for the group above: if these started reporting, the instructions would be claiming
    // a silence that no longer exists.
    expect(await checksFor(file, source)).toEqual([]);
  });

  it('and the instructions still state each of them', () => {
    expect({
      untypedArguments: SERVER_INSTRUCTIONS.includes(
        'An argument the documentation leaves untyped',
      ),
      schemaShape: SERVER_INSTRUCTIONS.includes('The SHAPE of a model schema is not checked'),
      duplicateKeyGap: SERVER_INSTRUCTIONS.includes(
        'silence there does not prove two keys are distinct',
      ),
      perProjectConfig: SERVER_INSTRUCTIONS.includes('Coverage is per project'),
    }).toEqual({
      untypedArguments: true,
      schemaShape: true,
      duplicateKeyGap: true,
      perProjectConfig: true,
    });
  });
});
