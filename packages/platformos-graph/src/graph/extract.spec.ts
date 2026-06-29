import { path as pathUtils } from '@platformos/platformos-check-common';
import { describe, expect, it } from 'vitest';
import { extractFileReferences } from '../index';
import { toSourceCode } from '../toSourceCode';
import { Reference } from '../types';
import { fixturesRoot, getDependencies } from './test-helpers';

/**
 * `extractFileReferences` is the per-file primitive a `validate_code`-style
 * consumer uses: parse an in-flight buffer with `toSourceCode`, then resolve its
 * outgoing dependency edges against the on-disk project — WITHOUT building the
 * whole app graph. The buffer is never read from disk, so these specs pass the
 * content inline (and even use a `sourceUri` for a file that does not exist).
 */
const { fs } = getDependencies();

/** The exact source range of `snippet` within `source`. */
function rangeOf(source: string, snippet: string): [number, number] {
  const start = source.indexOf(snippet);
  if (start < 0) throw new Error(`snippet not found: ${snippet}`);
  return [start, start + snippet.length];
}

function directRef(
  sourceUri: string,
  sourceRange: [number, number],
  targetUri: string,
  kind: Reference['kind'],
): Reference {
  return {
    source: { uri: sourceUri, range: sourceRange },
    target: { uri: targetUri },
    type: 'direct',
    kind,
  };
}

async function extract(rootUri: string, sourceUri: string, content: string) {
  return extractFileReferences(rootUri, sourceUri, await toSourceCode(sourceUri, content), { fs });
}

describe('extractFileReferences: resolves a single buffer against the project', () => {
  const rootUri = pathUtils.join(fixturesRoot, 'function-edges');
  const p = (part: string) => pathUtils.join(rootUri, ...part.split('/'));

  it('resolves a {% function %} edge to the canonical lib URI', async () => {
    const sourceUri = p('app/views/pages/draft.liquid'); // not on disk — in-flight buffer
    const content = `{% liquid
  function items = 'queries/list'
%}`;

    expect(await extract(rootUri, sourceUri, content)).toEqual([
      directRef(
        sourceUri,
        rangeOf(content, "function items = 'queries/list'"),
        p('app/lib/queries/list.liquid'),
        'function',
      ),
    ]);
  });

  it('resolves a target that does not exist on disk (path-based resolution)', async () => {
    const sourceUri = p('app/views/pages/draft.liquid');
    const content = `{% liquid
  function ghost = 'queries/missing'
%}`;

    expect(await extract(rootUri, sourceUri, content)).toEqual([
      directRef(
        sourceUri,
        rangeOf(content, "function ghost = 'queries/missing'"),
        p('app/lib/queries/missing.liquid'),
        'function',
      ),
    ]);
  });
});

describe('extractFileReferences: kinds and resolution match the full graph build', () => {
  it('tags include edges with kind "include"', async () => {
    const rootUri = pathUtils.join(fixturesRoot, 'include-edges');
    const p = (part: string) => pathUtils.join(rootUri, ...part.split('/'));
    const sourceUri = p('app/views/pages/draft.liquid');
    const content = "{% include 'shared/header' %}";

    expect(await extract(rootUri, sourceUri, content)).toEqual([
      directRef(
        sourceUri,
        rangeOf(content, "{% include 'shared/header' %}"),
        p('app/views/partials/shared/header.liquid'),
        'include',
      ),
    ]);
  });

  it('resolves a {% graphql %} edge to the .graphql operation file', async () => {
    const rootUri = pathUtils.join(fixturesRoot, 'graphql-edges');
    const p = (part: string) => pathUtils.join(rootUri, ...part.split('/'));
    const sourceUri = p('app/views/pages/draft.liquid');
    const content = `{% liquid
  graphql posts = 'blog_posts/find', id: '1'
%}`;

    expect(await extract(rootUri, sourceUri, content)).toEqual([
      directRef(
        sourceUri,
        rangeOf(content, "graphql posts = 'blog_posts/find', id: '1'"),
        p('app/graphql/blog_posts/find.graphql'),
        'graphql',
      ),
    ]);
  });

  it('resolves module-namespaced render + function targets in declaration order', async () => {
    const rootUri = pathUtils.join(fixturesRoot, 'module-edges');
    const p = (part: string) => pathUtils.join(rootUri, ...part.split('/'));
    const sourceUri = p('app/views/pages/draft.liquid');
    const content = `{% liquid
  function items = 'modules/my_module/queries/get'
%}
{% render 'modules/my_module/card' %}`;

    expect(await extract(rootUri, sourceUri, content)).toEqual([
      directRef(
        sourceUri,
        rangeOf(content, "function items = 'modules/my_module/queries/get'"),
        p('modules/my_module/public/lib/queries/get.liquid'),
        'function',
      ),
      directRef(
        sourceUri,
        rangeOf(content, "{% render 'modules/my_module/card' %}"),
        p('modules/my_module/public/views/partials/card.liquid'),
        'render',
      ),
    ]);
  });
});

describe('extractFileReferences: only statically resolvable edges', () => {
  const rootUri = pathUtils.join(fixturesRoot, 'function-edges');
  const sourceUri = pathUtils.join(rootUri, 'app/views/pages/draft.liquid');

  it('skips dynamic render targets', async () => {
    expect(await extract(rootUri, sourceUri, '{% render partial_name %}')).toEqual([]);
  });

  it('returns nothing for an unparseable buffer instead of throwing', async () => {
    expect(await extract(rootUri, sourceUri, '{% render %}{% endif %}')).toEqual([]);
  });

  it('returns nothing for a buffer with no references', async () => {
    expect(await extract(rootUri, sourceUri, '<h1>{{ page.title }}</h1>')).toEqual([]);
  });
});
