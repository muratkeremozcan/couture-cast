# CI database provisioning and Playwright pitfalls

Findings from Story 5.1, recorded because each one cost a red CI run to learn
and none of them is discoverable from the code alone. Written by the web pane;
handed to the CI review (`feat/epic5-story1-ci-review`) as input.

---

## 1. A migrated database is not a clean database: Supabase grant drift

**The finding.** Provisioning the quality gate with `prisma migrate deploy`
against a `supabase start` database is not equivalent to provisioning it with
`db:reset`. The suites in `packages/db` that assert an exact privilege set fail
under the first and pass under the second.

**Before and after, same branch, same job, only the provisioning step changed:**

| Provisioning step                        | `packages/db` result    |
| ---------------------------------------- | ----------------------- |
| `node scripts/prisma-migrate-deploy.mjs` | 4 failed, 6 passed      |
| `npm run db:reset`                       | **10 passed, 0 failed** |

Run 31505863900 and run 31507592323 respectively.

**Mechanism.** `supabase start` grants `authenticated` and `anon` broad default
privileges on `public`. Applying migrations on top of that database adds the
project's own `GRANT`/`REVOKE` statements but does not remove what Supabase
already handed out. The suites then observe a superset. The concrete assertion
failure was:

```
AssertionError: expected [ 'DELETE', 'DELETE', 'INSERT', …(11) ]
                to deeply equal [ 'DELETE', 'INSERT', 'SELECT', …(1) ]
+ "REFERENCES",
+ "REFERENCES",
```

`REFERENCES`, `TRIGGER`, and `TRUNCATE` arriving alongside the four DML grants
the suites expect. The four affected files were `commerce-schema.spec.ts`
(`5.1-DB-020`), `outfit-capsule-schema.spec.ts` (`4.3-DB-001`), and two cases in
`rls-policies.spec.ts` (`4.3-DB-003`, `4.4-DB-003`).

`db:reset` drops and recreates, so the resulting grant set is exactly what the
migration history declares and nothing more.

**What the CI review should check.** An ephemeral `postgres:*-alpine` container
with a hand-written Supabase bootstrap is clean by construction, which is a
better answer than reusing a Supabase stack. But "clean by construction" is a
claim about the bootstrap SQL, not a property you get for free:

- Does the bootstrap `CREATE ROLE authenticated / anon / service_role` and then
  grant them anything beyond what the migrations grant? If it mirrors Supabase's
  own default privileges for fidelity, it reintroduces exactly this failure.
- Does it set `ALTER DEFAULT PRIVILEGES` for those roles? That is the specific
  mechanism that made the grants survive; a default privilege applies to tables
  created afterwards, which is every table the migrations create.
- The check that matters is not "do the suites pass once" but "does the grant
  set equal what the migrations declare", which is what `5.1-DB-020` asserts. If
  that test passes on the ephemeral container, the bootstrap is correct.

**Withdrawn: the quality gate does not need a seeded catalog.** An earlier
version of this note claimed `commerce-affiliate-offers.integration.spec.ts`
reads and restores the seeded `sample-partner` catalog, so the job had to seed.
That was true before `4407498` and is not true now. That commit replaced the
parking with isolation by garment category and deleted the shared-state access
outright; the file's own comment now opens "NO SHARED STATE IS TOUCHED HERE, and
that is the point", and the global-publication cases create their own `'*'` rows
in `accessory` rather than reading seeded ones. Checked across the whole
directory: no file under `apps/api/integration/` references `SAMPLE_PARTNER` or
`'sample-partner'` at all, and `packages/db/test/commerce-seed.spec.ts` snapshots
whether the catalog existed on entry and restores that exact state, so it is
correct either way. A quality gate that migrates without seeding is right, and
seeding it would add shared state the RLS matrix's exact policy-name and row
count assertions do not want.

Playwright is the surface that genuinely needs the seed, and
`pr-pw-e2e-local.yml` already runs `db:reset`.

**Resolution of the bootstrap question above.** Mobile measured it on an
ephemeral `postgres:16-alpine` (`8f292f3` on `feat/epic5-story1-ci-review`) and
the narrowed grant is the answer:

```sql
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated;
```

Four DML verbs only, and to `authenticated` only. `GRANT ALL` reproduces the
artefact above and fails 8 tests; including `anon` fails 6, because the suites
require `anon` to hold zero grants everywhere. `5.1-DB-020` passes under the
narrowed form, which is the settling test.

They also found the sharper problem underneath, which is worth more than the
artefact: on a container with nothing to revoke, the migrations'
`REVOKE ALL ON TABLE ... FROM authenticated, anon` statements are no-ops, so the
RLS suite's negative assertions were **vacuous**. Deleting all three REVOKEs left
the suite 49/49 green. Under the narrowed bootstrap that mutant correctly fails
two tests. A clean container is not automatically a faithful one: it can make a
control unfalsifiable rather than merely untested.

---

## 2. A residual boundary hazard nobody has swept for

`db82729` swept the integration suites for boundary assertions whose margin is
eroded by elapsed wall clock, and framed the search as places with "a
one-second budget". That framing is correct for what it found and misses one
case, because the case is a different shape: a modular boundary rather than a
budget.

**Where.** `commerce-affiliate-clicks.integration.spec.ts`, `concurrency`,
"collapses two simultaneous activations on separate connections to one row".
The test's own comment states the exposure exactly:

> Both services skip the read-then-write dedupe check at the same instant, so
> the partial unique index on the minute bucket is the only thing standing
> between this and two rows.

The index is partial-unique on
`(user_id, offer_id, recommendation_id, date_trunc('minute', created_at))`. If
the two concurrent inserts land on opposite sides of a wall-clock minute
boundary they occupy different buckets, the index does not collide, both rows
commit, and the test fails three ways at once: `count` is 2, the redirect URLs
differ, and both results report `created`.

**Likelihood and why it still matters.** The failure window is the spread
between the two inserts divided by sixty seconds. That is small, on the order of
0.01% for a few milliseconds of spread, but it is not zero, it grows on a
contended two-core runner, and it runs on every pull request from now on. The
expensive part is not the frequency; it is that the failure is indistinguishable
from a genuine concurrency regression, so it will cost a real investigation the
first time it happens.

**Suggested shape of a fix.** Align to the start of a minute before dispatching,
so the pair cannot straddle a boundary. A guard is enough:

```ts
// The dedupe index buckets by date_trunc('minute'), so a pair that straddles a
// minute boundary legitimately occupies two buckets and legitimately mints two
// rows. Start the pair away from the edge.
const msIntoMinute = Date.now() % 60_000
if (msIntoMinute > 57_000) {
  await new Promise((resolve) => setTimeout(resolve, 60_000 - msIntoMinute))
}
```

**Product footnote, not a test problem.** The same boundary exists in
production: two genuinely simultaneous taps straddling a minute boundary mint
two `AffiliateClick` rows and emit two `affiliate_cta_clicked` events. Decision 7
makes the 60-second read-then-write check the primary dedupe and the index only
a concurrency backstop, so this is within the accepted design. Worth a line in
`deferred-work.md` rather than a change.

---

## 3. Two Playwright pitfalls specific to this repository

Both cost a red run on Story 5.1 Task 9. The next person writing a spec here
will hit them.

### Next injects a `role="alert"` element into every page

```html
<div role="alert" aria-live="assertive" id="__next-route-announcer__"></div>
```

Consequences for any spec using a bare `getByRole('alert')`:

- `await expect(page.getByRole('alert')).toHaveCount(0)` can **never** pass. It
  resolves to at least one element on every page.
- Asserting text becomes a strict-mode violation the moment the page's own alert
  renders, because the locator then matches two elements.

Address the component's own error node by test id instead.

### `networkErrorMonitor` is `auto: true` and fails on any 4xx or 5xx

`playwright/support/fixtures/merged-fixtures.ts` enables it for every test that
imports the merged fixtures. Any test that observes a page response of 400 or
worse fails on the monitor, before its own assertions run, so a spec whose
subject **is** an error response fails for the wrong reason and reports a
misleading cause.

The opt-out is an annotation, and there is existing precedent in
`home-analytics-resilience.spec.ts`:

```ts
test(
  '[P1] ...',
  { annotation: [{ type: 'skipNetworkMonitoring' }] },
  async ({ page }) => {
    /* ... */
  }
)
```

---

## 4. Smaller things worth keeping

- **`db:seed` was not re-runnable** until `d5bd4de`. `seedRituals` wrote
  `AuditLog` with `upsert`, and that table carries BEFORE UPDATE / DELETE /
  TRUNCATE triggers raising SQLSTATE 42501, so the conflict branch always
  failed. `AuditLog` is the only table in the migration history with mutation
  triggers, so no other seed has the shape. Any future seed that writes to an
  append-only table needs `createMany` with `skipDuplicates`, never `upsert`.

- **A fresh account cannot read a ritual.** `GET /api/v1/ritual` answers 400
  "No location preferences found for user" (`ritual.service.ts:906`) until the
  account has a location preference. Any end-to-end setup that signs a user up
  and then reads a ritual has to create one, as
  `ritual-daily-outfits.spec.ts` does.

- **The webhook signing secret must stay unset locally.**
  `COMMERCE_PARTNER_SAMPLE_PARTNER_WEBHOOK_SECRET` is commented out in
  `.env.example` on purpose. Setting it to the placeholder makes the server sign
  with the placeholder while every suite signs with
  `buildTestOnlyPartnerWebhookSecret`, so every valid webhook returns 401 while
  the entire signature-rejection matrix still passes. That combination reads as
  a broken endpoint rather than a misconfigured secret.
