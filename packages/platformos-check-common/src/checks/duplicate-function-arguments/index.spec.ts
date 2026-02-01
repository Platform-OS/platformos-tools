import { describe, it, expect } from 'vitest';
import { DuplicateFunctionArguments } from '.';
import { runLiquidCheck, applySuggestions } from '../../test';

describe('Module: DuplicateFunctionArguments', () => {
  function runCheck(sourceCode: string) {
    return runLiquidCheck(DuplicateFunctionArguments, sourceCode);
  }

  describe('detection', () => {
    it('should report duplicate arguments in function tags', async () => {
      const sourceCode = `
        {% function res = 'partial', param1: 'value1', param2: 'value2', param1: 'value3' %}
      `;

      const offenses = await runCheck(sourceCode);

      expect(offenses).toHaveLength(1);
      expect(offenses[0].message).toMatch(/Duplicate argument 'param1'/);
      expect(offenses[0].suggest).toBeDefined();
      expect(offenses[0].suggest!.length).toBe(1);
      expect(offenses[0].suggest![0].message).toBe("Remove duplicate argument 'param1'");
    });

    it('should report multiple duplicate arguments in function tags', async () => {
      const sourceCode = `
        {% function res = 'partial', param1: 'value1', param2: 'value2', param1: 'value3', param2: 'value4', param1: 'value5' %}
      `;

      const offenses = await runCheck(sourceCode);

      expect(offenses).toHaveLength(3);
      expect(offenses[0].message).toMatch(/Duplicate argument 'param1'/);
      expect(offenses[0].start.index).toBe(sourceCode.indexOf("param1: 'value3'"));
      expect(offenses[1].message).toMatch(/Duplicate argument 'param2'/);
      expect(offenses[1].start.index).toBe(sourceCode.indexOf("param2: 'value4'"));
      expect(offenses[2].message).toMatch(/Duplicate argument 'param1'/);
      expect(offenses[2].start.index).toBe(sourceCode.indexOf("param1: 'value5'"));
    });
  });

  describe('suggestions', () => {
    it('should correctly suggest fixing all duplicate arguments except for the first', async () => {
      const sourceCode = `{% function res = 'partial', param1: 'value1', param2: 'value2', param1: 'value3', param1: 'value4' %}`;
      const offenses = await runCheck(sourceCode);

      expect(offenses).toHaveLength(2);
      expect(offenses[0].start.index).toBe(sourceCode.indexOf("param1: 'value3'"));
      expect(offenses[1].start.index).toBe(sourceCode.indexOf("param1: 'value4'"));
      const suggestionResult = applySuggestions(sourceCode, offenses[0]);
      expect(suggestionResult).toEqual([
        `{% function res = 'partial', param1: 'value1', param2: 'value2', param1: 'value4' %}`,
      ]);
    });
  });

  describe('edge cases', () => {
    it('should not report when there are no duplicate arguments', async () => {
      const sourceCode = `
        {% function res = 'partial', param1: 'value1', param2: 'value2', param3: 'value3' %}
      `;

      const offenses = await runCheck(sourceCode);

      expect(offenses).toHaveLength(0);
    });

    it('should not report for variable function tags where partial name is a variable', async () => {
      const sourceCode = `
        {% function res = variable, param1: 'value1', param1: 'value2' %}
      `;

      const offenses = await runCheck(sourceCode);

      expect(offenses).toHaveLength(0);
    });

    it('should handle remove duplicate param when there are multiple function tags', async () => {
      const sourceCode = `
        {% function res = 'partial', param1: 'value1', param2: 'value2', param3: 'value3' %}
        {% function res = 'partial', param1: 'value4', param2: 'value5', param1: 'value6' %}
       `;

      const offenses = await runCheck(sourceCode);

      expect(offenses).toHaveLength(1);
      expect(offenses[0].message).toMatch(/Duplicate argument 'param1'/);
      expect(offenses[0].start.index).toBe(sourceCode.indexOf("param1: 'value6'"));
      const suggestionResult = applySuggestions(sourceCode, offenses[0]);
      expect(suggestionResult).toEqual([
        `
        {% function res = 'partial', param1: 'value1', param2: 'value2', param3: 'value3' %}
        {% function res = 'partial', param1: 'value4', param2: 'value5' %}
       `,
      ]);
    });
  });
});
