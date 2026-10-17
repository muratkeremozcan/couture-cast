# LDNOOBW term lists: attribution

The seven files in this directory (`en`, `es`, `fr`, `de`, `it`, `pt`, `tr`) are
copied byte for byte from the "List of Dirty, Naughty, Obscene, and Otherwise Bad
Words" repository and are used under the Creative Commons Attribution 4.0
International licence (CC-BY-4.0). The full licence text is in `LICENSE`, also
copied unmodified from the same commit.

| Field         | Value                                                                              |
| ------------- | ---------------------------------------------------------------------------------- |
| Work          | List of Dirty, Naughty, Obscene, and Otherwise Bad Words                           |
| Authors       | Shutterstock, Inc. and the LDNOOBW contributors                                    |
| Source        | <https://github.com/LDNOOBW/List-of-Dirty-Naughty-Obscene-and-Otherwise-Bad-Words> |
| Pinned commit | `5faf2ba42d7b1c0977169ec3611df25a3c08eb13` (2020-07-13, the tip of `master`)       |
| Retrieved     | 2026-10-16                                                                         |
| Licence       | CC-BY-4.0, <https://creativecommons.org/licenses/by/4.0/>                          |
| Files used    | `en`, `es`, `fr`, `de`, `it`, `pt`, `tr`, `LICENSE`                                |

## Changes made

None to these files. They are vendored unmodified, and
`npm run verify:community-screening-lists` fails when any of them drifts from the
hashes recorded in `source.json` for the pinned commit (`--remote` additionally
re-fetches each file from that commit and compares the bytes).

The runtime term lists under `../../terms-v1/` are a derived work. The generator
(`scripts/verify-community-screening-lists.mjs --write`) merges each upstream list
with this repository's graded overlay (`../../graded-overlay-v1/`), drops entries
the screener cannot index or that the repository allow list
(`../../allow-list-v1.json`) clears, and records every dropped entry and the
reason for it inside the generated file. Upstream entries carry no category or
severity, so each upstream-only entry is recorded as `profanity` at `medium`
severity, which routes a match to human review and never blocks automatically.

## Known limits of the upstream lists

Shutterstock compiled the lists to keep words out of image-search autocomplete
("what wouldn't we want to suggest that people look at?"), which is a broader
purpose than abuse screening. They were not reviewed by native speakers for this
product, and they are uneven in size: English carries 403 entries and German
carries 66. They also contain ordinary words that a fashion caption uses
legitimately (Italian `pesce` and `regina`, Portuguese `saco` and `comer`, English
`nude` and `panties`), which is what the repository allow list exists to handle.
The readiness evidence records the absence of native-speaker review as a named
limitation.
