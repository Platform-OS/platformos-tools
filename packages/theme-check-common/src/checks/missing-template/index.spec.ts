import { expect, describe, it } from 'vitest';
import { MissingTemplate } from '.';
import { check } from '../../test';

describe('Module: MissingTemplate', () => {
  it('should report missing template errors', async () => {
    const testCases = [
      {
        testCase: 'should report the missing snippet to be rendered with "render"',
        file: `
        {% render 'missing' with foo as arg          %}
        {% render myvariable %}
      `,
        expected: {
          "check": "MissingTemplate",
          "end": {
            "character": 27,
            "index": 28,
            "line": 1,
          },
          "fix": undefined,
          "message": "'missing' does not exist",
          "severity": 0,
          "start": {
            "character": 18,
            "index": 19,
            "line": 1,
          },
          "suggest": undefined,
          "type": "LiquidHtml",
          "uri": "file:///snippets/snippet.liquid",
        },
        filesWith: (file: string) => ({
          'snippets/snippet.liquid': file,
        }),
      },
      {
        testCase: 'should report the missing snippet to be rendered with "include"',
        file: "{% include 'missing' %}",
        expected: {
          message: "'missing' does not exist",
          uri: 'file:///snippets/snippet.liquid',
          start: { index: 11, line: 0, character: 11 },
          end: { index: 20, line: 0, character: 20 },
        },
        filesWith: (file: string) => ({
          'snippets/snippet.liquid': file,
        }),
      },
      {
        testCase: 'should report the missing section to be rendered with "section"',
        file: "{% section 'missing' %}",
        expected: {
          "check": "MissingTemplate",
          "end": {
            "character": 27,
            "index": 28,
            "line": 1,
          },
          "fix": undefined,
          "message": "'missing' does not exist",
          "severity": 0,
          "start": {
            "character": 18,
            "index": 19,
            "line": 1,
          },
          "suggest": undefined,
          "type": "LiquidHtml",
          "uri": "file:///snippets/snippet.liquid",
        },
        filesWith: (file: string) => ({
          'sections/section.liquid': file,
        }),
      },
    ];
    for (const { testCase, file, expected, filesWith } of testCases) {
      const offenses = await check(filesWith(file), [MissingTemplate]);

      expect(offenses).to.have.length(1);
      expect(offenses, testCase).to.containOffense({
        check: MissingTemplate.meta.code,
        ...expected,
      });
    }
  });
});
