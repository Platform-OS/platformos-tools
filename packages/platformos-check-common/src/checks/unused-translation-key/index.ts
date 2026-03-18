import { FileType, TranslationProvider } from '@platformos/platformos-common';
import { LiquidCheckDefinition, Severity, SourceCodeType } from '../../types';
import { flattenTranslationKeys } from '../../utils/levenshtein';
import { recursiveReadDirectory } from '../../context-utils';

/**
 * Discovers all module names by listing app/modules/ and modules/ directories.
 * Returns a deduplicated set of module names.
 */
async function discoverModules(
  fs: { readDirectory(uri: string): Promise<[string, FileType][]> },
  ...moduleDirUris: string[]
): Promise<Set<string>> {
  const modules = new Set<string>();

  for (const dirUri of moduleDirUris) {
    try {
      const entries = await fs.readDirectory(dirUri);
      for (const [entryUri, entryType] of entries) {
        if (entryType === FileType.Directory) {
          const name = entryUri.split('/').pop()!;
          modules.add(name);
        }
      }
    } catch {
      // Directory doesn't exist — skip
    }
  }

  return modules;
}

function extractUsedKeys(source: string): string[] {
  return [...source.matchAll(/["']([^"']+)["']\s*\|\s*(?:t|translate)\b/g)].map((m) => m[1]);
}

// Track which roots have been reported during a check run.
// Since create() is called per-file, we need module-level deduplication.
const reportedRoots = new Set<string>();

/** @internal Reset module state between test runs. */
export function _resetForTesting() {
  reportedRoots.clear();
}

export const UnusedTranslationKey: LiquidCheckDefinition = {
  meta: {
    code: 'UnusedTranslationKey',
    name: 'Translation key defined but never used',
    docs: {
      description:
        'Reports translation keys defined in app or module translation files that are never referenced in any Liquid template.',
      recommended: true,
      url: 'https://documentation.platformos.com/developer-guide/platformos-check/checks/unused-translation-key',
    },
    type: SourceCodeType.LiquidHtml,
    severity: Severity.INFO,
    schema: {},
    targets: [],
  },

  create(context) {
    return {
      async onCodePathEnd() {
        const rootKey = context.config.rootUri;
        if (reportedRoots.has(rootKey)) return;
        reportedRoots.add(rootKey);

        const definedKeys = new Set<string>();

        // 1. Load app-level translations
        for (const base of TranslationProvider.getSearchPaths()) {
          const baseUri = context.toUri(base);
          const translations = await context.getTranslationsForBase(baseUri, 'en');
          for (const key of flattenTranslationKeys(translations)) {
            definedKeys.add(key);
          }
        }

        // 2. Discover modules and load their translations
        const modules = await discoverModules(
          context.fs,
          context.toUri('app/modules'),
          context.toUri('modules'),
        );
        for (const moduleName of modules) {
          for (const base of TranslationProvider.getSearchPaths(moduleName)) {
            const baseUri = context.toUri(base);
            const translations = await context.getTranslationsForBase(baseUri, 'en');
            for (const key of flattenTranslationKeys(translations)) {
              definedKeys.add(`modules/${moduleName}/${key}`);
            }
          }
        }

        if (definedKeys.size === 0) return;

        // 3. Scan all Liquid files for used translation keys
        const usedKeys = new Set<string>();
        const scanRoots = [context.toUri('app'), context.toUri('modules')];
        const isLiquid = ([uri, type]: [string, FileType]) =>
          type === FileType.File && uri.endsWith('.liquid');

        for (const scanRoot of scanRoots) {
          try {
            const liquidFiles = await recursiveReadDirectory(context.fs, scanRoot, isLiquid);
            for (const fileUri of liquidFiles) {
              try {
                const source = await context.fs.readFile(fileUri);
                for (const key of extractUsedKeys(source)) {
                  usedKeys.add(key);
                }
              } catch {
                // Skip unreadable files
              }
            }
          } catch {
            // Root doesn't exist — skip
          }
        }

        // 4. Report unused keys
        for (const key of definedKeys) {
          if (!usedKeys.has(key)) {
            context.report({
              message: `Translation key '${key}' is defined but never used in any template.`,
              startIndex: 0,
              endIndex: 0,
            });
          }
        }
      },
    };
  },
};
