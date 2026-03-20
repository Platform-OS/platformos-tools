import { NodeTypes, YAMLFrontmatter } from '@platformos/liquid-html-parser';
import { getFileType } from '@platformos/platformos-common';
import { type AbstractFileSystem } from '@platformos/platformos-common';
import { DefinitionParams, DefinitionLink, Range, LocationLink } from 'vscode-languageserver-protocol';
import { URI, Utils } from 'vscode-uri';
import { LiquidHtmlNode } from '@platformos/liquid-html-parser';
import { DocumentManager } from '../../documents';
import { BaseDefinitionProvider } from '../BaseDefinitionProvider';
import { PlatformOSFileType } from '@platformos/platformos-common';

export class FrontmatterDefinitionProvider implements BaseDefinitionProvider {
  constructor(
    private documentManager: DocumentManager,
    private fs: AbstractFileSystem,
    private findAppRootURI: (uri: string) => Promise<string | null>,
  ) {}

  async definitions(
    params: DefinitionParams,
    _node: LiquidHtmlNode,
    _ancestors: LiquidHtmlNode[],
  ): Promise<DefinitionLink[]> {
    const uri = params.textDocument.uri;
    const sourceCode = this.documentManager.get(uri);
    if (!sourceCode || sourceCode.ast instanceof Error) return [];

    const ast = sourceCode.ast;
    if (ast.type !== NodeTypes.Document) return [];

    const frontmatterNode = ast.children.find(
      (child): child is YAMLFrontmatter => child.type === NodeTypes.YAMLFrontmatter,
    );
    if (!frontmatterNode) return [];

    const doc = sourceCode.textDocument;
    const source = doc.getText();

    const bodyStart = source.indexOf('\n', frontmatterNode.position.start) + 1;
    const bodyEnd = bodyStart + frontmatterNode.body.length;
    const cursor = doc.offsetAt(params.position);

    if (cursor < bodyStart || cursor > bodyEnd) return [];

    const cursorInBody = cursor - bodyStart;
    const bodyUpToCursor = frontmatterNode.body.slice(0, cursorInBody);

    // Determine the current line
    const lastNewline = bodyUpToCursor.lastIndexOf('\n');
    const currentLineText = bodyUpToCursor.slice(lastNewline + 1);

    // Determine remaining text on current line
    const bodyFromCursor = frontmatterNode.body.slice(cursorInBody);
    const nextNewline = bodyFromCursor.indexOf('\n');
    const restOfLine = nextNewline === -1 ? bodyFromCursor : bodyFromCursor.slice(0, nextNewline);

    const fullCurrentLine = currentLineText + restOfLine;

    // List item: line starts with optional whitespace + "- " (no colon, check first)
    const listItemMatch = fullCurrentLine.match(/^(\s*)-\s*(.*)/);
    if (listItemMatch) {
      const parentKey = findParentKey(bodyUpToCursor);
      if (parentKey !== 'authorization_policies') return [];

      const itemValue = listItemMatch[2].trim().replace(/^['"]/, '').replace(/['"]$/, '');
      if (!itemValue || itemValue.includes('{{') || itemValue.includes('{%')) return [];

      return this.resolveAuthPolicyDefinition(uri, itemValue, cursor, lastNewline + 1 + bodyStart, doc);
    }

    const colonIndex = fullCurrentLine.indexOf(':');
    if (colonIndex === -1) return [];

    const key = fullCurrentLine.slice(0, colonIndex).trim();

    // Scalar value: cursor must be after the colon
    if (cursor <= bodyStart + lastNewline + 1 + colonIndex) return [];

    if (key !== 'layout' && key !== 'layout_name') return [];

    // Only for page file types
    const fileType = getFileType(uri);
    if (fileType !== PlatformOSFileType.Page) return [];

    const afterColon = fullCurrentLine.slice(colonIndex + 1).trimStart();
    const value = afterColon.replace(/^['"]/, '').replace(/['"]$/, '').trim();

    if (!value || value.includes('{{') || value.includes('{%')) return [];

    // Compute origin range: from after colon+space to end of value
    const lineStart = bodyStart + lastNewline + 1;
    const valueStartInLine = colonIndex + 1 + (fullCurrentLine.slice(colonIndex + 1).length - afterColon.length);
    const originStart = lineStart + valueStartInLine;
    const originEnd = originStart + afterColon.length;

    return this.resolveLayoutDefinition(uri, value, originStart, originEnd, doc);
  }

  private async resolveLayoutDefinition(
    fileUri: string,
    layoutName: string,
    originStart: number,
    originEnd: number,
    doc: ReturnType<DocumentManager['get']>['textDocument'],
  ): Promise<DefinitionLink[]> {
    const rootUri = await this.findAppRootURI(fileUri);
    if (!rootUri) return [];
    const root = URI.parse(rootUri);

    let targetUri: string | undefined;

    if (layoutName.startsWith('modules/')) {
      const match = layoutName.match(/^modules\/([^/]+)\/(.+)$/);
      if (!match) return [];
      const [, mod, rest] = match;

      // Check app overwrite first (app/modules/{mod}/{visibility}/views/layouts/{rest}.liquid),
      // then fall back to the original module path (modules/{mod}/{visibility}/...).
      // Both visibilities are checked for each root before moving to the next.
      const roots: Array<(v: string) => URI> = [
        (v) => Utils.joinPath(root, 'app', 'modules', mod, v, 'views', 'layouts', `${rest}.liquid`),
        (v) => Utils.joinPath(root, 'modules', mod, v, 'views', 'layouts', `${rest}.liquid`),
      ];
      outer: for (const makeCandidate of roots) {
        for (const visibility of ['public', 'private'] as const) {
          const candidate = makeCandidate(visibility);
          if (await this.fileExists(candidate.toString())) {
            targetUri = candidate.toString();
            break outer;
          }
        }
      }
    } else {
      const candidate = Utils.joinPath(root, 'app', 'views', 'layouts', `${layoutName}.liquid`);
      if (await this.fileExists(candidate.toString())) {
        targetUri = candidate.toString();
      }
    }

    if (!targetUri) return [];

    const originRange = Range.create(doc.positionAt(originStart), doc.positionAt(originEnd));
    const targetRange = Range.create(0, 0, 0, 0);
    return [LocationLink.create(targetUri, targetRange, targetRange, originRange)];
  }

  private async resolveAuthPolicyDefinition(
    fileUri: string,
    policyName: string,
    _cursor: number,
    lineAbsStart: number,
    doc: ReturnType<DocumentManager['get']>['textDocument'],
  ): Promise<DefinitionLink[]> {
    const rootUri = await this.findAppRootURI(fileUri);
    if (!rootUri) return [];
    const root = URI.parse(rootUri);

    const candidate = Utils.joinPath(root, 'app', 'authorization_policies', `${policyName}.liquid`);
    if (!(await this.fileExists(candidate.toString()))) return [];

    // Find the item value start in the line
    const body = doc.getText();
    // We know lineAbsStart; find the "- " on the line
    const lineText = body.slice(lineAbsStart, lineAbsStart + 200).split('\n')[0] ?? '';
    const dashIdx = lineText.indexOf('-');
    if (dashIdx === -1) return [];
    const valueOffset = lineAbsStart + dashIdx + 1 + (lineText.slice(dashIdx + 1).length - lineText.slice(dashIdx + 1).trimStart().length);
    const valueEnd = lineAbsStart + lineText.length;

    const originRange = Range.create(doc.positionAt(valueOffset), doc.positionAt(valueEnd));
    const targetRange = Range.create(0, 0, 0, 0);
    return [LocationLink.create(candidate.toString(), targetRange, targetRange, originRange)];
  }

  private async fileExists(uri: string): Promise<boolean> {
    try {
      await this.fs.stat(uri);
      return true;
    } catch {
      return false;
    }
  }
}

function findParentKey(bodyUpToCursor: string): string | undefined {
  const lines = bodyUpToCursor.split('\n');
  for (let i = lines.length - 2; i >= 0; i--) {
    const line = lines[i];
    if (!line.trim()) continue;
    if (/^\s+-/.test(line)) continue;
    const match = line.match(/^([a-zA-Z_][a-zA-Z0-9_]*):/);
    if (match) return match[1];
    break;
  }
  return undefined;
}
