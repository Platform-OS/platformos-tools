import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import publishedLiquidDoc from '../data/liquid_doc.json';

import { downloadPlatformOSLiquidDocs, graphQLPath } from './platformOSLiquidDocsDownloader';
import { noop } from './utils';

/**
 * WHAT REACHES THE DISK, when the documentation site does not behave.
 */
const DESTINATION = '/docs-destination';

/** Every file the downloader is expected to produce, in the order it is asked for them. */
const OK_BODIES: Record<string, string> = {
  'latest.json': '{"revision":"abc"}',
  'filters.json': '[{"name":"upcase"}]',
  'objects.json': '[{"name":"context"}]',
  'tags.json': '[{"name":"if"}]',
  // The REAL published document, so this asserts the downloader writes what the platform serves rather
  // than what a fixture here made up.
  'liquid_doc.json': JSON.stringify(publishedLiquidDoc),
  schema: 'type Query { a: String }',
};

const written = new Map<string, string>();

vi.mock('node:fs/promises', () => ({
  default: {
    writeFile: vi.fn(async (path: string, text: string) => {
      written.set(path, text);
    }),
    stat: vi.fn(async () => ({})),
    mkdir: vi.fn(),
    readFile: vi.fn(),
  },
}));

/** A `fetch` serving `OK_BODIES`, with the named resource replaced by `failure`. */
function stubFetch(failure?: { resource: string; response: Partial<Response> }) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const name = url.endsWith('/schema') ? 'schema' : url.split('/').pop()!;

      if (failure && name === failure.resource) {
        return {
          ok: true,
          status: 200,
          statusText: 'OK',
          text: async () => '',
          ...failure.response,
        };
      }
      return { ok: true, status: 200, statusText: 'OK', text: async () => OK_BODIES[name] };
    }),
  );
}

const run = () => downloadPlatformOSLiquidDocs(DESTINATION, noop);

/**
 * The keys are `path.join` output, so they are `\`-separated on Windows: this spec must not
 * spell a separator of its own anywhere. `path.basename` for the names below, and the module's
 * own `graphQLPath` for the one assertion that needs a whole path.
 */
const writtenNames = () => [...written.keys()].map((key) => path.basename(key)).sort();

afterEach(() => {
  written.clear();
  vi.unstubAllGlobals();
});

describe('Module: downloadPlatformOSLiquidDocs', () => {
  it('writes every file when every response is good', async () => {
    stubFetch();

    await run();

    expect(writtenNames()).toEqual([
      'filters.json',
      'graphql.graphql',
      'latest.json',
      'liquid_doc.json',
      'objects.json',
      'tags.json',
    ]);
  });

  /**
   * THE OPTIONAL RESOURCE, which is the other half of the rule above.
   */
  it('writes the rest when an optional resource is not there yet', async () => {
    stubFetch({
      resource: 'liquid_doc.json',
      response: { ok: false, status: 404, statusText: 'Not Found' },
    });

    await run();

    expect(writtenNames()).toEqual([
      'filters.json',
      'graphql.graphql',
      'latest.json',
      'objects.json',
      'tags.json',
    ]);
  });

  /** And an optional resource that answers with something other than data is skipped, not written. */
  it('does not write an optional resource whose body is not JSON', async () => {
    stubFetch({
      resource: 'liquid_doc.json',
      response: { text: async () => '<!doctype html><title>Sign in</title>' },
    });

    await run();

    expect(writtenNames()).toEqual([
      'filters.json',
      'graphql.graphql',
      'latest.json',
      'objects.json',
      'tags.json',
    ]);
  });

  /**
   * THE TORN WRITE, which is the case this function exists to prevent.
   */
  it('writes NOTHING when one resource fails, rather than a mismatched set', async () => {
    stubFetch({
      resource: 'tags.json',
      response: { ok: false, status: 502, statusText: 'Bad Gateway' },
    });

    await expect(run()).rejects.toThrow('502 Bad Gateway');

    expect(writtenNames()).toEqual([]);
  });

  it('refuses a non-2xx body instead of writing the error page as data', async () => {
    stubFetch({
      resource: 'filters.json',
      response: {
        ok: false,
        status: 404,
        statusText: 'Not Found',
        text: async () => '<html>nope</html>',
      },
    });

    await expect(run()).rejects.toThrow('404 Not Found');

    expect(writtenNames()).toEqual([]);
  });

  /**
   * The 200 that is not data. A proxy or a login redirect answers with HTML and a success
   * status, so `res.ok` cannot catch this one — only parsing can, and it has to happen before
   * the write rather than at the next read.
   */
  it('refuses a 200 whose body is not JSON', async () => {
    stubFetch({
      resource: 'objects.json',
      response: { text: async () => '<!doctype html><title>Sign in</title>' },
    });

    await expect(run()).rejects.toThrow('objects did not come back as JSON');

    expect(writtenNames()).toEqual([]);
  });

  /**
   * The GraphQL schema is NOT JSON and must not be parsed as such — the control that keeps the
   * assertion above from being satisfied by a rule that simply rejects everything.
   */
  it('accepts the GraphQL schema, which is not JSON', async () => {
    stubFetch();

    await run();

    expect(written.get(graphQLPath(DESTINATION))).toEqual('type Query { a: String }');
  });
});
