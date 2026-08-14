import { expect, describe, it, beforeEach, afterEach, vi } from 'vitest';
import publishedLiquidDoc from '../data/liquid_doc.json';
import { PlatformOSLiquidDocsManager } from './platformOSLiquidDocsManager';
import { download, downloadPlatformOSLiquidDocs } from './platformOSLiquidDocsDownloader';

vi.mock('./platformOSLiquidDocsDownloader', async (importOriginal) => {
  const actual: any = await importOriginal();
  return {
    ...actual,
    // The two the manager reaches the network through: `download` fetches the published revision, and the
    // bulk refresh is what a revision difference triggers.
    download: vi.fn(async () => '{"revision": "1"}'),
    downloadPlatformOSLiquidDocs: vi.fn(),
  };
});

vi.mock('node:path', async () => {
  return {
    default: {
      join: (...paths: string[]) => paths.join('/'),
      resolve: () => '.',
    },
  };
});

vi.mock('env-paths', async () => {
  return {
    default: (appPath: string) => ({ cache: `MOCKED_CACHE/${appPath}` }),
  };
});

/**
 * A filesystem that REMEMBERS WRITES, because one of the tests below is about what is on disk after a
 * failed refresh. With a read-only map, a `latest.json` written mid-setup would be invisible and the
 * regression it guards against would pass either way.
 */
vi.mock('node:fs/promises', async () => {
  const fileSystem: Record<string, string> = {
    'MOCKED_CACHE/platformos-liquid-docs/filters.json': '[{"name": "upcase"}]',
    'MOCKED_CACHE/platformos-liquid-docs/objects.json': '[{"name": "current_user"}]',
    'MOCKED_CACHE/platformos-liquid-docs/tags.json': '[{"name": "if"}]',
    'MOCKED_CACHE/platformos-liquid-docs/latest.json': '{"revision": "1"}',
  };

  return {
    default: {
      readFile: vi.fn().mockImplementation((path: string) => fileSystem[path]),
      writeFile: vi.fn().mockImplementation((path: string, text: string) => {
        fileSystem[path] = text;
      }),
      mkdir: vi.fn(),
    },
  };
});

describe('Module: PlatformOSLiquidDocsManager', async () => {
  let manager: PlatformOSLiquidDocsManager;

  beforeEach(async () => {
    manager = new PlatformOSLiquidDocsManager();
  });

  afterEach(async () => {
    vi.clearAllMocks();
  });

  it('should not download remote files if the revision is stable', async () => {
    await Promise.all([manager.filters(), manager.objects(), manager.tags()]);

    expect(vi.mocked(download)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(downloadPlatformOSLiquidDocs)).not.toHaveBeenCalled();
  });

  /** THE CONTROL: a revision that moved DOES trigger the refresh, so the assertion above means something. */
  it('refreshes every file when the published revision moved', async () => {
    vi.mocked(download).mockResolvedValueOnce('{"revision": "2"}');

    await manager.filters();

    expect(vi.mocked(downloadPlatformOSLiquidDocs)).toHaveBeenCalledTimes(1);
  });

  /**
   * A FAILED REFRESH MUST BE RETRIED, which is only possible if the revision on disk was left alone.
   *
   * `setup` used to write the remote `latest.json` before refreshing anything else. A bulk refresh that
   * then failed left the new revision on disk beside the old four files — and the next run compared local
   * against remote, found them equal, and never refreshed again. Nothing failed, nothing logged, and the
   * docset stayed a release behind forever.
   */
  it('retries after a failed refresh, because the revision on disk was not moved', async () => {
    vi.mocked(download).mockResolvedValue('{"revision": "2"}');
    vi.mocked(downloadPlatformOSLiquidDocs).mockRejectedValueOnce(new Error('502 Bad Gateway'));

    await manager.filters();
    expect(vi.mocked(downloadPlatformOSLiquidDocs)).toHaveBeenCalledTimes(1);

    // A second run — `setup` is memoized per instance, so this is what the next process does.
    await new PlatformOSLiquidDocsManager().filters();

    expect(vi.mocked(downloadPlatformOSLiquidDocs)).toHaveBeenCalledTimes(2);
  });

  describe('Unit: filters', () => {
    it('should return an array', async () => {
      const filters = await manager.filters();
      expect(filters).to.eql([{ name: 'upcase' }]);
    });
  });

  describe('Unit: objects', () => {
    it('should return an array', async () => {
      const objects = await manager.objects();
      expect(objects).to.eql([{ name: 'current_user' }]);
    });
  });

  describe('Unit: tags', () => {
    it('should return an array', async () => {
      const tags = await manager.tags();
      expect(tags).to.eql([{ name: 'if' }]);
    });
  });

  describe('Unit: liquidDoc', () => {
    /**
     * There is no `liquid_doc.json` in the mocked cache and none committed in `data/`, which is the state
     * of every machine until the documentation site serves the endpoint. An empty vocabulary is what the
     * features that read it fall silent on; a throw here would take the whole docset down with it.
     */
    it('is an empty vocabulary when the file is nowhere to be found', async () => {
      const vocabulary = await manager.liquidDoc();

      expect(vocabulary).to.eql({ annotations: [], param_types: [] });
    });

    /** THE CONTROL: the same loader chain DOES read the file once it is there. */
    it('reads the vocabulary when the docset carries it', async () => {
      const fs: any = (await import('node:fs/promises')).default;
      const cache = vi.mocked(fs.readFile).getMockImplementation()!;

      try {
        vi.mocked(fs.readFile).mockImplementation((path: string) =>
          path.endsWith('liquid_doc.json') ? JSON.stringify(publishedLiquidDoc) : cache(path),
        );

        const vocabulary = await new PlatformOSLiquidDocsManager().liquidDoc();

        expect(vocabulary).to.eql(publishedLiquidDoc);
      } finally {
        vi.mocked(fs.readFile).mockImplementation(cache);
      }
    });
  });
});
