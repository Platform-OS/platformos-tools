import { containsLiquid, PlatformOSFileType } from '@platformos/platformos-common';
import { LiquidCheckDefinition, Severity, SourceCodeType } from '../../types';
import { frontmatterBlock } from '../../frontmatter/extract';

/**
 * A frontmatter value the converter refuses.
 *
 * Two shapes, both MEASURED as converter rejections, which fail the WHOLE changeset:
 *
 *   method: POST     `Request method 'POST' is not allowed. Valid methods: delete, get, …`
 *   layout: false    `undefined method 'sub' for false`
 *
 * `layout: false` is the second one and it is worth spelling out, because the previous
 * wording of this diagnostic claimed the opposite. YAML parses it as the BOOLEAN, and
 * `page_converter.rb`'s `set_layout` guards `nil` rather than `false`
 * (`value&.sub(…) unless value.nil?`), so `false.sub` raises during conversion. The
 * instance-default fallback in `use_layout` is only reached when `layout` is absent, so a
 * boolean never gets there. `layout: ''` is the spelling that disables the layout, and it
 * validates and deploys clean.
 */
export const InvalidFrontmatterValue: LiquidCheckDefinition = {
  meta: {
    code: 'InvalidFrontmatterValue',
    name: 'Invalid Frontmatter Value',
    docs: {
      description:
        'Reports a frontmatter value outside the set the platform accepts for that key. The deploy converter rejects the whole changeset for such a value.',
      recommended: true,
      url: 'https://documentation.platformos.com/developer-guide/platformos-check/checks/invalid-frontmatter-value',
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
        const block = frontmatterBlock(file, fileType);
        if (!block) return;

        const { schema, entries } = block;

        // Enum validation — allowed values are defined in the schema.
        // Comparison is case-insensitive for string values: both the field value and
        // each enum entry are lowercased before comparing, so `GET` matches `get` etc.
        for (const [key, entry] of entries) {
          const fieldSchema = schema.fields[key];
          if (!fieldSchema?.enumValues) continue;
          const { jsValue, absStart, absEnd } = entry;
          // Skip enum validation for Liquid expressions — they're dynamic and can't be statically checked.
          if (typeof jsValue === 'string' && containsLiquid(jsValue)) continue;
          const normalizedValue = typeof jsValue === 'string' ? jsValue.toLowerCase() : jsValue;
          const matches = fieldSchema.enumValues.some((allowed) =>
            typeof allowed === 'string'
              ? allowed.toLowerCase() === normalizedValue
              : allowed === normalizedValue,
          );
          if (!matches) {
            context.report({
              message: `Invalid value '${jsValue}' for '${key}'. Must be one of: ${fieldSchema.enumValues.join(', ')}`,
              startIndex: absStart,
              endIndex: absEnd,
            });
          }
        }

        // `layout: false` (Page and Email share the primary `layout` key; the deprecated
        // alias differs per type).
        if (fileType === PlatformOSFileType.Page || fileType === PlatformOSFileType.Email) {
          const deprecatedAlias =
            fileType === PlatformOSFileType.Page ? 'layout_name' : 'layout_path';
          const layoutEntry = entries.get('layout') ?? entries.get(deprecatedAlias);

          if (layoutEntry?.jsValue === false) {
            context.report({
              message:
                "`layout: false` is rejected by the deploy converter, which fails the whole changeset. Use `layout: ''` to disable layout rendering.",
              startIndex: layoutEntry.valueAbsStart,
              endIndex: layoutEntry.valueAbsEnd,
              suggest: [
                {
                  message: "Replace with `layout: ''`",
                  fix: (corrector) => {
                    corrector.replace(layoutEntry.valueAbsStart, layoutEntry.valueAbsEnd, "''");
                  },
                },
              ],
            });
          }
        }
      },
    };
  },
};
