# CC-6.8 text holdout v4

Reviewer: cc68-tea. Release verdict: **FAIL**.
The evaluation is valid and reproducible against stable frozen inputs.
German, Italian and Portuguese exceed the preregistered 1% Wilson upper bound.

Coordinator disposition after evaluation: **RETIRED FROM HOLDOUT DUTY; DEVELOPMENT DATA**.
The committed v4 corpus and original failed evidence remain frozen.
The coordinator authorizes sending all v4 false-positive cases and reason codes to
cc68-impl after this retirement is committed. V4 cannot support a subsequent release
claim once exposed for development. V5 must be freshly authored with a different
author for each locale, disjoint from in-sample and v1 through v4, under the same
independence measures and unchanged Wilson gate. Seal v5 before round-3 repair
inspection, send its hash, and wait for a separate release.

## Seal and release identity

- Corpus SHA-256: `5e922f4c7798a28f04799a7007c695fdccdca74ed5982edd48ee1ed7e3c5bab8`.
- Freeze manifest SHA-256: `58a02d54bf9c6dda0d0589ae450c4fca06ebbce5688daa316198b7b4afb44612`.
- Sealed at: `2026-10-26T08:05:04.440826+00:00`.
- Authoring base and independence amendment: `406b3e13b6b788bb81d57be4677bb5ee3132976a`.
- Corpus and active-selector commit: `6deee28ec2f9fc8f9e6814c212aa3543a251da1b`.
- Authoring policy SHA-256: `b0daab4ab9d175cc018d88d7c37d3443a4d9425909394da3aee110e15ad98b65`.

The corpus digest hashes sorted repository-relative locale JSON paths, NUL, file
SHA-256 and LF as combined UTF-8 bytes. The manifest separately pins all source and
review evidence, the README, the diversity report and the 28 historical locale files.
Every imported field and text matches its complete authored source literally.
All 7,000 imported entries are gated clean; none is excluded as deliberate review.

| Locale | Captions | Alt texts | Gated clean | Five-word affected / n | Share | Largest concept / n | Share | Distinct concepts |
| ------ | -------: | --------: | ----------: | ---------------------: | ----: | ------------------: | ----: | ----------------: |
| de     |      500 |       500 |        1000 |                 0/1000 |    0% |             10/1000 |    1% |               189 |
| en     |      500 |       500 |        1000 |                 6/1000 |  0.6% |             10/1000 |    1% |               698 |
| es     |      500 |       500 |        1000 |                 0/1000 |    0% |             10/1000 |    1% |               191 |
| fr     |      500 |       500 |        1000 |                 0/1000 |    0% |              8/1000 |  0.8% |               242 |
| it     |      500 |       500 |        1000 |                 0/1000 |    0% |              8/1000 |  0.8% |               243 |
| pt     |      500 |       500 |        1000 |                 0/1000 |    0% |             10/1000 |    1% |               200 |
| tr     |      500 |       500 |        1000 |                 0/1000 |    0% |             10/1000 |    1% |               185 |

Both preregistered diversity measures pass for every locale. Concept groups can
overlap when an item expresses multiple substantive motifs. Counts use the full
1,000-item denominator. Semantic acceptance remains reviewable by the code reviewers.

| Locale | Most repeated concept, with an example where tied                         | Count | Tied maximum groups |
| ------ | ------------------------------------------------------------------------- | ----: | ------------------: |
| de     | `florale-handstickerei`: small hand-embroidered flowers or leaves         |    10 |                  11 |
| en     | `clothing-or-bag-on-chair`: clothing or a bag set aside on a chair        |    10 |                   1 |
| es     | `capas-blusa-transparentes`: transparent blouse above an opaque inner top |    10 |                   9 |
| fr     | `bord-retourne-visible`: turned edge revealing a cuff or inner layer      |     8 |                   8 |
| it     | `bande-riflettenti-indossate`: reflective bands worn at torso or ankle    |     8 |                   7 |
| pt     | `painel-acolchoado-costurado`: stitched padded quilting panels            |    10 |                   1 |
| tr     | `acik-sirt-baglama`: open garment back panels joined by ties              |    10 |                  15 |

All tied names, English glosses and exact row/field memberships are retained in
the author manifests. `diversity.json` retains every concept and imported-row membership.
English's three repeated five-word sequences affect rows 500/987, 544/777 and 815/911.
Every member of each pair counts toward the six-item total.
All items have at least five normalized words; per-locale minima are de6, en7, es7,
fr8, it8, pt7 and tr5. No item evades the measure through being shorter than five words.
The independent Unicode-category scan agrees with the regex-based audit for all locales.
All locales have zero complete-text duplicates, normalized historical matches and
length/field failures.

## Preregistered independence requirement

Coordinator decision B9 rejected v3 as non-independent release evidence.
Its 1,000 compositions per locale used 200 shared fragments.
The coordinator's reference of approximately 200 independent units gives a zero-error
Wilson 95% upper bound of 1.884533%, above the 1% gate.
V3 stays committed as history; its report now records the rejection.

Before v4 authoring or sealing, commit
`406b3e13b6b788bb81d57be4677bb5ee3132976a`
amended `apps/api/test/fixtures/community-text-corpus/holdout-gate.md`.
The amendment prohibits fragment banks, templates, combinatorial assembly and
text-generating programs, and requires 1,000 individually written items per locale.
The coordinator confirmed that content concepts mean underlying scenarios or visual
motifs, grouping paraphrases and differences limited to colour, fabric or incidental setting.
Each locale must have 500 captions and 500 alt texts.
Both the share of items sharing any five-word sequence and the largest substantive
concept group must be at most 10/1,000, or 1%.

## Authors and provenance

The coordinator explicitly authorized the two existing independent authors.

| Author                                              | Assigned locales | Authored source rows per locale | Imported ID range                                    |
| --------------------------------------------------- | ---------------- | ------------------------------- | ---------------------------------------------------- |
| cc68-tea, `/root`                                   | en               | 1 through 1000                  | en-holdout-v4-001 through en-holdout-v4-1000         |
| cc68-tea independent author, `/root/edge_paths`     | de, es, tr       | 1 through 1000                  | locale-holdout-v4-001 through locale-holdout-v4-1000 |
| cc68-tea independent author, `/root/general_review` | fr, it, pt       | 1 through 1000                  | locale-holdout-v4-001 through locale-holdout-v4-1000 |

Authors persist each complete item literally in a locale TSV file, with editorial
concept labels and its field. Each sentence is composed individually.
Source rows map one-to-one, in order, to the imported entries.
The documented importer assigns IDs and labels, enforces field lengths, and writes
the new version once. Serialization copies complete authored text unchanged.
Measurement helpers do not construct item wording.

Root retains prior v2 and v3 results and the previously released repair inspection.
During v4 authoring, root performs no additional repair inspection or screening.
The two authors report no policy, screener, repair or development-corpus inspection.
No corpus content is shared with cc68-impl.
Historical wording is read only for mechanical complete-text disjointness checks.
The common audit explicitly limits history to the 28 locale files at corpus root
and under holdout-v1, holdout-v2 and holdout-v3.

The French author's initial equality-check helper also parsed four metadata files:
`active-holdout.json`, v2 and v3 freeze manifests, and v3 diversity metadata.
It printed no content and used none for wording.
No development corpus or repair material was read.
The final audit uses only the 28 explicit locale files.

## Measures and review

The five-word check applies Unicode NFKC then casefold, extracts Unicode letter/number
word runs, ignores punctuation, and counts all items participating in any shared
contiguous five-word sequence across both fields. Each affected item counts once.
Repeated sequences and complete membership are retained for audit.

Concept membership is an editorial judgment. Authors consolidate synonyms across
captions and alt texts and review whether incidental differences disguise one motif.
English retains an explicit synonym-merge codebook.
Each author reviews every item and concept group in their assigned locales.
Root measures every completed item with the common audit and performs semantic spot
checks of the other authors' wording and consolidation evidence.
The final diversity artifact retains all concept names and member identifiers.
Both code reviewers can challenge the groupings before accepting release evidence.
These measures describe the authored corpus; they do not establish random production
sampling or eliminate every source of statistical dependence.

The peer audit identified English lining-reveal and extra-warmth scenarios above
the cap. Root individually rewrote 32 complete items into distinct motifs before
sealing. The final boundary memberships are five inner-surface reveals and four
practical extra-layer items. Peer recheck returned READY. Root also included the
backpack in the conservative chair-storage group, yielding ten members.
The peer verified this annotation-only step left all wording unchanged.
The source, exact rewrite rows and both review passes remain pinned.
Other authors' pre-seal synonym consolidations and complete-item replacements are
retained in their review evidence. No screening outcome informed these changes.

## Gate and release order

The arithmetic preregistration remains commit
`621bd3fa0ce191344e2a727968676eadbf6c695f`.
At n=1,000, zero through three errors satisfy the unchanged Wilson 95% upper bound
of at most 1%; four errors fail. At n=400, one error fails.
In-sample zero withholds, disguised zero passes and all count minimums remain unchanged.

After completing authoring and structural review, seal the seven locale JSON files
and source evidence, send the corpus hash and counts to the coordinator, and wait.
Only a subsequent explicit release authorizes verifying the frozen round-2 repair,
committing v4 and its selector by explicit paths, and evaluating all seven locales.
The required repair manifest SHA-256 is
`5e97ccffd9c2b23ebe16457301b35ca715421783da940a3cb9677061b8d26128`.
All 21 files must match before and after evaluation.

The private authoring worktree was `/tmp/cc68-tea-holdout-v4`.
No containers or database operations are needed for authoring or the text evaluation.
It was removed after commit and before evaluation, as instructed.

## Released execution

The coordinator received the sealed corpus and manifest hashes and counts before
authorizing v4 commit or evaluation. After explicit release, root verified the
manifest digest and all 21 repair files, copied the exact sealed corpus, and
committed exactly 34 owned paths, including the active-holdout switch.
All 21 repair files matched again after commit. Unrelated staged path counts were
275 before and 275 after; their staged path set was unchanged. The commit contains
none of those paths. The corpus and source hashes remained unchanged.

The private worktree was then removed. The evaluation records before/after complete
input-set manifests and verifies all 21 repair files and corpus/source pins again.
Evidence is under
`_bmad-output/test-artifacts/story-6-8/runs/cc68-tea-text-holdout-v4`.

## Evaluation result

| Locale | Withheld / gated | Wilson 95% upper bound | Verdict |
| ------ | ---------------: | ---------------------: | ------- |
| de     |           6/1000 |              1.302817% | FAIL    |
| en     |           0/1000 |              0.382676% | PASS    |
| es     |           0/1000 |              0.382676% | PASS    |
| fr     |           0/1000 |              0.382676% | PASS    |
| it     |           4/1000 |              1.023956% | FAIL    |
| pt     |           5/1000 |              1.165096% | FAIL    |
| tr     |           0/1000 |              0.382676% | PASS    |

The command exited 1: **49/52 tests passed, three Wilson gate assertions failed**.
All in-sample clean checks withheld zero. All 700 disguised cases were withheld,
with zero bypasses. No v4 deliberate-review exclusions reduced any denominator.
The gate implementation and arithmetic tests are unchanged from preregistration.

- Started: `2026-10-26T08:09:07.429967+00:00`.
- Finished: `2026-10-26T08:09:28.062721+00:00`.
- Input-set SHA-256 before, in the product and after:
  `a36c2f18474bbea75cc756af2a5c99dbde88e472a3d218ced61db71c0cb9684a`.
- Evaluated policy SHA-256:
  `45a486ed1751e099eee8c4dfc5789651c87b75806b001cc599c68f5d8ea2442c`.
- All 21 repair files matched before commit, after commit, before evaluation and after.
- All corpus, source and 28 historical-file pins matched after evaluation.
- The 34 owned paths match commit `6deee28ec2f9fc8f9e6814c212aa3543a251da1b`.
- The private worktree was removed before evaluation. No containers or DB operations ran.

Post-evaluation review of all 15 withheld items confirms ordinary fashion text and
visual motifs. Retain these cases as clean false positives. No item was removed,
relabeled or rewritten after sealing, and the repair received no tuning from these
results. Raw corpus wording was not sent to cc68-impl during the blind holdout phase.
The subsequent retirement decision releases these cases for development.

| Locale | Withheld case suffixes       | Reason            |
| ------ | ---------------------------- | ----------------- |
| de     | 041, 170, 713, 808, 907, 953 | text_policy_match |
| it     | 241, 453, 549, 865           | text_policy_match |
| pt     | 272, 306, 307, 413, 877      | text_policy_match |

Full case IDs, dispositions and reasons are in the run product and review summary.
The run directory also retains the command log, Vitest JSON, source manifests,
release verification, seal summary, owned path list and private-text-free triage.
V4 stays frozen as failed development evidence. V3 remains non-independent historical evidence.
The release gate is closed.
