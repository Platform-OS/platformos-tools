import { path } from '@platformos/platformos-check-common';
import {
  AugmentedLocation,
  AppGraphRootRequest,
} from '@platformos/platformos-language-server-common';
import { Position, Range, Uri, window, workspace } from 'vscode';
import { BaseLanguageClient } from 'vscode-languageclient';

export function openLocation(ref: AugmentedLocation) {
  if (ref.exists === false || !ref.position) {
    window.showTextDocument(Uri.parse(ref.uri));
    return;
  }

  workspace.openTextDocument(Uri.parse(ref.uri)).then((doc) => {
    window.showTextDocument(doc, {
      selection: new Range(
        new Position(ref.position.start.line, ref.position.start.character),
        new Position(ref.position.end.line, ref.position.end.character),
      ),
      preserveFocus: true,
      preview: true,
    });
  });
}
