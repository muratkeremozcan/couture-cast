# Maestro burn-in: investment decision

Updated: 2026-08-14 - Initial decision recorded after the Maestro suite began gating pull requests, then extended the same day with the viewport gap and the scroll convention approved to close it.

Status: active - revisit on or after 2026-08-28

## The question

Should we build a burn-in utility for the Maestro mobile suite, mirroring the one in
`playwright-utils` (`/Users/murat/opensource/playwright-utils`, documented at `docs/burn-in.md`),
to eliminate flake?

## The verdict

**Not yet. Defer.** Re-evaluate after roughly two weeks of pull-request-triggered runs, which
means on or after 2026-08-28.

Two branches, decided in advance so the re-evaluation is a lookup rather than another debate:

- **Measured flake rate near zero** — do not build it at all. Close this decision as declined and
  record the measured rate here.
- **Measured flake rate around 3-5%** — build it. The design in this document is ready to
  implement and does not need re-deriving.

This is a deferral, not a decline. The investment is explicitly contingent on the suite degrading:
if the mobile suite starts failing unpredictably, burn-in gets built, and the two-week date below
is a floor rather than a gate. Anyone finding this document during a bad week should read it as
permission to start, not as a decision to wait longer.

## Why defer

We have no measured flake data. Not a low rate: none.

The CI run history behind this suite is green, then red with a named deterministic cause, then
green, then green. Every red was traced to a reproducible cause and fixed rather than re-run until
it passed. Nothing in that history is measured nondeterminism, so there is currently no evidence
that the suite flakes at all.

Building a flake-elimination tool on that evidence would be a quality gate backed by vibes rather
than data, which is exactly the thing this project's testing practice refuses to do elsewhere.

The pull-request trigger that landed in PR #130 makes the missing measurement free. Every pull
request now runs all 18 flows across 4 shards. `gh run list` plus the per-shard artifacts the
workflow already uploads are sufficient to compute a rate, with no instrumentation to write and no
engineering cost to carry. Waiting costs nothing and converts an argument into a number.

## The distinction that decides it

**Burn-in only catches nondeterministic flake.** This is the load-bearing point, and both classes
of failure are present in this suite's own history.

Most of what broke this suite was _deterministic_. The `pixel_3a` versus `medium_phone` viewport
class failed 100% in CI and 0% locally, because a screen roughly 12% shorter pushed asserted
elements below the fold. Repeating those flows would have taught us nothing; the failure was
perfectly reproducible on the CI profile and perfectly absent on the local one. Environment parity
fixed it, not repetition.

The affiliate `retryTapIfNoChange` toggle bug is the counter-example and the genuine case for
burn-in. It passed 18/18 in one run and failed the next. The flag re-tapped a binary toggle when
Maestro did not observe the screen change quickly enough, so the flow opted out and straight back
in, and whether that happened depended on timing. One flow run four times in parallel would have
caught it before it ever reached a pull request.

**The ratio between these two classes is what justifies or kills the investment**, and that ratio
is precisely what two weeks of PR runs will measure. Record both classes when the data arrives;
counting only total reds will overstate the case for burn-in.

## Why mobile E2E is structurally more flake-prone than web E2E

Context a future reader needs, because the instinct carried over from Playwright is wrong here.

Playwright removes three flake classes that Maestro does not:

| Flake source                   | Playwright                                       | Maestro                                                                                                        |
| ------------------------------ | ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| Element not ready to act on    | Auto-waits on every action, and `expect` retries | Implicit wait on element lookup only                                                                           |
| Element present but off-screen | Auto-scrolls into view before acting             | Does not. `assertVisible` and `extendedWaitUntil: visible` require the element inside the viewport             |
| Environment under test         | One pinned browser binary                        | Emulator, GPU backend, snapshot state, ANR dialogs, keyboard, and a JS bundle served over the network by Metro |

The middle row caused three separate defects in this repository in a single day, each presenting
initially as something else entirely.

Maestro's own answer to flake is element-level waiting and nothing more. Verified against the
pinned 2.8.0 binary via `maestro test --help`: `--repeat`, `--retry` and `--last-failed` are all
**absent**; `--shard-all`, `--shard-split` and `--flatten-debug-output` are **present**. There is
no vendor burn-in to buy and no flow-level retry to configure.

## The viewport gap, and the convention approved to close it

This is a separate decision from the one above, recorded here because it comes out of the same
middle row of the table. Unlike burn-in, it is **approved and being built**.

### What Maestro is actually missing

The gap is usually described as "Maestro has no auto-scroll". That is the symptom. The cause is
narrower and sharper: **Maestro ships exactly one visibility assertion, and it means in-viewport.**

Playwright has two words for two different claims. `toBeVisible()` means rendered with a non-empty
box and does _not_ require the viewport; `toBeInViewport()` is a separate matcher you opt into. So
the common assertion on the web is the weak one, and the strong one is explicit.

Verified against the pinned Maestro 2.8.0 with `maestro check-syntax`, using an unknown property as
a negative control to confirm the checker rejects things that do not exist:

| Command            | 2.8.0                          |
| ------------------ | ------------------------------ |
| `assertVisible`    | present, and means in-viewport |
| `assertExists`     | **Invalid**                    |
| `assertPresent`    | **Invalid**                    |
| `assertNotVisible` | present                        |

There is no way to assert that an element is in the hierarchy without also asserting it is on
screen. So Maestro cannot simply make `assertVisible` auto-scroll: doing that would silently
downgrade the only strong assertion it has and leave nothing to test with. Adding auto-scroll would
require first adding the weak assertion it never built.

Scrolling is also genuinely harder on a device than in a browser. `scrollIntoViewIfNeeded()` is one
deterministic DOM call. Maestro drives a black-box screen through an accessibility hierarchy, so
reaching an element means guessing which container scrolls, in which direction, and how far, then
re-dumping the hierarchy and checking. That is why `scrollUntilVisible` takes an explicit
`direction`, and why it cannot be applied implicitly without risking a scroll of the wrong pane.

### Our exposure, measured

12 of the 18 top-level flows contain **no scroll command at all**, and hold 91 assertions between
them. The worst are `wardrobe-onboarding-flow` with 17 assertions and 0 scrolls,
`wardrobe-onboarding-localization-flow` with 11 and 0, and `garment-capture-flow` with 10 and 0.

Every one of those passes today only because CI and local now boot the same `medium_phone` profile.
Profile parity is the systemic fix and remains correct, but it is a single point of failure:
changing one device profile returns a whole class of failures across many flows at once, which is
exactly what the `pixel_3a` episode was.

### The decision

Build a house convention rather than a one-off repair, and build it inside couture-cast first,
extracting it once it has run green against all 18 real flows. The convention is the deliverable,
in the same shape as `playwright-utils`: a small utility, a documented rule, and a lint that
enforces it. A fix tuned to this repository's current measurements does not travel; a convention
does.

Three pieces:

1. **A wrapper subflow**, `maestro/subflows/assert-visible-scrolled.yaml`, taking the target id
   through `runFlow` and `env`, scrolling to it and then asserting it. Both the wrapper and the
   `runFlow`/`env` call site were confirmed with `maestro check-syntax` against 2.8.0, as were all
   six `scrollUntilVisible` parameters in use (`element`, `direction`, `timeout`, `speed`,
   `visibilityPercentage`, `centerElement`). The `timeout` is set explicitly rather than left at
   the default; see the tail measurement below for why.
2. **A lint** that fails when a top-level flow asserts on an id without going through the wrapper.
   This is what turns the convention from a suggestion into a rule, and it is the piece that
   travels to other repositories unchanged. It must support an explicit opt-out marker carrying a
   reason, because for some assertions "on screen without scrolling" _is_ the claim under test: a
   sticky bottom navigation bar that needs a scroll to see is a defect, not a test problem.
3. **A one-time fold-margin measurement** to seed those opt-out markers rather than hand-classifying
   91 sites. Every `screen-hierarchy/step-*.json` the suite already uploads carries per-element
   `bounds` in the form `[x1,y1][x2,y2]`, so the distance between an asserted element's lower edge
   and the bottom of the screen is computable from artifacts already in hand. This runs once during
   the migration and is not part of the ongoing tooling.

### The measurement that settled the design

The obvious objection to wrapping every assertion is the cost of a scroll attempt on elements that
are already on screen. Measured from 292 real `scrollUntilVisible` executions across this
repository's existing artifacts:

| Statistic       | Value                   |
| --------------- | ----------------------- |
| Minimum         | 19 ms                   |
| Median          | 138 ms                  |
| 90th percentile | 3,464 ms                |
| Maximum         | 17,338 ms               |
| Under 500 ms    | 196 of 292              |
| Status          | 287 completed, 5 failed |

The command short-circuits when the element is already visible, so the median cost is negligible:
wrapping all 91 unprotected assertions adds on the order of 13 seconds in total, against flows that
each cost 3 to 5 minutes. The objection does not survive the data.

What does survive is the tail. A p90 of 3.5 seconds and a maximum of 17 seconds is what happens
when the target is not in the scrolled container at all, and the command scrolls until it gives up.
Left at the default timeout, the convention would convert fast, clear failures into slow, confusing
ones. Hence the explicit `timeout` in the wrapper.

### Rejected alternative

Compiling the flows inside `scripts/run-maestro.mjs`, so the runner injects the scrolls and authors
write only intent, is the truest expression of "be the framework". It was rejected for this suite
specifically: it shifts every `commands.json` entry and `screen-hierarchy/step-NNN` index onto
generated files, and those two artifacts are the only way this suite gets diagnosed. The debugging
cost outweighs the authoring convenience here.

For completeness, `waitUntilVisible: true` on `tapOn` is authorable in 2.8.0 and is the closest
thing Maestro ships to actionability, but it only waits. It does not scroll, so it does not close
this gap.

## The design, if we do build it

Recorded so a future session does not re-derive it.

The `playwright-utils` pipeline is: `git diff` for changed files, skip patterns to drop irrelevant
ones, a `madge` import graph to find affected tests, percentage sampling for volume control, and
`repeatEach` for repetition. Four of those five port directly to Maestro. The `madge` step does
not, because nothing imports a YAML flow and there is no graph to walk.

### The substitute for the import graph

Flows select elements by `testID`, and those testIDs are declared in the React Native source, so
the coupling is real and mechanically discoverable. Measured on this repository on 2026-08-14:

| Measurement                                            | Count |
| ------------------------------------------------------ | ----- |
| `testID` declarations in `apps/mobile`                 | 169   |
| `id:` selectors across the 18 flows and their subflows | 100   |
| Exact matches between the two sets                     | 65    |

The remaining 35 flow selectors are regular expressions or templates, such as `capsule-card-.*`
and `edit-capsule-button-${CAPSULE_ID}`. These resolve by prefix, because the application writes
the corresponding testIDs as template literals with a static prefix, for example
``testID={`capsule-card-${capsule.id}`}``.

The resulting chain is: a changed `.tsx` file yields the testIDs it declares, which yields the
flows that select them. This is arguably more precise than `madge`, because it follows the actual
coupling rather than an import chain.

### The cost problem and its escape

A Playwright test runs in 10-30 seconds. A Maestro flow runs in 3-5 minutes; the affiliate flow was
measured at 4m43s and then 3m16s on consecutive local runs. A naive `repeatEach: 3` across all 18
flows is therefore roughly 3.6 hours of serial execution, which is unaffordable and rules out the
straightforward port.

The escape is `--shard-all=N`, which runs the _entire given set_ on N devices rather than splitting
it across them. With the four emulators the suite already boots, that yields four repetitions at
roughly the wall-clock cost of one.

**Believed, not yet measured:** the precise semantics of `--shard-all` come from the CLI help text,
not from an observed run. This suite has a standing rule that a Maestro command or flag must be
proven with a scratch flow and `maestro check-syntax` before anything is built on it, after a
previous session invented a property and broke all eighteen flows on a parse error. Prove
`--shard-all` first.

## What to spend on instead in the meantime

First, the scroll convention described under "The viewport gap" above. It is approved and in
progress, and it addresses a gap we have measured rather than one we suspect.

Then, from the open items in `maestro-handoff-2026-08-14-evening.md`, both of which beat burn-in on
certainty per hour today:

1. **`--flatten-debug-output`** — roughly an hour of work. It drops the per-run timestamped
   subfolders, which removes the newest-directory path resolution that has produced a wrong path
   more than once.
2. **The two `index: 0` taps in `garment-capsule-create-flow`** — a real blast-radius risk. No id
   exists because the capsule is created in-flow. A mis-tap fails loudly rather than passing
   hollow, but if one ever resolved to the runner's seeded capsule it would also destroy the
   fixture that `garment-capsule-repair-flow` depends on.

## Re-evaluation checklist

When revisiting on or after 2026-08-28:

1. Pull the mobile-e2e run history for the period and count runs, per-flow failures, and reds.
2. Classify each red as deterministic (reproducible, named cause) or nondeterministic (same commit,
   different result). Only the second class counts toward the flake rate.
3. Record the measured rate in this document with the sample size.
4. Take the branch declared under "The verdict" above.
