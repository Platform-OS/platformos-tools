import {
  AbstractFileSystem,
  DEFAULT_LOCALE,
  FileType,
  MODULE_ROOTS,
  TranslationProvider,
} from '@platformos/platformos-common';
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
    try {
      const entries = await fs.readDirectory(dirUri);
      for (const [entryUri, entryType] of entries) {
        if (entryType === FileType.Directory) {
          modules.add(entryUri.split('/').pop()!);
        }
      }
    } catch {
      // Directory doesn't exist or isn't accessible — skip
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
    const translations = await context.getTranslationsForBase(context.toUri(base), DEFAULT_LOCALE);
    definedKeys.push(...flattenTranslationKeys(translations));
  }

  // Module translations
  const modules = await discoverModules(
    context.fs,
    ...MODULE_ROOTS.map((root) => context.toUri(root)),
  );
  for (const moduleName of modules) {
    for (const base of TranslationProvider.getSearchPaths(moduleName)) {
      const translations = await context.getTranslationsForBase(
        context.toUri(base),
        DEFAULT_LOCALE,
      );
      for (const key of flattenTranslationKeys(translations)) {
        definedKeys.push(`modules/${moduleName}/${key}`);
      }
    }
  }

  return definedKeys;
}
