import { DocDefinition } from '@platformos/platformos-check-common';
import { describe, expect, it } from 'vitest';
import { publishedLiquidDoc } from '@platformos/platformos-check-common/src/test';
import {
  formatLiquidDocContentMarkdown,
  formatLiquidDocParameter,
  liquidDocAnnotationSnippet,
} from './liquidDoc';

describe('Module: liquidDoc', async () => {
  describe('formatLiquidDocContentMarkdown', async () => {
    const name = 'item-card';

    const mockDocDefinition: DocDefinition = {
      uri: `file:///${name}.liquid`,
      liquidDoc: {
        parameters: [
          {
            name: 'title',
            description: 'The title of the item',
            type: 'string',
            required: true,
            nodeType: 'param',
          },
          {
            name: 'border-radius',
            description: 'The border radius in px',
            type: 'number',
            required: false,
            nodeType: 'param',
          },
          {
            name: 'no-type',
            description: 'This parameter has no type',
            type: null,
            required: true,
            nodeType: 'param',
          },
          {
            name: 'no-description',
            description: null,
            type: 'string',
            required: true,
            nodeType: 'param',
          },
          {
            name: 'no-type-or-description',
            description: null,
            type: null,
            required: true,
            nodeType: 'param',
          },
        ],
        description: {
          content: 'This is a description',
          nodeType: 'description',
        },
        examples: [
          {
            content: '{{ item }}',
            nodeType: 'example',
          },
          {
            content: '{{ item.title }}',
            nodeType: 'example',
          },
        ],
      },
    };

    it('should format the LiquidDoc content correctly', async () => {
      // prettier-ignore
      const expectedHoverContent = 
`### ${name}

**Description:**


This is a description

**Parameters:**
- \`title\`: string - The title of the item
- \`border-radius\` (Optional): number - The border radius in px
- \`no-type\` - This parameter has no type
- \`no-description\`: string
- \`no-type-or-description\`

**Examples:**
\`\`\`liquid
{{ item }}
\`\`\`
\`\`\`liquid
{{ item.title }}
\`\`\``;

      const result = formatLiquidDocContentMarkdown(name, mockDocDefinition);
      expect(result).toEqual(expectedHoverContent);
    });

    it('should only return name if LiquidDocDefinition found', async () => {
      const expectedHoverContent = `### ${name}`;

      const result = formatLiquidDocContentMarkdown(name);
      expect(result).toEqual(expectedHoverContent);
    });
  });

  describe('formatLiquidDocParameter', async () => {
    it('should format a required parameter correctly', async () => {
      expect(
        formatLiquidDocParameter({
          name: 'title',
          description: 'The title of the item',
          type: 'string',
          required: true,
          nodeType: 'param',
        }),
      ).toEqual('- `title`: string - The title of the item');
    });

    it('should format an optional parameter correctly', async () => {
      expect(
        formatLiquidDocParameter({
          name: 'title',
          description: 'The title of the item',
          type: 'string',
          required: false,
          nodeType: 'param',
        }),
      ).toEqual('- `title` (Optional): string - The title of the item');
    });

    it('should format a parameter with no type correctly', async () => {
      expect(
        formatLiquidDocParameter({
          name: 'title',
          description: 'The title of the item',
          type: null,
          required: true,
          nodeType: 'param',
        }),
      ).toEqual('- `title` - The title of the item');
    });

    it('should format a parameter with no description correctly', async () => {
      expect(
        formatLiquidDocParameter({
          name: 'title',
          description: null,
          type: null,
          required: true,
          nodeType: 'param',
        }),
      ).toEqual('- `title`');
    });

    it('should format a parameter when it is meant to be in a header', async () => {
      expect(
        formatLiquidDocParameter(
          {
            name: 'title',
            description: 'The title of the item',
            type: 'string',
            required: true,
            nodeType: 'param',
          },
          true,
        ),
      ).toEqual('### `title`: string\n\nThe title of the item');
    });
  });
  /**
   * The snippet is MECHANISM, which is why it stayed here when the prose went upstream: only `@param`
   * puts the cursor anywhere but the end of the line, and the docset says nothing about tab stops.
   */
  describe('liquidDocAnnotationSnippet', async () => {
    it('places the cursor in the type braces for param and after the name for the rest', () => {
      const snippets = publishedLiquidDoc.annotations.map(({ name }) =>
        liquidDocAnnotationSnippet(name),
      );

      expect(snippets).toEqual(['param {$2} $1$0', 'example $0', 'description $0']);
    });

    /**
     * An annotation this package has never heard of still completes to something usable — which is what
     * lets the docset publish one without a release here. `prompt` is the live example: the parser
     * tolerates it, nothing publishes it, and if something ever did, its completion would work.
     */
    it('gives an annotation it does not know the generic snippet', () => {
      expect(liquidDocAnnotationSnippet('prompt')).toEqual('prompt $0');
    });
  });
});
