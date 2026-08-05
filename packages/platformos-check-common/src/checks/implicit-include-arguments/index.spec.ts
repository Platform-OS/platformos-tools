import { describe, expect, it } from 'vitest';
import { ImplicitIncludeArguments } from '.';
import { applySuggestions, check } from '../../test';
import { Severity } from '../../types';

describe('Module: ImplicitIncludeArguments', () => {
  it('reports a variable the target reads and the include does not pass', async () => {
    const offenses = await check(
      {
        'app/views/partials/card.liquid': '{{ title }}',
        'app/views/pages/caller.liquid': "{% include 'card' %}",
      },
      [ImplicitIncludeArguments],
    );

    expect(offenses.map((offense) => [offense.check, offense.severity, offense.message])).toEqual([
      [
        'ImplicitIncludeArguments',
        Severity.WARNING,
        "Partial 'card' reads 'title', which the include does not pass — it resolves from the caller's scope. Pass it explicitly.",
      ],
    ]);
  });

  it('stays silent once the argument is passed', async () => {
    const offenses = await check(
      {
        'app/views/partials/card.liquid': '{{ title }}',
        'app/views/pages/caller.liquid': "{% include 'card', title: 'Hello' %}",
      },
      [ImplicitIncludeArguments],
    );

    expect(offenses.map((offense) => offense.message)).toEqual([]);
  });

  it('stays silent at a render site, which does not share the caller scope', async () => {
    // A `render` gets a fresh scope, so the same shape is a real error and
    // `PartialCallArguments` owns it.
    const offenses = await check(
      {
        'app/views/partials/card.liquid': '{{ title }}',
        'app/views/pages/caller.liquid': "{% render 'card' %}",
      },
      [ImplicitIncludeArguments],
    );

    expect(offenses.map((offense) => offense.message)).toEqual([]);
  });

  it('stays silent on a variable the target defaults itself', async () => {
    const offenses = await check(
      {
        'app/views/partials/card.liquid': "{{ title | default: 'Untitled' }}",
        'app/views/pages/caller.liquid': "{% include 'card' %}",
      },
      [ImplicitIncludeArguments],
    );

    expect(offenses.map((offense) => offense.message)).toEqual([]);
  });

  it('stays silent on an object every partial has in scope', async () => {
    const offenses = await check(
      {
        'app/views/partials/card.liquid': '{{ context.params.id }}',
        'app/views/pages/caller.liquid': "{% include 'card' %}",
      },
      [ImplicitIncludeArguments],
    );

    expect(offenses.map((offense) => offense.message)).toEqual([]);
  });

  it('cedes a documented target to MissingRenderPartialArguments', async () => {
    // A {% doc %} block is a declared contract, and a missing required @param stays an
    // ERROR from that check at an include site too. Only the INFERRED path warns, because
    // inference cannot tell a deliberately scope-sharing helper from a partial that wanted
    // an argument.
    const offenses = await check(
      {
        'app/views/partials/card.liquid':
          '{% doc %}\n  @param {string} title - the title\n{% enddoc %}\n{{ title }}',
        'app/views/pages/caller.liquid': "{% include 'card' %}",
      },
      [ImplicitIncludeArguments],
    );

    expect(offenses.map((offense) => offense.message)).toEqual([]);
  });

  it('reports every implicit variable, not just the first', async () => {
    const offenses = await check(
      {
        'app/views/partials/card.liquid': '{{ title }}{{ body }}',
        'app/views/pages/caller.liquid': "{% include 'card' %}",
      },
      [ImplicitIncludeArguments],
    );

    expect(offenses.map((offense) => offense.message)).toEqual([
      "Partial 'card' reads 'title', which the include does not pass — it resolves from the caller's scope. Pass it explicitly.",
      "Partial 'card' reads 'body', which the include does not pass — it resolves from the caller's scope. Pass it explicitly.",
    ]);
  });

  // ─── the two shapes found on real projects ───────────────────────────────

  it('reports content_for_layout, included from a layout that has it in scope', async () => {
    // The value resolves from the layout, so nothing is broken; the call site just does
    // not say where it comes from.
    const offenses = await check(
      {
        'app/views/partials/theme/simple/layout/mailer.liquid': '{{ content_for_layout }}',
        'app/views/layouts/mailer.html.liquid':
          "{% include 'theme/simple/layout/mailer', url: url %}",
      },
      [ImplicitIncludeArguments],
    );

    expect(offenses.map((offense) => [offense.severity, offense.message])).toEqual([
      [
        Severity.WARNING,
        "Partial 'theme/simple/layout/mailer' reads 'content_for_layout', which the include does not pass — it resolves from the caller's scope. Pass it explicitly.",
      ],
    ]);
  });

  it('reports forloop, included from inside the caller loop that declares it', async () => {
    // app/views/partials/theme/simple/dashboard/orders/cart.liquid:55
    const offenses = await check(
      {
        'app/views/partials/order_edit.liquid': '{{ forloop.index }}',
        'app/views/partials/cart.liquid':
          "{% for order in orders %}{% include 'order_edit', order: order %}{% endfor %}",
      },
      [ImplicitIncludeArguments],
    );

    expect(offenses.map((offense) => [offense.severity, offense.message])).toEqual([
      [
        Severity.WARNING,
        "Partial 'order_edit' reads 'forloop', which the include does not pass — it resolves from the caller's scope. Pass it explicitly.",
      ],
    ]);
  });

  // ─── the suggestion ──────────────────────────────────────────────────────

  describe('suggests passing the variable under its own name', () => {
    const target = { 'app/views/partials/card.liquid': '{{ title }}' };

    const cases: [description: string, source: string, fixed: string][] = [
      ['no arguments yet', "{% include 'card' %}", "{% include 'card', title: title %}"],
      [
        'an argument already passed',
        "{% include 'card', url: url %}",
        "{% include 'card', url: url, title: title %}",
      ],
      [
        'a `with … as` alias',
        "{% include 'card' with thing as alias %}",
        "{% include 'card' with thing as alias, title: title %}",
      ],
      [
        'a bare include line inside {% liquid %}',
        "{% liquid\n  include 'card', url: url\n%}",
        "{% liquid\n  include 'card', url: url, title: title\n%}",
      ],
    ];

    for (const [description, source, fixed] of cases) {
      it(description, async () => {
        const offenses = await check({ ...target, 'app/views/pages/caller.liquid': source }, [
          ImplicitIncludeArguments,
        ]);

        expect(offenses[0].suggest!.map((suggestion) => suggestion.message)).toEqual([
          "Pass 'title' explicitly",
        ]);
        expect(applySuggestions(source, offenses[0])).toEqual([fixed]);
      });
    }
  });
});
