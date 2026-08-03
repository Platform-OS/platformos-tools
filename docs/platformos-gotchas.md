# platformOS gotchas — measured, not assumed

Behaviours of the platformOS runtime and deploy converter that surprised us while
building and evaluating `platformos-mcp-supervisor`. **Every entry here was
measured against a live instance**, not read from documentation — several exist
precisely *because* the documentation says something else, or says nothing.

Two oracles are used throughout, and which one applies is never a matter of taste:

| Oracle | Question it answers | Use it for |
|---|---|---|
| `pos-cli deploy --dry-run` | will the **converter** accept this file? | syntax, deployability |
| `/api/app_builder/liquid_exec` | what does the **runtime** do with this value? | semantics, types, raises |

A converter rejection fails the **whole changeset**, not just the offending file.
A runtime raise breaks one render. They are different failure modes and the
dry-run oracle outranks the runtime one *for syntax only*.

---

## 1. `hash_assign` is stricter than "it needs an object"

The runtime enforces **three** rules, and they fail at different times. Rule zero is
syntactic and fires before the other two are even considered.

### Rule 0 — the target must end in a BRACKET subscript

```liquid
{% hash_assign h['k']   = 'v' %}   ✅
{% hash_assign h["k"]   = 'v' %}   ✅
{% hash_assign h.a['b'] = 'v' %}   ✅   a dot is fine when it is not the LAST subscript
{% hash_assign h[k]     = 'v' %}   ✅   variable key
{% hash_assign h[0]     = 'v' %}   ✅
{% hash_assign h['k-1'] = 'v' %}   ✅

{% hash_assign h.k      = 'v' %}   ❌
{% hash_assign h.a.b    = 'v' %}   ❌
{% hash_assign h['a'].b = 'v' %}   ❌
```

The failure is `Liquid::SyntaxError: Syntax Error in 'hash_assign' - Valid syntax:
hash_assign hash[key] = value`, raised at **parse** time — so the template cannot be
rendered *and* the deploy converter rejects it, taking the whole changeset. Measuring only
the converter understates it.

Only the *last* subscript matters, which is easy to get wrong in both directions:
`h.a['b']` works and `h['a'].b` does not.

This is the **one place in Liquid** where `h['k']` and `h.k` are not interchangeable —
everywhere else they are the same lookup — so it is a rule you will violate by habit.

**And it bites formatters hardest.** Any tool that normalises `h['k']` to `h.k`, which is
the conventional Liquid style, silently converts a working file into one that cannot be
parsed, with no error at any layer. `prettier-plugin-liquid` did exactly that until this
was found. If you regenerate Liquid from an AST, this position needs a special case.

### Rules 1 and 2 — the container type and the subscript kind

The target must be a Hash or an Array, **and the subscript must match the container**.

```liquid
{% assign x = 'a,b' | split: ',' %}
{% hash_assign x[0]   = 'v' %}   ✅ renders
{% hash_assign x['k'] = 'v' %}   ❌ "x is an Array, expected index, k was provided"

{% parse_json x %}{"a":1}{% endparse_json %}
{% hash_assign x['k'] = 'v' %}   ✅ renders
```

Telling an author to "convert it to a Hash" when they have a working Array is
wrong advice. The remedy depends on the container.

**A Hash is a valid target and must never be reported.** Filters returning a
Hash — `parse_json`, `extract_url_params`, `find`, and 10 more — are fine.

### Nested subscripts are evaluated in full

```liquid
{% assign x = 'a,b' | split: ',' %}
{% hash_assign x[0]['k'] = 'v' %}   ❌ "x[0] is a, expected Hash or Array"
```

The runtime complains about the **intermediate** value, not the variable. And
the obvious inverse rule does **not** hold:

```liquid
{% parse_json x %}{"a": {}}{% endparse_json %}
{% hash_assign x['a'][0] = 'v' %}   ✅ renders
```

So "the last subscript must match the container" is false. Anything modelling
nested targets needs real element types, not a heuristic.

### `hash_assign` does not convert the target

Writing into an Array leaves it an Array. A later key-assign on the same
variable is still wrong.

---

## 2. YAML: duplicate keys deploy, and silently lose data

`pos-cli deploy --dry-run` **accepts** a repeated key — at the top level, inside
a property, and in a translations file. Refusing it is a false block.

The runtime resolves **last-wins**. Measured by deploying a translations file and
reading it back:

```yaml
en:
  k: FIRST
  k: SECOND        # -> "SECOND"
```

An absent key renders `translation missing: en.…`, which is what makes the
result conclusive rather than a fallback.

**Consequence:** the file works and the earlier value is gone with no error
anywhere. Worth a warning; never worth blocking.

### The platform reads YAML **1.1**, and your parser almost certainly reads 1.2

This is the single highest-yield sentence in this document. Ruby Psych/libyaml
implements YAML **1.1**; npm `yaml`, PyYAML's 1.1-but-not-quite, and every
JS-flavoured intuition you have are not it. Three separate defects in this repo — a
false block, a false positive, and a documented silence whose stated reason was
wrong — all fell out of nobody having written it down.

**Keys that look different and are ONE key** (measured, Psych 5.3.1):

| YAML | Resolves to |
|---|---|
| `yes:` and `true:` | both boolean `true` — the second value silently wins |
| `TRUE:` and `true:` | both boolean `true` |
| `014:` and `12:` | YAML 1.1 **octal** — both `Integer(12)` |
| `null:` and `~:` | both `nil` |
| `+1:` and `1:` | both `Integer(1)` |
| `0x10:` and `16:` | both `Integer(16)` |
| `1:30:` and `5400:` | YAML 1.1 **sexagesimal** — both `Integer(5400)` |

**Keys that look the same and are TWO keys:**

| YAML | Why |
|---|---|
| `1:` and `"1":` | a number and a string. One key in a JS object, two in a Ruby Hash |
| `1:` and `1.0:` | `Integer(1)` and `Float(1.0)`. Ruby Hash uses `eql?`, which is class-sensitive: `1.eql?(1.0)` is **false** |
| `on:` and `off:` | both booleans, different values |
| `y:` and `n:` | **strings** in Psych, despite the YAML 1.1 spec listing them as booleans |
| `<<:` twice | merge keys, repeatable |

That last row is why this has to be **measured** rather than derived: Psych does not
implement the 1.1 spec's full boolean set. Reading the spec gives the wrong answer.

**Two traps in the "is it one key" test itself**, both measured against
`Psych.safe_load(…).size`, which is the only trustworthy way to ask:

- **`-0.0:` and `0.0:` are ONE key**, even though `-0.0.inspect != 0.0.inspect`.
  `Float#eql?` is value-based, so signed zeros collapse — unlike the `Integer`/`Float`
  split one row above, where the *classes* differ. Comparing keys by class plus
  `inspect` gets this exactly backwards.
- **Psych's boolean resolution is case-insensitive well beyond the spec's three
  spellings.** `TrUe:` is boolean `true`, and collides with `true:`, `TRUE:`, `yes:`,
  `on:` and `oN:`. Likewise `.Inf:` and `.INF:` are both `Float::INFINITY` and collide
  with `.inf:`; `.NAN:` collides with `.nan:`. Any list of "the boolean spellings"
  short enough to write down is wrong.
- **`.nan:` twice is ONE key, yet two NaN objects are not `eql?`.** So even *object
  identity* is not a safe proxy for what a document does:
  `YAML.load(".nan: x\n.nan: y").size == 1`, while `(0.0/0.0).eql?(0.0/0.0)` is `false`.
  Every proxy for the question disagrees with the question somewhere. Load the two-key
  document and read `.size`.
- **A parser's "source text" may exclude the quotes.** In npm `yaml`, `"yes"` has
  `source: 'yes'` — identical to the plain `yes` that Psych resolves to a boolean. The
  only reliable discriminator is the scalar's *type* (`QUOTE_DOUBLE` vs `PLAIN`).
  Deciding from source text reports `yes:` and `"yes":` as one key, which Psych keeps as
  two.

Compare keys by **what the platform's parser does with a document containing both**,
never by source text, never by your own parser's resolution, and never by a proxy for
Ruby's equality.

### A multi-line quoted scalar may be indented at or below its own key

Another 1.1-vs-1.2 lexer divergence, and a more likely one to hit than the stray CR
because it is something a human writes on purpose:

```yaml
en:
  greeting: "Hello
  world"          # continuation aligned with the KEY, not deeper
```

Psych loads this as `{"en" => {"greeting" => "Hello world"}}` and the converter accepts
it. A YAML 1.2 parser requires a flow scalar's continuation to be indented *more* than
its parent and reports `Missing closing " quote`. Both quote styles behave the same, and
column-0 continuation is accepted too. Indent the continuation by one more space than
the key and every parser agrees.

**The control that separates this from a real error:** an *unquoted* multi-line value
(`a: x` / newline / `y`) is rejected by Psych as well. It is specifically the quoted
form that is legal.

### A lone `\r` is a line break to the platform and not to npm `yaml`

YAML 1.1 lists a bare carriage return as a line break; 1.2 does not. So
`a: 1\rb: 2\n` — one stray CR pasted into an ordinary LF file — is two mappings to
the platform and one long line to a 1.2 parser, which reports
`Nested mappings are not allowed in compact mappings`. The converter accepts the
file in all four YAML types. Note that `parseDocument(source, { version: '1.1' })`
does **not** fix this: the option changes scalar resolution, not line-break lexing.

### A quoted string may be continued at ANY indentation, including column 0

The second consequence of the same 1.1-vs-1.2 split, and a much more likely one to hit
than a stray `\r`, because it is what a translator does with a long string:

```yaml
en:
  greeting: "Hello
  world"            # aligned with the key   -> "Hello world"
  farewell: "Bye
world"              # column 0              -> "Bye world"
```

YAML **1.2 requires the continuation to be indented deeper than its key**; Psych does not
care. So a 1.2 parser reports `Missing closing "quote` on a file the converter accepts.

Two traps for anyone writing tooling here:

- **The error code is not diagnostic.** npm `yaml` reports `MISSING_CHAR` for this *and*
  for a genuinely unterminated quote, an unquoted multi-line value, and bad block
  indentation. Suppressing the code trades one false block for several false approvals.
- **Folding matters.** The value is *not* the raw text: YAML collapses the break and the
  continuation's leading whitespace to a single space, so `"trailing  \n  x"` is
  `"trailing x"`. Reconstructing the string by joining lines gives the wrong value.

Neither `version: '1.1'` nor `strict: false` changes any of this — measured, all four
combinations.

### Other YAML that is legal and must not be refused

Multi-document files, complex keys (`? [a, b]`), flow collections, `.inf`/`.nan`,
octal/hex scalars, timestamps, empty values, explicit nulls. All accepted by the
converter; 50 of 52 probed shapes were clean.

**Genuinely invalid YAML, however, is a hard converter rejection** and takes the
entire changeset with it — including unterminated flow sequences and
tab-indented frontmatter.

---

## 3. Filter return types: the docs are incomplete and occasionally empty

`filters.json` from the documentation API carries 167 filters. Reality differs:

- **Six real filters are absent entirely** — `sum`, `where`, `find`,
  `find_index`, `has`, `h`. All work. Several are names a developer reaches for
  by habit from Shopify Liquid.
- **`array_index_of`** ships `return_type: [{ type: "" }]` — an empty string.
- **`new_line_to_br`** ships no `return_type` at all.

### Aliases are real filters

The docset expands aliases into first-class entries, so 140 documented reporting
rows become **165+ usable names**. `to_json`, `t`, `t_escape`, `select`,
`sort_by`, `reject`, `limit`, `compact`, `flatten`, `any`, `map_attributes`,
`markdownify` and more appear nowhere in `filters.json` as filters in their own
right. Any analysis over "the filters" that reads only top-level entries misses
them.

### The runtime class is often not what the docs call it

Measured across 173 names — every one still *behaves* as its documented type:

| Documented | Actual runtime class |
|---|---|
| `string` | `String`, `ActiveSupport::SafeBuffer` (8 html-producing filters), `JOSE::EncryptedBinary` (`jwe_encode`), and `nil` (`asset_name_to_raw_url` on a missing asset) |
| `number` | `Integer` **or** `Float` (`round`, `time_diff`, `fractional_to_amount`) |

**Type by behaviour, not by class name.**

### Unusual `return_type` spellings, all measured

| Spelling | Filters | Runtime | `hash_assign` |
|---|---|---|---|
| `date` | `to_date`, `date_add`, `add_to_date` | `Date` | raises on both subscripts |
| `datetime` | `to_time` | `Time` | raises on both |
| `time` | `add_to_time` | `Time` | raises on both |
| `array of arrays` | `parse_csv`, `parse_csv_rc` | `Array` | key raises, **index renders** |
| `string, nil` | `localize`, `l` | union | not narrowable — a union, not a type |

### Date/time unit arguments are **plural**

```liquid
{{ d | date_add: 1, 'days' }}     ✅      {{ d | date_add: 1, 'day' }}     ❌
{{ t | add_to_time: 1, 'hours' }} ✅      {{ t | add_to_time: 1, 'hour' }} ❌
```

The error is `third argument must be valid unit, received: day`.

---

## 4. JSON literals in `{% assign %}` must use double quotes

```liquid
{% assign x = '{"k": 1}' %}   ✅
{% assign x = "{'k': 1}" %}   ❌ rejected by the deploy converter
```

Single-quoted JSON is a **converter rejection**, so it fails the whole changeset
— not a runtime error you discover on one page.

---

## 5. A filter in a tag has THREE possible fates, not two

This section said "accepted" and "refused" for a long time, and it was wrong in the most
expensive way available: **accepted by the converter is not the same as applied by the
runtime.** Measuring only `--dry-run` answers "does this deploy", never "does this do
anything". Two claims, one sentence — and only one of them had been measured.

| Fate | Where | What it costs you |
|---|---|---|
| **Rejected** | a condition — `if`/`unless`/`elsif`, either side of a comparison, `for … in`, a range bound, an index-lookup interior | converter rejection, fails the **whole changeset** |
| **Silently ignored** | every other platformOS tag operand or argument value | the file deploys and renders, and your filter **does nothing** |
| **Applied** | `{{ }}`, `{% assign %}`, `{% echo %}`, `{% print %}`, `{% return %}`, `{% session %}`, and a trailing filter on `{% function %}` / `{% graphql %}` (which filters the RESULT) | works as written |

**How the middle row was established.** `no_such_filter_xyz` raises
`Liquid::UndefinedFilter` wherever the runtime evaluates it, so a construct that renders
clean proves the filter was never seen. 15 positions measured against
`/api/app_builder/liquid_exec`, each paired with a filterless control that renders clean,
plus 5 positive controls where the same probe **does** raise. A second lens agreed: a
wrong-arity real filter (`| upcase: 1, 2, 3`), which raises `Liquid::ArgumentError` in
`{{ }}`, is also silent in a tag operand.

The decisive one needs no error at all — it is directly observable:

```liquid
{% case 'a' | upcase %}{% when 'A' %}FILTER APPLIED{% when 'a' %}FILTER IGNORED{% endcase %}
```

renders **`FILTER IGNORED`**.

**Why.** Ruby Liquid parses these markups with its own scanner, and `TagAttributes`
captures `QuotedFragment`, which explicitly **excludes `|`**. The platform never sees the
filter as part of the value. That is also why the boundary is *which position inside the
tag*, not which tag: the applying positions are the ones where the platform parses the
whole value as a Liquid variable.

**So the repair is the same for both failing rows** — `{% assign %}` the filtered value on
a preceding line and pass the assigned variable:

```liquid
{% assign key = 'k' | append: '1' %}
{% cache key %}…{% endcache %}
```

`platformos-check` reports the middle row as a **`FilterWithoutEffect` warning**: it must
not block, because the file deploys and renders, but silence would let you ship a template
that does something other than what it says.

**Accepted by the converter, and silently ignored at runtime:**

```liquid
{% cache 'k' | append: '1' %}…{% endcache %}
{% log 'msg' | upcase %}
{% yield 'slot' | upcase %}
{% redirect_to '/p' | append: '/x' %}
{% spam_protection 'x' | downcase %}
{% response_headers '{}' | upcase %}
{% render 'p' with 'a' | upcase %}
{% render 'p' for 'a,b' | split: ',' %}
{% case 'a' | upcase %}{% when 'A' | downcase %}…{% endcase %}
{% cycle 'a' | upcase, 'b' %}
```

**Argument values parse the same way** — named, positional and hash-pair alike, in every
tag that has arguments. Each was deployed with the filter and again without it, and each
is equally ignored at runtime:

```liquid
{% render 'p', v: 'a' | upcase %}            {% log 'm', type: 't' | upcase %}
{% log 'm', 'x' | upcase %}                  {% cache 'k', expire: 60 | plus: 1 %}
{% include_form 'p', v: 'a' | upcase %}      {% sign_in user_id: 1 | plus: 0 %}
{% background source_name: 'x' | upcase %}   {% redirect_to '/p', status: 301 | plus: 0 %}
{% spam_protection 'r', v: 'a' | upcase %}   {% context k: 'a' | upcase %}
{% transaction isolation: 'a' | upcase %}    {% form k: 'a' | upcase %}
{% theme_render_rc 'p', v: 'a' | upcase %}   {% render 'p', filter: type: 'a' | upcase %}
{% export x, namespace: 'n' | upcase %}      {% session k = 'a' | upcase %}
{% response_status 200 | plus: 0 %}
```

One exception worth knowing, because it is the only place the two readings compete:
`{% function res = 'p', arg: 3 | dig: 'results' %}`. Here the trailing filter belongs to
the function's **result**, and it really is applied — same shape as `{% return %}`. The
same holds for `{% graphql %}`. So a filter after the last argument of those two tags is
not dead code.

**Refused — and a refusal here is a converter rejection that fails the whole
changeset, not a runtime error on one page:**

```liquid
{% if 'a' | upcase == 'A' %}          ❌   both sides of a comparison, too
{% unless 'a' | upcase == 'A' %}      ❌
{% elsif 'a' | upcase == 'A' %}       ❌
{% for i in 'a,b' | split: ',' %}     ❌   the `in` source
{% for i in (1..'3' | plus: 0) %}     ❌   a range bound
{% assign x = a['k' | upcase] %}      ❌   an index-lookup interior
```

The repair is always the same: `{% assign %}` the filtered value on a preceding
line, then test or iterate the assigned variable.

**Neither oracle answers this alone, which is the whole lesson.**
`/api/app_builder/liquid_exec` accepts every construct above, including all six the
converter rejects — verified with controls proving it does report real syntax errors. So
for *does it deploy*, the converter is the only authority. But the converter cannot tell
you whether the filter runs, and reading its acceptance as approval is what produced the
wrong version of this section. Ask both questions, and name which oracle answered which.

---

## 6. Tags Shopify Liquid taught you that platformOS does not have

Editor tooling for platformOS is forked from Shopify's, so a tag can be highlighted,
parsed and autocompleted while the platform has never heard of it. The converter is the
only authority, and its refusal fails the **whole changeset**.

| Construct | What the converter says |
|---|---|
| `{% layout 'application' %}` | `Unknown tag 'layout'` — platformOS chooses a layout from **frontmatter** (`layout: application`), never from a tag. Swept all 46 tag names the parser knows: this is the only one the platform does not implement |
| `{% content_for 'slot' %}` | `'content_for' tag was never closed` — it is a **block** tag here. `{% content_for 'slot' %}…{% endcontent_for %}` deploys |

`{% rollback %}` goes the other way and is more permissive than it looks: it deploys
bare, outside any `{% transaction %}`.

---

## 7. GraphQL: the converter enforces the full validation rules, not just the schema

Three things many GraphQL servers tolerate are hard rejections here — each confirmed by
deploying the file, twice:

```graphql
query q($limit: Int!, $unused: Int) { … }   ❌ a declared, unused variable
fragment unused on X { … }                  ❌ a declared, unused fragment
```

A document containing **only** fragments and no operation is rejected too. Fragments,
nested fragments, inline fragments, aliases, `@include`/`@skip` and `__typename` are all
fine; a cyclic fragment spread is correctly rejected.

---

## 8. Tags that take no markup — and one that raises anyway

Five tags are declared as taking no markup at all: `break`, `continue`, `else`, `try` and
**`rollback`**. Two things about them are easy to get wrong.

**Trailing text is silently ignored, not rejected.** `{% rollback something %}` behaves
exactly like `{% rollback %}`, and `{% break something %}` renders. The platform never
reads it, so tooling that regenerates Liquid from an AST will drop it — harmlessly, since
nothing depends on it.

**`{% rollback %}` parses everywhere and RAISES outside a transaction.** This is the trap:

```liquid
{% rollback %}                                        parses ✅  raises at runtime ❌
                                                      "rollback performed outside of transaction"

{% transaction %}{% rollback %}{% endtransaction %}   parses ✅  works ✅
                                                      raises ActiveRecord::Rollback, which IS the rollback
```

So a linter must not refuse `{% rollback %}` on syntax grounds — it is valid Liquid. Whether
it is *usable* depends on an enclosing `{% transaction %}`, which is a semantic question and
a separate one. `platformos-check` deliberately does not report the outside-a-transaction
case today; that is a known gap, not a judgement that the code is fine.

Note also that `ActiveRecord::Rollback` surfacing from `liquid_exec` is **success**, not a
syntax error. Scoring any raise as a failure would mark the working case broken.

---

## 9. Multi-file changes must be validated together

A partial created in the same changeset as its caller does not exist on disk yet.
Validated file-by-file, the caller is reported as rendering a missing partial —
a false block on a coherent change. Overlay every buffer at once.

---

## 10. Filter arity is only knowable from the runtime

`filters.json` cannot answer it: of 167 filters, 123 carry a `parameters[]`
array, **zero** mark any parameter `required`, and `slice`/`replace` carry no
parameters at all. Its counts also disagree with reality — `add_to_time` lists
three parameters while the runtime accepts `1..3`.

The runtime states it exactly:

```
wrong number of arguments (given 1, expected 2..3)
```

**Counting rule**, established by probe:

```
given = 1 (the piped input) + positional count + (1 if any named argument)
```

A whole group of named arguments collapses into a **single** trailing hash:
`{{ 'abc' | upcase: a: 1, b: 2, c: 3 }}` is "given 2", not 4.

---

## 11. Translations

- Missing key renders literally as `translation missing: en.some.key` — it does
  not raise and does not render empty.
- Translation files are merged per file; syncing a file with `en: {}` removes
  the keys it previously contributed.
- `t` and `t_escape` are aliases of `translate` / `translate_escape` and are
  absent from `filters.json` as top-level entries.

---

## 12. Operational gotchas

- **`data/filters.json` is re-downloaded on every build.** The docs-updater's
  `postbuild` fetches it from `documentation.platformos.com`. Editing it locally
  is reverted by the next build — and looks like a fix that silently isn't.
- **`pos-cli sync --file-path` on a deleted file is a silent no-op.** It does not
  push a deletion. Removing a file from an instance needs
  `DELETE /api/app_builder/marketplace_releases/sync` with `path` and
  `primary_key`, or a full deploy.
- **`liquid_exec` aborts the whole template at the first raise.** Probing several
  constructs in one request measures only the first failure — send one per
  request.
- **A raise whose message embeds a binary value comes back HTTP 406 with no
  body.** `gzip_compress`, `ecdh_compute` and `hkdf` return binary, so the
  runtime's own complaint is unencodable. Treating any non-2xx as "rendered"
  turns this into a phantom finding.
- **`type_of` is the cheapest runtime type oracle** — `{{ x | type_of }}` returns
  `String`, `Integer`, `Float`, `Boolean`, `Array`, `Hash`, `Date`, `Time`,
  `Range`, `null`.

### `pos-cli deploy --dry-run` fails intermittently, and the failure looks like a rejection

Roughly one probe in fifteen came back without `Dry run completed` and **without any
Liquid error in the output**. Three separate constructs were scored as converter
rejections on the first pass and came back ACCEPTED 2/2 and 3/3 on re-probe — one of
them would have inverted a finding.

If you are using the dry run as an oracle, **require a positive error message**, not
merely the absence of the success line, and repeat every rejection. Treating "did not
succeed" as "was refused" silently manufactures findings.

### Formatting platformOS Liquid can break it

`prettier-plugin-liquid` regenerates source from the AST rather than editing text, so
anything the AST does not carry is deleted on the next format — in the author's own
file, with no error at any layer. Measured across all 46 tag names and 112 constructs
on plugin 0.0.17 under prettier 2.8.8 and 3.8.1: exactly one construct comes back
changed in a way that matters, and it is the `hash_assign` bracket-to-dot rewrite in
§1, which turns a working file into a whole-changeset deploy failure.

Two related traps worth knowing:

- The plugin ships two printers and picks between them from the prettier version **it**
  resolves, not the one you called. Inside a workspace checkout where the plugin has its
  own `prettier` devDependency, it can hand prettier 2's doc builders to prettier 3 and
  crash with `Unexpected doc.type 'concat'` — an artefact of the checkout, not of the
  published package.
- The printer inserts and moves whitespace-control markers (`-%}`, `{{-`) freely to
  preserve rendering while it reflows. That is intended; a diff that treats it as
  corruption will bury the one change that is real.

### `pos-cli check` and the MCP supervisor are NOT the same linter

They share a codebase lineage and nothing else at runtime. `pos-cli` resolves published
npm packages under its own `node_modules`; the supervisor runs whatever build it was
pointed at. Measured on the current machine, the CLI loads
`platformos-check-common@0.0.20` / `liquid-html-parser@0.0.18` and the supervisor loads
`0.0.19` / `0.0.17` — the CLI's copies carry the **higher version number and different
content**, including ~40 Shopify theme checks (`app-block-*`, `valid-schema`,
`settings_schema`) that the platformOS tree does not have, and missing three that it
does (`yaml-syntax-error`, `duplicate-yaml-key`, `filter-arity`).

Consequences, all measured by running the same buffer through both:

- **`pos-cli check` does not check YAML syntax at all.** An unterminated quote, a
  tab-indented mapping and a bad indent in a schema or translations file are all silent
  — and all three are hard converter rejections that fail the whole changeset.
- **It misses a filter in an `{% if %}` or `{% unless %}` condition**, which the
  converter rejects. It does catch the `{% for … in %}` and index-lookup forms.
- **It still reports filters in `cache`/`log`/`yield`/`redirect_to` operands as syntax
  errors**, which the converter accepts.

So a green `pos-cli check` is not the same claim as a green supervisor run, in either
direction. Check which build each one is loading before comparing their output —
`readlink -f node_modules/@platformos/platformos-check-common` answers it in one line.

---

## 13. What is *not* validated, and must not be assumed

- The **shape** of a model schema. An unknown property deploys fine.
- Nested `hash_assign` subscripts (`x[0]['k']`) — a known, bounded gap.
- `hash_assign` on a variable never assigned in the file. In a partial the
  variable may legitimately arrive as a render argument, so silence is correct.
- Return types for the six undocumented filters, in the **language server** —
  it types them all as `string` by default.
