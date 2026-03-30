import { expect, describe, it } from 'vitest';
import { MetadataParamsCheck } from '.';
import { check } from '../../test';

describe('Module: MetadataParamsCheck', () => {
  it('should use doc tag as complete param list when present', async () => {
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

  it('should report missing required doc params', async () => {
    const file = `
      {% doc %}
        @param {Number} variable - param with description
        @param {Number} variable2 - param with description
      {% enddoc %}

      {% assign a = 5 | plus: variable | plus: variable2 %}
      {{ a }}
    `;
    const file2 = `
      {% function a = 'commands/call/fileToCall', variable: 2 %}
      {{ a }}
    `;
    const files = {
      'app/lib/commands/call/fileToCall.liquid': file,
      'app/lib/caller.liquid': file2,
    };

    const offenses = await check(files, [MetadataParamsCheck]);

    expect(offenses).to.have.length(1);
    expect(offenses).to.containOffense(
      'Required parameter variable2 must be passed to function call',
    );
  });

  it('should report unknown params not in doc', async () => {
    const file = `
      {% doc %}
        @param {Number} variable - param with description
      {% enddoc %}

      {% assign a = 5 | plus: variable %}
      {{ a }}
    `;
    const file2 = `
      {% function a = 'commands/call/fileToCall', variable: 2, extra: 12 %}
      {{ a }}
    `;
    const files = {
      'app/lib/commands/call/fileToCall.liquid': file,
      'app/lib/caller.liquid': file2,
    };

    const offenses = await check(files, [MetadataParamsCheck]);

    expect(offenses).to.have.length(1);
    expect(offenses).to.containOffense('Unknown parameter extra passed to function call');
  });

  it('should allow doc-optional params without requiring them', async () => {
    const file = `
      {% doc %}
        @param {String} a - required
        @param {String} [b] - optional
      {% enddoc %}
      {{ a }}{{ b }}
    `;
    const file2 = `
      {% function res = 'commands/call/fileToCall', a: 'hello' %}
      {{ res }}
    `;
    const files = {
      'app/lib/commands/call/fileToCall.liquid': file,
      'app/lib/caller.liquid': file2,
    };

    const offenses = await check(files, [MetadataParamsCheck]);

    expect(offenses).to.have.length(0);
  });

  it('should allow passing doc-optional params without reporting unknown', async () => {
    const file = `
      {% doc %}
        @param {String} a - required
        @param {String} [b] - optional
      {% enddoc %}
      {{ a }}{{ b }}
    `;
    const file2 = `
      {% function res = 'commands/call/fileToCall', a: 'hello', b: 'world' %}
      {{ res }}
    `;
    const files = {
      'app/lib/commands/call/fileToCall.liquid': file,
      'app/lib/caller.liquid': file2,
    };

    const offenses = await check(files, [MetadataParamsCheck]);

    expect(offenses).to.have.length(0);
  });

  it('should require doc params even if not used in source', async () => {
    const file = `
      {% doc %}
        @param {String} a - required param
        @param {String} unused - required but not used in source
      {% enddoc %}
      {{ a }}
    `;
    const file2 = `
      {% function res = 'commands/call/fileToCall', a: 'hello' %}
      {{ res }}
    `;
    const files = {
      'app/lib/commands/call/fileToCall.liquid': file,
      'app/lib/caller.liquid': file2,
    };

    const offenses = await check(files, [MetadataParamsCheck]);

    expect(offenses).to.have.length(1);
    expect(offenses).to.containOffense('Required parameter unused must be passed to function call');
  });

  it('should infer required params from undefined variables when no doc', async () => {
    const file = `
      {% assign b = a %}
      {{ b }}
    `;
    const file2 = `
      {% function res = 'commands/call/fileToCall', a: 'hello' %}
      {{ res }}
    `;
    const files = {
      'app/lib/commands/call/fileToCall.liquid': file,
      'app/lib/caller.liquid': file2,
    };

    const offenses = await check(files, [MetadataParamsCheck]);

    expect(offenses).to.have.length(0);
  });

  it('should report missing inferred params when no doc', async () => {
    const file = `
      {% assign b = a %}
      {{ b }}
    `;
    const file2 = `
      {% function res = 'commands/call/fileToCall' %}
      {{ res }}
    `;
    const files = {
      'app/lib/commands/call/fileToCall.liquid': file,
      'app/lib/caller.liquid': file2,
    };

    const offenses = await check(files, [MetadataParamsCheck]);

    expect(offenses).to.have.length(1);
    expect(offenses).to.containOffense('Required parameter a must be passed to function call');
  });

  it('should report unknown params when passing args not in inferred set', async () => {
    const file = `
      {% assign b = a %}
      {{ b }}
    `;
    const file2 = `
      {% function res = 'commands/call/fileToCall', a: 'hello', extra: 'world' %}
      {{ res }}
    `;
    const files = {
      'app/lib/commands/call/fileToCall.liquid': file,
      'app/lib/caller.liquid': file2,
    };

    const offenses = await check(files, [MetadataParamsCheck]);

    expect(offenses).to.have.length(1);
    expect(offenses).to.containOffense('Unknown parameter extra passed to function call');
  });

  it('should not include global objects like context in inferred params', async () => {
    const file = `
      {{ context.session }}
      {{ a }}
    `;
    const file2 = `
      {% function res = 'commands/call/fileToCall', a: 'hello' %}
      {{ res }}
    `;
    const files = {
      'app/lib/commands/call/fileToCall.liquid': file,
      'app/lib/caller.liquid': file2,
    };

    const offenses = await check(files, [MetadataParamsCheck]);

    expect(offenses).to.have.length(0);
  });

  it('should work with render tags too', async () => {
    const file = `{{ a }}`;
    const file2 = `{% render 'fileToRender' %}`;
    const files = {
      'app/views/partials/fileToRender.liquid': file,
      'app/views/pages/caller.liquid': file2,
    };

    const offenses = await check(files, [MetadataParamsCheck]);

    expect(offenses).to.have.length(1);
    expect(offenses).to.containOffense('Required parameter a must be passed to render call');
  });

  it('should skip validation when no doc and no undefined vars', async () => {
    const file = `
      {% assign a = 5 %}
      {{ a }}
    `;
    const file2 = `
      {% function res = 'commands/call/fileToCall', extra: 'hello' %}
      {{ res }}
    `;
    const files = {
      'app/lib/commands/call/fileToCall.liquid': file,
      'app/lib/caller.liquid': file2,
    };

    const offenses = await check(files, [MetadataParamsCheck]);

    expect(offenses).to.have.length(0);
  });
});
