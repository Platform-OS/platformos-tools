import { describe, expect, it } from 'vitest';
import { check } from '../test';
import { LiquidCheckDefinition } from '../types';
import { DuplicateRenderPartialArguments } from './duplicate-render-partial-arguments';
import { MissingRenderPartialArguments } from './missing-render-partial-arguments';
import { PartialCallArguments } from './partial-call-arguments';
import { UnrecognizedRenderPartialArguments } from './unrecognized-render-partial-arguments';

/**
 * `{% include %}`, `{% render %}` and `{% theme_render_rc %}` all parse to the same
 * `RenderMarkup` node, so a check that words its message from the node type names a tag the
 * author may not have written. Every call-site check reads the enclosing tag instead
 * (`callSiteTag`), and this pins that it does — an author sent looking for a `render` tag
 * that is not in the file has been told the wrong thing about their code.
 */
describe('call-site checks name the tag actually used', () => {
  const DOCUMENTED = '{% doc %}\n  @param {string} title - the title\n{% enddoc %}\n{{ title }}';

  const cases: [
    checks: LiquidCheckDefinition[],
    caller: string,
    partial: string,
    messages: string[],
  ][] = [
    [
      [PartialCallArguments],
      "{% include 'card', extra: 1 %}",
      'hello',
      ['Unknown parameter extra passed to include call'],
    ],
    [
      [MissingRenderPartialArguments],
      "{% include 'card' %}",
      DOCUMENTED,
      ["Missing required argument 'title' in include tag for partial 'card'."],
    ],
    [
      [UnrecognizedRenderPartialArguments],
      "{% include 'card', title: 'a', extra: 1 %}",
      DOCUMENTED,
      ["Unknown argument 'extra' in include tag for partial 'card'."],
    ],
    [
      // A `with … as` alias draws an offense from two checks at once, which is why both run
      // here: neither may say "render".
      [UnrecognizedRenderPartialArguments, MissingRenderPartialArguments],
      "{% include 'card' with thing as bogus %}",
      DOCUMENTED,
      [
        "Missing required argument 'title' in include tag for partial 'card'.",
        "Unknown argument 'bogus' in include tag for partial 'card'.",
      ],
    ],
    [
      [DuplicateRenderPartialArguments],
      "{% include 'card', title: 'a', title: 'b' %}",
      DOCUMENTED,
      ["Duplicate argument 'title' in include tag for partial 'card'."],
    ],
  ];

  for (const [checkDefinitions, caller, partial, messages] of cases) {
    const codes = checkDefinitions.map((definition) => definition.meta.code).join(' + ');

    it(`${codes} on \`${caller}\``, async () => {
      const offenses = await check(
        {
          'app/views/partials/card.liquid': partial,
          'app/views/pages/caller.liquid': caller,
        },
        checkDefinitions,
      );

      expect(offenses.map((offense) => offense.message)).toEqual(messages);
    });
  }

  it('names theme_render_rc, the third tag that parses to a RenderMarkup', async () => {
    const offenses = await check(
      {
        'app/views/partials/card.liquid': DOCUMENTED,
        'app/views/pages/caller.liquid': "{% theme_render_rc 'card' %}",
      },
      [MissingRenderPartialArguments],
    );

    expect(offenses.map((offense) => offense.message)).toEqual([
      "Missing required argument 'title' in theme_render_rc tag for partial 'card'.",
    ]);
  });
});
