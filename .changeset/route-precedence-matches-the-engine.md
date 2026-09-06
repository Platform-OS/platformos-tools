---
'@platformos/platformos-common': minor
---

Score route precedence the way the platform engine does

`calculatePrecedence` is a port of `Router::RouteBuilder::Route` and had drifted from it in four
ways. Measured by extracting the engine's own `slug_components_weighted_size` and
`calculate_precedence` from `app/models/router/route_builder/route.rb`, running them under Ruby,
and comparing against this function over 40 slugs in html and non-html formats: **30 of the 80
pairs disagreed**. They now all agree.

- **A wildcard was scored as a parameter.** The engine's only test is `start_with?(':')`, so a
  `*` falls to its `else` and weighs 100, like a hardcoded component — and takes no
  optional-group discount. The port gave it 10, or 1 inside a group. `a/*` scored -10999 here
  against the engine's -19999.
- **Empty path components were skipped.** The engine weighs them 100 like anything else that is
  not a `:param`, so `a//b` is 300 there and was 200 here. Trailing empties are still dropped,
  because Ruby's `String#split` drops them and JavaScript's does not — that difference is now
  handled explicitly rather than by accident.
- **A bare trailing dot was not treated as a format.** `File.extname('a.')` is `"."` in Ruby, so
  the engine applies its -1; the port required a non-empty extension.
- **An empty slug was treated as root.** `ROOT_SLUGS` is `%w[/]`, so only `/` earns the root
  adjustment. An empty slug now scores one lower for the same format.

WHY IT MATTERS: `RouteTable` sorts candidates by precedence, so these scores decide which page the
tooling believes serves a URL. Where they disagreed with the engine, any answer derived from them
— `MissingPage` above all — could differ from what the platform actually does.

BEHAVIOUR CHANGE. Route ordering shifts for any app whose page slug contains a wildcard, a doubled
slash, or a trailing dot, and for an empty slug. Every other slug shape is unaffected, which the
same differential confirms.
