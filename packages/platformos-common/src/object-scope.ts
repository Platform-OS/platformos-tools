import { appFileTypeToFileType, PlatformOSFileType } from './path-utils';

/**
 * The `access` block the platformOS Liquid docset carries for a documented object.
 *
 * Declared structurally rather than imported, because the docset TYPES live in
 * `platformos-check-common` and this package sits below it. Any `access` assignable to
 * this shape works, which is what lets check-common keep its own `Access` interface.
 */
export interface ObjectAccess {
  /**
   * Whether the object needs no parent object to be reached. NOT the same as "in scope
   * everywhere" — see {@link isObjectInScope}.
   */
  global: boolean;
  /** The objects this one hangs off, e.g. `forloop.parentloop`. */
  parents: readonly { readonly object: string; readonly property: string }[];
  /** Shopify-era template scoping. platformOS leaves this empty. */
  template: readonly string[];
  /** The one kind of app file the object exists in, in platformOS's snake_case. */
  app_file_type?: string | null;
}

/**
 * Whether a documented object is in scope inside a file of `fileType` — the platform's
 * rule about where its own objects exist, which is why it lives here and not in a linter.
 *
 * `access.global` does NOT mean "available everywhere"; it means "needs no parent object".
 * `context` is the only documented object global to a partial, while `data` and `response`
 * are equally `global` and exist solely inside an api_call. A caller that reads `global`
 * on its own concludes that every partial has `data` in scope.
 *
 * An `access` of `undefined` means the docset says nothing, which is treated as in scope.
 */
export function isObjectInScope(
  access: ObjectAccess | undefined,
  fileType: PlatformOSFileType | undefined,
): boolean {
  if (!access) return true;

  // A parented object is reached THROUGH its parent, or exists only inside the construct
  // that declares it — `forloop` lives in its `{% for %}` and nowhere else. Never a
  // file-level global, whatever `global` says.
  if (access.parents.length > 0) return false;

  if (access.app_file_type) {
    const restrictedTo = appFileTypeToFileType(access.app_file_type);
    // An `app_file_type` this version has never heard of stays permissive: a docset we do
    // not understand is not evidence about scope, and must not become a false positive.
    return restrictedTo === undefined || restrictedTo === fileType;
  }

  return access.global === true || access.template.length > 0;
}
