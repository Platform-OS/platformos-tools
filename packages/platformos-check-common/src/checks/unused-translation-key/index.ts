import { URI, Utils } from 'vscode-uri';
import { FileType, TranslationProvider } from '@platformos/platformos-common';
import { LiquidCheckDefinition, Severity, SourceCodeType } from '../../types';
import { flattenTranslationKeys } from '../../utils/levenshtein';

/**
 * Recursively collects all .liquid file URIs under a directory.
 */
async function collectLiquidFiles(
  fs: { readDirectory(uri: string): Promise<[string, FileType][]> },
  dirUri: string,
): Promise<string[]> {
  const uris: string[] = [];
  let entries: [string, FileType][];
  try {
    entries = await fs.readDirectory(dirUri);
  } catch {
    return uris;
  }
  for (const [entryUri, entryType] of entries) {
    if (entryType === FileType.Directory) {
      uris.push(...(await collectLiquidFiles(fs, entryUri)));
    } else if (entryType === FileType.File && entryUri.endsWith('.liquid')) {
      uris.push(entryUri);
    }
  }
  return uris;
}

/**
 * Extracts translation keys from a liquid file source using regex.
 * Matches patterns like: "key" | t, 'key' | t, "key" | translate
 */
const TRANSLATION_KEY_RE = /["']([^"']+)["']\s*\|\s*(?:t|translate)\b/g;

function extractUsedKeys(source: string): string[] {
  const keys: string[] = [];
  let match;
  while ((match = TRANSLATION_KEY_RE.exec(source)) !== null) {
    keys.push(match[1]);
  }
  return keys;
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
        'Reports translation keys defined in app/translations/en.yml that are never referenced in any Liquid template.',
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

        const rootUri = URI.parse(context.config.rootUri);
        const baseUri = Utils.joinPath(rootUri, 'app/translations');
        const provider = new TranslationProvider(context.fs);

        let allTranslations: Record<string, any>;
        try {
          allTranslations = await provider.loadAllTranslationsForBase(baseUri, 'en');
        } catch {
          return;
        }

        const definedKeys = flattenTranslationKeys(allTranslations);
        if (definedKeys.length === 0) return;

        // Scan all liquid files for used translation keys
        const usedKeys = new Set<string>();
        const appUri = Utils.joinPath(rootUri, 'app').toString();
        const liquidFiles = await collectLiquidFiles(context.fs, appUri);

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
