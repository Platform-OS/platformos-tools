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
import { type FrontmatterBlock, frontmatterBlock } from '../../frontmatter/extract';
import { doesFileExist } from '../../utils/file-utils';

/**
 * A frontmatter association array naming a policy or notification that does not exist —
 * `authorization_policies` on a Page, the notification arrays on a FormConfiguration.
 *
 * NOT in `BLOCKING_CHECKS`, and the reason is that its deploy behaviour is UNMEASURED
 * rather than benign. `pos-cli deploy --dry-run` accepts it, but the dry run is not the
 * authority here: `base_converter.rb`'s `import` returns before `persist_slice!` and before
 * `bulk_write_associations_from_snapshot!`, and it is the latter that raises
 * `raise_missing_association_error` for a name it cannot resolve. So the dry run's silence
 * is a gap in the oracle, not evidence.
 *
 * The gate does not block on its own uncertainty. Settling this needs one REAL deploy; if
 * it rejects, this check joins the blocking set unchanged.
 */
export const MissingFrontmatterAssociation: LiquidCheckDefinition = {
  meta: {
    code: 'MissingFrontmatterAssociation',
    name: 'Missing Frontmatter Association',
    docs: {
      description:
        'Reports an authorization policy or notification named in frontmatter that the project does not contain.',
      recommended: true,
      url: 'https://documentation.platformos.com/developer-guide/platformos-check/checks/missing-frontmatter-association',
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
        const block = frontmatterBlock(file, fileType);
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
