import { describe, it, expect, vi } from 'vitest';
import { URI } from 'vscode-uri';
import { SearchPathsLoader } from './searchPaths';

const rootUri = URI.parse('file:///project');
const configUri = 'file:///project/app/config.yml';

function createMockFs(configContent: string | null) {
  return {
    readFile: vi.fn(async (uri: string) => {
      if (uri === configUri && configContent !== null) return configContent;
      throw new Error(`File not found: ${uri}`);
    }),
    readDirectory: vi.fn(async () => []),
    stat: vi.fn(async () => ({ type: 1, size: 0 })),
  };
}

describe('SearchPathsLoader', () => {
  it('should always read fresh (no internal caching)', async () => {
    let configContent = 'theme_search_paths:\n  - theme/dress';
    const fs = {
      readFile: vi.fn(async (uri: string) => {
        if (uri === configUri) return configContent;
        throw new Error(`File not found: ${uri}`);
      }),
      readDirectory: vi.fn(async () => []),
      stat: vi.fn(async () => ({ type: 1, size: 0 })),
    };
    const cache = new SearchPathsLoader(fs);

    const result1 = await cache.get(rootUri);
    expect(result1).toEqual(['theme/dress']);

    // Config changes — no invalidation needed, reads are always fresh
    configContent = 'theme_search_paths:\n  - theme/simple';

    const result2 = await cache.get(rootUri);
    expect(result2).toEqual(['theme/simple']);
    expect(fs.readFile).toHaveBeenCalledTimes(2);
  });

  it('should return null when config has no search paths', async () => {
    const fs = createMockFs('some_other_key: value');
    const cache = new SearchPathsLoader(fs);

    const result = await cache.get(rootUri);
    expect(result).toBeNull();
  });

  it('should return null when config.yml does not exist', async () => {
    const fs = createMockFs(null);
    const cache = new SearchPathsLoader(fs);

    const result = await cache.get(rootUri);
    expect(result).toBeNull();
  });

});
