import {
  Range,
  DocumentOnTypeFormattingParams,
  TextEdit,
  Position,
} from 'vscode-languageserver-protocol';
import { AugmentedSourceCode } from '../../documents';
import { BaseOnTypeFormattingProvider } from '../types';

export class BracketsAutoclosingOnTypeFormattingProvider implements BaseOnTypeFormattingProvider {
  /**
   * Autoclosing UX for `{{`/`{%`, including the whitespace-stripping forms.
   *
   * What we want:
   * 1. `{{` autocloses to `{{ | }}` (cursor at |), `{%` to `{% | %}`
   * 2. `{{-` autocloses to `{{- | -}}`
   * 3. typing `-` at `{{| drop }}` gives `{{- drop }}`
   *
   * VS Code's `autoclosingPairs` cannot express this: with a space in the pair set, typing a
   * space at `{{| drop }}` sees a space after the cursor, closes there, and produces
   * `{{  }}drop }}`. The `-` forms misbehave the same way.
   *
   * So the pairs include the closing space (`{{| }}`, `{%| %}`) and this OnTypeFormattingProvider
   * fixes them up afterwards: `{{| }}` -> `{{ | }}`, `{{ -| }}` -> `{{- | -}}`, and likewise for
   * `{%`. With `editor.onTypeFormatting: false` the user types the `-` on both sides manually.
   */
  onTypeFormatting(
    document: AugmentedSourceCode,
    params: DocumentOnTypeFormattingParams,
  ): TextEdit[] | null {
    const textDocument = document.textDocument;
    const ch = params.ch;
    // position is position of cursor so 1 ahead of char
    const { line, character } = params.position;
    // This is an early return to avoid doing currentLine.at(-1);
    if ((ch === ' ' && character <= 2) || character <= 1) return null;
    const currentLineRange = Range.create(Position.create(line, 0), Position.create(line + 1, 0));
    const currentLine = textDocument.getText(currentLineRange);
    const charIdx = ch === ' ' ? character - 2 : character - 1;
    const char = currentLine.at(charIdx);
    switch (char) {
      // here we fix {{| }} with {{ | }}
      // here we fix {%| %} with {% | %}
      case '{':
      case '%': {
        const chars = currentLine.slice(charIdx - 1, charIdx + 4);
        if (chars === '{{ }}' || chars === '{% %}') {
          return [TextEdit.insert(Position.create(line, charIdx + 1), ' ')];
        }
      }

      // here we fix {{ -| }} to {{- | -}}
      // here we fix {% -| }} to {%- | -%}
      case '-': {
        // remember 0-index means 4th char
        if (charIdx < 3) return null;

        const chars = currentLine.slice(charIdx - 3, charIdx + 4);
        if (chars === '{{ - }}' || chars === '{% - %}') {
          // Here we're being clever and doing the {{- -}} if the first character
          // you type is a `-`, leaving your cursor in the middle :)
          return [
            // Start with
            //   {{ - }}
            //     ^ start replace
            //       ^ end replace (excluded)
            // Replace with '- ', get
            //   {{- }}
            TextEdit.replace(
              Range.create(Position.create(line, charIdx - 1), Position.create(line, charIdx + 1)),
              '- ',
            ),
            // Start with
            //   {{ - }}
            //      ^ char
            //        ^ insertion point
            // Insert ' ' , get
            //   {{ - -}}
            // Both together and you get {{- -}} with your cursor in the middle
            TextEdit.insert(Position.create(line, charIdx + 2), '-'),
          ];
        }
      }
    }
    return null;
  }
}
