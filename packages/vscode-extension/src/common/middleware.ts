import { workspace } from 'vscode';
import type { Middleware } from 'vscode-languageclient';

export const middleware: Middleware = {
  provideDocumentLinks: async (document, token, next) => {
    const links = await next(document, token);
    if (!links) return links;
    const results = await Promise.all(
      links.map(async (link) => {
        if (!link.target) return link;
        try {
          await workspace.fs.stat(link.target);
          return link;
        } catch {
          // File doesn't exist — remove so ctrl+click falls through to
          // go-to-definition, which VS Code handles natively (opens empty editor).
          return null;
        }
      }),
    );
    return results.filter((l) => l !== null);
  },
};
