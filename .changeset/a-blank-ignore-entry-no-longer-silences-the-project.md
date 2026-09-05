---
'@platformos/platformos-check-common': patch
---

Skip a blank `ignore` entry instead of letting it match every file

An empty string in an `ignore` list was rewritten to a match-everything pattern, so the whole
project was skipped and the run reported clean. Measured on a real project with two broken pages
and `ignore: ["", "modules/vendor/**"]`: zero offenses, exit code fine, nothing to say why.
Removing the blank entry gave two. That is the worst shape a defect in this code can take — an
ignored file produces no offense for anyone to miss.

A blank entry is now skipped before it is compiled, the way `.gitignore` skips a blank line —
verified against git itself, which still applies the surrounding patterns and ignores nothing
extra. The entries either side of it keep working, and a list holding nothing but blanks now
compiles no matcher at all, so `hasIgnorePatterns` correctly reports there is nothing to match.

Applies to the top-level `ignore` and to a check's own `ignore` alike. Only a truly empty entry
is affected: a whitespace-only one is still compiled and, as before, matches nothing.
