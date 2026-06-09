import { describe, expect, it } from 'vitest';
import { Severity } from '../../types';
import { applySuggestions, runLiquidCheck } from '../../test';
import { MissingContentForLayout } from './index';

const LAYOUT = 'app/views/layouts/application.liquid';
const PAGE = 'app/views/pages/index.liquid';
const PARTIAL = 'app/views/partials/card.liquid';

describe('Module: MissingContentForLayout', () => {
  it('flags a layout that never references content_for_layout', async () => {
    const sourceCode = '<html><body><header>Site</header></body></html>';

    const offenses = await runLiquidCheck(MissingContentForLayout, sourceCode, LAYOUT);

    expect(offenses).toHaveLength(1);
    expect(offenses[0].check).toEqual('MissingContentForLayout');
    expect(offenses[0].severity).toEqual(Severity.ERROR);
  });

  it('does not flag a layout that outputs {{ content_for_layout }}', async () => {
    const sourceCode = '<html><body>{{ content_for_layout }}</body></html>';

    const offenses = await runLiquidCheck(MissingContentForLayout, sourceCode, LAYOUT);

    expect(offenses).toEqual([]);
  });

  it('detects content_for_layout referenced inside a {% liquid %} block via echo', async () => {
    const sourceCode = [
      '<html><body>',
      '{% liquid',
      '  echo content_for_layout',
      '%}',
      '</body></html>',
    ].join('\n');

    const offenses = await runLiquidCheck(MissingContentForLayout, sourceCode, LAYOUT);

    expect(offenses).toEqual([]);
  });

  it('does not flag non-layout files (pages, partials)', async () => {
    const sourceCode = '<html><body><header>Site</header></body></html>';

    const pageOffenses = await runLiquidCheck(MissingContentForLayout, sourceCode, PAGE);
    const partialOffenses = await runLiquidCheck(MissingContentForLayout, sourceCode, PARTIAL);

    expect(pageOffenses).toEqual([]);
    expect(partialOffenses).toEqual([]);
  });

  it('suggests inserting content_for_layout before the closing </body> tag', async () => {
    const sourceCode = '<html><body><header>Site</header></body></html>';

    const offenses = await runLiquidCheck(MissingContentForLayout, sourceCode, LAYOUT);
    const suggestions = applySuggestions({ [LAYOUT]: sourceCode }, offenses[0]);

    expect(suggestions).toEqual([
      '<html><body><header>Site</header>{{ content_for_layout }}\n</body></html>',
    ]);
  });

  it('suggests appending content_for_layout when there is no </body> tag', async () => {
    const sourceCode = '<header>Site</header>';

    const offenses = await runLiquidCheck(MissingContentForLayout, sourceCode, LAYOUT);
    const suggestions = applySuggestions({ [LAYOUT]: sourceCode }, offenses[0]);

    expect(suggestions).toEqual(['<header>Site</header>\n{{ content_for_layout }}\n']);
  });
});
