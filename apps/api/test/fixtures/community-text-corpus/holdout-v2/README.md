# Independent clean text holdout v2

Reviewer and author: cc68-tea. This corpus was sealed in a private worktree before the
reviewer inspected the builder's frozen text repair or ran screening against these entries.
The coordinator received the seal before repair inspection.

Corpus SHA-256: `3bd993bb4135ed1db8a3f1d21f652978373662459538d96ed16517900857bebf`.

The digest covers the seven locale JSON files. Sort repository-relative paths, concatenate
each path, NUL, its file SHA-256 and LF, then hash the UTF-8 bytes. Per-file hashes, counts,
authoring policy identity and freeze time are in `freeze-manifest.json`.

| Language | Captions | Alt texts | Gated clean | Deliberate review |
| -------- | -------: | --------: | ----------: | ----------------: |
| de       |      200 |       200 |         400 |                 0 |
| en       |      200 |       200 |         400 |                 0 |
| es       |      200 |       200 |         400 |                 0 |
| fr       |      200 |       200 |         400 |                 0 |
| it       |      200 |       200 |         400 |                 0 |
| pt       |      200 |       200 |         400 |                 0 |
| tr       |      200 |       200 |         400 |                 0 |

Each locale contains fresh ordinary fashion copy about repairs, garment construction,
hand-me-downs, accessories, outfit choices, transit and community events. Alt text describes
visible garments and settings. Some scene concepts and translations recur across locales.
These synthetic examples provide coverage; their Wilson interval does not establish a
population false-positive rate.

The importer enforced field lengths, trimmed and deduplicated text, assigned IDs, applied
the authoring policy's deliberate-review labels and recorded baseline list hashes. Review
also checked NFKC/casefold uniqueness and disjointness from each language's in-sample clean
half and v1. The `frozenAgainst` fields record the authoring baseline. The later run product
records the repaired policy and input set actually evaluated. Both identities remain visible.

The frozen corpus may fail. Keep it unchanged after evaluation. A future repair requires
another independent version. The old v1 files and their red evidence remain available.

To import a future reviewed version from fresh `holdout-<language>.json` inputs:

```sh
node scripts/build-community-text-corpus.mjs --import-holdout <private-input-dir> --holdout-version holdout-v3
```

The importer keeps existing versions unchanged. `active-holdout.json` selects the corpus
used by both the evaluation and readiness evidence. Run `npm run community:screening:text`
after committing and freezing the inputs. This command enforces the 1% Wilson 95% upper
bound, zero unexpected withholds, the in-sample regression gate and disguised-term coverage.
