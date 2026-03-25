import { DocumentLink, Location, LocationLink, Uri, window, workspace } from 'vscode';
import type { Middleware } from 'vscode-languageclient';

export function openFileMissingCommand(uriString: string) {
  window.showTextDocument(Uri.parse(uriString));
}

export function buildMiddleware(): Middleware {
  return {
    provideDocumentLinks: async (document, token, next) => {
      const links = await next(document, token);
      if (!links) return links;
      return Promise.all(
        links.map(async (link) => {
          if (!link.target) return link;
          try {
            await workspace.fs.stat(link.target);
            return link;
          } catch {
            const commandArg = encodeURIComponent(JSON.stringify([link.target.toString()]));
            return new DocumentLink(
              link.range,
              Uri.parse(`command:platformosLiquid.openFile?${commandArg}`),
            );
          }
        }),
      );
    },
    provideDefinition: async (document, position, token, next) => {
      const result = await next(document, position, token);
      if (!result) return result;
      const defs = Array.isArray(result) ? result : [result];
      const first = defs[0];
      if (!first) return result;
      const targetUri =
        'targetUri' in first ? (first as LocationLink).targetUri : (first as Location).uri;
      try {
        await workspace.fs.stat(targetUri);
        return result;
      } catch {
        await window.showTextDocument(targetUri);
        return null;
      }
    },
  };
}
