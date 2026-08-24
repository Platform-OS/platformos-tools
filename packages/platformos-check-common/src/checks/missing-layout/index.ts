import { containsLiquid, PlatformOSFileType } from '@platformos/platformos-common';
import { LiquidCheckDefinition, Severity, SourceCodeType } from '../../types';
import { wellFormedFrontmatterBlock } from '../../frontmatter';

/**
 * A `layout:` naming a layout that does not exist.
 *
 * Measured: the converter rejects the file — `Could not find Layout with layout: <name>` —
 * failing the whole changeset.
 *
 * A Liquid-interpolated value is skipped (it resolves at render time), and so is an empty
 * one — `layout: ''` deliberately disables layout rendering.
 */
export const MissingLayout: LiquidCheckDefinition = {
  meta: {
    code: 'MissingLayout',
    name: 'Missing Layout',
    docs: {
      description:
        'Reports a frontmatter `layout` that names a layout the project does not contain. The deploy converter rejects the whole changeset for a missing layout.',
      recommended: true,
      url: 'https://documentation.platformos.com/developer-guide/platformos-check/checks/missing-layout',
    },
    type: SourceCodeType.LiquidHtml,
    severity: Severity.ERROR,
    schema: {},
    targets: [],
  },

  create(context) {
    return {
      async onCodePathStart(file) {
        const fileType = context.fileType(file.uri);
        if (fileType !== PlatformOSFileType.Page && fileType !== PlatformOSFileType.Email) return;

        const block = wellFormedFrontmatterBlock(context.file, fileType);
        if (!block) return;

        const deprecatedAlias =
          fileType === PlatformOSFileType.Page ? 'layout_name' : 'layout_path';
        const layoutEntry = block.entries.get('layout') ?? block.entries.get(deprecatedAlias);
        if (!layoutEntry) return;

        const layoutName = layoutEntry.jsValue;
        if (typeof layoutName !== 'string' || layoutName === '' || containsLiquid(layoutName)) {
          return;
        }

        // The one resolver: the run's `App` answers from its index — an unsaved layout
        // buffer included — and falls back to the filesystem for a layout the app does
        // not hold (a config `ignore` keeps a real file out of it). Same rule, same
        // precedence, same format handling as the language server's go-to-definition.
        const exists =
          (await context.app.findOrLocate(PlatformOSFileType.Layout, layoutName)) !== undefined;
        if (exists) return;

        context.report({
          message: `Layout '${layoutName}' does not exist`,
          startIndex: layoutEntry.absStart,
          endIndex: layoutEntry.absEnd,
        });
      },
    };
  },
};
