import { describe, beforeEach, it, expect } from 'vitest';
import { InsertTextFormat, type TextEdit } from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';

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
            // SYNTHETIC. No shipped platformOS filter publishes `positional: false` — all 342 parameters
            // in filters.json are positional — so this provider is exercised by a fixture and nothing
            // else. The name it used to carry, `with_options`, is Shopify's.
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
});
