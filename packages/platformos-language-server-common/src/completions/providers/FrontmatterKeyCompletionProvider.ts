import { NodeTypes, YAMLFrontmatter } from '@platformos/liquid-html-parser';
import { getFrontmatterSchema, getFileType } from '@platformos/platformos-check-common';
import { CompletionItem, CompletionItemKind } from 'vscode-languageserver';
import { LiquidCompletionParams } from '../params';
import { Provider } from './common';

export type GetLayoutNamesForURI = (uri: string) => Promise<string[]>;
export type GetAuthPolicyNamesForURI = (uri: string) => Promise<string[]>;

export class FrontmatterKeyCompletionProvider implements Provider {
  constructor(
    private readonly getLayoutNamesForURI?: GetLayoutNamesForURI,
    private readonly getAuthPolicyNamesForURI?: GetAuthPolicyNamesForURI,
  ) {}

  async completions(params: LiquidCompletionParams): Promise<CompletionItem[]> {
    const { document } = params;

    // Use the full document AST — the partial AST used for other completions is truncated
    // at the cursor, so the frontmatter closing "---" is never present there.
    const ast = document.ast;
    if (ast instanceof Error || ast.type !== NodeTypes.Document) return [];

    const frontmatterNode = ast.children.find(
      (child): child is YAMLFrontmatter => child.type === NodeTypes.YAMLFrontmatter,
    );
    if (!frontmatterNode) return [];

    const schema = getFrontmatterSchema(getFileType(params.textDocument.uri));
    if (!schema) return [];

    // Locate the YAML body within the source: skip the opening "---\n"
    const source = document.textDocument.getText();
    const bodyStart = source.indexOf('\n', frontmatterNode.position.start) + 1;
    const bodyEnd = bodyStart + frontmatterNode.body.length;

    const cursor = document.textDocument.offsetAt(params.position);
    if (cursor < bodyStart || cursor > bodyEnd) return [];

    const cursorInBody = cursor - bodyStart;

    // Determine what context the cursor is in based on the current line text.
    const bodyUpToCursor = frontmatterNode.body.slice(0, cursorInBody);
    const lastNewline = bodyUpToCursor.lastIndexOf('\n');
    const currentLineText = bodyUpToCursor.slice(lastNewline + 1);

    // ── List-item completion ─────────────────────────────────────────────────
    // Must be checked before colonIndex since list items have no colon.
    const listItemMatch = currentLineText.match(/^(\s*)-\s*(.*)/);
    if (listItemMatch) {
      const partial = listItemMatch[2];
      const parentKey = findParentKey(bodyUpToCursor);
      return this.listItemCompletions(parentKey, partial, params.textDocument.uri);
    }

    const colonIndex = currentLineText.indexOf(':');

    if (colonIndex === -1) {
      // ── Key completion ────────────────────────────────────────────────────
      return this.keyCompletions(frontmatterNode.body, currentLineText, schema);
    }

    // ── Scalar value completion ───────────────────────────────────────────────
    const key = currentLineText.slice(0, colonIndex).trim();
    const afterColon = currentLineText.slice(colonIndex + 1);
    const rawPartial = afterColon.trimStart();
    // Strip enclosing quotes for prefix matching, but keep raw text for filtering
    const partial = rawPartial.replace(/^['"]/, '').replace(/['"]$/, '');

    return this.valueCompletions(key, partial, schema, params.textDocument.uri);
  }

  // ── Key completions ─────────────────────────────────────────────────────────

  private keyCompletions(
    body: string,
    currentLineText: string,
    schema: ReturnType<typeof getFrontmatterSchema>,
  ): CompletionItem[] {
    if (!schema) return [];
    const partial = currentLineText.trimStart();

    // Collect keys already present so we can omit them.
    const usedKeys = new Set<string>();
    const keyRegex = /^([a-zA-Z_][a-zA-Z0-9_]*):/gm;
    let match: RegExpExecArray | null;
    while ((match = keyRegex.exec(body)) !== null) {
      usedKeys.add(match[1]);
    }

    return Object.entries(schema.fields)
      .filter(([key]) => !usedKeys.has(key) && key.startsWith(partial))
      .map(([key, fieldSchema]): CompletionItem => {
        const typeStr = Array.isArray(fieldSchema.type)
          ? fieldSchema.type.join(' | ')
          : fieldSchema.type;
        const tags = [
          fieldSchema.required ? 'required' : undefined,
          fieldSchema.deprecated ? 'deprecated' : undefined,
        ].filter(Boolean);
        const detail = tags.length > 0 ? `${typeStr} (${tags.join(', ')})` : typeStr;

        return {
          label: key,
          kind: CompletionItemKind.Field,
          detail,
          documentation: fieldSchema.description
            ? { kind: 'markdown', value: fieldSchema.description }
            : undefined,
          insertText: key + ': ',
        };
      });
  }

  // ── Value completions for scalar fields ─────────────────────────────────────

  private async valueCompletions(
    key: string,
    partial: string,
    schema: ReturnType<typeof getFrontmatterSchema>,
    uri: string,
  ): Promise<CompletionItem[]> {
    if (!schema) return [];

    // Layout field — list available layout files
    if (key === 'layout' || key === 'layout_name') {
      const names = (await this.getLayoutNamesForURI?.(uri)) ?? [];
      return names
        .filter((n) => n.startsWith(partial))
        .map((n) => ({ label: n, kind: CompletionItemKind.Value }));
    }

    // Fields with enum values
    const fieldSchema = schema.fields[key];
    if (fieldSchema?.enumValues) {
      return fieldSchema.enumValues
        .map(String)
        .filter((v) => v.startsWith(partial))
        .map((v) => ({
          label: v,
          kind: CompletionItemKind.Value,
        }));
    }

    return [];
  }

  // ── List-item completions (authorization_policies, etc.) ─────────────────────

  private async listItemCompletions(
    parentKey: string | undefined,
    partial: string,
    uri: string,
  ): Promise<CompletionItem[]> {
    if (parentKey === 'authorization_policies') {
      const names = (await this.getAuthPolicyNamesForURI?.(uri)) ?? [];
      return names
        .filter((n) => n.startsWith(partial))
        .map((n) => ({ label: n, kind: CompletionItemKind.Value }));
    }
    return [];
  }
}

/** Walk backwards through the YAML body up-to-cursor to find the key that
 *  owns the current list block (the first non-indented, non-list-item line). */
function findParentKey(bodyUpToCursor: string): string | undefined {
  const lines = bodyUpToCursor.split('\n');
  // Start from the second-to-last line (the current line is the last)
  for (let i = lines.length - 2; i >= 0; i--) {
    const line = lines[i];
    if (!line.trim()) continue; // skip blank lines
    // List item line — keep walking up
    if (/^\s+-/.test(line)) continue;
    // Top-level key line
    const match = line.match(/^([a-zA-Z_][a-zA-Z0-9_]*):/);
    if (match) return match[1];
    // Anything else — stop
    break;
  }
  return undefined;
}
