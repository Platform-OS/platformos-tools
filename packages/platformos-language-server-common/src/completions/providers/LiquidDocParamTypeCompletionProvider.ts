import { NodeTypes } from '@platformos/liquid-html-parser';
import { CompletionItem, CompletionItemKind, MarkupKind } from 'vscode-languageserver';
import { LiquidCompletionParams } from '../params';
import { Provider } from './common';
import { FileTypeForURI } from '../../internal-types';
import { makeSupportsLiquidDoc } from '../../utils/uri';
import { getValidParamTypes, PlatformOSDocset } from '@platformos/platformos-check-common';

/**
 * `@param`'s spelling, which the PARSER owns: the grammar's `paramNode` rule is what makes this the one
 * annotation with a type in braces, and the docset publishes the type list without saying which
 * annotation takes it. The same exemption the grammar has, for the same reason — a completion here has
 * to know the shape it is completing inside.
 */
const PARAM_ANNOTATION = '@param';

export class LiquidDocParamTypeCompletionProvider implements Provider {
  private readonly supportsLiquidDoc: (uri: string) => Promise<boolean>;

  constructor(
    private readonly platformosDocset: PlatformOSDocset,
    fileTypeForURI?: FileTypeForURI,
  ) {
    this.supportsLiquidDoc = makeSupportsLiquidDoc(fileTypeForURI);
  }

  async completions(params: LiquidCompletionParams): Promise<CompletionItem[]> {
    if (!params.completionContext) return [];
    if (!(await this.supportsLiquidDoc(params.document.uri))) return [];

    const { node, ancestors } = params.completionContext;
    const parentNode = ancestors.at(-1);

    if (
      !node ||
      !parentNode ||
      node.type !== NodeTypes.TextNode ||
      parentNode.type !== NodeTypes.LiquidRawTag ||
      parentNode.name !== 'doc'
    ) {
      return [];
    }

    /**
     * We need to make sure we're trying to code complete after
     * the param tag's `{` character.
     *
     * We will be removing any spaces in case there are any formatting issues.
     */
    const fragments = node.value.split(' ').filter(Boolean);
    if (
      fragments.length > 2 ||
      fragments[0] !== PARAM_ANNOTATION ||
      !/^\{[a-zA-Z]*$/.test(fragments[1])
    ) {
      return [];
    }

    const [vocabulary, liquidDrops] = await Promise.all([
      this.platformosDocset.liquidDoc(),
      this.platformosDocset.liquidDrops(),
    ]);

    // No published types means no completions — the alternative is offering the object names alone,
    // which reads as "`string` is not a valid param type".
    const validParamTypes = getValidParamTypes(vocabulary.param_types, liquidDrops);

    if (!validParamTypes) return [];

    return Array.from(validParamTypes).map(([label, description]) => {
      const documentation = description
        ? {
            kind: MarkupKind.Markdown,
            value: description,
          }
        : undefined;

      return {
        label,
        kind: CompletionItemKind.EnumMember,
        insertText: label,
        documentation,
      };
    });
  }
}
