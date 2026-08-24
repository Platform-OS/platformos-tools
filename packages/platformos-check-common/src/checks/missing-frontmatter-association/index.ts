import { isMap, isScalar, isSeq } from 'yaml';
import {
  containsLiquid,
  FRONTMATTER_ASSOCIATION_DIRS,
  getAppDirPath,
  getModuleDirPaths,
  parseModulePrefix,
  PlatformOSFileType,
} from '@platformos/platformos-common';
import { LiquidCheckDefinition, RelativePath, Severity, SourceCodeType } from '../../types';
import { type FrontmatterBlock, wellFormedFrontmatterBlock } from '../../frontmatter';
import { doesFileExist } from '../../utils/file-utils';

/**
 * An `authorization_policies` (Page) or notification (FormConfiguration) entry naming
 * something the project does not contain.
 *
 * Measured by a REAL deploy: `<page> tries to assign authorization_policies which do not
 * exist: <name>`, from `raise_missing_association_error`. `--dry-run` accepts it — it
 * returns before the association write — so only a real deploy answers here.
 */
export const MissingFrontmatterAssociation: LiquidCheckDefinition = {
  meta: {
    code: 'MissingFrontmatterAssociation',
    name: 'Missing Frontmatter Association',
    docs: {
      description:
        'Reports an authorization policy or notification named in frontmatter that the project does not contain. The deploy converter rejects the whole changeset for a name it cannot resolve.',
      recommended: true,
      url: 'https://documentation.platformos.com/developer-guide/platformos-check/checks/missing-frontmatter-association',
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

        if (fileType === PlatformOSFileType.Page) {
          await checkAssociationArray(
            block,
            'authorization_policies',
            FRONTMATTER_ASSOCIATION_DIRS['authorization_policies'],
            'Authorization policy',
            context,
          );
          return;
        }

        if (fileType === PlatformOSFileType.FormConfiguration) {
          for (const [field, dir] of Object.entries(FRONTMATTER_ASSOCIATION_DIRS)) {
            if (field === 'authorization_policies') continue; // only on Page, handled above
            await checkAssociationArray(block, field, dir, fieldLabel(field), context);
          }
        }
      },
    };
  },
};

/**
 * Checks each string item of a YAML sequence field against the filesystem.
 *
 * `dir` is a directory NAME from `FRONTMATTER_ASSOCIATION_DIRS` rather than a file
 * type, so the candidate paths come from the dir-keyed helpers: `getAppDirPath` for
 * an app-level item (e.g. `require_login`), `getModuleDirPaths` for a
 * module-prefixed one (e.g. `modules/community/require_login`). That is the same
 * candidate list, in the same resolution order, that go-to-definition on the very
 * same value walks in `FrontmatterDefinitionProvider` — spelling the module roots
 * here instead is how the two came to disagree about `app/modules/<mod>/…`.
 */
async function checkAssociationArray(
  block: FrontmatterBlock,
  fieldName: string,
  dir: string,
  label: string,
  context: Parameters<LiquidCheckDefinition['create']>[0],
) {
  const { doc, bodyOffset } = block;
  if (!isMap(doc.contents)) return;
  const pair = doc.contents.items.find((p) => isScalar(p.key) && p.key.value === fieldName);
  if (!pair || !isSeq(pair.value)) return;

  for (const item of pair.value.items) {
    if (!isScalar(item) || typeof item.value !== 'string') continue;
    const name = item.value;
    if (containsLiquid(name)) continue;
    const [is = 0, ie = 0] = item.range ?? [];

    const parsed = parseModulePrefix(name);
    const searchPaths = parsed.isModule
      ? getModuleDirPaths(dir, parsed.moduleName)
      : [getAppDirPath(dir)];

    let exists = false;
    for (const searchPath of searchPaths) {
      if (await doesFileExist(context, `${searchPath}/${parsed.key}.liquid` as RelativePath)) {
        exists = true;
        break;
      }
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
