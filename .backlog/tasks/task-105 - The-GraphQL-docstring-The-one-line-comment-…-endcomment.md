---
id: TASK-105
title: The GraphQL """docstring"""/ The one-line comment … endcomment
status: To Do
assignee: []
created_date: '2026-09-05 15:57'
updated_date: '2026-09-05 15:57'
labels: []
dependencies: []
priority: medium
ordinal: 84000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
1. The GraphQL """docstring"""

  What I wrote. I like documenting stored operations, so each read query opened like this:

  """
  Loads one checklist by its database id, with every section and item.
  Private access path. The caller MUST still compare user_id...
  """
  query checklist_find($id: ID!) {

  What the gate said. All five files came back status: "ok", must_fix_before_write: false, and — importantly — impact: "computed". That last field means the supervisor didn't skip them; it
  parsed them as GraphQL and built a dependency graph. A confident green.

  What the converter said. The deploy died before uploading anything:

  Validation failed:
  graphql/checklists/find.graphql:          syntax error, unexpected QUERY ("query") at [11, 1]
  graphql/checklists/find_by_token.graphql: syntax error, unexpected QUERY ("query") at [8, 1]
  graphql/checklists/search_by_owner.graphql: ... at [8, 1]
  graphql/items/find.graphql:               ... at [8, 1]
  graphql/sections/find.graphql:            ... at [7, 1]

  Every position is the query keyword on the line right after the closing """.

  Why. GraphQL has two grammars. In the type-system grammar (SDL — type, input, enum, field definitions) a leading string literal is a description and is legal. In the executable grammar —
  the one a stored query is written in — there is no description production at all. So the parser reads a block string, then hits query, and has no rule that allows an operation there.

  The clean control: records/create.graphql, update.graphql and delete.graphql had no docstring and were the only three that didn't error. Same directory, same deploy, same parser — the
  docstring is isolated as the cause.

  Why it's worth recording. Not because the rule is exotic, but because of the gap between the two oracles. AGENT.md §6 already says "Will it deploy? → the converter. Only this," and §4
  lists what validate_code blocks on. This is a concrete, reproducible instance of that gap, and an expensive one: five files rejected meant the whole changeset was refused, so the schema
  and everything else in that deploy went nowhere.

  ---

  2. The one-line comment … endcomment

  {% liquid
    comment Sharing starts off, so a real token must not open the list yet. endcomment
    function denied = 'queries/checklists/authorize', id: '', token: token, full: false

  What happened. validate_code — clean, both files. Deploy:

  views/partials/tests/checklists/authorize_test.liquid:  Body syntax is invalid
    (Liquid syntax error: 'comment' tag was never closed)
  views/partials/tests/checklists/cross_list_test.liquid: same

  Why. Inside {% liquid %}, each line is one tag invocation: a tag name plus its markup. comment is a block tag. So the parser takes comment as the tag and swallows the rest of the line —
  including the trailing endcomment — as that tag's markup, then scans following lines for a closing endcomment tag and never finds one.

  This is the same underlying constraint as the entry directly above it in that file ("A statement may not wrap across lines inside {% liquid %} — one statement, one line"), which is why I
  filed it there. The corollary nobody had written down: a block tag needs its opener and closer on separate lines. The multi-line form I'd used earlier in header.liquid and the commands
  worked fine throughout.

  One precision worth flagging: the behaviour is measured — single-line fails, multi-line works, on this converter. The mechanism in that entry ("everything after it on the line is its
  markup") is my reading of the error, not something I isolated with a further experiment. By the provenance convention in .agent/gotchas/INDEX.md the explanatory sentence is closer to
  [inferred] than [measured-here]. The remedy is unaffected either way, but I'd rather you know which half is proven.

  ---

  The detail that makes these easy to confuse

  I hit "'comment' tag was never closed" twice in this session, from two different causes.

  The first time was in header.liquid, where I'd written a properly multi-line comment whose text contained {% for … in %}. The %} inside the prose closed the comment block early. That one
  is already documented — gotchas/silent-failures.md: "A delimiter inside a Liquid comment ends the block early." I violated a known rule and only recognised it from the error.

  The second was the single-line form above — no delimiters involved at all. Identical error message, unrelated cause. That's precisely why I wrote it down: someone hitting that message will
  find the existing entry, check their comment for %}, find none, and be stuck. Now there's a second entry to check.

  Both files use [measured-here], the marker the index defines as "reproduced in this environment during the audit," and both name the oracle that caught it — which is the convention the
  rest of those files follow.
<!-- SECTION:DESCRIPTION:END -->
