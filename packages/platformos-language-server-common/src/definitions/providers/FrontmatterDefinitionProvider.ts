import { NodeTypes, YAMLFrontmatter } from '@platformos/liquid-html-parser';
import {
  FRONTMATTER_ASSOCIATION_DIRS,
  getAppDirPath,
  getFileType,
  getModuleDirPaths,
  nameToPaths,
  parseModulePrefix,
  type AbstractFileSystem,
  PlatformOSFileType,
} from '@platformos/platformos-common';
import { SourceCodeType } from '@platformos/platformos-check-common';
import {
  DefinitionParams,
  DefinitionLink,
  Range,
  LocationLink,
} from 'vscode-languageserver-protocol';
import { URI, Utils } from 'vscode-uri';
import { LiquidHtmlNode } from '@platformos/liquid-html-parser';
import { DocumentManager } from '../../documents';
import { BaseDefinitionProvider } from '../BaseDefinitionProvider';

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
    if (
      !sourceCode ||
      sourceCode.type !== SourceCodeType.LiquidHtml ||
      sourceCode.ast instanceof Error
    )
      return [];

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
      const appDir = parentKey ? FRONTMATTER_ASSOCIATION_DIRS[parentKey] : undefined;
      if (!appDir) return [];

      const itemValue = listItemMatch[2].trim().replace(/^['"]/, '').replace(/['"]$/, '');
      if (!itemValue || itemValue.includes('{{') || itemValue.includes('{%')) return [];

      return this.resolveAssociationDefinition(
        uri,
        itemValue,
        appDir,
        lastNewline + 1 + bodyStart,
        doc,
      );
    }

    const colonIndex = fullCurrentLine.indexOf(':');
    if (colonIndex === -1) return [];

    const key = fullCurrentLine.slice(0, colonIndex).trim();

    // Scalar value: cursor must be after the colon
    if (cursor <= bodyStart + lastNewline + 1 + colonIndex) return [];

    // `layout` / `layout_name` are valid on Page; `layout` / `layout_path` on Email.
    // Anchored: which of the two a file is depends on where it sits under its root.
    const fileRootUri = await this.findAppRootURI(uri);
    const fileType = fileRootUri ? getFileType(uri, fileRootUri) : undefined;
    const isLayoutKey =
      (fileType === PlatformOSFileType.Page && (key === 'layout' || key === 'layout_name')) ||
      (fileType === PlatformOSFileType.Email && (key === 'layout' || key === 'layout_path'));
    if (!isLayoutKey) return [];

    const afterColon = fullCurrentLine.slice(colonIndex + 1).trimStart();
    const value = afterColon.replace(/^['"]/, '').replace(/['"]$/, '').trim();

    if (!value || value.includes('{{') || value.includes('{%')) return [];

    // Compute origin range: from after colon+space to end of value
    const lineStart = bodyStart + lastNewline + 1;
    const valueStartInLine =
      colonIndex + 1 + (fullCurrentLine.slice(colonIndex + 1).length - afterColon.length);
    const originStart = lineStart + valueStartInLine;
    const originEnd = originStart + afterColon.length;

    return this.resolveLayoutDefinition(uri, value, originStart, originEnd, doc);
  }

  private async resolveLayoutDefinition(
    fileUri: string,
    layoutName: string,
    originStart: number,
    originEnd: number,
    doc: NonNullable<ReturnType<DocumentManager['get']>>['textDocument'],
  ): Promise<DefinitionLink[]> {
    const rootUri = await this.findAppRootURI(fileUri);
    if (!rootUri) return [];
    const root = URI.parse(rootUri);

    let targetUri: string | undefined;

    // Candidate paths and their order — the app/modules overwrite before the modules
    // original, public before private — come from platformos-common's name→path
    // mapping, so go-to-definition lands on the same file the platform, the linter and
    // the graph resolve.
    for (const candidate of nameToPaths(PlatformOSFileType.Layout, layoutName)) {
      const uri = Utils.joinPath(root, candidate).toString();
      if (await this.fileExists(uri)) {
        targetUri = uri;
        break;
      }
    }

    if (!targetUri) return [];

    const originRange = Range.create(doc.positionAt(originStart), doc.positionAt(originEnd));
    const targetRange = Range.create(0, 0, 0, 0);
    return [LocationLink.create(targetUri, targetRange, targetRange, originRange)];
  }

  /**
   * Resolves a frontmatter list-item value to a definition link.
   *
   * App-level items (e.g. `require_login`) resolve to:
   *   app/{appDir}/{name}.liquid
   *
   * Module-prefixed items (e.g. `modules/community/require_login`) resolve to the first
   * existing path in priority order:
   *   app/modules/{mod}/public/{appDir}/{name}.liquid  (app overwrite, public)
   *   app/modules/{mod}/private/{appDir}/{name}.liquid (app overwrite, private)
   *   modules/{mod}/public/{appDir}/{name}.liquid
   *   modules/{mod}/private/{appDir}/{name}.liquid
   */
  private async resolveAssociationDefinition(
    fileUri: string,
    itemName: string,
    appDir: string,
    lineAbsStart: number,
    doc: NonNullable<ReturnType<DocumentManager['get']>>['textDocument'],
  ): Promise<DefinitionLink[]> {
    const rootUri = await this.findAppRootURI(fileUri);
    if (!rootUri) return [];
    const root = URI.parse(rootUri);

    let targetUri: string | undefined;

    // `appDir` is a directory NAME (from FRONTMATTER_ASSOCIATION_DIRS) rather than a
    // file type, so this uses the dir-keyed variants — same candidate ordering.
    const parsed = parseModulePrefix(itemName);
    const searchPaths = parsed.isModule
      ? getModuleDirPaths(appDir, parsed.moduleName)
      : [getAppDirPath(appDir)];

    for (const searchPath of searchPaths) {
      const uri = Utils.joinPath(root, searchPath, `${parsed.key}.liquid`).toString();
      if (await this.fileExists(uri)) {
        targetUri = uri;
        break;
      }
    }

    if (!targetUri) return [];

    // Compute origin range: from after the "- " to end of the item value on this line
    const body = doc.getText();
    const lineText = body.slice(lineAbsStart, lineAbsStart + 200).split('\n')[0] ?? '';
    const dashIdx = lineText.indexOf('-');
    if (dashIdx === -1) return [];
    const valueOffset =
      lineAbsStart +
      dashIdx +
      1 +
      (lineText.slice(dashIdx + 1).length - lineText.slice(dashIdx + 1).trimStart().length);
    const valueEnd = lineAbsStart + lineText.length;

    const originRange = Range.create(doc.positionAt(valueOffset), doc.positionAt(valueEnd));
    const targetRange = Range.create(0, 0, 0, 0);
    return [LocationLink.create(targetUri, targetRange, targetRange, originRange)];
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
