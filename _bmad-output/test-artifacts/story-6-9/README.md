# Story 6.9 evidence

Updated: 2026-10-31: the X-IPAD-ANCHOR proof is keyed on the anchor source blobs.

This folder holds the committed evidence for CC-6.9 native platform sharing that CI cannot
produce. The spec is
`_bmad-output/implementation-artifacts/spec-6-9-native-platform-sharing.md` (AC5).

## X-IPAD-ANCHOR: iPad popover proof

On an iPad (simulator or device), with the story68 dev client built from the commit under test,
open the composer, tap Share and confirm the share sheet presents as a popover whose arrow points
at the Share button. Take one screenshot of that state.

Put the screenshot in this folder as a lowercase `.png` file, then write the record from it:

```sh
node scripts/lib/story69-ipad-evidence.mjs record \
  --screenshot ipad-anchor-proof.png --os 18.1 --environment simulator
```

`--environment` is `simulator` or `device`. `--os` is the iPadOS version shown in Settings or in
the simulator's device name. The commit defaults to the checkout's HEAD; pass `--commit <sha>` to
name the build you proved. The command reads the git blob SHA of each anchor source from that
commit, computes the screenshot SHA256, writes `ipad-anchor-proof.json` and verifies it. Commit
both files.

Only record what you observed. If the sheet did not anchor to Share, do not write a record: the
check keeps failing, which is the correct state.

The check passes while every anchor source (`IPAD_ANCHOR_SOURCES` in the check) in HEAD has the
blob SHA the record names, so any change to those three files needs a re-record. The recorded
commit is provenance: a squash merge leaves it outside the default branch's history, and the proof
stays valid as long as the anchor sources match. Reading HEAD's tree needs no history, so a
depth-1 CI checkout runs the check.

## Record format

`ipad-anchor-proof.json` holds exactly these keys; any other key fails the check.

| Key                 | Value                                                            |
| ------------------- | ---------------------------------------------------------------- |
| `test`              | `X-IPAD-ANCHOR`                                                  |
| `deviceClass`       | `iPad`                                                           |
| `environment`       | `simulator` or `device`                                          |
| `osVersion`         | iPadOS version, for example `18.1` or `26`                       |
| `commit`            | full 40-character SHA of the proven build                        |
| `sources`           | each anchor source path mapped to its git blob SHA at `commit`   |
| `result`            | `anchored_to_share`                                              |
| `screenshot.file`   | screenshot file name in this folder (lowercase, `.png`, no path) |
| `screenshot.sha256` | SHA256 of that file, lowercase hex                               |
| `recordedAt`        | ISO 8601 UTC time, for example `2026-10-30T21:00:00.000Z`        |

The screenshot must not show personal data: use the owned story68 test account and the seeded
outfit.

## The check

`scripts/lib/story69-ipad-evidence.mjs` validates the record and the screenshot it names. Its test
file, `scripts/lib/story69-ipad-evidence.test.mjs`, runs in the `native-harness` node suite (the
`browser-acceptance` job on pull requests). The test named
`U-HARNESS-IPAD-EVIDENCE: the committed X-IPAD-ANCHOR record and screenshot pass the check` fails
until the record and screenshot are committed here. Run it alone with:

```sh
node scripts/lib/story69-ipad-evidence.mjs
```
