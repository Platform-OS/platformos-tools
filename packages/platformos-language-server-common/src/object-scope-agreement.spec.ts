import { NodeTypes, toLiquidHtmlAST, LiquidVariableLookup } from '@platformos/liquid-html-parser';
import {
  CheckDefinition,
  ObjectEntry,
  SourceCodeType,
  allChecks,
  path as pathUtils,
} from '@platformos/platformos-check-common';
import { publishedDocset, runLiquidCheck } from '@platformos/platformos-check-common/src/test';
import {
  PlatformOSFileType,
  appFileTypeToFileType,
  getAppPaths,
  isObjectInScope,
} from '@platformos/platformos-common';
import { assert, describe, expect, it } from 'vitest';

import { TypeSystem } from './TypeSystem';
import { DocumentManager } from './documents';
import { CompletionsProvider } from './completions';

/**
 * The editor and the linter must answer "is this object in scope here" the same way.
 */

const ROOT = 'file:///project';

/** Every documented object, from the docset a user's editor answers from. */
const publishedObjects = (): Promise<ObjectEntry[]> => publishedDocset.objects();

const undefinedObject = allChecks.find(
  (check) => check.meta.code === 'UndefinedObject',
) as CheckDefinition<SourceCodeType.LiquidHtml>;

/**
 * The file types both consumers can see a Liquid file of. `UndefinedObject` is a LiquidHtml check
 * and the editor completes Liquid, so a YAML type has no end-to-end answer to compare — the
 * per-type agreement in the second describe covers those.
 */
const LIQUID_FILE_TYPES = [
  PlatformOSFileType.Page,
  PlatformOSFileType.Layout,
  PlatformOSFileType.Partial,
  PlatformOSFileType.ApiCall,
  PlatformOSFileType.Email,
  PlatformOSFileType.Sms,
  PlatformOSFileType.Authorization,
  PlatformOSFileType.FormConfiguration,
  PlatformOSFileType.Migration,
] as const;

/** A real path of `fileType`, spelled by the table that owns where each type lives. */
function probePath(fileType: PlatformOSFileType): string {
  const [dir] = getAppPaths(fileType);
  assert(dir, `no app path for ${fileType}`);
  return `${dir}/probe.liquid`;
}

/** The names the EDITOR offers at `{{ █ }}` in a file of this type. */
async function offeredByEditor(fileType: PlatformOSFileType): Promise<string[]> {
  const uri = `${ROOT}/${probePath(fileType)}`;
  const documentManager = new DocumentManager(
    undefined,
    undefined,
    undefined,
    undefined,
    async () => ROOT,
  );
  const provider = new CompletionsProvider({
    documentManager,
    platformosDocset: publishedDocset,
    findAppRootURI: async () => ROOT,
  });

  documentManager.open(uri, '{{  }}', 1);
  const items = await provider.completions({
    textDocument: { uri },
    position: { line: 0, character: 3 },
  });

  return items.map((item) => item.label).sort();
}

/**
 * The names the CHECK stays silent about, one `{{ name }}` per documented object.
 *
 * The `{% doc %}` block is what makes the check speak at all outside a page: a file with no
 * contract is assumed to be reading arguments its caller passed, so every name in it is
 * legitimate. It declares no `@param`, which is what leaves the names to this check rather than to
 * `MissingDocParam`.
 */
async function acceptedByCheck(fileType: PlatformOSFileType): Promise<string[]> {
  const names = (await publishedObjects()).map((object) => object.name!);
  const source = ['{% doc %}', '  A probe.', '{% enddoc %}']
    .concat(names.map((name) => `{{ ${name} }}`))
    .join('\n');
  const offenses = await runLiquidCheck(undefinedObject, source, probePath(fileType));
  const reported = new Set(
    offenses.map((offense) => source.slice(offense.start.index, offense.end.index)),
  );

  return names.filter((name) => !reported.has(name)).sort();
}

/** Which of the Liquid file types offer `name`, as a whole value to assert against. */
async function offeredIn(name: string) {
  return Promise.all(
    LIQUID_FILE_TYPES.map(async (fileType) => ({
      fileType,
      offered: (await offeredByEditor(fileType)).includes(name),
    })),
  );
}

describe('the editor and the linter agree on object scope', () => {
  it.each(LIQUID_FILE_TYPES)(
    'the editor offers exactly what the check accepts, in a %s',
    async (fileType) => {
      const [editor, check] = await Promise.all([
        offeredByEditor(fileType),
        acceptedByCheck(fileType),
      ]);

      expect(editor).toEqual(check);
    },
  );

  /**
   * The agreement above is satisfied by two consumers that both ignore the file type — which is
   * precisely the bug. These pin the answers that made them disagree, still without restating the
   * docset: which objects are restricted, and to what, is read out of the shipped file.
   */
  describe('an object the docset restricts is offered only where it exists', () => {
    it('CONTROL: the shipped docset restricts objects in both ways', async () => {
      // A suppression wide enough to hide a real defect passes every "nothing was offered"
      // assertion ever written. If either list is empty the cases below are vacuous.
      const objects = await publishedObjects();

      expect({
        byFileType: objects.filter((object) => object.access?.app_file_type).length === 0,
        byParent: objects.filter((object) => (object.access?.parents.length ?? 0) > 0).length === 0,
      }).toEqual({ byFileType: false, byParent: false });
    });

    it('offers an object restricted to one file type in that file type and in no other', async () => {
      const restricted = (await publishedObjects()).filter(
        (object) => object.access?.app_file_type,
      );

      const actual = await Promise.all(
        restricted.map(async (object) => ({
          name: object.name,
          offeredIn: await offeredIn(object.name!),
        })),
      );

      expect(actual).toEqual(
        restricted.map((object) => {
          const home = appFileTypeToFileType(object.access!.app_file_type!);
          return {
            name: object.name,
            offeredIn: LIQUID_FILE_TYPES.map((fileType) => ({
              fileType,
              offered: fileType === home,
            })),
          };
        }),
      );
    });

    it('never offers an object reached through a parent at file level', async () => {
      const parented = (await publishedObjects()).filter(
        (object) => (object.access?.parents.length ?? 0) > 0,
      );

      const actual = await Promise.all(
        parented.map(async (object) => ({
          name: object.name,
          offeredIn: await offeredIn(object.name!),
        })),
      );

      expect(actual).toEqual(
        parented.map((object) => ({
          name: object.name,
          offeredIn: LIQUID_FILE_TYPES.map((fileType) => ({ fileType, offered: false })),
        })),
      );
    });

    it('CONTROL: an unrestricted object is offered in every one of those file types', async () => {
      // Without this, the two cases above pass on an editor that offers NOTHING anywhere.
      const unrestricted = (await publishedObjects()).filter((object) =>
        LIQUID_FILE_TYPES.every((fileType) => isObjectInScope(object.access, fileType)),
      );
      expect(unrestricted.length === 0).toBe(false);

      const offeredEverywhere = await Promise.all(
        LIQUID_FILE_TYPES.map(async (fileType) => {
          const offered = new Set(await offeredByEditor(fileType));
          return unrestricted.every((object) => offered.has(object.name!));
        }),
      );

      expect(offeredEverywhere).toEqual(LIQUID_FILE_TYPES.map(() => true));
    });
  });
});

describe('TypeSystem resolves scope through platformos-common, for every file type', () => {
  const ALL_FILE_TYPES: (PlatformOSFileType | undefined)[] = [
    ...Object.values(PlatformOSFileType),
    undefined,
  ];

  /** What the type system seeds into a file of `fileType` — the editor's whole answer. */
  async function seededBy(fileType: PlatformOSFileType | undefined): Promise<string[]> {
    const typeSystem = new TypeSystem(
      publishedDocset,
      undefined,
      undefined,
      undefined,
      undefined,
      async () => fileType,
    );
    const ast = toLiquidHtmlAST('{{ x }}');
    const output = ast.children[0];
    assert(output.type === NodeTypes.LiquidVariableOutput);
    assert(typeof output.markup !== 'string');
    assert(output.markup.expression.type === NodeTypes.VariableLookup);

    const available = await typeSystem.availableVariables(
      ast,
      '',
      output.markup.expression as LiquidVariableLookup,
      pathUtils.join(ROOT, probePath(PlatformOSFileType.Partial)),
    );

    return available.map(({ entry }) => entry.name!).sort();
  }

  it.each(ALL_FILE_TYPES)('matches isObjectInScope in a %s', async (fileType) => {
    const expected = (await publishedObjects())
      .filter((object) => isObjectInScope(object.access, fileType))
      .map((object) => object.name!)
      .sort();

    expect(await seededBy(fileType)).toEqual(expected);
  });
});
