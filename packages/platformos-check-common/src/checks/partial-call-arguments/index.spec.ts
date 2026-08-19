import { expect, describe, it } from 'vitest';
import { PartialCallArguments } from '.';
import { check } from '../../test';
import { ImplicitIncludeArguments } from '../implicit-include-arguments';
import { Severity } from '../../types';

describe('Module: PartialCallArguments', () => {
  // ─── Ownership: documented partials belong to the contract-reading checks ──

  it('should stay silent on a documented partial, even when a required param is missing', async () => {
    // MissingRenderPartialArguments owns this, with an autofix this check cannot offer.
    // Both reporting it is what produced two offenses per missing argument.
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

    expect(offenses.map((offense) => offense.message)).toEqual([]);
  });

  it('should stay silent on a documented partial, even when an unknown param is passed', async () => {
    // UnrecognizedRenderPartialArguments owns this.
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

    expect(offenses.map((offense) => offense.message)).toEqual([]);
  });

  it('should stay silent on a documented partial reached through a render tag', async () => {
    const files = {
      'app/views/partials/card.liquid':
        '{% doc %}\n  @param {string} title - the title\n{% enddoc %}\n{{ title }}',
      'app/views/pages/caller.liquid': "{% render 'card', extra: 1 %}",
    };

    const offenses = await check(files, [PartialCallArguments]);

    expect(offenses.map((offense) => offense.message)).toEqual([]);
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

  // ─── `global` in the docset does not mean global to a PARTIAL ──────────────

  for (const name of ['data', 'response']) {
    it(`should require \`${name}\`, which is an api_call object and not in scope in a partial`, async () => {
      // `data` and `response` are `global: true` in the docset — meaning "needs no parent
      // object", not "available everywhere" — with `app_file_type: 'api_call'`. Reading
      // `global` on its own put them in scope inside every partial, so a partial using one
      // drew no offense at all and the caller was never told to pass it.
      const offenses = await check(
        {
          'app/views/partials/uses_it.liquid': `{{ ${name} }}`,
          'app/views/pages/caller.liquid': "{% render 'uses_it' %}",
        },
        [PartialCallArguments],
      );

      expect(offenses.map((offense) => offense.message)).toEqual([
        `Required parameter ${name} must be passed to render call`,
      ]);
    });

    it(`should accept \`${name}\` once it is passed`, async () => {
      const offenses = await check(
        {
          'app/views/partials/uses_it.liquid': `{{ ${name} }}`,
          'app/views/pages/caller.liquid': `{% render 'uses_it', ${name}: 1 %}`,
        },
        [PartialCallArguments],
      );

      expect(offenses.map((offense) => offense.message)).toEqual([]);
    });
  }

  it('should require `content_for_layout`, which exists only in a layout', async () => {
    const offenses = await check(
      {
        'app/views/partials/uses_it.liquid': '{{ content_for_layout }}',
        'app/views/pages/caller.liquid': "{% render 'uses_it' %}",
      },
      [PartialCallArguments],
    );

    expect(offenses.map((offense) => offense.message)).toEqual([
      'Required parameter content_for_layout must be passed to render call',
    ]);
  });

  it('should require `forloop` in a partial that reads it outside any loop', async () => {
    // `forloop` is also `global: true`, and exists only inside the `{% for %}` that
    // declares it — a `render` gets a fresh scope, so the partial has no loop of its own.
    const offenses = await check(
      {
        'app/views/partials/uses_it.liquid': '{{ forloop.index }}',
        'app/views/pages/caller.liquid': "{% render 'uses_it' %}",
      },
      [PartialCallArguments],
    );

    expect(offenses.map((offense) => offense.message)).toEqual([
      'Required parameter forloop must be passed to render call',
    ]);
  });

  it('should not require `forloop` in a partial that reads it inside its own loop', async () => {
    const offenses = await check(
      {
        'app/views/partials/uses_it.liquid':
          '{% for item in items %}{{ forloop.index }}{% endfor %}',
        'app/views/pages/caller.liquid': "{% render 'uses_it', items: [1, 2] %}",
      },
      [PartialCallArguments],
    );

    expect(offenses.map((offense) => offense.message)).toEqual([]);
  });

  it('should still treat `context` as in scope, the one documented global for a partial', async () => {
    const offenses = await check(
      {
        'app/views/partials/uses_it.liquid': '{{ context.params.id }}',
        'app/views/pages/caller.liquid': "{% render 'uses_it' %}",
      },
      [PartialCallArguments],
    );

    expect(offenses.map((offense) => offense.message)).toEqual([]);
  });

  it('should allow passing a global object as an argument to an inferred partial', async () => {
    // `context` is in scope inside every partial, so passing it is redundant rather than
    // unknown — and it is absent from the inferred parameter set for exactly that reason.
    const offenses = await check(
      {
        'app/views/partials/header.liquid':
          '{% assign profile = profile | default: context.exports.profile %}{{ profile }}',
        'app/views/pages/caller.liquid': "{% render 'header', profile: 'me', context: context %}",
      },
      [PartialCallArguments],
    );

    expect(offenses.map((offense) => offense.message)).toEqual([]);
  });

  it('should allow passing a global object as an argument to a documented partial', async () => {
    const offenses = await check(
      {
        'app/views/partials/header.liquid':
          '{% doc %}\n  @param {string} profile - the profile\n{% enddoc %}\n{{ profile }}',
        'app/views/pages/caller.liquid': "{% render 'header', profile: 'me', context: context %}",
      },
      [PartialCallArguments],
    );

    expect(offenses.map((offense) => offense.message)).toEqual([]);
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

  it('should report an unknown param when no doc and no undefined vars', async () => {
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

    expect(offenses.map((offense) => offense.message)).toEqual([
      'Unknown parameter extra passed to function call',
    ]);
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

  // ─── {% include %} shares the caller's scope ─────────────────────────────

  describe('a variable the target reads and the call does not pass', () => {
    const app = {
      'app/views/partials/card.liquid': '{{ title }}',
      'app/views/pages/includes_it.liquid': "{% include 'card' %}",
      'app/views/pages/renders_it.liquid': "{% render 'card' %}",
    };

    it('is an error for render and a warning for include, from different checks', async () => {
      // `include` runs the partial in the CALLER'S scope, so `title` resolves from the
      // caller and nothing is broken — an explicitness finding, not a correctness one.
      // `render` gets a fresh scope, so the same shape always renders nothing.
      const offenses = await check(app, [PartialCallArguments, ImplicitIncludeArguments]);

      expect(
        offenses.map((offense) => [offense.uri.split('/').pop(), offense.check, offense.severity]),
      ).toEqual([
        ['includes_it.liquid', 'ImplicitIncludeArguments', Severity.WARNING],
        ['renders_it.liquid', 'PartialCallArguments', Severity.ERROR],
      ]);
    });

    it('draws nothing from this check at the include site', async () => {
      const offenses = await check(app, [PartialCallArguments]);

      expect(offenses.map((offense) => offense.message)).toEqual([
        'Required parameter title must be passed to render call',
      ]);
    });
  });

  it('still reports an unknown argument passed to an include', async () => {
    // Passing an argument the target never reads is a real mistake whichever tag was used.
    const offenses = await check(
      {
        'app/views/partials/card.liquid': 'hello',
        'app/views/pages/caller.liquid': "{% include 'card', arg1: 'hi' %}",
      },
      [PartialCallArguments],
    );

    expect(offenses.map((offense) => offense.message)).toEqual([
      'Unknown parameter arg1 passed to include call',
    ]);
  });

  // ─── an argument the partial never uses ──────────────────────────────────

  describe('an argument the partial does not use', () => {
    const CALLER = `{% render 'testt3', arg1: "hi" %}`;

    it('leaves it to UnrecognizedRenderPartialArguments when the partial has a {% doc %}', async () => {
      const offenses = await check(
        {
          'app/views/partials/testt3.liquid': [
            '{% doc %}',
            '  @param {string} [other] - optional, so only arg1 is at issue',
            '{% enddoc %}',
            'hello {{ other }}',
          ].join('\n'),
          'app/views/pages/ar.liquid': CALLER,
        },
        [PartialCallArguments],
      );

      expect(offenses.map((offense) => offense.message)).toEqual([]);
    });

    it('reports it when the partial has no {% doc %} and uses no variables', async () => {
      const offenses = await check(
        {
          'app/views/partials/testt3.liquid': 'hello',
          'app/views/pages/ar.liquid': CALLER,
        },
        [PartialCallArguments],
      );

      expect(offenses.map((offense) => offense.message)).toEqual([
        'Unknown parameter arg1 passed to render call',
      ]);
    });

    // A mutation READS its target, so the target is a required input rather than a
    // variable the partial defines for itself.
    const mutations = [
      "hash_assign object['removed_at'] = 'now'",
      "assign object['removed_at'] = 'now'",
      'assign object.removed_at = 1',
      'assign object << 1',
    ];

    for (const mutation of mutations) {
      it(`treats \`${mutation}\` as reading object, not defining it`, async () => {
        const offenses = await check(
          {
            'app/lib/commands/remove.liquid': `{% liquid\n  ${mutation}\n  return object\n%}`,
            'app/lib/caller.liquid': "{% function object = 'commands/remove', object: object %}",
          },
          [PartialCallArguments],
        );

        expect(offenses.map((offense) => offense.message)).toEqual([]);
      });

      it(`requires object when \`${mutation}\` is the only use and the caller omits it`, async () => {
        const offenses = await check(
          {
            'app/lib/commands/remove.liquid': `{% liquid\n  ${mutation}\n%}`,
            'app/lib/caller.liquid': "{% function res = 'commands/remove' %}",
          },
          [PartialCallArguments],
        );

        expect(offenses.map((offense) => offense.message)).toEqual([
          'Required parameter object must be passed to function call',
        ]);
      });
    }

    it('reports it when the partial has no {% doc %} and uses other variables', async () => {
      const offenses = await check(
        {
          'app/views/partials/testt3.liquid':
            '{% assign other = other | default: "x" %}{{ other }}',
          'app/views/pages/ar.liquid': CALLER,
        },
        [PartialCallArguments],
      );

      expect(offenses.map((offense) => offense.message)).toEqual([
        'Unknown parameter arg1 passed to render call',
      ]);
    });
  });

  // ─── A partial that rebuilds its own input ────────────────────────────────

  /**
   * `{% parse_json object %}{ … {{ object.x }} … }{% endparse_json %}` is the shape of nearly
   * every `build.liquid` in the platformOS modules: the body reads the caller's `object` and
   * the tag assigns the normalized result over it. The body runs BEFORE the assignment, so
   * `object` is an input; scoping the target from the opening tag hid that and turned the one
   * argument every caller passes into "Unknown parameter object".
   */
  it('should not call the parse_json target unknown when the body reads it', async () => {
    const files = {
      'app/lib/commands/email/send/build.liquid': `
        {% parse_json object %}
          {
            "to": {{ object.to | json }}
          }
        {% endparse_json %}
        {% return object %}
      `,
      'app/lib/caller.liquid': `
        {% function object = 'commands/email/send/build', object: object %}
      `,
    };

    const offenses = await check(files, [PartialCallArguments]);

    expect(offenses.map((offense) => offense.message)).toEqual([]);
  });

  it('should still report an argument the parse_json target never reads', async () => {
    const files = {
      'app/lib/commands/build.liquid': `
        {% parse_json object %}
          { "a": 1 }
        {% endparse_json %}
        {% return object %}
      `,
      'app/lib/caller.liquid': `
        {% function object = 'commands/build', unrelated: 2 %}
      `,
    };

    const offenses = await check(files, [PartialCallArguments]);

    expect(offenses.map((offense) => offense.message)).toEqual([
      'Unknown parameter unrelated passed to function call',
    ]);
  });
});
