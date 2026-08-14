# Maestro burn-in: investment decision

Updated: 2026-08-14 - Initial decision recorded after the Maestro suite began gating pull requests.

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

From the open items in `maestro-handoff-2026-08-14-evening.md`, both of which beat burn-in on
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
