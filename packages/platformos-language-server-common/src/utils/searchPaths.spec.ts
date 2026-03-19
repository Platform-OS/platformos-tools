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
  it('should cache results across calls for the same root', async () => {
    const fs = createMockFs('theme_search_paths:\n  - theme/dress');
    const loader = new SearchPathsLoader(fs);

    const result1 = await loader.get(rootUri);
    expect(result1).toEqual(['theme/dress']);

    const result2 = await loader.get(rootUri);
    expect(result2).toEqual(['theme/dress']);

    // readFile should only be called once — second call served from cache
    expect(fs.readFile).toHaveBeenCalledTimes(1);
  });

  it('should return fresh results after invalidate()', async () => {
    let configContent = 'theme_search_paths:\n  - theme/dress';
    const fs = {
      readFile: vi.fn(async (uri: string) => {
        if (uri === configUri) return configContent;
        throw new Error(`File not found: ${uri}`);
      }),
      readDirectory: vi.fn(async () => []),
      stat: vi.fn(async () => ({ type: 1, size: 0 })),
    };
    const loader = new SearchPathsLoader(fs);

    const result1 = await loader.get(rootUri);
    expect(result1).toEqual(['theme/dress']);

    // Config changes externally
    configContent = 'theme_search_paths:\n  - theme/simple';

    // Without invalidation, still returns cached result
    const result2 = await loader.get(rootUri);
    expect(result2).toEqual(['theme/dress']);

    // After invalidation, reads fresh
    loader.invalidate();
    const result3 = await loader.get(rootUri);
    expect(result3).toEqual(['theme/simple']);

    expect(fs.readFile).toHaveBeenCalledTimes(2);
  });

  it('should return null when config has no search paths', async () => {
    const fs = createMockFs('some_other_key: value');
    const loader = new SearchPathsLoader(fs);

    const result = await loader.get(rootUri);
    expect(result).toBeNull();
  });

  it('should return null when config.yml does not exist', async () => {
    const fs = createMockFs(null);
    const loader = new SearchPathsLoader(fs);

    const result = await loader.get(rootUri);
    expect(result).toBeNull();
  });

  it('should cache per root URI independently', async () => {
    const root2 = URI.parse('file:///other-project');
    const config2Uri = 'file:///other-project/app/config.yml';
    const fs = {
      readFile: vi.fn(async (uri: string) => {
        if (uri === configUri) return 'theme_search_paths:\n  - theme/a';
        if (uri === config2Uri) return 'theme_search_paths:\n  - theme/b';
        throw new Error(`File not found: ${uri}`);
      }),
      readDirectory: vi.fn(async () => []),
      stat: vi.fn(async () => ({ type: 1, size: 0 })),
    };
    const loader = new SearchPathsLoader(fs);

    const result1 = await loader.get(rootUri);
    const result2 = await loader.get(root2);

    expect(result1).toEqual(['theme/a']);
    expect(result2).toEqual(['theme/b']);
    expect(fs.readFile).toHaveBeenCalledTimes(2);
  });
});
