import { FileType, TranslationProvider } from '@platformos/platformos-common';
import { flattenTranslationKeys } from '../utils/levenshtein';

/**
 * Discovers all module names by listing app/modules/ and modules/ directories.
 * Returns a deduplicated set of module names.
 */
export async function discoverModules(
  fs: { readDirectory(uri: string): Promise<[string, FileType][]> },
  ...moduleDirUris: string[]
): Promise<Set<string>> {
  const modules = new Set<string>();
  for (const dirUri of moduleDirUris) {
    try {
      const entries = await fs.readDirectory(dirUri);
      for (const [entryUri, entryType] of entries) {
        if (entryType === FileType.Directory) {
          modules.add(entryUri.split('/').pop()!);
        }
      }
    } catch (error) {
      console.debug(`[translation-utils] Module directory ${dirUri} not detected, skipping.`);
    }
  }
  return modules;
}

export interface TranslationContext {
  fs: { readDirectory(uri: string): Promise<[string, FileType][]> };
  toUri(relativePath: string): string;
  getTranslationsForBase(uri: string, locale: string): Promise<Record<string, any>>;
}

/**
 * Loads all defined translation keys (app-level + module-level) and returns
 * them as a flat string array. Module keys are prefixed with `modules/{name}/`.
 */
export async function loadAllDefinedKeys(context: TranslationContext): Promise<string[]> {
  const definedKeys: string[] = [];

  // App-level translations
  for (const base of TranslationProvider.getSearchPaths()) {
    const translations = await context.getTranslationsForBase(context.toUri(base), 'en');
    definedKeys.push(...flattenTranslationKeys(translations));
  }

  // Module translations
  const modules = await discoverModules(
    context.fs,
    context.toUri('app/modules'),
    context.toUri('modules'),
  );
  for (const moduleName of modules) {
    for (const base of TranslationProvider.getSearchPaths(moduleName)) {
      const translations = await context.getTranslationsForBase(context.toUri(base), 'en');
      for (const key of flattenTranslationKeys(translations)) {
        definedKeys.push(`modules/${moduleName}/${key}`);
      }
    }
  }

  return definedKeys;
}
