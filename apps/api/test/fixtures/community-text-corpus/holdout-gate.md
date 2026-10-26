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
