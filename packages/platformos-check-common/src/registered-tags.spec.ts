import { describe, expect, it } from 'vitest';

import { REGISTERED_TAGS } from './registered-tags';

/**
 * TASK-56. `REGISTERED_TAGS` is transcribed from the platform's `register_tag` registry by
 * `scripts/verify-registered-tags.mjs`. It decides what `UnknownTag` accepts, so it is
 * dangerous in both directions — a fictional name silences a real misspelling, and a
 * missing real name BLOCKS working code.
 *
 * These tests cannot read the platform repo (it is a separate checkout, absent in CI), so
 * they pin the properties that hold WITHOUT it — the ones a hand-edit or a broken
 * extraction would change.
 */
describe('Unit: REGISTERED_TAGS', () => {
  it('is exactly the vocabulary the platform registers', () => {
    // Pinned whole. Every name here is a name the write gate stops refusing, so adding
    // one must be a deliberate edit HERE after re-running the generator against a real
    // checkout — never a quiet append.
    expect(REGISTERED_TAGS.map((tag) => tag.name)).toEqual([
      'background',
      'cache',
      'content_for',
      'context',
      'context_rc',
      'execute_query',
      'export',
      'form',
      'function',
      'function_rc',
      'graphql',
      'hash_assign',
      'include_form',
      'log',
      'parse_json',
      'print',
      'query_graph',
      'redirect_to',
      'render_form',
      'response_headers',
      'response_status',
      'return',
      'return_rc',
      'rollback',
      'session',
      'sign_in',
      'sign_in_rc',
      'spam_protection',
      'theme_render_rc',
      'transaction',
      'try',
      'try_rc',
      'yield',
    ]);
  });

  it('records the handler class for every tag, because identity is derived from it', () => {
    // Not decoration. `undocumentedTagEntries` decides what is an ALIAS by comparing
    // handler classes, so an entry with a missing or malformed handler would silently
    // become a standalone tag and lose its "use `{% x %}` instead" remedy.
    const malformed = REGISTERED_TAGS.filter((tag) => !/^Liquify::Tags::\w+Tag$/.test(tag.handler));

    expect(malformed).toEqual([]);
  });

  it('groups the names that share a handler — the alias facts everything else derives from', () => {
    // THE LOAD-BEARING ASSERTION of this file. Two names on one handler are one tag under
    // two spellings; that is what makes `context_rc` an alias of `context` rather than a
    // separate tag that happens to look similar. Pinned as groups so a regeneration that
    // dropped a handler, or transcribed the wrong class, changes this list.
    const byHandler = new Map<string, string[]>();
    for (const tag of REGISTERED_TAGS) {
      byHandler.set(tag.handler, [...(byHandler.get(tag.handler) ?? []), tag.name]);
    }
    const shared = [...byHandler.entries()]
      .filter(([, names]) => names.length > 1)
      .map(([handler, names]) => [handler, names.sort()])
      .sort();

    expect(shared).toEqual([
      ['Liquify::Tags::ContextTag', ['context', 'context_rc']],
      ['Liquify::Tags::FunctionTag', ['function', 'function_rc']],
      ['Liquify::Tags::IncludeFormTag', ['include_form', 'render_form']],
      ['Liquify::Tags::ReturnTag', ['return', 'return_rc']],
      ['Liquify::Tags::SignInTag', ['sign_in', 'sign_in_rc']],
      ['Liquify::Tags::TryTag', ['try', 'try_rc']],
    ]);
  });

  it("keeps the registry's own comments, from ABOVE the line as well as beside it", () => {
    // Deprecation is read from these strings and from nothing else, so losing one turns a
    // superseded alias into a tag we silently recommend by omission.
    //
    // `render_form` is why the generator reads the preceding line at all: its
    // "semi-backwards compatibility" note sits ABOVE the call, not after it. An extraction
    // that only captured trailing comments would produce a plausible file in which the one
    // genuinely-superseded alias looked unmarked — so this pins both placements.
    const annotated = REGISTERED_TAGS.filter(
      (tag) => tag.comment !== undefined || tag.precedingComment !== undefined,
    );

    expect(annotated).toEqual([
      { name: 'function_rc', handler: 'Liquify::Tags::FunctionTag', comment: 'TODO: remove' },
      {
        name: 'hash_assign',
        handler: 'Liquify::Tags::HashAssignTag',
        comment: 'DEPRECATED: Use {% assign %} instead',
      },
      {
        name: 'render_form',
        handler: 'Liquify::Tags::IncludeFormTag',
        precedingComment: 'For semi-backwards compatibility, for now...',
      },
      { name: 'return_rc', handler: 'Liquify::Tags::ReturnTag', comment: 'TODO: remove' },
      { name: 'sign_in_rc', handler: 'Liquify::Tags::SignInTag', comment: 'TODO: remove' },
    ]);
  });

  it('registers each name once', () => {
    // Ruby would let the file register a name twice, last-wins. The generator refuses to
    // write that, because two entries for one name make the alias grouping above ambiguous.
    const names = REGISTERED_TAGS.map((tag) => tag.name);

    expect(names.filter((name, i) => names.indexOf(name) !== i)).toEqual([]);
  });
});
