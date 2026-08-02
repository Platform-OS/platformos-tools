import { App, Parsers, SourceCodeType } from '@platformos/platformos-common';
import { toLiquidHTMLAST } from '@platformos/platformos-check-common';
import { describe, expect, it, vi } from 'vitest';
import { appBackedGetSourceCode, graphParsers } from './parsers';
import { toSourceCode } from './toSourceCode';

const ROOT = 'file:///project';
const uri = (relativePath: string) => `${ROOT}/${relativePath}`;

const fsOver = (files: Record<string, string>) => ({
  readFile: async (target: string) => {
    const source = files[target];
    if (source === undefined) throw new Error(`ENOENT: ${target}`);
    return source;
  },
  stat: async () => {
    throw new Error('not used');
  },
  readDirectory: async () => [],
});

describe('graphParsers', () => {
  it('registers a JS parser and treats images as opaque', async () => {
    const jsUri = uri('app/assets/app.js');
    const pngUri = uri('app/assets/logo.png');
    const files = { [jsUri]: 'export const a = 1;', [pngUri]: 'binary' };
    const app = App.fromPaths(ROOT, [jsUri, pngUri], fsOver(files), graphParsers);

    await app.load();

    expect((app.get(jsUri)!.ast as { type: string }).type).toBe('Program');
    expect(app.get(pngUri)!.ast).toEqual(new Error('File parsing not implemented'));
  });

  it('is the same JS parse the buffer path uses', async () => {
    const source = 'export const a = 1;';
    const jsUri = uri('app/assets/app.js');
    const app = App.fromPaths(ROOT, [jsUri], fsOver({ [jsUri]: source }), graphParsers);
    await app.load();

    const fromBuffer = await toSourceCode(jsUri, source);

    expect(app.get(jsUri)!.ast).toEqual(fromBuffer.ast);
  });
});

describe('appBackedGetSourceCode', () => {
  const parsers = (
    liquid = vi.fn(toLiquidHTMLAST),
  ): { parsers: Parsers; liquid: typeof liquid } => ({
    parsers: { [SourceCodeType.LiquidHtml]: liquid, extensions: graphParsers.extensions },
    liquid,
  });

  it('parses a file at most once across a graph read and a lint read', async () => {
    const cardUri = uri('app/views/partials/card.liquid');
    const { parsers: registered, liquid } = parsers();
    const app = App.fromPaths(ROOT, [cardUri], fsOver({ [cardUri]: '<b>card</b>' }), registered);
    const getSourceCode = appBackedGetSourceCode(app, async () => {
      throw new Error('fallback should not be needed');
    });

    // The graph asks for it…
    const forGraph = await getSourceCode(cardUri);
    void forGraph.ast;
    // …and the lint reads the same file object.
    await app.get(cardUri)!.load();
    void app.get(cardUri)!.ast;

    expect(forGraph).toBe(app.get(cardUri) as unknown as typeof forGraph);
    expect(liquid.mock.calls.length).toBe(1);
  });

  it('falls back for a URI the app does not contain', async () => {
    const app = App.fromPaths(ROOT, [], fsOver({}), graphParsers);
    const outside = 'file:///elsewhere/thing.liquid';

    const result = await appBackedGetSourceCode(app, async (target) =>
      toSourceCode(target, '<b>outside</b>'),
    )(outside);

    expect(result.uri).toBe(outside);
    expect(result.source).toBe('<b>outside</b>');
  });
});
