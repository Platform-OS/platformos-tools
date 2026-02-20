import { assert, beforeEach, describe, expect, it } from 'vitest';
import { DocumentManager } from '../documents';
import { CSSLanguageService } from './CSSLanguageService';
import { getRequestParams, isCompletionList } from './test/test-helpers';

describe('Module: CSSLanguageService', () => {
  let cssLanguageService: CSSLanguageService;
  let documentManager: DocumentManager;

  beforeEach(async () => {
    documentManager = new DocumentManager(
      undefined,
      undefined,
      undefined,
      async () => 'theme', // theme schema
      async () => false, // invalid
    );
    cssLanguageService = new CSSLanguageService(documentManager);

    await cssLanguageService.setup({
      textDocument: {
        completion: {
          contextSupport: true,
          completionItem: {
            snippetSupport: true,
            commitCharactersSupport: true,
            documentationFormat: ['markdown'],
            deprecatedSupport: true,
            preselectSupport: true,
          },
        },
      },
    });
  });

  describe('completions', () => {
    it('should return CSS completions in a liquid file {% stylesheet %}', async () => {
      const params = getRequestParams(
        documentManager,
        'sections/section.liquid',
        `
          {% stylesheet %}
            .a:hov█ {
              color: red;
            }
          {% endstylesheet %}
          <div>hello world</div>

        `,
      );

      const completions = await cssLanguageService.completions(params);
      assert(isCompletionList(completions));
      expect(completions.items).to.have.lengthOf(377);
      expect(completions.items[0].label).to.equal(':active');
      expect(completions.items[0].documentation).to.deep.equal({
        kind: 'markdown',
        value:
          `Applies while an element is being activated by the user\\. For example, between the times the user presses the mouse button and releases it\\.\n\n` +
          `![Baseline icon](data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTgiIGhlaWdodD0iMTAiIHZpZXdCb3g9IjAgMCA1NDAgMzAwIiBmaWxsPSJub25lIiB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciPgogIDxzdHlsZT4KICAgIC5ncmVlbi1zaGFwZSB7CiAgICAgIGZpbGw6ICNDNEVFRDA7IC8qIExpZ2h0IG1vZGUgKi8KICAgIH0KCiAgICBAbWVkaWEgKHByZWZlcnMtY29sb3Itc2NoZW1lOiBkYXJrKSB7CiAgICAgIC5ncmVlbi1zaGFwZSB7CiAgICAgICAgZmlsbDogIzEyNTIyNTsgLyogRGFyayBtb2RlICovCiAgICAgIH0KICAgIH0KICA8L3N0eWxlPgogIDxwYXRoIGQ9Ik00MjAgMzBMMzkwIDYwTDQ4MCAxNTBMMzkwIDI0MEwzMzAgMTgwTDMwMCAyMTBMMzkwIDMwMEw1NDAgMTUwTDQyMCAzMFoiIGNsYXNzPSJncmVlbi1zaGFwZSIvPgogIDxwYXRoIGQ9Ik0xNTAgMEwzMCAxMjBMNjAgMTUwTDE1MCA2MEwyMTAgMTIwTDI0MCA5MEwxNTAgMFoiIGNsYXNzPSJncmVlbi1zaGFwZSIvPgogIDxwYXRoIGQ9Ik0zOTAgMEw0MjAgMzBMMTUwIDMwMEwwIDE1MEwzMCAxMjBMMTUwIDI0MEwzOTAgMFoiIGZpbGw9IiMxRUE0NDYiLz4KPC9zdmc+) _Widely available across major browsers (Baseline since 2015)_\n\n` +
          `[MDN Reference](https://developer.mozilla.org/docs/Web/CSS/:active)`,
      });
    });
  });

  describe('hover', () => {
    it('should return hover information for the given property in a {% stylesheet %}', async () => {
      const params = getRequestParams(
        documentManager,
        'sections/section.liquid',
        `
          {% stylesheet %}
            .wrapper {
              display: flex█;
            }
          {% endstylesheet %}
          <div>hello world</div>
        `,
      );
      const hover = await cssLanguageService.hover(params);
      assert(hover !== null);
      expect(hover.contents).to.eql({
        kind: 'plaintext',
        value:
          dedent(`In combination with 'float' and 'position', determines the type of box or boxes that are generated for an element.

        Widely available across major browsers (Baseline since 2015)

        Syntax: [ <display-outside> || <display-inside> ] | <display-listitem> | <display-internal> | <display-box> | <display-legacy>

        MDN Reference: https://developer.mozilla.org/docs/Web/CSS/display`),
      });
    });

    it('should return hover information for the given tag in a {% stylesheet %}', async () => {
      const params = getRequestParams(
        documentManager,
        'sections/section.liquid',
        `
          {% stylesheet %}
            .wrapper█ {
              display: flex;
            }
          {% endstylesheet %}
          <div>hello world</div>
        `,
      );
      const hover = await cssLanguageService.hover(params);
      assert(hover !== null);
      expect(hover.contents).to.eql([
        '<element class="wrapper">',
        '[Selector Specificity](https://developer.mozilla.org/docs/Web/CSS/Specificity): (0, 1, 0)',
      ]);
    });
  });

  describe('diagnostics', () => {
    it('should return ddiagnostics information for the given property in a {% stylesheet %}', async () => {
      const params = getRequestParams(
        documentManager,
        'sections/section.liquid',
        `
          {% stylesheet %}
            a:h {
            }
          {% endstylesheet %}
          <div>hello world</div>
        `,
      );
      const diagnostics = await cssLanguageService.diagnostics(params);
      assert(diagnostics !== null);
      expect(diagnostics).to.eql([
        {
          code: 'emptyRules',
          message: 'Do not use empty rulesets',
          range: {
            end: {
              character: 15,
              line: 2,
            },
            start: {
              character: 12,
              line: 2,
            },
          },
          severity: 2,
          source: 'json',
        },
      ]);
    });
  });
});

function dedent(text: string): string {
  return text
    .split('\n')
    .map((line) => line.trimStart())
    .join('\n');
}
