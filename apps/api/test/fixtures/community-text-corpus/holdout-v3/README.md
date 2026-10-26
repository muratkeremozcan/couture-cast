# Independent clean text holdout v3

Author and reviewer: cc68-tea. Corpus SHA-256: `f987d152ca6d3c04d99a54bf7d7fb8008d966030ecdac2d550e32bf3d0663ada`.

Each of de, en, es, fr, it, pt and tr has 500 captions and 500 alt texts, all gated clean.
The text was sealed before inspecting the round-2 repair and before screening. The coordinator
received the hash before repair inspection. `freeze-manifest.json` records locale and
authoring-source hashes, baseline policy identity, counts and freeze time. The corpus digest
is SHA-256 over sorted locale JSON paths, NUL, file SHA-256 and LF.

Fresh locale-specific sentence banks, a preregistered seed and deterministic selection
produce the cases. `authoring/` retains the generator, plan and banks. These are synthetic
compositions with shared wording, reviewed for ordinary fashion meaning. Their Wilson
interval describes this corpus under the gate's assumptions; population accuracy requires
representative data. Captions concern complete outfits and community activities. Alt texts
describe outfits, visual settings and light.

All cases are exact and NFKC/casefold unique within each locale and disjoint from its
in-sample clean half, v1 and v2. The importer enforces 280-character caption and
200-character alt-text limits and policy-required review labels. The baseline `frozenAgainst`
hashes remain the authoring identity; the evaluation records the repaired inputs separately.

The preregistered gate commit is `621bd3fa0ce191344e2a727968676eadbf6c695f`. At n=1000,
the unchanged 1% Wilson 95% upper bound allows at most 3 errors; 4 fails. The reasoning and
pure arithmetic tests are recorded in `../holdout-gate.md`. In-sample zero withholds,
disguised zero passes and existing count minimums remain separate checks.

`diversity.json` records each bank's authored and used fragment counts, every fragment's
item reuse, the maximum reuse and its share of the 1,000 items per locale. The largest
single-fragment shares are de 3.8%, en 3.6%, es 3.3%, fr 3.9%, it 4.3%, pt 3.6% and tr 3.6%.
Each of the 50 paired outfit concepts occurs in 20 items (2%). These repeated fragments
create dependence. Reviewers must judge the adequacy of the corpus as evidence separately
from whether its measured Wilson bound clears the preregistered gate.

Keep v3 unchanged after evaluation, regardless of its result. Future screening repairs
require a separately authored independent version. v1 and v2 remain historical evidence.
