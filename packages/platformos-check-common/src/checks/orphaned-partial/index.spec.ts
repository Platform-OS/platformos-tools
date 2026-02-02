import { expect, describe, it } from 'vitest';
import { OrphanedPartial } from './index';
import { runLiquidCheck } from '../../test';

describe('Module: OrphanedPartial', () => {
  describe('when the partial is not referenced by any files', () => {
    it('should report a warning', async () => {
      const sourceCode = `<div>Orphaned content</div>`;

      const offenses = await runLiquidCheck(
        OrphanedPartial,
        sourceCode,
        'app/views/partials/orphaned.liquid',
        {
          getReferences: async (uri) => [],
        },
      );

      expect(offenses).toHaveLength(1);
      expect(offenses[0].message).toBe('This partial is not referenced by any other files');
    });
  });

  describe('when the partial is referenced by other files', () => {
    it('should not report a warning', async () => {
      const sourceCode = `<div>Referenced partial</div>`;

      const offenses = await runLiquidCheck(
        OrphanedPartial,
        sourceCode,
        'app/views/partials/product-card.liquid',
        {
          getReferences: async (uri) => [
            {
              source: { uri: 'templates/product.liquid' },
              target: { uri: 'app/views/partials/product-card.liquid' },
              type: 'direct',
            },
          ],
        },
      );

      expect(offenses).toHaveLength(0);
    });
  });

  describe('when checking non-partial files', () => {
    it('should not report warnings for templates', async () => {
      const sourceCode = `{% section 'header' %}`;

      const offenses = await runLiquidCheck(OrphanedPartial, sourceCode, 'templates/index.liquid', {
        getReferences: async (uri) => [],
      });

      expect(offenses).toHaveLength(0);
    });
  });
});
