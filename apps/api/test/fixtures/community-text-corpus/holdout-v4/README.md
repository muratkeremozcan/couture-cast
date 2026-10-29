# Individually authored clean text holdout v4

Coordinator decision B9 required a fresh corpus after rejecting v3 as non-independent.
V1, v2 and v3 remain immutable history. This version contains 1,000 individually
written items per locale: 500 captions and 500 alt texts in de, en, es, fr, it, pt and tr.
No shared fragment banks, templates or text-generating program constructs the items.

`authoring/` contains the complete literal TSV sources, author identities, editorial
concept evidence and audit/serialization tools. These tools copy complete text and
measure it. They never generate wording. Source row n maps directly to locale entry n.
Caption and alt-text rows may be interleaved.

| Author                                               | Locale items                   |
| ---------------------------------------------------- | ------------------------------ |
| cc68-tea (`/root`)                                   | en 1 through 1000              |
| cc68-tea independent author (`/root/edge_paths`)     | de, es, tr 1 through 1000 each |
| cc68-tea independent author (`/root/general_review`) | fr, it, pt 1 through 1000 each |

The coordinator confirmed the concept unit as the underlying scenario or visual motif,
including paraphrases and changes limited to colour, fabric or incidental setting.
Every locale must have at most ten items sharing any five-word sequence and at most
ten members of any one substantive concept group. `diversity.json` retains the full
measurements, sequences and memberships. Editorial grouping remains reviewable.
These constraints do not establish representative random production sampling.

Before v4 authoring, commit `406b3e13b6b788bb81d57be4677bb5ee3132976a`
registered the independence requirement in `../holdout-gate.md`.
Commit `621bd3fa0ce191344e2a727968676eadbf6c695f` previously registered the
unchanged Wilson arithmetic: at n=1,000, zero through three errors pass and four fail.
In-sample zero withholds, disguised zero passes and count minimums stay unchanged.

The source audit normalizes with NFKC then casefold. Five-word overlap uses Unicode
letter/number word runs across both fields and counts every participating item once.
Whole-text equality is checked against the 28 explicit locale files at corpus root
and under v1, v2 and v3, across all languages. Field lengths remain 280 and 200 characters.
The source TSV files retain the concept labels used for the audit.

`freeze-manifest.json` records all seven locale hashes, counts, source hashes,
authoring policy identity and seal time. The corpus SHA-256 recipe is the hash of
sorted UTF-8 lines: repository-relative locale path, NUL, file SHA-256, LF.
The manifest records the corpus digest; its own hash is separately reported.
The importer writes each version once and leaves an existing version unchanged.

Root retains the previous released repair inspection and v2/v3 outcomes.
No further repair inspection or screening occurs during v4 authoring.
The independent authors report no repair or screening inspection.
The corpus is never supplied to the repair builder for tuning.
Import pins describe the committed authoring baseline. A released evaluation must
record the actual frozen round-2 repaired inputs separately.

The coordinator receives the sealed hash and counts before releasing corpus commit
or evaluation. After release, verify all 21 files against the round-2 manifest hash
`5e97ccffd9c2b23ebe16457301b35ca715421783da940a3cb9677061b8d26128`,
commit the new corpus and active selector by explicit path, evaluate seven locales,
and reverify the repair and corpus seals. Preserve v4 regardless of the result.
