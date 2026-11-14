# Fonts

Three SIL Open Font License 1.1 families. `full/` has the Latin subsets as
they come from the Fontsource packages (`@fontsource-variable/*`, version
5.3); the page loads the files beside this note, which
`scripts/subset-fonts.py` cuts down from them to the characters the page
uses (printable ASCII and the few others listed in `chars.json`), with
Fraunces's SOFT axis, which the page leaves at 0, taken out.

| File | Family | Axes | From |
| --- | --- | --- | --- |
| `fraunces.woff2` | Fraunces | weight | `full/fraunces-latin-soft-normal.woff2` |
| `figtree.woff2` | Figtree | weight | `full/figtree-latin-wght-normal.woff2` |
| `jetbrains-mono.woff2` | JetBrains Mono | weight | `full/jetbrains-mono-latin-wght-normal.woff2` |

If the page gains a character that is not in `chars.json`, the build says
so (`scripts/check-fonts.mjs`): run `python3 scripts/subset-fonts.py`
(it needs fonttools and brotli) and commit the fonts it writes.

The Fraunces license is in `OFL-Fraunces.txt`; Figtree and JetBrains Mono
ship under the same license (https://openfontlicense.org).
