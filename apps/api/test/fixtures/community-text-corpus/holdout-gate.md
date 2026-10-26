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
