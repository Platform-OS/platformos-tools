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

The runtime enforces **two** rules, not one: the target must be a Hash or an
Array, **and the subscript must match the container**.

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

Compare keys by **resolved type and value under the platform's parser**, never by
source text and never by your own parser's resolution.

### A lone `\r` is a line break to the platform and not to npm `yaml`

YAML 1.1 lists a bare carriage return as a line break; 1.2 does not. So
`a: 1\rb: 2\n` — one stray CR pasted into an ordinary LF file — is two mappings to
the platform and one long line to a 1.2 parser, which reports
`Nested mappings are not allowed in compact mappings`. The converter accepts the
file in all four YAML types. Note that `parseDocument(source, { version: '1.1' })`
does **not** fix this: the option changes scalar resolution, not line-break lexing.

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

## 5. Where a filter is allowed is a rule, not a symmetry

Filters are accepted wherever the platform parses a full Liquid **Variable**, and
refused wherever it parses a bare **Expression**. That follows each Ruby tag's own
markup parsing, so it is not derivable from what looks consistent — every row below
was settled with `pos-cli deploy --dry-run`, each construct deployed with the filter
and again without it so a bad fixture is distinguishable from a real refusal.

**Accepted:**

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

Named-argument values, hash-pair values and `session` take one too.

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

**The runtime is not the oracle for this.** `/api/app_builder/liquid_exec` accepts
every construct above, including all six the converter rejects — verified with
controls proving it does report real syntax errors. For a syntax question the
converter is the only authority.

---

## 6. Multi-file changes must be validated together

A partial created in the same changeset as its caller does not exist on disk yet.
Validated file-by-file, the caller is reported as rendering a missing partial —
a false block on a coherent change. Overlay every buffer at once.

---

## 7. Filter arity is only knowable from the runtime

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

## 8. Translations

- Missing key renders literally as `translation missing: en.some.key` — it does
  not raise and does not render empty.
- Translation files are merged per file; syncing a file with `en: {}` removes
  the keys it previously contributed.
- `t` and `t_escape` are aliases of `translate` / `translate_escape` and are
  absent from `filters.json` as top-level entries.

---

## 9. Operational gotchas

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

---

## 10. What is *not* validated, and must not be assumed

- The **shape** of a model schema. An unknown property deploys fine.
- Nested `hash_assign` subscripts (`x[0]['k']`) — a known, bounded gap.
- `hash_assign` on a variable never assigned in the file. In a partial the
  variable may legitimately arrive as a render argument, so silence is correct.
- Return types for the six undocumented filters, in the **language server** —
  it types them all as `string` by default.
