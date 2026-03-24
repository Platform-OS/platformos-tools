import { AbstractFileSystem, FileType, TranslationProvider } from '@platformos/platformos-common';
import { flattenTranslationKeys } from '../utils/levenshtein';

/**
 * Discovers all module names by listing app/modules/ and modules/ directories.
 * Returns a deduplicated set of module names.
 */
export async function discoverModules(
  fs: AbstractFileSystem,
  ...moduleDirUris: string[]
): Promise<Set<string>> {
  const modules = new Set<string>();
  for (const dirUri of moduleDirUris) {
    const stat = await fs.stat(dirUri).catch(() => undefined);
    if (!stat || stat.type !== FileType.Directory) continue;

    const entries = await fs.readDirectory(dirUri);
    for (const [entryUri, entryType] of entries) {
      if (entryType === FileType.Directory) {
        modules.add(entryUri.split('/').pop()!);
      }
    }
  }
  return modules;
}

export interface TranslationContext {
  fs: AbstractFileSystem;
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
