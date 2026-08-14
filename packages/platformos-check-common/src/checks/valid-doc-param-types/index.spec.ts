import { expect, describe, it } from 'vitest';
import { ValidDocParamTypes } from './index';
import { runLiquidCheck, applySuggestions, messagesOf } from '../../test';
import { PlatformOSDocset } from '../../types';
import {
  docsetWithoutLiquidDoc,
  publishedDocset,
  publishedLiquidDoc,
} from '../../test/published-docset';

/**
 * The REAL published docset, because that is the whole subject: this check accepts exactly the types
 * `liquid_doc.json` publishes, unioned with the objects `objects.json` publishes. Against a hand-written
 * docset it could only prove it agrees with the mock.
 */
const check = (source: string, docset: PlatformOSDocset = publishedDocset) =>
  runLiquidCheck(ValidDocParamTypes, source, undefined, { platformosDocset: docset });

describe('Module: ValidDocParamTypes', () => {
  // Every type the docset publishes, whatever they are. Restating the list here would make this test
  // fail on a correct docs release rather than on a bug.
  publishedLiquidDoc.param_types.forEach(({ name: paramType }) => {
    it(`should not report an error when a valid basic parameter (${paramType}) type is used`, async () => {
      const offenses = await check(`
        {% doc %}
          @param {${paramType}} param1 - Example param
        {% enddoc %}
      `);

      expect(offenses).to.be.empty;
    });
  });

  // `date` and `time` are in that loop now, which is the half of TASK-84's AC#6 that changed: both were
  // types the platform documented for `to_date` and `to_time` and rejected in a docblock.

  it(`should not report an error when a valid liquid object parameter (current_user) type is used`, async () => {
    const offenses = await check(`
      {% doc %}
        @param {current_user} param1 - Example param
      {% enddoc %}
    `);

    expect(offenses).to.be.empty;
  });

  it(`should not report an error when the generic array parameter type is used`, async () => {
    const offenses = await check(`
      {% doc %}
        @param {array} mentioned_ids - unique profile ids
      {% enddoc %}
    `);

    expect(offenses).to.be.empty;
  });

  it(`should not report an error when a valid liquid object array parameter (current_user[]) type is used`, async () => {
    const offenses = await check(`
      {% doc %}
        @param {current_user[]} param1 - Example param
      {% enddoc %}
    `);

    expect(offenses).to.be.empty;
  });

  it('should report an error with suggestions when an invalid parameter type is used', async () => {
    const offenses = await check(`
      {% doc %}
        @param {invalidType} param1 - Example param
      {% enddoc %}
    `);

    expect(offenses).to.have.length(1);
    expect(offenses[0].message).to.equal("The parameter type 'invalidType' is not supported.");
    expect(offenses[0].suggest).to.have.length(1);
    expect(offenses[0]!.suggest![0].message).to.equal('Remove invalid parameter type');
  });

  it('should apply suggestion when an invalid parameter type is used', async () => {
    const sources = [
      `{% doc %} @param {invalidType} param1 - Example param {% enddoc %}`,
      `{% doc %} @param   {   invalidType   }   param1 - Example param {% enddoc %}`,
    ];

    for (const source of sources) {
      const offenses = await check(source);

      expect(offenses).to.have.length(1);
      const suggestions = applySuggestions(source, offenses[0]);

      expect(suggestions).to.deep.equal([`{% doc %} @param param1 - Example param {% enddoc %}`]);
    }
  });

  /**
   * A docset published before `liquid_doc.json` existed reports NOTHING, rather than reporting every
   * type in the project as unsupported — the same silence an unpublished filter arity gets.
   *
   * PAIRED with the control, because "no offenses" is what a check that ran and a check that never looked
   * both say. The suppression is wide enough to hide a real defect, so the defect is shown to be findable
   * through the same docset with only the vocabulary missing.
   */
  it('reports nothing when the docset publishes no param types', async () => {
    const sourceCode = `
      {% doc %}
        @param {invalidType} param1 - Example param
      {% enddoc %}
    `;

    expect(await check(sourceCode, docsetWithoutLiquidDoc)).to.be.empty;

    expect(messagesOf(await check(sourceCode))).to.deep.equal([
      "The parameter type 'invalidType' is not supported.",
    ]);
  });
});
