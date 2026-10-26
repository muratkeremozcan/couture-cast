# Clean holdout gate preregistration

Registered by cc68-tea before any holdout-v3 evaluation, under the coordinator's explicit
instruction. Story 6.2b defines a Wilson 95% upper bound of at most 1% for each language's
clean holdout. Its zero-withhold condition applies to the in-sample regression half.

The previous release evaluation combined the Wilson condition with an extra zero-withhold
assertion. That assertion rejected a corpus with one, two or three errors among 1,000 items,
although each clears the documented Wilson bound. The release evaluation now calls a pure
gate helper. The helper uses the existing two-sided 95% Wilson formula and the unchanged 1%
ceiling. The following decisions were fixed before any v3 result:

| Withheld | Gated sample | Wilson 95% upper bound | Result |
| -------: | -----------: | ---------------------: | ------ |
|        0 |         1000 |              0.382676% | Pass   |
|        1 |         1000 |              0.564256% | Pass   |
|        2 |         1000 |              0.726281% | Pass   |
|        3 |         1000 |              0.878301% | Pass   |
|        4 |         1000 |              1.023956% | Fail   |
|        0 |          400 |              0.951229% | Pass   |
|        1 |          400 |              1.402329% | Fail   |
|        0 |          200 |              1.884533% | Fail   |

The pure unit suite asserts these acceptance results, the three requested numeric boundary
values, the original interval reference values and invalid-count rejection. It loads no
policy, screener, term list, corpus or database.

The release evaluation retains the minimum of 200 gated clean items per language, all
existing corpus minimums, the in-sample zero-withhold assertion, deliberate-review checks,
all obfuscation families and zero disallowed bypasses. Existing v1 and v2 entries and their
recorded results stay frozen. The gate correction has no effect on v2's verdict because its
three failing languages each have 1/400 withheld and still exceed the 1% upper bound.

Holdout v3 will have 500 captions and 500 alt texts per language. At 1,000 gated clean
items, at most three errors clear the bound. Under an independent binomial model with a
true withheld rate of 0.1%, this occurs with probability 98.1073% per language; at 0.2%,
85.7304%; at 0.5%, 26.4322%. At 400 items the corresponding probabilities are 67.0186%,
44.8969% and 13.4658%. This describes the mathematical gate's operating characteristics.
An authored synthetic corpus does not establish the production input distribution.

The v3 corpus commit and evaluation require a separate coordinator release after the
builder freezes its repair. This preregistration authorizes neither action.

## Independence amendment for holdout v4

Coordinator decision B9 rejects v3 as independent evidence. Its 1,000 items per language
were composed from 200 shared fragments. Its measured zero-withhold result remains
historical evidence; it cannot establish the 1% release claim. At an effective sample of
200 independent units, zero errors gives a Wilson 95% upper bound of 1.884533%.
The committed v3 corpus and its original run products remain unchanged.

Register these requirements before authoring and sealing v4:

- Each of de, en, es, fr, it, pt and tr must contain 1,000 individually written items:
  500 captions and 500 alt texts. Shared fragment banks, templates, combinatorial
  assembly and text-generating scripts are prohibited. Serialization and measurement
  tools may copy complete authored items without generating their wording.
- All complete items must be exact and NFKC/casefold unique within their language and
  disjoint from the in-sample clean corpus and frozen v1, v2 and v3. Enforce the existing
  280-character caption and 200-character alt-text limits.
- For every language, report the number and share of items sharing any contiguous
  five-word sequence with at least one other item in that language, across both fields.
  Normalize with Unicode NFKC and casefold, extract Unicode letter/number word runs,
  and disregard punctuation. Count each affected item once, including both members
  of every repeated sequence. The affected share must be at most 1%, or ten items.
  Also retain the repeated sequences and affected item identifiers for reviewer audit.
- For every language, record an editorial content-concept label for every item and
  report the most repeated concept, its item identifiers, count and share. A concept
  groups the same underlying outfit scenario or visual motif, including paraphrases
  and changes limited to colour, fabric or incidental setting. Labels must not split
  the same substantive idea merely to clear the cap. Record multiple labels where
  an item substantively expresses multiple concepts. The largest concept group must
  cover at most 1%, or ten items. Reviewers judge the semantic grouping and corpus
  adequacy; unique labels alone do not prove independent observations.
- Report these measures before screening and preserve the complete authoring and
  measurement evidence. They are necessary diversity checks. They do not by themselves
  establish random sampling, statistical independence or production representativeness.
- Seal the seven locale files, report their aggregate SHA-256 and counts to the
  coordinator, and wait for explicit release before committing the corpus, switching
  the active holdout or evaluating it. Keep the corpus blind to the repair builder.
  Evaluate only against the frozen round-2 repair after verifying all 21 file hashes
  against manifest SHA-256
  `5e97ccffd9c2b23ebe16457301b35ca715421783da940a3cb9677061b8d26128`.
  Verify those hashes again after evaluation.

The arithmetic gate remains unchanged: the two-sided Wilson 95% upper bound must be
at most 1% per language. At n=1,000, zero through three errors pass and four fail.
In-sample zero withholds, disguised zero passes and all existing count minimums remain
unchanged. A corpus that fails either independence measure cannot support release,
regardless of its numerical Wilson result. This amendment authorizes no evaluation.

## V4 retirement and v5 authoring

After the sealed v4 evaluation failed in German (6/1,000), Italian (4/1,000) and
Portuguese (5/1,000), the coordinator retired v4 from holdout duty. V4 is development
data from this decision onward. Its committed corpus, seal, authorship evidence and
failed run remain immutable history. The full false-positive cases and reason codes
may now be supplied to cc68-impl for development. V4 cannot support a later release
claim after the builder has seen it.

V5 must be freshly authored in a new private worktree, before any round-3 repair
inspection. Keep the v4 independence requirements unchanged: each of seven languages
has 1,000 individually written items, 500 captions and 500 alt texts; no fragment
banks, templates or text generator; at most 1% of items sharing a five-word sequence;
and at most 1% in any underlying content-concept group. V5 must also be exact and
NFKC/casefold disjoint from the in-sample corpus and v1, v2, v3 and v4.

Each locale must have a different author from v4. Record each author's exact item
ranges. Seal v5 and send its aggregate hash and counts to the coordinator before
inspecting the round-3 repair, committing the corpus or evaluating it. A separate
explicit coordinator release remains required. The Wilson gate and its arithmetic,
in-sample zero withholds, disguised zero passes and all count minimums are unchanged.
The release gate stays closed while a fresh eligible holdout is pending.

## Enforced retirement eligibility

Code reviewers Astra A2 and Opus H3 found that a selector pointing at retired v4
could still pass the mandatory release evaluator. The evaluator now reads
`holdout-retirements.json` and rejects a retired active version before constructing
the screener or producing a measurement. The ledger records v3 as non-independent
and v4 as disclosed development data. Record future retirements in this ledger
in the same change as their disposition here.

An eligible active version also requires a matching seal identity, a valid seal
timestamp and a SHA-256 corpus digest. The existing per-language and aggregate
seal checks still verify the actual corpus bytes. Unit cases reject v3, v4,
another ledger retirement, invalid selectors and invalid seal identities; a
sealed unretired version is accepted. They load no screening or repair inputs.
The Wilson arithmetic and regression requirements remain unchanged.

The active v4 selector intentionally fails until a fresh sealed and unretired
version is committed under coordinator release. V5 will evaluate the frozen
round-4 repair after the coordinator supplies its manifest and releases the run.

## V5 retirement and v6 power preregistration

The released v5 evaluation against frozen round 4 failed Italian at 4/1000:
Wilson 95% upper bound 1.023956%. English and Turkish each had 3/1000 and passed
at 0.878301%; the other four locales had zero. All 9982 disguised cases were
withheld with zero bypasses, and all in-sample clean halves had zero withholds.
The coordinator retired v5 to development. Its sealed bytes and failed run stay
immutable. This retirement is committed in the machine ledger and v5 report
before the full English, Italian and Turkish false-positive cases or reasons
are handed to the builder. The active v5 selector must now fail eligibility.

V6 requires 2000 individually written items in each of de, en, es, fr, it, pt and
tr: 1000 captions and 1000 alt texts. Keep the existing no-bank, no-template and
no-generator rules. Complete items must be exact and NFKC/casefold unique and
disjoint from the in-sample clean corpus and every frozen v1 through v5 locale.
That is 42 historical locale files. Each locale changes author from v5; retain
exact source ranges and the assignment record before authoring. Five-word
affected items and each underlying content-concept group remain capped at 1%,
which is 20 items among 2000. Keep all existing field lengths and count minimums.

The two-sided Wilson 95% upper-bound gate remains at most 1%. At n=2000, zero
through 11 withheld items pass: 11 gives 0.9822062752%; 12 gives 1.0458448337% and
fails. At n=1000, only zero through 3 pass. Pure arithmetic tests register both
new boundary values before any v6 result; the formula and threshold are unchanged.
In-sample zero withholds and disguised zero passes stay unchanged.

Under an independent binomial model with a true 0.3% withheld rate, the probability
of passing is 98.007692% per locale at n=2000, versus 64.723206% at n=1000.
At a true 0.5% it is 69.706180%, versus 26.432240%. If the seven locale samples
are also independent and all have a true 0.3% rate, the probability that all seven
pass is 86.860263%, versus 4.757953% at n=1000. These are operating characteristics
of the unchanged rule. An authored synthetic corpus and its diversity caps do
not establish statistical independence or representative production sampling.

Author v6 in a fresh private worktree before any round 5 repair inspection.
Seal all seven locale files and the complete authorship/diversity evidence,
send the aggregate SHA-256 and per-locale counts to the coordinator, then wait
for explicit release before inspecting the round 5 freeze, committing v6,
switching the active selector or evaluating it. This preregistration authorizes
no v6 evaluation. The release gate remains closed.

## V6 primary-scenario cluster preregistration

The coordinator rejected the private draft design of 500 scenarios with four
sentences each. A screening error can affect all variants of one scenario;
counting those variants as 2000 independent observations would overstate the
sample supporting the Wilson calculation. Preserve those unsealed drafts and
their provenance as superseded private authoring history. They have supplied
no release measurement.

Before sealing v6, require 2000 distinct primary scenarios per language, with
exactly one item per scenario: 1000 captions and 1000 alt texts. An existing
draft scenario may contribute at most one complete sentence. Merge genuine
duplicate scenarios across old labels before selecting representatives, record
the old source hash and physical row for every retained sentence, and write
fresh scenarios for every remaining slot. Existing author rotation and exact
authorship records still apply. No fragment banks, templates, combinatorial
assembly or wording generator may supply these new items.

A primary scenario is the same specific core outfit event, observation or
composition. Caption versus alt-text wording, viewpoint, colour, material,
incidental setting, background props and simple carrier substitutions do not
create additional primary scenarios. A changed action, purpose, construction
or object relationship must be substantive to justify a separate scenario.
Two lemon-earring demonstrations or two wearable magnets retaining a needle
share a primary scenario. Generic detachable-component demonstrations also
share one unless the changed component has a substantively different role.
Keep one representative conservatively when the distinction is doubtful.

Secondary motifs can recur across genuinely different primary scenarios. A
thread-storage coil, a decorative wrist coil and a coiled tail in a climbing
animal depiction have different roles while sharing the coil motif. Broad
categories such as wearing trousers or sewing do not identify a primary
scenario. Each underlying secondary concept remains capped at 20 of 2000
items, and at most 20 items may share a five-word sequence. Semantic review
must assess the complete wording and consolidate paraphrases; unique labels
alone cannot establish scenario independence.

Report the primary-scenario inventory, all scenario memberships, the number of
items per scenario, its full count distribution and the maximum for each
language. Assert exactly 2000 scenarios and a maximum of one item per scenario.
Bind every inventory record to the corpus item ID and SHA-256 of its exact
UTF-8 text. The pure scenario gate rejects missing or extra inventory entries,
duplicate item IDs, invalid scenario identities, mismatched text hashes,
incorrect field counts and every repeated primary scenario. Its unit suite
accepts the complete singleton design and rejects caption/alt pairs and
four-item variant clusters, independently of screening or repair inputs.

Run that gate against all seven sealed locale files and their scenario
inventories before any v6 screening result can count as release evidence.
Publish its reports with the independent semantic review and existing
five-word, concept, authorship, uniqueness and historical-disjointness checks.
An item-level Wilson calculation requires this singleton design. These checks
remain necessary evidence, with statistical independence and production
representativeness subject to the stated synthetic-corpus limitations.

The Wilson threshold, preregistered arithmetic and power calculations remain
unchanged and conditional on the independent-item model. In-sample zero
withholds, disguised zero passes and all count minimums remain unchanged.
Seal, send the hash and counts, and wait for coordinator release before any
round 5 inspection, corpus commit, active switch or screening evaluation.
