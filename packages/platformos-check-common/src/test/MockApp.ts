/**
 * @example
 * {
 *   'app/views/layouts/layout.liquid': `
 *     <html>
 *       {{ content_for_page }}
 *     </html>
 *   `,
 *   'app/views/partials/snip.liquid': `
 *     <b>'hello world'</b>
 *   `,
 * }
 */

export type MockApp = {
  [relativePath in string]: string;
};
