# CC-6.8 text holdout v5

Reviewer: cc68-tea. Status: **RETIRED TO DEVELOPMENT after FAIL**. Italian has 4/1000 withheld,
with a Wilson 95% upper bound of 1.023956%. The release gate remains closed.
The coordinator released v5 against frozen round 4. The corpus and active-selector
switch are committed, the private worktree is removed, and all sealed bytes remain
unchanged. The coordinator has retired v5 to development. Full case handoff is authorized
only after this retirement is committed in the ledger and this report.

## Seal and order

- Corpus SHA-256: `0c0f4d4843ddb608151495ca6e17e0c82858d35dcb35be0b9cc04b39208bc889`
- Freeze-manifest SHA-256: `9282161138137f0b85ab3b1613ed931f5836603412f5face574362d81883700b`
- Seal time: `2026-10-26T10:12:02.574860+00:00`
- Authoring base and v4 retirement commit:
  `1061931acef45b1c59ccfbe1c7dc0e7cb601fa50`.
- Wilson preregistration: `621bd3fa0ce191344e2a727968676eadbf6c695f`.
- Independence amendment: `406b3e13b6b788bb81d57be4677bb5ee3132976a`.
- Retirement eligibility correction:
  `b02e82022731b963366306b9c4eecb4c89da1fa1`.

The corpus digest covers the seven locale JSON files. Its recipe is SHA-256 over
sorted UTF-8 lines: repository-relative path, NUL, file SHA-256, LF. The separate
manifest pins those files, 49 authoring files, README, diversity evidence and
35 historical locale files. There are 59 sealed files including the manifest.
The manifest's release flags describe the state at sealing and remain immutable.

The sealed hash and per-locale counts were sent to cc66-coordinator through Herdr
before release. The coordinator then explicitly released commit and evaluation
against round 4 manifest SHA-256
`87dbf164c74999949e87508a76b1bc5c5327f52fe5a3177e8ff414cfd3a2057a`.
It contains 38 frozen paths. All 38 matched before and after the run and in repair
commit `9783ee4701a93b164e13cee2f0aa36aef5eb8d69`. V5 contents and results were
not given to cc68-impl. Earlier round3 targets were superseded without inspection.

## Retirement before new work

Commit `1061931acef45b1c59ccfbe1c7dc0e7cb601fa50` first recorded v4's retirement
in `holdout-gate.md` and the v4 report. After that commit, root sent cc68-impl all
15 full v4 false-positive cases, fields, expected/actual dispositions and reason
codes under explicit coordinator authorization. The packet and delivery receipt
remain in the v4 run directory. V4 is immutable failed development evidence.

V4 failed de6/1000, it4/1000 and pt5/1000 under the unchanged Wilson bound;
en/es/fr/tr were zero. All 21 frozen round-2 repair files matched after its run,
and the pre/product/post input-set hash was stable. V3 remains non-independent
historical evidence. Neither version can support a new release claim.

## Exact authorship and rotation

| Locale | V4 author              | V5 author              | V5 source rows |
| ------ | ---------------------- | ---------------------- | -------------- |
| de     | `/root/edge_paths`     | cc68-tea, `/root`      | 1 through 1000 |
| en     | cc68-tea, `/root`      | `/root/general_review` | 1 through 1000 |
| es     | `/root/edge_paths`     | `/root/general_review` | 1 through 1000 |
| fr     | `/root/general_review` | `/root/edge_paths`     | 1 through 1000 |
| it     | `/root/general_review` | `/root/edge_paths`     | 1 through 1000 |
| pt     | `/root/general_review` | cc68-tea, `/root`      | 1 through 1000 |
| tr     | `/root/edge_paths`     | `/root/general_review` | 1 through 1000 |

Every locale changes author. Before any Portuguese text existed, the private plan
amended its assignment from edge_paths to root so three authors could work in
parallel. Edge_paths wrote no Portuguese wording and supplied a semantic peer
review. German rows 1 through 500 are captions and 501 through 1000 are alt texts. Portuguese
odd rows are captions and even rows are alt texts. The other sources interleave
fields; their attestations and imported entries retain exact membership.
Source row n maps one-to-one to `<locale>-holdout-v5-<n padded to three digits>`.

Every complete item was individually composed and persisted literally. There
are no fragment banks, templates, combinatorial assembly, scripted model calls
or text-generating programs. Prior corpus wording was not translated or adapted.
Helpers copy complete authored items unchanged and measure them. Root retains
prior released repair knowledge and v2/v3/v4 outcomes; the existing authors retain
their earlier authoring/review context. All stayed blind to the new repair and
v5 screening output. Own eligibility gate paths were separately edited and
unit-tested during authoring, without opening repair implementation or data.

## Final diversity and counts

| Locale | Clean gated n | Caption / alt text | Distinct concepts | Five-word affected | Largest concept |
| ------ | ------------: | -----------------: | ----------------: | -----------------: | --------------: |
| de     |          1000 |          500 / 500 |               443 |           8 (0.8%) |        8 (0.8%) |
| en     |          1000 |          500 / 500 |               240 |           0 (0.0%) |        8 (0.8%) |
| es     |          1000 |          500 / 500 |               200 |           0 (0.0%) |       10 (1.0%) |
| fr     |          1000 |          500 / 500 |               232 |           0 (0.0%) |        8 (0.8%) |
| it     |          1000 |          500 / 500 |               215 |           0 (0.0%) |        8 (0.8%) |
| pt     |          1000 |          500 / 500 |               479 |           2 (0.2%) |       10 (1.0%) |
| tr     |          1000 |          500 / 500 |               245 |           0 (0.0%) |        9 (0.9%) |

All seven meet both 1% diversity caps. All 7,000 complete texts are globally
NFKC/casefold unique, with zero whole-text duplicates, historical equality
matches or field-length violations. Every item has at least seven words.
Exactly 1,000 items per locale remain gated clean, with zero deliberate-review
labels. The documented write-once importer ran once. All imported texts, fields
and sequential IDs equal the complete source items exactly.

Five-word overlap uses NFKC then casefold, contiguous Unicode letter/number runs,
and both fields together. Every participating item counts once. An independent
Unicode-category scanner agrees with the regular-expression measurement for
all seven locales. German has four repeated sequences with two members each;
Portuguese has one two-member sequence. The other locales have none. Full
sequences, item IDs and memberships are retained in `diversity.json`.

The concept unit is the underlying scenario or visual motif. Paraphrases and
changes limited to colour, fabric or incidental setting stay together. Every
item has editorial concept labels; multiple substantive concepts are retained.
One representative maximum group per locale is below. Every tied maximum has
an English gloss and exact item IDs in the sealed diversity evidence.

| Locale | Representative most-repeated concept                                                                             | Tied maximum groups |
| ------ | ---------------------------------------------------------------------------------------------------------------- | ------------------: |
| de     | Tiny embroidered, woven or numbered identification marks distinguish paired or similar accessories.              |                   4 |
| en     | A guide aligning or spacing the buttons along a garment front.                                                   |                  10 |
| es     | A garment hem divided into projecting triangular points.                                                         |                   8 |
| fr     | Bag pocket arranged for easy reach                                                                               |                  18 |
| it     | Adjustment cord concealed within a garment compartment                                                           |                  38 |
| pt     | Readable personal marks or letters reproduced as textile decoration, consolidated across stitching and printing. |                   1 |
| tr     | Unspecified small or plain flowers used as a decorative visual motif                                             |                   1 |

The 35 historical files are the seven in-sample locale files and seven files
under each of v1, v2, v3 and v4, across all languages. Their private bytes match
the immutable authoring base. Whole-file and clean-entry hashes are pinned.
The earlier main-checkout hash comparison also matched before further development.
Current repair data stayed unopened until release. After release, all 35 pinned
historical clean entry sets matched. The round 4 disguised development expansion
changed the root corpus files while preserving every in-sample clean entry.

## Pre-seal editorial corrections

The source evidence preserves authors' synonym consolidations, complete-item
revisions, old/new hashes, peer findings and resolutions. These precede screening.

- German: the peer identified a 12-item seam-reinforcement family crossing bags
  and a coat pocket. Root replaced complete pairs with different motifs; final
  peer review is READY at the sealed source hash.
- English and French: authors consolidated near-neighbour scenarios. Root reviewed
  their concept catalogs and complete memberships of every maximum group.
- Spanish: eight conservative merges retain cross-carrier motif groups. Root
  reviewed all eight maximum groups and their full wording/membership.
- Italian: root found interior reveal split by viewing/cleaning purpose. The author
  consolidated it and wholly reauthored two four-item groups as bicycle-rack bag
  carrying and thumb-loop cuffs. Final source has 215 concepts and maximum 8.
- Portuguese: peer review consolidated reversible components across clothing,
  footwear, jewellery, cleaning and transfer, plus flowers, handwriting and spirals.
  Root individually reauthored 40 distinct complete items versus the preserved
  peer-review snapshot. The final families include removable components 8, plain
  flowers 8, written memories 8, broader typography 10, woven strips 8 and coils 8.
  The structural boundary between reversible component exchange and permanently
  sewn restoration is recorded with the specific cases. All findings are READY.
  The revision log reconstructs the full old source SHA from final rows and diffs.
- Turkish: a 13-item plain-flower union crossed techniques and botanical labels.
  The author wholly rewrote four items as seed capsules, leaving nine plain-flower
  items. Additional anatomical botanical aliases remain conservatively grouped.

These are authored synthetic examples. The measured caps and editorial judgments
are necessary diversity checks; they do not establish random production sampling,
statistical independence or production representativeness. Reviewers retain the
semantic adequacy decision.

## Gate arithmetic and power

The unchanged gate is the two-sided Wilson 95% upper bound at most 1% per language.
At n=1000, zero through three withheld items pass; four fail. The upper bounds at
three and four are 0.878301% and 1.023956%. At n=400, only zero errors passes;
one error gives 1.402329%. This increase permits a few errors while retaining the
same confidence ceiling. Under an independent binomial model, a true 0.1% rate
passes with probability 98.1073% per locale at n=1000, versus 67.0186% at n=400.
These operating characteristics remain conditional on the model assumptions.
In-sample zero withholds, disguised zero passes and all count minimums are unchanged.

## Retirement guard before evaluation

Commit `b02e82022731b963366306b9c4eecb4c89da1fa1` fixes Astra A2 and Opus H3.
The mandatory evaluator reads `holdout-retirements.json` and rejects retired v3
or v4 before constructing the screener or producing a measurement. An unretired
version requires a matching seal identity. Existing corpus-byte and aggregate
seal checks remain in place. All 14 eligibility tests and 18 unchanged Wilson
arithmetic tests pass; lint passes. The initial syntax-only reproduction failed
eight eligibility cases, including both retired versions. Exactly five owned
paths were committed. No v5 corpus or active-selector change was included.
Gate evidence is in `runs/cc68-tea-retired-holdout-gate/verification.json`.

## Released round 4 evaluation

The v5 commit is `a15918219581bfa7d75249a655caf1dc66639401`, with exactly 59
sealed corpus/source files plus the active selector. Staging occurred immediately
before the explicit-path commit; unrelated repair paths were excluded. All 60
committed paths still match. The builder then committed exactly 33 changed repair
paths as `9783ee4701a93b164e13cee2f0aa36aef5eb8d69`. Independent verification
checked all 38 frozen Git objects and current files, plus preservation of all 60
corpus/selector paths in that repair commit. Both commits include the existing
eligibility guard commit as an ancestor.

The private worktree `/tmp/cc68-tea-holdout-v5` was removed after all 59 sealed
files were verified in the corpus commit and before evaluation. No containers or
database operations occurred. A release-entry probe first selected retired v4 and
failed at the retirement guard without writing a measurement. The normal run
accepted the sealed, unretired v5 identity and exercised all seven language gates.

Command from `apps/api`: `node ../../node_modules/vitest/vitest.mjs run
src/modules/community/community-text-corpus.evaluation.spec.ts --reporter=default
--reporter=json --outputFile=<v5-run>/result.json`, with
`NODE_OPTIONS=--conditions=development` and
`COMMUNITY_SCREENING_RUN_PRODUCT_DIR=<v5-run>`.
The absolute argument array and timestamps are in `evaluation-state.json`.

| Locale | Withheld / gated n | Wilson 95% upper bound | Verdict |
| ------ | -----------------: | ---------------------: | ------- |
| de     |           0 / 1000 |           0.382675849% | PASS    |
| en     |           3 / 1000 |           0.878301405% | PASS    |
| es     |           0 / 1000 |           0.382675849% | PASS    |
| fr     |           0 / 1000 |           0.382675849% | PASS    |
| it     |           4 / 1000 |           1.023955628% | FAIL    |
| pt     |           0 / 1000 |           0.382675849% | PASS    |
| tr     |           3 / 1000 |           0.878301405% | PASS    |

Overall verdict: **FAIL**. The command exited 1 with 51 passing and 1 failing test
out of 52. Italian's four withheld items cross the unchanged 1% upper bound;
English and Turkish each have three and correctly pass the preregistered rule.
Every in-sample clean half has zero withholds. Each language contains 1426
disguised cases; all 9982 were withheld, with zero bypasses. Deliberate-review,
count minimum and seal checks passed. No cohort, threshold, label or wording was
changed after observing these results, and no rerun was used to select a result.

The 451-file input-set hash was identical before, in the product and afterward:
`f2afbd8b52f0fb8787fb302681c5bae8f281462dcf5c5ecb5e9a2b1172ac4851`.
Policy SHA-256:
`1939048dab9a8a8f0503caf2ce6f375a68c70e8220f259b8a735e5662c68aee9`.
Text engine identity: `adr013-text:policy-v2@1939048dab9a`.

Evidence directory: `runs/cc68-tea-text-holdout-v5/`. It retains the release and
committed-repair verifications, explicit owned paths and commit proof, worktree
removal receipt, source-start/source-end file pins, command log, Vitest result,
measurement product and `review-summary.json`. The summary records all 38 frozen
repair hashes matching before/after, all 59 sealed corpus files unchanged, all 60
committed corpus/selector paths preserved and all 35 historical clean sets stable.
The per-locale verdicts and real commit SHAs were sent to cc66-coordinator before
pushing as instructed. The coordinator subsequently retired v5 to development. Its corpus, failed run
and original seal stay immutable. This disposition is committed with the ledger
before any case handoff. The builder is authorized to receive the ten full
English, Italian and Turkish false-positive cases and reason codes after that
commit. A delivery receipt will remain in the v5 run evidence. V5 cannot support
a future release claim after development disclosure. V6 will be freshly authored
at2000 items per locale under the unchanged Wilson gate and independence rules,
with rotated authors and a new seal before round5 inspection.

## Retirement order and v6 transition

The coordinator explicitly directed retirement after the v5 result. Record the
retirement in `holdout-retirements.json` and this report in the same commit before
sending any full false-positive case to cc68-impl. The gate document preregisters
n=2000 arithmetic and power for v6 before its authoring or evaluation. The active
v5 selector remains in place and must fail the retirement guard until a fresh
eligible version is committed after release. V6 source creation, sealing and
release are separate; v5 remains frozen development history.

Retirement commit: `11dda5768f1f2463876b7245e7eb8deb7a458e0d`.
After that commit, all ten English/Italian/Turkish cases and exact reason codes
were delivered to cc68-impl. The receipt is in the v5 run directory. The remote
branch was verified at that same retirement commit after pushing, including the
v5, eligibility and frozen round4 repair commits. No v6 content was included.
