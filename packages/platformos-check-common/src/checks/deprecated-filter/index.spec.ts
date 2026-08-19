import { expect, describe, it } from 'vitest';
import { applySuggestions, highlightedOffenses, runLiquidCheck } from '../../test';
import { DeprecatedFilter } from './index';

const mockDependencies = {
  platformosDocset: {
    async graphQL() {
      return null;
    },
    async filters() {
      return [
        {
          name: 'old_filter',
          deprecated: true,
          deprecation_reason: 'use [new_filter](#new_filter) filter',
          deprecation_replacement: 'new_filter',
        },
        {
          name: 'deprecated_no_replacement',
          deprecated: true,
        },
        {
          name: 'new_filter',
        },
        {
          name: 'active_filter',
        },
      ];
    },
    async objects() {
      return [];
    },
    async liquidDrops() {
      return [];
    },
    async liquidDoc() {
      return { annotations: [], param_types: [] };
    },
    async tags() {
      return [];
    },
  },
};

describe('Module: DeprecatedFilter', () => {
  it('should report an offense when a deprecated filter is used', async () => {
    const sourceCode = `
      {{ value | old_filter }}
      {{ value | old_filter: 'arg' }}
    `;

    const offenses = await runLiquidCheck(
      DeprecatedFilter,
      sourceCode,
      'app/views/partials/file.liquid',
      mockDependencies,
    );
    expect(offenses.map((e) => e.message)).toEqual([
      "Deprecated filter 'old_filter', consider using 'new_filter'.",
      "Deprecated filter 'old_filter', consider using 'new_filter'.",
    ]);

    const highlights = highlightedOffenses(
      { 'app/views/partials/file.liquid': sourceCode },
      offenses,
    );
    expect(highlights).toEqual(['| old_filter', "| old_filter: 'arg'"]);
  });

  it('should not report an offense when a non-deprecated filter is used', async () => {
    const sourceCode = `
      {{ value | active_filter }}
      {{ value | new_filter }}
    `;

    const offenses = await runLiquidCheck(
      DeprecatedFilter,
      sourceCode,
      'app/views/partials/file.liquid',
      mockDependencies,
    );
    expect(offenses).toHaveLength(0);
  });

  it('should report a message without replacement when no alternative exists', async () => {
    const sourceCode = `{{ value | deprecated_no_replacement }}`;

    const offenses = await runLiquidCheck(
      DeprecatedFilter,
      sourceCode,
      'app/views/partials/file.liquid',
      mockDependencies,
    );
    expect(offenses).toHaveLength(1);
    expect(offenses[0].message).toEqual("Deprecated filter 'deprecated_no_replacement'.");
  });

  it('should report multiple offenses for multiple deprecated filter usages', async () => {
    const sourceCode = `{{ a | old_filter }} {{ b | deprecated_no_replacement }}`;

    const offenses = await runLiquidCheck(
      DeprecatedFilter,
      sourceCode,
      'app/views/partials/file.liquid',
      mockDependencies,
    );
    expect(offenses).toHaveLength(2);
  });

  it('should provide a suggestion to replace deprecated filter with recommended alternative', async () => {
    const sourceCode = `{{ value | old_filter }}`;

    const offenses = await runLiquidCheck(
      DeprecatedFilter,
      sourceCode,
      'app/views/partials/file.liquid',
      mockDependencies,
    );
    expect(offenses).toHaveLength(1);
    expect(offenses[0].suggest).toHaveLength(1);
    expect(offenses[0].suggest![0].message).toEqual("Replace 'old_filter' with 'new_filter'");
  });

  it('should apply the suggestion to replace the filter name', async () => {
    const sourceCode = `{{ value | old_filter }}`;

    const offenses = await runLiquidCheck(
      DeprecatedFilter,
      sourceCode,
      'app/views/partials/file.liquid',
      mockDependencies,
    );
    const suggestions = applySuggestions(sourceCode, offenses[0]);
    expect(suggestions).toContain('{{ value | new_filter }}');
  });

  it('should not provide a suggestion when no replacement exists', async () => {
    const sourceCode = `{{ value | deprecated_no_replacement }}`;

    const offenses = await runLiquidCheck(
      DeprecatedFilter,
      sourceCode,
      'app/views/partials/file.liquid',
      mockDependencies,
    );
    expect(offenses).toHaveLength(1);
    expect(offenses[0].suggest).toBeUndefined();
  });
  /**
   * The successor as DATA. Before `deprecation_replacement` existed the only source was the
   * `deprecation_reason` prose, matched with a "replaced by [`name`]" pattern — and the group of
   * tests above pins that pattern against a fixture written to satisfy it. No filter the platform
   * actually publishes is phrased that way: the second test below feeds `sha1`'s real reason,
   * verbatim, and gets no suggestion. So the rename was never once offered in practice.
   */
  describe('the successor published as a field', () => {
    const docsetWithField = {
      platformosDocset: {
        async graphQL() {
          return null;
        },
        async filters() {
          return [
            {
              name: 'sha1',
              deprecated: true,
              // Verbatim from the platform: it names the successor, in prose the regex cannot read.
              deprecation_reason: 'use [digest](#digest) filter',
              deprecation_replacement: 'digest',
            },
            { name: 'digest' },
          ];
        },
        async objects() {
          return [];
        },
        async liquidDrops() {
          return [];
        },
        async liquidDoc() {
          return { annotations: [], param_types: [] };
        },
        async tags() {
          return [];
        },
      },
    };

    it('offers the rename from deprecation_replacement when the prose does not state it', async () => {
      const sourceCode = `{{ value | sha1 }}`;
      const offenses = await runLiquidCheck(
        DeprecatedFilter,
        sourceCode,
        'app/views/partials/file.liquid',
        docsetWithField,
      );

      expect(offenses.map((offense) => offense.message)).toEqual([
        "Deprecated filter 'sha1', consider using 'digest'.",
      ]);
      expect(offenses[0].suggest!.map((suggestion) => suggestion.message)).toEqual([
        "Replace 'sha1' with 'digest'",
      ]);
      expect(applySuggestions(sourceCode, offenses[0])).toEqual(['{{ value | digest }}']);
    });

    it('offers nothing from that same prose without the field', async () => {
      // The control: identical entry minus `deprecation_replacement`. It isolates the field as
      // the cause — the suggestion above is not the regex quietly succeeding.
      const offenses = await runLiquidCheck(
        DeprecatedFilter,
        `{{ value | sha1 }}`,
        'app/views/partials/file.liquid',
        {
          platformosDocset: {
            ...docsetWithField.platformosDocset,
            async filters() {
              return [
                {
                  name: 'sha1',
                  deprecated: true,
                  deprecation_reason: 'use [digest](#digest) filter',
                },
                { name: 'digest' },
              ];
            },
          },
        },
      );

      expect(offenses.map((offense) => offense.message)).toEqual(["Deprecated filter 'sha1'."]);
      expect(offenses[0].suggest).toBeUndefined();
    });
  });

  // ─── A rewrite deprecation only fires on template-authored JSON ───────────

  /**
   * `parse_json` names `assign` as its replacement, which is a TAG: the migration is
   * `'{"a":1}' | parse_json` -> `{ "a": 1 }` as markup, and it only exists for JSON the template
   * itself wrote. These four tests pin the line between the two.
   */
  describe('a deprecation whose successor is not a filter', () => {
    const rewriteDependencies = {
      platformosDocset: {
        ...mockDependencies.platformosDocset,
        async filters() {
          return [
            {
              name: 'parse_json',
              deprecated: true,
              deprecation_replacement: 'assign',
            },
            { name: 'default' },
            { name: 'hash_merge' },
          ];
        },
      },
    };

    const messagesFor = async (sourceCode: string) => {
      const offenses = await runLiquidCheck(
        DeprecatedFilter,
        sourceCode,
        'app/views/partials/file.liquid',
        rewriteDependencies,
      );
      return offenses.map((offense) => offense.message);
    };

    it('reports a string literal, which is what the rewrite applies to', async () => {
      expect(await messagesFor(`{% assign a = '{"a":1}' | parse_json %}`)).toEqual([
        "Deprecated filter 'parse_json'.",
      ]);
    });

    it('reports a string literal that goes on to be merged', async () => {
      expect(await messagesFor(`{% assign a = '{}' | parse_json | hash_merge: b: 1 %}`)).toEqual([
        "Deprecated filter 'parse_json'.",
      ]);
    });

    it('stays silent on a runtime string, which has no rewrite', async () => {
      expect(await messagesFor(`{% assign a = response.body | parse_json %}`)).toEqual([]);
    });

    it('stays silent when a preceding filter produced the input', async () => {
      expect(
        await messagesFor(`{% assign a = errors[field] | default: '[]' | parse_json %}`),
      ).toEqual([]);
    });
  });
});
