# Individually authored clean text holdout v5

V4 failed its released evaluation and became development data in commit
`1061931acef45b1c59ccfbe1c7dc0e7cb601fa50`. Its corpus and failed result remain
immutable history. The coordinator authorized the builder to receive its full
false-positive cases only after that retirement was committed.

V5 contains 1,000 individually written items per locale: 500 captions and 500 alt
texts in de, en, es, fr, it, pt and tr. Every locale changes author from v4.
The fresh private authoring worktree is pinned to the retirement commit, before
the round-3 repair handoff. V5 stays blind to the builder.

| Author                                      | V5 locale source rows          | V4 locale source rows          |
| ------------------------------------------- | ------------------------------ | ------------------------------ |
| cc68-tea (`/root`)                          | de, pt 1 through 1000 each     | en 1 through 1000              |
| Independent author (`/root/edge_paths`)     | fr, it 1 through 1000 each     | de, es, tr 1 through 1000 each |
| Independent author (`/root/general_review`) | en, es, tr 1 through 1000 each | fr, it, pt 1 through 1000 each |

`authoring/` retains complete literal TSV sources, exact authorship attestations,
editorial concept evidence and measurement tools. Source row n maps to imported
locale entry n. Fields may be interleaved. Each complete sentence was individually
written. No fragment bank, template, combinatorial assembly, scripted model call
or text-generating program supplies the wording. Prior corpus wording is not
translated or adapted. Helpers copy complete items unchanged and measure them.

The concept unit is the underlying scenario or visual motif, grouping paraphrases
and changes limited to colour, fabric or incidental setting. The largest group
may contain at most ten of 1,000 items. Multiple labels are retained where an item
substantively expresses multiple concepts. Editorial synonym consolidation and
peer review precede sealing. Labels and grouping remain reviewable.

Five-word overlap uses NFKC then casefold, Unicode letter/number word runs and
contiguous sequences across both fields. Every item participating in any repeated
sequence counts once toward the affected share, including both members. At most
ten items per locale may be affected. A second Unicode-category scanner checks
the common measurement independently. `diversity.json` retains all sequences,
memberships, concept groups and source hashes.

Complete texts are exact and NFKC/casefold unique within each language and disjoint
from the 35 explicit locale files at corpus root and under v1, v2, v3 and v4,
across all seven languages. Caption and alt-text limits remain 280 and 200 characters.
Every imported field and text must equal its complete source item.

Commit `406b3e13b6b788bb81d57be4677bb5ee3132976a` preregistered the independence
measures. Commit `621bd3fa0ce191344e2a727968676eadbf6c695f` preregistered the
unchanged Wilson arithmetic. At n=1,000, zero through three withheld items pass
the two-sided Wilson 95% upper bound of at most 1%; four fail. In-sample zero
withholds, disguised zero passes and all count minimums remain unchanged.

Commit `b02e82022731b963366306b9c4eecb4c89da1fa1` subsequently enforced retired
holdout rejection before screener construction. Its 14 eligibility tests and the
18 unchanged Wilson tests passed before this seal. The active v4 selector stays
in place until a separate coordinator release permits the v5 commit and switch.

These are authored synthetic examples. The diversity checks do not establish
random sampling, statistical independence or production representativeness.
Root retains prior released repair knowledge and v2/v3/v4 results. Both independent
authors retain their previous authoring and review context. No author inspects
the round-3 repair or v5 screening results before sealing.

The documented write-once importer reads only the committed authoring baseline
for required pins and deliberate-review labels. A released evaluation records
its actual frozen repaired inputs separately. `freeze-manifest.json` pins all
seven locale files, source evidence, historical inputs and the seal time.
The corpus digest is SHA-256 over sorted UTF-8 lines: repository-relative locale
path, NUL, file SHA-256, LF. The manifest records that digest; its own hash is
reported separately.

Send the sealed digest and per-locale counts to the coordinator, then wait for
explicit release before repair inspection, corpus commit, active-holdout switch
or screening. The coordinator superseded the announced round-3 target with a
future frozen round-4 repair after code reviewers reported disguised-term bypasses.
The round-3 manifest, its timeout supplement and round-4 repair remain unopened
during authoring. The coordinator will supply the round-4 manifest separately.
After release, verify all frozen file hashes before and after evaluation.
Preserve v5 regardless of the result.
