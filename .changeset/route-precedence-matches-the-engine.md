---
'@platformos/platformos-common': minor
---

Score route precedence the way the platform engine does

`calculatePrecedence` is a port of `Router::RouteBuilder::Route` and had drifted from it in six
ways, across three parts of the calculation. Measured by extracting the engine's own `slug_components_weighted_size` and
`calculate_precedence` from `app/models/router/route_builder/route.rb`, running them under Ruby,
and comparing against this function over a corpus enumerated exhaustively to length three over
`. / a ( ) : *`, plus realistic slugs — 844 cases in html and non-html. **72 disagreed.** They now
all agree.

- **A wildcard was scored as a parameter.** The engine's only test is `start_with?(':')`, so a
  `*` falls to its `else` and weighs 100, like a hardcoded component — and takes no
  optional-group discount. The port gave it 10, or 1 inside a group. `a/*` scored -10999 here
  against the engine's -19999.
- **Empty path components were skipped.** The engine weighs them 100 like anything else that is
  not a `:param`, so `a//b` is 300 there and was 200 here. Trailing empties are still dropped,
  because Ruby's `String#split` drops them and JavaScript's does not — that difference is now
  handled explicitly rather than by accident.
- **The "format in the last component" test was wrong three ways.** The engine asks
  `File.extname(slug.split('/').last || '')`. The port stripped parentheses first, took the last
  component with `lastIndexOf('/')`, and required a non-empty extension. So it disagreed on a
  bare trailing dot (`a.`, where `File.extname` returns `"."`), on a leading run of dots (`..`
  and `...`, where it returns `""`), on a component containing a paren (`(.json)`), and on a
  trailing slash (`a.json/`, where Ruby's split drops the empty and sees `a.json`).
- **An empty slug was treated as root.** The engine's root-slug list holds only `/`, so only `/` earns the root
  adjustment. An empty slug now scores one lower for the same format.

WHY IT MATTERS: `RouteTable` sorts candidates by precedence, so these scores decide which page the
tooling believes serves a URL. Where they disagreed with the engine, any answer derived from them
— `MissingPage` above all — could differ from what the platform actually does.

BEHAVIOUR CHANGE. Route ordering shifts for a page slug containing a wildcard, a doubled slash, a
trailing dot, a leading run of dots, a parenthesis in its last component, or a trailing slash, and
for an empty slug. Every other shape is unaffected, which the same differential confirms.
