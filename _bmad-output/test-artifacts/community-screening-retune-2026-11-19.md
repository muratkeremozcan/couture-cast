# Community screening retune, 2026-11-19

Updated: 2026-11-19 - created for the Community Beta launch, owner decision to relax screening
friction without lowering unsafe catch.

The owner asked for safe photos and clean captions to publish without waiting for a moderator,
cutting false holds as far as the measured holdouts allow while the unsafe catch rate on those
holdouts does not drop. Teens are the main users, so unsafe content must still be held.
`community-content-screening-model-readiness.md` is generated and stays as its 2026-10-17 run
wrote it; this record holds the before and after numbers of this change.

## Captions

Measured with `npm run community:screening:text` (`community-text-corpus.evaluation.spec.ts`). The
clean columns come from the active holdouts of the day: holdout-v6 for de, en, es, fr, it and tr,
holdout-v8 for pt. The unsafe columns come from the per-language corpus files
(`apps/api/test/fixtures/community-text-corpus/<language>.json`, `disallowed`), which are regression
fixtures, not a holdout: they show no known unsafe input started passing, not the catch rate on
unseen unsafe text.

| Language | Clean held before | Clean held after | Clean entries | Unsafe fixtures held before | Unsafe fixtures held after | Bypasses after |
| -------- | ----------------- | ---------------- | ------------- | --------------------------- | -------------------------- | -------------- |
| de       | 4                 | 0                | 2000          | 1520 of 1520                | 1520 of 1520               | 0              |
| en       | 5                 | 3                | 1999          | 1520 of 1520                | 1520 of 1520               | 0              |
| es       | 6                 | 0                | 2000          | 1520 of 1520                | 1520 of 1520               | 0              |
| fr       | 3                 | 0                | 2000          | 1520 of 1520                | 1520 of 1520               | 0              |
| it       | 7                 | 0                | 2000          | 1520 of 1520                | 1520 of 1520               | 0              |
| pt       | 2                 | 1                | 2000          | 1520 of 1520                | 1520 of 1520               | 0              |
| tr       | 3                 | 0                | 2000          | 1520 of 1520                | 1520 of 1520               | 0              |
| Total    | 30                | 4                | 13999         | 10640 of 10640              | 10640 of 10640             | 0              |

The 26 cleared holds were ordinary words caught by another language's list or by folding, for
example Spanish "pinto" for "I paint", Italian "toppa" for a patch pocket, French "lapins" and
German "in die Pedale". Every new rule in `apps/api/policies/community-screening/allow-list-v1.json`
clears only under its own declared locale: a few words scoped to that locale, and context rules
that need the attested construction nearby and are vetoed by person, insult and sexual words.

An earlier draft of this change cleared all 30 and opened bypasses that review found: a German
homophobic slur ("du pedale"), Portuguese body slang ("mulher maciça"), English sexual phrasings
around "pussy bow", "fur muff" and "strap on my bag", a German "muff" imperative, a French slur and
an English "lust" sentence under a German locale, and "capullo de seda" aimed at a person. Those
rules were removed or narrowed, and every probe in those findings now screens. Where no rule could
separate the safe reading from the abusive one, the caption stays held: the three English
captions ("pussy bow", two with "strap on my ... bag") and `pt-holdout-v8-1212` ("Pé de quem ...",
which needs a person word after "pé de"). A held safe caption is preferred to a published slur.

These are development numbers, not release evidence. The rules were tuned against these clean
holdouts, so holdout-v6 and holdout-v8 are retired in `holdout-retirements.json`; until a fresh
holdout is authored, sealed and released, the PR evaluation runs only the in-sample, disallowed,
disguised and review-term gates, and release runs refuse
(`apps/api/test/fixtures/community-text-corpus/holdout-gate.md`).

## Photos

No unsafe photo set exists, because no unsafe imagery may enter the repository, so the unsafe
catch rate for photos cannot be measured. Every photo threshold therefore stays at policy-v2.

| Measure                                  | Before                         | After |
| ---------------------------------------- | ------------------------------ | ----- |
| Safe holdout photos held for a moderator | 27 of 298 (9.1 percent)        | Same  |
| Wilson 95 percent upper bound            | 12.9 percent                   | Same  |
| Safe calibration photos held             | 57 of 341 (16.7 percent)       | Same  |
| Unsafe photo catch                       | Not measurable (no unsafe set) | Same  |

Replay of the photo policy on the full-precision model outputs of the 2026-10-17 run
(`apps/api/.cache/community-screening/safe-corpus-evaluation.json`, field `perEntry`, the 298
holdout vectors, and `model-calibration.json`, `vectors.mobilenet_v2_mid`, the 341 calibration
vectors; the cache is not committed). Each vector is classified with the policy's own rule: block
when Hentai or Porn is above the block floor; pass when Neutral plus Drawing is above the safe-mass
minimum, Hentai plus Porn is below the unsafe aggregate maximum, Sexy is below the review-class
maximum and Hentai, Porn and Sexy together are below the joint maximum; review otherwise.

| Thresholds (safe-mass minimum, unsafe aggregate, Sexy, joint, block) | Holdout held | Calibration held |
| -------------------------------------------------------------------- | ------------ | ---------------- |
| 0.85, 0.10, 0.15, 0.15, 0.35 (policy-v2, shipped)                    | 27 of 298    | 57 of 341        |
| 0.85, 0.15, 0.15, 0.15, 0.35                                         | 26 of 298    | 53 of 341        |
| 0.70, 0.20, 0.30, 0.30, 0.35                                         | 15 of 298    | 27 of 341        |
| 0.65, 0.20, 0.35, 0.35, 0.35                                         | 14 of 298    | 26 of 341        |

In the tested scenario that halves the held holdout photos (last row), four thresholds move
together: the safe-mass minimum, the Sexy ceiling and both aggregates, so a photo whose model scores
put below 0.20 on Hentai plus Porn and below 0.35 on all three non-safe classes, and that passes the
other checks, publishes with no review. That is the tested scenario, not the only one: other combinations of these thresholds can
reach a similar count, and the table reports only the rows replayed here. These are
model scores, not calibrated probabilities that a photo is unsafe, and with no unsafe photo set
nothing measures how many unsafe photos such thresholds would publish. The coordinator ruled to
keep the shipped thresholds.

## Faster review instead

A held post or comment is due 30 minutes after it is flagged (was 24 hours), the moderation console
re-reads its queue every minute, and SLA alerts can be sent to moderator devices by Expo push
when `MODERATION_OPS_PUSH_USER_IDS` names moderators whose current app has notifications allowed
(see `_bmad-output/project-knowledge/moderation-sla-runbook.md`). With no such device the alert stays
on the console as `invalid_config`, and no hosted drill or device delivery is recorded here yet.
