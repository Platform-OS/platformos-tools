import { isMap, isScalar } from 'yaml';
import {
  containsLiquid,
  LEGACY_SPAM_PROTECTION_STRING,
  PlatformOSFileType,
  SPAM_PROTECTION_STRATEGIES,
} from '@platformos/platformos-common';
import { LiquidCheckDefinition, Severity, SourceCodeType } from '../../types';
import { type FrontmatterBlock, wellFormedFrontmatterBlock } from '../../frontmatter';

/**
 * A frontmatter value the converter refuses. Both shapes are measured rejections:
 * `method: not_a_method` → `Request method '…' is not allowed`, and `layout: false` →
 * `undefined method 'sub' for false`.
 *
 * `layout: false` does NOT fall back to the default layout, which this diagnostic used to
 * claim: YAML reads it as a boolean and `page_converter.rb`'s `set_layout` guards `nil`
 * rather than `false`. `layout: ''` is the spelling that disables the layout.
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
        const block = wellFormedFrontmatterBlock(context.file, fileType);
        if (!block) return;

        const { schema, entries } = block;

        // Enum validation. Case-insensitive by default; a field whose platform-side
        // validation compares literally sets `caseSensitiveEnum` (see `Page.method`).
        for (const [key, entry] of entries) {
          const fieldSchema = schema.fields[key];
          if (!fieldSchema?.enumValues) continue;
          const { jsValue, absStart, absEnd } = entry;
          // Skip enum validation for Liquid expressions — they're dynamic and can't be statically checked.
          if (typeof jsValue === 'string' && containsLiquid(jsValue)) continue;
          const fold = (value: string) =>
            fieldSchema.caseSensitiveEnum ? value : value.toLowerCase();
          const normalizedValue = typeof jsValue === 'string' ? fold(jsValue) : jsValue;
          const matches = fieldSchema.enumValues.some((allowed) =>
            typeof allowed === 'string' ? fold(allowed) === normalizedValue : allowed === jsValue,
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

        if (fileType === PlatformOSFileType.FormConfiguration) {
          checkSpamProtection(block, context);
        }
      },
    };
  },
};

/**
 * `spam_protection` is a MAPPING whose first key names the strategy, or the single legacy
 * string `recaptcha`. Every rule below is a measured converter rejection.
 */
function checkSpamProtection(
  block: FrontmatterBlock,
  context: Parameters<LiquidCheckDefinition['create']>[0],
) {
  const { doc, bodyOffset, entries } = block;
  const entry = entries.get('spam_protection');
  if (!entry) return;

  if (!isMap(doc.contents)) return;
  const pair = doc.contents.items.find(
    (item) => isScalar(item.key) && item.key.value === 'spam_protection',
  );
  if (!pair) return;

  const report = (message: string, start: number, end: number) =>
    context.report({ message, startIndex: start, endIndex: end });

  const value = pair.value;

  // A bare string. Only `recaptcha` survives; anything else reaches `.keys` and raises
  // `undefined method 'keys' for an instance of String`.
  if (isScalar(value) && typeof value.value === 'string') {
    const given = value.value;
    if (containsLiquid(given) || given === LEGACY_SPAM_PROTECTION_STRING) return;
    const [vs = 0, ve = 0] = value.range ?? [];
    return report(
      `'${given}' must be written as a mapping key, not a plain value — ` +
        `only '${LEGACY_SPAM_PROTECTION_STRING}' may be a plain string.`,
      bodyOffset + vs,
      bodyOffset + ve,
    );
  }

  if (!isMap(value)) return;

  const strategyPair = value.items[0];
  if (!strategyPair || !isScalar(strategyPair.key)) return;
  const strategy = String(strategyPair.key.value);
  const [ks = 0, ke = 0] = strategyPair.key.range ?? [];

  if (!(SPAM_PROTECTION_STRATEGIES as readonly string[]).includes(strategy)) {
    return report(
      `Unknown spam protection strategy '${strategy}'. Must be one of: ${SPAM_PROTECTION_STRATEGIES.join(', ')}`,
      bodyOffset + ks,
      bodyOffset + ke,
    );
  }

  if (strategy !== 'recaptcha_v3') return;

  const options = strategyPair.value;
  const optionOf = (name: string) =>
    isMap(options)
      ? options.items.find((item) => isScalar(item.key) && item.key.value === name)
      : undefined;

  if (!optionOf('action')) {
    report("'recaptcha_v3' requires an 'action'.", bodyOffset + ks, bodyOffset + ke);
  }

  const score = optionOf('minimum_score')?.value;
  if (isScalar(score) && typeof score.value === 'number') {
    if (score.value < 0 || score.value > 1) {
      const [ss = 0, se = 0] = score.range ?? [];
      report("'minimum_score' must be between 0 and 1.", bodyOffset + ss, bodyOffset + se);
    }
  }
}
