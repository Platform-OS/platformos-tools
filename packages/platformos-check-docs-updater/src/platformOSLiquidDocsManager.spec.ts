import { expect, describe, it, beforeEach, afterEach, vi } from 'vitest';
import { PlatformOSLiquidDocsManager } from './platformOSLiquidDocsManager';
import { downloadResource, Resources } from './platformOSLiquidDocsDownloader';
import { noop } from './utils';

vi.mock('./platformOSLiquidDocsDownloader', async (importOriginal) => {
  const actual: any = await importOriginal();
  return {
    ...actual,
    downloadResource: vi.fn(),
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

vi.mock('node:fs/promises', async () => {
  const fileSystem: Record<string, string> = {
    'MOCKED_CACHE/platformos-liquid-docs/filters.json': '[{"name": "upcase"}]',
    'MOCKED_CACHE/platformos-liquid-docs/objects.json': '[{"name": "product"}]',
    'MOCKED_CACHE/platformos-liquid-docs/tags.json': '[{"name": "if"}]',
    'MOCKED_CACHE/platformos-liquid-docs/latest.json': '{"revision": "1"}',
    'MOCKED_CACHE/platformos-liquid-docs/platformos_system_translations.json':
      '{"pos.general.cart": "Cart"}',
  };

  return {
    default: {
      readFile: vi.fn().mockImplementation((path) => fileSystem[path]),
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
    expect(vi.mocked(downloadResource)).toHaveBeenNthCalledWith(
      1,
      'latest',
      'MOCKED_CACHE/platformos-liquid-docs',
      noop,
    );
    expect(vi.mocked(downloadResource)).toHaveBeenCalledTimes(1);
    for (const resource of Resources) {
      expect(vi.mocked(downloadResource)).not.toHaveBeenCalledWith(resource, expect.any(String));
    }
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
      expect(objects).to.eql([{ name: 'product' }]);
    });
  });

  describe('Unit: tags', () => {
    it('should return an array', async () => {
      const tags = await manager.tags();
      expect(tags).to.eql([{ name: 'if' }]);
    });
  });

  describe('Unit: systemTranslations', () => {
    it('should return the parsed JSON content of the system translations', async () => {
      const systemTranslations = await manager.systemTranslations();
      expect(systemTranslations).to.eql({
        'pos.general.cart': 'Cart',
      });
    });
  });
});
