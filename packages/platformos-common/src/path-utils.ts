/**
 * Utility functions for identifying platformOS file types based on their paths
 */

import { UriString } from './AbstractFileSystem';

/**
 * Checks if a URI points to a partial file.
 * Partials can be located in:
 * - app/lib
 * - app/views/partials
 * - app/modules/{moduleName}/public/lib
 * - app/modules/{moduleName}/private/lib
 * - app/modules/{moduleName}/public/views/partials
 * - app/modules/{moduleName}/private/views/partials
 * - modules/{moduleName}/public/lib
 * - modules/{moduleName}/private/lib
 * - modules/{moduleName}/public/views/partials
 * - modules/{moduleName}/private/views/partials
 */
export function isPartial(uri: UriString): boolean {
  return uri.includes('/lib/') || uri.includes('/views/partials');
}

/**
 * Checks if a URI points to a page file.
 * Pages are located in app/views/pages
 */
export function isPage(uri: UriString): boolean {
  return uri.includes('/views/pages');
}

/**
 * Checks if a URI points to a layout file.
 * Layouts are located in app/views/layouts
 */
export function isLayout(uri: UriString): boolean {
  return uri.includes('/views/layouts');
}

/**
 * Legacy Shopify terminology - use isPartial instead
 * @deprecated Use isPartial instead
 */
export const isSnippet = isPartial;
