import { isMap, isScalar, isSeq, parseDocument } from 'yaml';
import { LiquidCheckDefinition, RelativePath, Severity, SourceCodeType } from '../../types';
import {
  containsLiquid,
  FRONTMATTER_ASSOCIATION_DIRS,
  getFrontmatterSchema,
  getFileType,
  PlatformOSFileType,
} from '@platformos/platformos-common';
import { doesFileExist } from '../../utils/file-utils';

export const ValidFrontmatter: LiquidCheckDefinition = {
  meta: {
    code: 'ValidFrontmatter',
    name: 'Valid Frontmatter',
    docs: {
      description:
        'Validates YAML frontmatter properties (required fields, allowed values, deprecated keys) for known platformOS file types.',
      recommended: true,
      url: undefined,
    },
    type: SourceCodeType.LiquidHtml,
    severity: Severity.WARNING,
    schema: {},
    targets: [],
  },

  create(context) {
    return {
      async onCodePathStart(file) {
        const source = file.source;

        if (/(?:^|\/)home\.html\.liquid$/.test(file.uri)) {
          context.report({
            message:
              "'home.html.liquid' is deprecated. Rename to 'index.html.liquid' to serve as the root page.",
            startIndex: 0,
            endIndex: 0,
          });
        }

        // Locate the frontmatter block — may be preceded by whitespace
        const trimmed = source.trimStart();
        if (!trimmed.startsWith('---')) return;

        const leadingLen = source.length - trimmed.length;
        const firstNewline = trimmed.indexOf('\n');
        if (firstNewline === -1) return;

        const afterOpening = trimmed.slice(firstNewline + 1);

        // The closing `---` may be the very first line of afterOpening (empty frontmatter)
        // or may follow a newline (normal frontmatter with content).
        let yamlBody: string;
        if (afterOpening.startsWith('---')) {
          yamlBody = '';
        } else {
          const closeIdx = afterOpening.indexOf('\n---');
          if (closeIdx === -1) return;
          yamlBody = afterOpening.slice(0, closeIdx);
        }
        // Absolute offset of the first character of yamlBody in source
        const bodyOffset = leadingLen + firstNewline + 1;

        const fileType = getFileType(file.uri);
        const schema = getFrontmatterSchema(fileType);
        if (!schema) return;

        // Parse YAML with position tracking (yaml v2 provides range arrays).
        // Continue even when the document has parse errors — parseDocument is
        // lenient and still builds a partial map for the valid pairs it finds.
        // Normalize CRLF → LF so YAML values don't contain stray \r characters.
        const doc = parseDocument(yamlBody.replace(/\r\n/g, '\n').replace(/\r/g, '\n'));

        // Build lookup: key → { jsValue, absStart, absEnd, valueAbsStart, valueAbsEnd }
        type Entry = {
          jsValue: unknown;
          absStart: number;
          absEnd: number;
          valueAbsStart: number;
          valueAbsEnd: number;
        };
        const entries = new Map<string, Entry>();

        // Only populate entries when the document parsed to a map (non-empty frontmatter).
        // When frontmatter is empty (`---\n---\n`) doc.contents is null — entries stays empty
        // and required-field validation below will still fire correctly.
        if (isMap(doc.contents)) {
          for (const pair of doc.contents.items) {
            const keyNode = pair.key;
            if (!isScalar(keyNode) || typeof keyNode.value !== 'string') continue;
            const [ks = 0, ke = 0] = keyNode.range ?? [];
            const valNode = isScalar(pair.value) ? pair.value : undefined;
            const jsValue = valNode?.value;
            const [vs = 0, ve = 0] = valNode?.range ?? [];
            entries.set(keyNode.value, {
              jsValue,
              absStart: bodyOffset + ks,
              absEnd: bodyOffset + ke,
              valueAbsStart: bodyOffset + vs,
              valueAbsEnd: bodyOffset + ve,
            });
          }
        }

        const frontmatterStart = leadingLen; // position of opening `---`

        // 1. Required field validation
        for (const [fieldName, fieldSchema] of Object.entries(schema.fields)) {
          if (fieldSchema.required && !entries.has(fieldName)) {
            context.report({
              message: `Missing required frontmatter field '${fieldName}' in ${schema.name} file`,
              startIndex: frontmatterStart,
              endIndex: frontmatterStart + 3,
            });
          }
        }

        // 2. Unrecognized key warnings
        for (const [key, entry] of entries) {
          if (!(key in schema.fields)) {
            context.report({
              message: `Unknown frontmatter field '${key}' in ${schema.name} file`,
              startIndex: entry.absStart,
              endIndex: entry.absEnd,
            });
          }
        }

        // 3. Deprecated field warnings
        for (const [key, entry] of entries) {
          const fieldSchema = schema.fields[key];
          if (fieldSchema?.deprecated) {
            context.report({
              message: fieldSchema.deprecatedMessage ?? `'${key}' is deprecated`,
              startIndex: entry.absStart,
              endIndex: entry.absEnd,
            });
          }
        }

        // 4. Enum validation — allowed values are defined in the schema.
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

        // 5. Layout association validation (Page and Email).
        // Both types share the primary `layout` key; deprecated aliases differ per type.
        if (fileType === PlatformOSFileType.Page || fileType === PlatformOSFileType.Email) {
          const deprecatedAlias = fileType === PlatformOSFileType.Page ? 'layout_name' : 'layout_path';
          const layoutEntry = entries.get('layout') ?? entries.get(deprecatedAlias);
          if (layoutEntry) {
            if (layoutEntry.jsValue === false) {
              // `layout: false` (YAML boolean) does NOT disable the layout — it falls back to the
              // instance default. Use `layout: ''` to explicitly disable layout rendering.
              context.report({
                message: "`layout: false` falls back to the default layout. Use `layout: ''` to disable layout rendering.",
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
            } else if (
              typeof layoutEntry.jsValue === 'string' &&
              layoutEntry.jsValue !== '' &&
              !containsLiquid(layoutEntry.jsValue)
            ) {
              await checkLayoutExists(layoutEntry.jsValue, layoutEntry, context);
            }
          }
        }

        // 6. Authorization policy association validation (Page)
        if (fileType === PlatformOSFileType.Page) {
          await checkNotificationArray(
            doc,
            bodyOffset,
            'authorization_policies',
            `app/${FRONTMATTER_ASSOCIATION_DIRS['authorization_policies']}`,
            'Authorization policy',
            context,
          );
        }

        // 7. Notification association validation (FormConfiguration)
        if (fileType === PlatformOSFileType.FormConfiguration) {
          for (const [field, dir] of Object.entries(FRONTMATTER_ASSOCIATION_DIRS)) {
            if (field === 'authorization_policies') continue; // only on Page, handled above
            await checkNotificationArray(
              doc,
              bodyOffset,
              field,
              `app/${dir}`,
              fieldLabel(field),
              context,
            );
          }
        }
      },
    };
  },
};

/**
 * Checks each string item of a YAML sequence field against the filesystem.
 *
 * App-level items (e.g. `require_login`) are looked up at `{dir}/{name}.liquid`.
 * Module-prefixed items (e.g. `modules/community/require_login`) are looked up
 * at modules/{mod}/{public|private}/{moduleDir}/{name}.liquid where moduleDir
 * is derived from dir by stripping the leading `app/` segment.
 */
async function checkNotificationArray(
  doc: ReturnType<typeof parseDocument>,
  bodyOffset: number,
  fieldName: string,
  dir: string,
  label: string,
  context: Parameters<LiquidCheckDefinition['create']>[0],
) {
  if (!isMap(doc.contents)) return;
  const pair = doc.contents.items.find(
    (p) => isScalar(p.key) && p.key.value === fieldName,
  );
  if (!pair || !isSeq(pair.value)) return;

  // Module-relative dir: strip leading 'app/' (e.g. 'app/authorization_policies' → 'authorization_policies')
  const moduleDir = dir.slice('app/'.length);

  for (const item of pair.value.items) {
    if (!isScalar(item) || typeof item.value !== 'string') continue;
    const name = item.value;
    if (containsLiquid(name)) continue;
    const [is = 0, ie = 0] = item.range ?? [];

    let exists: boolean;
    if (name.startsWith('modules/')) {
      const match = name.match(/^modules\/([^/]+)\/(.+)$/);
      if (!match) {
        exists = false;
      } else {
        const [, mod, rest] = match;
        exists =
          (await doesFileExist(context, `modules/${mod}/public/${moduleDir}/${rest}.liquid` as RelativePath)) ||
          (await doesFileExist(context, `modules/${mod}/private/${moduleDir}/${rest}.liquid` as RelativePath));
      }
    } else {
      exists = await doesFileExist(context, `${dir}/${name}.liquid` as RelativePath);
    }

    if (!exists) {
      context.report({
        message: `${label} '${name}' does not exist`,
        startIndex: bodyOffset + is,
        endIndex: bodyOffset + ie,
      });
    }
  }
}

/**
 * Tries both `{base}.liquid` and `{base}.html.liquid` since layout files may
 * carry a format extension (e.g. `application.html.liquid`).
 */
async function layoutFileExists(
  context: Parameters<LiquidCheckDefinition['create']>[0],
  base: string,
): Promise<boolean> {
  return (
    (await doesFileExist(context, `${base}.liquid` as RelativePath)) ||
    (await doesFileExist(context, `${base}.html.liquid` as RelativePath))
  );
}

async function checkLayoutExists(
  layoutName: string,
  entry: { absStart: number; absEnd: number },
  context: Parameters<LiquidCheckDefinition['create']>[0],
) {
  let exists: boolean;

  if (layoutName.startsWith('modules/')) {
    // modules/{mod}/rest → modules/{mod}/{public,private}/views/layouts/{rest}.{html.}liquid
    const match = layoutName.match(/^modules\/([^/]+)\/(.+)$/);
    if (!match) return;
    const [, mod, rest] = match;
    exists = await layoutFileExists(context, `modules/${mod}/public/views/layouts/${rest}`) ||
             await layoutFileExists(context, `modules/${mod}/private/views/layouts/${rest}`);
  } else {
    exists = await layoutFileExists(context, `app/views/layouts/${layoutName}`);
  }

  if (!exists) {
    context.report({
      message: `Layout '${layoutName}' does not exist`,
      startIndex: entry.absStart,
      endIndex: entry.absEnd,
    });
  }
}

function fieldLabel(field: string): string {
  switch (field) {
    case 'email_notifications':
      return 'Email notification';
    case 'sms_notifications':
      return 'SMS notification';
    case 'api_call_notifications':
      return 'API call notification';
    default:
      return field;
  }
}
