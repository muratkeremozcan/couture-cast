---
title: 'Show uncovered changed lines in unit-test PR comments'
type: 'feature'
created: '2026-07-22'
status: 'done'
review_loop_iteration: 0
baseline_commit: 'f0acdef'
context:
  - '{project-root}/.github/actions/unit-test-coverage-comment/action.yml'
  - '{project-root}/.github/workflows/pr-checks.yml'
---

<frozen-after-approval reason="human-owned intent - do not modify unless human renegotiates">

## Intent

**Problem:** Couture Cast's sticky unit-test PR comment reports aggregate coverage and aggregate
new/changed-line coverage, but gives reviewers no direct way to find the lines new tests missed.
The richer shared-action implementation is not consumed here because this personal repository keeps
its action source in-repo.

**Approach:** Extend the local unit-test coverage action to retain its calculated per-file diff
coverage, then show uncovered changed-line ranges in a compact, collapsible PR-comment table. Each
range will link directly to the relevant GitHub Files-tab diff line.

## Boundaries & Constraints

**Always:** Keep the action local to Couture Cast. Preserve the existing monorepo LCOV merge and
path normalization, excluded `.claude` and `_bmad` diff paths, threshold validation output, and
fail-closed behavior when a configured threshold cannot be evaluated. Treat per-file detail as
best-effort so it cannot change aggregate coverage results, gate outcomes, or prevent the sticky
comment from being posted. Generate a unique temporary sidecar outside the uploaded coverage
artifact.

**Ask First:** Adding a third-party action, changing the 50% diff-coverage threshold, changing
coverage-workspace discovery, or changing the PR workflow's permissions or triggers.

**Never:** Replace the local action with a reference to `seon-gh-actions`, wholesale-copy unrelated
shared-action features, hand-edit generated coverage reports, or render unescaped changed file paths
as Markdown link text.

## I/O & Edge-Case Matrix

| Scenario                | Input / State                                               | Expected Output / Behavior                                                                                       | Error Handling                                                                 |
| ----------------------- | ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Uncovered changed lines | Same-repository PR has LCOV DA entries with zero hits       | PR comment adds a collapsible table, capped at 25 worst files; each row shows coverage and linked missing ranges | Show at most 30 ranges per file and keep the comment detail under 55,000 bytes |
| Fully covered diff      | All instrumentable changed lines have one or more hits      | Existing aggregate coverage text remains; no detail block is added                                               | No change to gate result                                                       |
| Detail unavailable      | LCOV, diff, or sidecar is missing, malformed, or unwritable | Existing aggregate comment and coverage gate continue to work                                                    | Log a warning or notice and omit detail                                        |
| No instrumentable diff  | Changed lines have no LCOV DA entries                       | Existing not-applicable aggregate behavior remains                                                               | Do not render a detail block or enforce a false threshold failure              |
| Unsafe path             | Changed path contains Markdown or HTML-special characters   | Row path is safely escaped; generated GitHub URL remains valid                                                   | Do not allow path text to alter table markup or links                          |

</frozen-after-approval>

## Code Map

- `.github/actions/unit-test-coverage-comment/action.yml` - Local composite action that merges
  coverage, calculates aggregate diff coverage, creates the sticky PR comment, and enforces the gate.
- `.github/workflows/pr-checks.yml` - Existing caller; confirms full checkout, PR-comment permission,
  and merged workspace LCOV input are already available. No behavior change is planned here.
- `scripts/run-workspace-test-coverage.mjs` - Produces the workspace coverage directory list consumed
  by the action's existing merge step.

## Tasks & Acceptance

**Execution:**

- [x] `.github/actions/unit-test-coverage-comment/action.yml` - Add a `diff-detail-path` output and
      create a unique `RUNNER_TEMP` sidecar before diff calculation. Write per-file details using the
      existing LCOV and Git-diff intersection, without changing aggregate outputs or gate semantics.
- [x] `.github/actions/unit-test-coverage-comment/action.yml` - Group consecutive uncovered lines
      into ranges; sort files by uncovered changed-line count then path; retain at most 25 files and 30
      ranges per file. Use null-prototype maps for path-indexed coverage and changed-line data.
- [x] `.github/actions/unit-test-coverage-comment/action.yml` - Read the sidecar best-effort in the
      PR-comment step and render detail only when a real uncovered range exists. Use SHA-256 GitHub diff
      anchors, direct range links, safe path escaping, a 55,000-byte comment budget, and explicit
      truncation messaging.
- [x] `.github/actions/unit-test-coverage-comment/action.yml` - Update the action's nearby usage and
      behavior comments to describe the collapsible detail and its 25-file, 30-range, and size limits.
- [x] `.github/actions/unit-test-coverage-comment/action.yml` - Exercise the embedded calculation and
      comment formatting with synthetic Git/LCOV fixtures: covered and uncovered lines, non-instrumented
      lines, fully covered diffs, no instrumentable diff, 26 files, 31 fragmented ranges, unsafe paths,
      and malformed detail data.

**Acceptance Criteria:**

- Given a same-repository PR with an uncovered instrumentable changed line, when the unit-test
  coverage action runs, then its sticky PR comment contains a collapsible per-file table and every
  displayed range opens the matching line range in the Files tab.
- Given a PR whose instrumentable changed lines are fully covered, when the action runs, then its
  comment has no new detail block and its prior aggregate output is unchanged.
- Given a missing, stale, malformed, or unwritable detail sidecar, when the action runs, then the
  aggregate comment is still created or updated and threshold behavior is unchanged.
- Given a configured threshold and failure to calculate the Git diff, when the action runs, then the
  existing fail-closed behavior remains in effect.
- Given more than 25 changed files, more than 30 missing ranges in one file, or a large generated
  table, when the action runs, then the comment stays within GitHub's size limit and reports any
  truncation.

## Spec Change Log

## Design Notes

The sidecar is intentionally ephemeral and independent from the coverage artifact. The coverage
calculation already has the data required for a detail view; the feature only preserves that data
long enough for the following comment step. Keeping the aggregate path authoritative prevents a
presentational failure from weakening CI enforcement.

Example table row shape:

```markdown
| <a href="...#diff-<sha>"><code>src/example.ts</code></a> | 2/4 (50%) | [11-12](...R11-R12) |
```

## Verification

**Commands:**

- `npm run test:coverage` - expected: all workspace coverage reports and LCOV files are produced.
- `npx prettier --check .github/actions/unit-test-coverage-comment/action.yml` - expected: the
  composite-action YAML is formatted.
- `act -l` - expected: the local runner recognizes the repository workflows; it is not a substitute
  for GitHub PR-comment rendering.

**Manual checks:**

- Open a same-repository draft PR with intentionally uncovered changed executable lines. Confirm the
  sticky comment is updated, the detail block appears, and its file and range links resolve in the
  GitHub Files tab.

## Suggested Review Order

**Detail handoff**

- Exposes a unique, ephemeral detail artifact without altering existing aggregate outputs.
  [`action.yml:132`](../../.github/actions/unit-test-coverage-comment/action.yml#L132)

- Creates the sidecar outside uploaded coverage and keeps its failure non-fatal.
  [`action.yml:334`](../../.github/actions/unit-test-coverage-comment/action.yml#L334)

**Coverage derivation**

- Groups missed executable lines while preserving the existing coverage and threshold calculations.
  [`action.yml:450`](../../.github/actions/unit-test-coverage-comment/action.yml#L450)

- Caps and orders detail data before it crosses the action-step boundary.
  [`action.yml:508`](../../.github/actions/unit-test-coverage-comment/action.yml#L508)

**Reviewer experience and safety**

- Makes detail rendering optional so fully covered PRs retain the existing comment shape.
  [`action.yml:700`](../../.github/actions/unit-test-coverage-comment/action.yml#L700)

- Escapes PR-controlled paths and reserves comment space for safe truncation output.
  [`action.yml:719`](../../.github/actions/unit-test-coverage-comment/action.yml#L719)
