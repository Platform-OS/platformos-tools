import {
  extractRelativePagePath,
  isDeprecatedHomeAlias,
  PlatformOSFileType,
} from '@platformos/platformos-common';
import { LiquidCheckDefinition, Severity, SourceCodeType } from '../../types';
import { wellFormedFrontmatterBlock } from '../../frontmatter';
import { basename } from '../../path';

/**
 * A superseded frontmatter key, and the deprecated `home` page filename.
 *
 * Measured: `layout_name` (naming a layout that exists), `redirect_url` and a `home.liquid`
 * page all deploy cleanly, so this stays a warning and out of `BLOCKING_CHECKS`.
 */
export const DeprecatedFrontmatterField: LiquidCheckDefinition = {
  meta: {
    code: 'DeprecatedFrontmatterField',
    name: 'Deprecated Frontmatter Field',
    docs: {
      description:
        'Reports a frontmatter key that has been superseded by another, and the deprecated `home` page filename. Both still deploy.',
      recommended: true,
      url: 'https://documentation.platformos.com/developer-guide/platformos-check/checks/deprecated-frontmatter-field',
    },
    type: SourceCodeType.LiquidHtml,
    severity: Severity.WARNING,
    schema: {},
    targets: [],
  },

  create(context) {
    return {
      async onCodePathStart(file) {
        const fileType = context.fileType(file.uri);

        // Only a top-level PAGE named `home` serves the root route through the
        // deprecated alias — `blog/home` is the `blog/home` route, and a module page
        // counts because the backend derives the slug after `views/pages/`
        // (`page.rb:72`). `extractRelativePagePath` is the same extraction the
        // `RouteTable` feeds the slug rules with.
        //
        // This one is about the FILENAME, so it is reported whether or not the file
        // carries a frontmatter block at all.
        if (fileType === PlatformOSFileType.Page) {
          const pagePath = extractRelativePagePath(file.uri);
          if (pagePath && isDeprecatedHomeAlias(pagePath)) {
            const fileName = basename(file.uri);
            const indexName = `index${fileName.slice('home'.length)}`;
            context.report({
              message: `'${fileName}' is deprecated. Rename to '${indexName}' to serve as the root page.`,
              startIndex: 0,
              endIndex: 0,
            });
          }
        }

        const block = wellFormedFrontmatterBlock(context.file, fileType);
        if (!block) return;

        for (const [key, entry] of block.entries) {
          const fieldSchema = block.schema.fields[key];
          if (!fieldSchema?.deprecated) continue;

          context.report({
            message: fieldSchema.deprecatedMessage ?? `'${key}' is deprecated`,
            startIndex: entry.absStart,
            endIndex: entry.absEnd,
          });
        }
      },
    };
  },
};
