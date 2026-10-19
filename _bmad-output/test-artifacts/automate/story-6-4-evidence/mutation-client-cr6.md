# Mutation evidence: Story 6.4 shared comments client

Script: `/Users/murat/opensource/couture-cast/_bmad-output/test-artifacts/automate/story-6-4-evidence/mutation-client.py`

Reproduce:

```sh
python3 -I /Users/murat/opensource/couture-cast/_bmad-output/test-artifacts/automate/story-6-4-evidence/mutation-client.py --only-cr6
```

What it runs per mutant, inside the scratch copy `/Users/murat/opensource/couture-cast/_bmad-output/test-artifacts/automate/story-6-4-evidence/mutation-client-work/packages/api-client` (node_modules symlinked to the package and repo root):

```sh
cd /Users/murat/opensource/couture-cast/_bmad-output/test-artifacts/automate/story-6-4-evidence/mutation-client-work/packages/api-client && /Users/murat/opensource/couture-cast/node_modules/.bin/vitest run --config vitest.config.ts testing/community-comments-state.spec.ts testing/community-comments-state-outcomes.spec.ts testing/community-comments-client.spec.ts --reporter=json --outputFile=<result.json>
```

Source under test (sha256 prefix at run time): `src/community-comments-state.ts` 9c1b4a4526a2, `src/contracts/http/community.ts` dab6fbbd07c5.

Baseline on the unmutated copy: 111 tests, 111 passed, 0 failed.

A mutant is killed when at least one test that passes on the baseline fails on the mutant. Baseline failures are excluded from killing evidence.

Result: 1 of 1 mutants killed.

Invariant I: a ticket only goes invalid in reset() or evict(), both emit synchronously, and the watch listener runs schedule(), whose renewal block cancels the old timer and bumps cycle, before any timer or poll callback can run. Old tickets never become valid again (generation only grows). So, while not stopped, !owns() holds exactly when scheduledCycle !== cycle.

| Mutant                                   | file:line                             | Original                                     | Mutated                                                                                                          | Verdict | Killing tests                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Notes |
| ---------------------------------------- | ------------------------------------- | -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| M27 no-cursor append invalidates refresh | `src/community-comments-state.ts:327` | `if (append && !current?.nextCursor) return` | `if (append && !current?.nextCursor) { \n this.ownRequest(postId, `${postId}/${parentId ?? ''}`) \n return \n }` | killed  | community-comments-state-outcomes.spec.ts > screen-owned comments state preserves a deferred first reply expansion read when no-cursor append is requested<br>community-comments-state-outcomes.spec.ts > screen-owned comments state preserves a deferred initial roots read when no-cursor append is requested<br>community-comments-state-outcomes.spec.ts > screen-owned comments state preserves a deferred refreshed replies at the last page read when no-cursor append is requested<br>community-comments-state-outcomes.spec.ts > screen-owned comments state preserves a deferred refreshed roots at the last page read when no-cursor append is requested | -     |
