import { expect, describe, it } from 'vitest';
import { MetadataParamsCheck } from '.';
import { check } from '../../test';

describe('Module: MetadataParamsCheck', () => {
  it('should report the missing variable when not defined but passed', async () => {
    const file = `
      ---
      metadata:
        params:
          variable: {}
          variable3: {}
      ---
      {% assign a = 5 | plus: variable | plus: variable2 %}
      {{ a }}
    `;
    const file2 = `
      {% function a = 'commands/call/fileToCall', variable: 2, variable2: 12 %}
      {{ a }}
    `;
    const files = {
      'app/lib/commands/call/fileToCall.liquid': file,
      'app/lib/caller.liquid': file2,
    };

    const offenses = await check(files, [MetadataParamsCheck]);

    expect(offenses).to.have.length(2);
    expect(offenses).to.containOffense('Unknown parameter variable2 passed to function call');
    expect(offenses).to.containOffense(
      'Required parameter variable3 must be passed to function call',
    );
  });

  it('should ignore if metadata not defined', async () => {
    const file = `
      ---
      metadata:
      ---
      {% assign a = 5 | plus: variable | plus: variable2 %}
      {{ a }}
    `;
    const file2 = `
      {% function a = 'commands/call/fileToCall', variable: 2, variable2: 12 %}
      {{ a }}
    `;
    const files = {
      'app/lib/commands/call/fileToCall.liquid': file,
      'app/lib/caller.liquid': file2,
    };

    const offenses = await check(files, [MetadataParamsCheck]);

    expect(offenses).to.have.length(0);
  });

  it('should accept doc tag if metadata not defined', async () => {
    const file = `
      {% doc %}
        @param {Number} variable - param with description
        @param {Number} variable2 - param with description
      {% enddoc %}

      {% assign a = 5 | plus: variable | plus: variable2 %}
      {{ a }}
    `;
    const file2 = `
      {% function a = 'commands/call/fileToCall', variable: 2, variable2: 12 %}
      {{ a }}
    `;
    const files = {
      'app/lib/commands/call/fileToCall.liquid': file,
      'app/lib/caller.liquid': file2,
    };

    const offenses = await check(files, [MetadataParamsCheck]);

    expect(offenses).to.have.length(0);
  });

  it('should reject if doc tag is missing params', async () => {
    const file = `
      {% doc %}
        @param {Number} variable - param with description
      {% enddoc %}

      {% assign a = 5 | plus: variable | plus: variable2 %}
      {{ a }}
    `;
    const file2 = `
      {% function a = 'commands/call/fileToCall', variable: 2, variable2: 12 %}
      {{ a }}
    `;
    const files = {
      'app/lib/commands/call/fileToCall.liquid': file,
      'app/lib/caller.liquid': file2,
    };

    const offenses = await check(files, [MetadataParamsCheck]);

    expect(offenses).to.have.length(1);
  });
});
