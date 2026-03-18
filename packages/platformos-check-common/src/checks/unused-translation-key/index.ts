import { FileType } from '@platformos/platformos-common';
import { LiquidCheckDefinition, Severity, SourceCodeType } from '../../types';
import { recursiveReadDirectory } from '../../context-utils';
import { loadAllDefinedKeys } from '../translation-utils';

function extractUsedKeys(source: string): string[] {
  // Direct usage: "key" | t
  const direct = [...source.matchAll(/["']([^"']+)["']\s*\|\s*(?:t|translate)\b/g)].map(
    (m) => m[1],
  );
  // Indirect usage via default filter: | default: "key"
  const defaults = [...source.matchAll(/\|\s*default:\s*["']([^"']+)["']/g)].map((m) => m[1]);
  return [...direct, ...defaults];
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

        const allDefinedKeys = await loadAllDefinedKeys(context);
        if (allDefinedKeys.length === 0) return;
        const definedKeys = new Set(allDefinedKeys);

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
              } catch (error) {
                console.error(`[UnusedTranslationKey] Failed to read ${fileUri}:`, error);
              }
            }
          } catch (error) {
            console.error(`[UnusedTranslationKey] Failed to scan ${scanRoot}:`, error);
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
