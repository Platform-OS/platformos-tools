import { describe, beforeEach, it, expect } from 'vitest';
import { CompletionItemKind, InsertTextFormat, type TextEdit } from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';
import type { FilterEntry } from '@platformos/platformos-check-common';
import { publishedDocset } from '@platformos/platformos-check-common/src/test';

import { renderParameter } from '../../docset';
import { DocumentManager } from '../../documents';
import { CompletionsProvider } from '../CompletionsProvider';
import { CURSOR } from '../params';

describe('Module: ObjectCompletionProvider', async () => {
  let provider: CompletionsProvider;

  beforeEach(async () => {
    provider = new CompletionsProvider({
      documentManager: new DocumentManager(),
      platformosDocset: {
        graphQL: async () => null,
        filters: async () => [
          {
            parameters: [
              {
                description: '',
                name: 'crop',
                positional: false,
                required: false,
                types: ['string'],
              },
              {
                description: '',
                name: 'weight',
                positional: false,
                required: false,
                types: ['string'],
              },
              {
                description: '',
                name: 'width',
                positional: false,
                required: false,
                types: ['number'],
              },
            ],
            // SYNTHETIC, and INPUT rather than documentation: the cases below are about the text edit's
            // algebra, so they need parameters at known columns, not real ones. What the provider does
            // against the shipped docset is measured in `against the published docset` below — and had
            // to be, because for as long as the documentation site published
            // `positional: {{ param.positional | default: true }}`, every parameter of every filter came
            // back positional and this provider completed nothing anywhere but here.
            name: 'with_options',
          },
        ],
        objects: async () => [],
        liquidDrops: async () => [],
        liquidDoc: async () => ({ annotations: [], param_types: [] }),
        tags: async () => [],
      },
    });
  });

  it('should complete filter parameter lookups', async () => {
    const contexts = [
      `{{ item | with_options: █`,
      `{{ item | with_options: width: 100, █`,
      `{{ item | with_options: 1, string, width: 100, █`,
      `{{ item | with_options: width: 100 | with_options: █`,
    ];
    await Promise.all(
      contexts.map((context) =>
        expect(provider, context).to.complete(context, ['crop', 'weight', 'width']),
      ),
    );
  });

  describe('when the user has already begun typing a filter parameter', () => {
    it('should filter options based on the text', async () => {
      const contexts = [
        `{{ item | with_options: c█`,
        `{{ item | with_options: width: 100, c█`,
        `{{ item | with_options: 1, string, width: 100, c█`,
        `{{ item | with_options: width: 100 | with_options: c█`,
      ];
      await Promise.all(
        contexts.map((context) => expect(provider, context).to.complete(context, ['crop'])),
      );
    });
  });

  describe('when the user has already typed out the parameter name', () => {
    describe('and the cursor is in the middle of the parameter', () => {
      it('changes the range depending on the completion item', async () => {
        //                               char 24 ⌄         ⌄ char 34
        const context = `{{ item | with_options: w█idth: 100, height: 200 | strip }}`;
        //                                            ⌃ char 29

        const weightTextEdit: TextEdit = {
          newText: "weight: '$1'",
          range: {
            end: { line: 0, character: 34 },
            start: { line: 0, character: 24 },
          },
        };

        const widthTextEdit: TextEdit = {
          newText: 'width',
          range: {
            end: { line: 0, character: 29 },
            start: { line: 0, character: 24 },
          },
        };

        await expect(provider).to.complete(context, [
          expect.objectContaining({
            label: 'weight',
            insertTextFormat: InsertTextFormat.Snippet,
            textEdit: expect.objectContaining(weightTextEdit),
          }),
          expect.objectContaining({
            label: 'width',
            insertTextFormat: InsertTextFormat.PlainText,
            textEdit: expect.objectContaining(widthTextEdit),
          }),
        ]);

        const textDocument = TextDocument.create('', 'liquid', 0, context.replace(CURSOR, ''));

        expect(TextDocument.applyEdits(textDocument, [weightTextEdit])).toBe(
          "{{ item | with_options: weight: '$1', height: 200 | strip }}",
        );

        expect(TextDocument.applyEdits(textDocument, [widthTextEdit])).toBe(
          '{{ item | with_options: width: 100, height: 200 | strip }}',
        );
      });
    });

    describe('and the cursor is at the beginning of the parameter', () => {
      it('offers a full list of completion items', async () => {
        const context = `{{ item | with_options: █crop: 'center' }}`;

        await expect(provider).to.complete(context, ['crop', 'weight', 'width']);
      });

      it('does not replace the existing text', async () => {
        //                               char 24 ⌄
        const context = `{{ item | with_options: █crop: 'center' }}`;

        const textEdit: TextEdit = {
          newText: 'width: ',
          range: {
            end: { line: 0, character: 24 },
            start: { line: 0, character: 24 },
          },
        };

        await expect(provider).to.complete(
          context,
          expect.arrayContaining([
            expect.objectContaining({
              label: 'width',
              insertTextFormat: InsertTextFormat.PlainText,
              textEdit,
            }),
          ]),
        );

        const textDocument = TextDocument.create('', 'liquid', 0, context.replace(CURSOR, ''));

        expect(TextDocument.applyEdits(textDocument, [textEdit])).toBe(
          "{{ item | with_options: width: crop: 'center' }}",
        );
      });
    });

    describe('and the cursor is at the end of the parameter', () => {
      it('restricts the range to only the name of the parameter', async () => {
        //                               char 24 ⌄   ⌄ char 28
        const context = `{{ item | with_options: crop█: 'center' }}`;

        const textEdit: TextEdit = {
          newText: 'crop',
          range: {
            end: { line: 0, character: 28 },
            start: { line: 0, character: 24 },
          },
        };

        await expect(provider).to.complete(context, [
          expect.objectContaining({
            label: 'crop',
            insertTextFormat: InsertTextFormat.PlainText,
            textEdit,
          }),
        ]);

        const textDocument = TextDocument.create('', 'liquid', 0, context.replace(CURSOR, ''));

        expect(TextDocument.applyEdits(textDocument, [textEdit])).toBe(
          "{{ item | with_options: crop: 'center' }}",
        );
      });
    });
  });

  describe('when the parameter is a string type', () => {
    it('includes quotes in the insertText', async () => {
      const context = `{{ item | with_options: cr█`;

      await expect(provider).to.complete(context, [
        expect.objectContaining({
          label: 'crop',
          insertTextFormat: InsertTextFormat.Snippet,
          textEdit: expect.objectContaining({
            newText: "crop: '$1'",
          }),
        }),
      ]);
    });
  });

  describe('when the parameter is not a string type', () => {
    it('does not include a tab stop position', async () => {
      const context = `{{ item | with_options: wid█`;

      await expect(provider).to.complete(context, [
        expect.objectContaining({
          label: 'width',
          insertTextFormat: InsertTextFormat.PlainText,
          textEdit: expect.objectContaining({
            newText: 'width: ',
          }),
        }),
      ]);
    });
  });

  describe('when the cursor is inside of a quotes', () => {
    it('does not return any completion options', async () => {
      const context = `{{ item | with_options: width: 100, crop: '█'`;

      await expect(provider).to.complete(context, []);
    });
  });

  /**
   * The shipped documents, with the expectation READ OUT of them rather than written down: a filter
   * documenting one more named argument upstream cannot fail these, while this side going quiet does.
   *
   * The `complete` matcher compares the whole list, which here also holds the variables in scope, so
   * these assert the provider's own items — the ones it marks `TypeParameter`.
   */
  describe('against the published docset', () => {
    let published: CompletionsProvider;

    beforeEach(() => {
      published = new CompletionsProvider({
        documentManager: new DocumentManager(),
        platformosDocset: publishedDocset,
      });
    });

    async function namedArgumentsOffered(source: string) {
      const uri = 'file:///app/views/layouts/file.liquid';
      published.documentManager.open(uri, source.replace(CURSOR, ''), 1);

      const items = await published.completions({
        textDocument: { uri },
        position: { line: 0, character: source.indexOf(CURSOR) },
      });

      return items
        .filter((item) => item.kind === CompletionItemKind.TypeParameter)
        .map((item) => item.label);
    }

    async function filtersBy(predicate: (entry: FilterEntry) => boolean) {
      const filters = await publishedDocset.filters();

      return filters.filter(predicate);
    }

    const declaresNamedArguments = (entry: FilterEntry) =>
      !!entry.parameters?.some((parameter) => parameter.positional === false);

    it('offers every named argument of every filter that publishes one', async () => {
      const filters = await filtersBy(declaresNamedArguments);

      // A docset with no named argument anywhere would make the loop below assert nothing.
      expect(filters.map((entry) => entry.name)).not.toEqual([]);

      for (const entry of filters) {
        const expected = entry
          .parameters!.filter((parameter) => parameter.positional === false)
          .map((parameter) => parameter.name);

        expect(await namedArgumentsOffered(`{{ x | ${entry.name}: █ }}`), entry.name).toEqual(
          expected,
        );
      }
    });

    /** The control: a suppression wide enough to hide a real defect passes the assertion above. */
    it('offers no named argument for a filter that publishes none', async () => {
      const filters = await filtersBy((entry) => !declaresNamedArguments(entry));

      expect(filters.map((entry) => entry.name)).not.toEqual([]);

      for (const entry of filters) {
        expect(await namedArgumentsOffered(`{{ x | ${entry.name}: █ }}`), entry.name).toEqual([]);
      }
    });

    it('documents a named argument as the filter argument it is', async () => {
      const uri = 'file:///app/views/layouts/file.liquid';
      const source = `{{ 'k' | translate: █ }}`;
      published.documentManager.open(uri, source.replace(CURSOR, ''), 1);

      const items = await published.completions({
        textDocument: { uri },
        position: { line: 0, character: source.indexOf(CURSOR) },
      });
      const locale = items.find((item) => item.label === 'locale')!;

      const translate = (await publishedDocset.filters()).find(
        (entry) => entry.name === 'translate',
      )!;
      const parameter = translate.parameters!.find((entry) => entry.name === 'locale')!;

      expect(locale.documentation).toEqual({
        kind: 'markdown',
        value: renderParameter(parameter, translate),
      });
    });
  });
});
