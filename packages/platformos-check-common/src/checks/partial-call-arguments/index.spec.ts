import { expect, describe, it } from 'vitest';
import { PartialCallArguments } from '.';
import { check } from '../../test';

describe('Module: PartialCallArguments', () => {
  // ─── @doc-based validation ───────────────────────────────────────────────

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

    const offenses = await check(files, [PartialCallArguments]);

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

    const offenses = await check(files, [PartialCallArguments]);

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

    const offenses = await check(files, [PartialCallArguments]);

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

    const offenses = await check(files, [PartialCallArguments]);

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

    const offenses = await check(files, [PartialCallArguments]);

    expect(offenses).to.have.length(0);
  });

  it('should not require doc params that are not used in source', async () => {
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

    const offenses = await check(files, [PartialCallArguments]);

    expect(offenses).to.have.length(0);
  });

  it('should still require a doc-required param even when implementation uses | default', async () => {
    // The @doc annotation is the public API contract; internal fallbacks do not change it.
    const file = `
      {% doc %}
        @param {String} message - required by contract
      {% enddoc %}
      {% assign message = message | default: 'fallback' %}
      {{ message }}
    `;
    const file2 = `
      {% function res = 'commands/call/fileToCall' %}
      {{ res }}
    `;
    const files = {
      'app/lib/commands/call/fileToCall.liquid': file,
      'app/lib/caller.liquid': file2,
    };

    const offenses = await check(files, [PartialCallArguments]);

    expect(offenses).to.have.length(1);
    expect(offenses).to.containOffense(
      'Required parameter message must be passed to function call',
    );
  });

  // ─── Inferred validation (no @doc) ───────────────────────────────────────

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

    const offenses = await check(files, [PartialCallArguments]);

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

    const offenses = await check(files, [PartialCallArguments]);

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

    const offenses = await check(files, [PartialCallArguments]);

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

    const offenses = await check(files, [PartialCallArguments]);

    expect(offenses).to.have.length(0);
  });

  it('should work with render tags too', async () => {
    const file = `{{ a }}`;
    const file2 = `{% render 'fileToRender' %}`;
    const files = {
      'app/views/partials/fileToRender.liquid': file,
      'app/views/pages/caller.liquid': file2,
    };

    const offenses = await check(files, [PartialCallArguments]);

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

    const offenses = await check(files, [PartialCallArguments]);

    expect(offenses).to.have.length(0);
  });

  // ─── | default — inferred optional params ────────────────────────────────

  it('should treat assign x = x | default: val as optional (no error when omitted)', async () => {
    const file = `
      {% assign message = message | default: null %}
      {% assign required_param = required_param %}
      {{ message }}{{ required_param }}
    `;
    const file2 = `
      {% function res = 'commands/call/fileToCall', required_param: 'hello' %}
      {{ res }}
    `;
    const files = {
      'app/lib/commands/call/fileToCall.liquid': file,
      'app/lib/caller.liquid': file2,
    };

    const offenses = await check(files, [PartialCallArguments]);

    expect(offenses).to.have.length(0);
  });

  it('should allow passing inferred optional params without reporting unknown', async () => {
    const file = `
      {% assign message = message | default: null %}
      {% assign required_param = required_param %}
      {{ message }}{{ required_param }}
    `;
    const file2 = `
      {% function res = 'commands/call/fileToCall', required_param: 'hello', message: 'hi' %}
      {{ res }}
    `;
    const files = {
      'app/lib/commands/call/fileToCall.liquid': file,
      'app/lib/caller.liquid': file2,
    };

    const offenses = await check(files, [PartialCallArguments]);

    expect(offenses).to.have.length(0);
  });

  it('should treat inline output {{ x | default: val }} as optional', async () => {
    const file = `{{ message | default: 'fallback' }}`;
    const file2 = `
      {% function res = 'commands/call/fileToCall' %}
      {{ res }}
    `;
    const files = {
      'app/lib/commands/call/fileToCall.liquid': file,
      'app/lib/caller.liquid': file2,
    };

    const offenses = await check(files, [PartialCallArguments]);

    expect(offenses).to.have.length(0);
  });

  it('should treat assign y = x | default: val as x optional (different lhs/rhs)', async () => {
    const file = `{% assign label = title | default: 'Untitled' %}{{ label }}`;
    const file2 = `
      {% function res = 'commands/call/fileToCall' %}
      {{ res }}
    `;
    const files = {
      'app/lib/commands/call/fileToCall.liquid': file,
      'app/lib/caller.liquid': file2,
    };

    const offenses = await check(files, [PartialCallArguments]);

    expect(offenses).to.have.length(0);
  });

  it('should still report unknown when caller passes arg not in optional or required set', async () => {
    const file = `
      {% assign message = message | default: null %}
      {{ message }}
    `;
    const file2 = `
      {% function res = 'commands/call/fileToCall', unknown_param: 'oops' %}
      {{ res }}
    `;
    const files = {
      'app/lib/commands/call/fileToCall.liquid': file,
      'app/lib/caller.liquid': file2,
    };

    const offenses = await check(files, [PartialCallArguments]);

    expect(offenses).to.have.length(1);
    expect(offenses).to.containOffense('Unknown parameter unknown_param passed to function call');
  });

  it('should handle the real register_error pattern: required + optional params', async () => {
    const file = `
      {% liquid
        assign key = key | default: null
        assign message = message | default: null
        assign errors = contract.errors
        assign field_errors = errors[field_name] | default: blank
        assign field_errors << message
        assign errors[field_name] = field_errors
        assign contract.valid = false
        return contract
      %}
    `;
    const file2 = `
      {% function c = 'helpers/register_error', contract: c, field_name: field_name, key: key %}
    `;
    const files = {
      'app/lib/helpers/register_error.liquid': file,
      'app/lib/caller.liquid': file2,
    };

    const offenses = await check(files, [PartialCallArguments]);

    expect(offenses).to.have.length(0);
  });

  it('should still require required params even when optional ones are present', async () => {
    const file = `
      {% liquid
        assign key = key | default: null
        assign errors = contract.errors
        assign field_errors = errors[field_name] | default: blank
        return contract
      %}
    `;
    // omits both required: contract and field_name
    const file2 = `
      {% function c = 'helpers/register_error', key: 'some_key' %}
    `;
    const files = {
      'app/lib/helpers/register_error.liquid': file,
      'app/lib/caller.liquid': file2,
    };

    const offenses = await check(files, [PartialCallArguments]);

    expect(offenses).to.have.length(2);
    expect(offenses).to.containOffense(
      'Required parameter contract must be passed to function call',
    );
    expect(offenses).to.containOffense(
      'Required parameter field_name must be passed to function call',
    );
  });
});
