# Moderation SLA runbook

Updated: 2026-11-05 - created for Story 6.12, staffing sign-off recorded by Story 6.13.

This runbook covers the at-risk, breach and escalation alerts for moderation cases.
A member report carries a 24-hour review target, and a screening hold is due 30 minutes after it is flagged.
A case is at risk with 6 hours left and breached at its due time.
The definition lives in `deriveSlaState` in `@couture/api-client`.

## Roles

This runbook names roles only.
The coverage table below stays empty until the release owner chooses to fill it.

### Community moderator

Works the queue at `/moderation`, oldest and highest risk first.
Answers at-risk and breached alerts.
Escalates a case that needs an admin.

### Admin

Rules on escalated cases, because only an admin can apply a terminal decision to one.
Applies permanent bans and records appeal outcomes.

### On-duty responder

Watches the operations channel and `/moderation/sla` during their shift.
Handles a stale monitor and a failing channel, and pulls in a moderator or an admin.

### Release owner

Decides rollout and rollback of the flags.
Sets the webhook, assigns the coverage table and decides the Community Beta gate items.
The owner signed off moderation staffing on 2026-11-05, as Coverage records.

## Coverage

Signed off by the owner on 2026-11-05. Source: the owner's statement that staffing is ok, relayed by the coordinator in the Story 6.13 fleet rules.
This closes the coverage sign-off Story 6.12 D16 left open, and the signature is recorded in [the Community Beta gate record](../test-artifacts/community-beta-gate-signatures.md).
The sign-off rests on the owner's statement and on the roles above.
No roster or schedule exists, so the table below stays blank.

| Role                | Assignee | Hours covered |
| ------------------- | -------- | ------------- |
| Community moderator |          |               |
| Admin               |          |               |
| On-duty responder   |          |               |
| Release owner       |          |               |

## What an alert holds

An alert holds its id, kind, source, risk, due time, detection time and a link to the case.
It holds no reason, excerpt, alias, reporter or subject.
Open the case in the console for the content.
A chat tool receives the same alert again after a worker crash, with the same id.
The `Idempotency-Key` header carries that id, so a receiver can drop the repeat.

## Response by alert kind

### at_risk

1. A community moderator opens the case from the alert.
2. Decide it within the 6 hours left: resolve, release, take down, ban or escalate.
3. If the queue is too long to clear in time, the on-duty responder calls in another moderator.

### breached

1. The on-duty responder treats this as overdue work and assigns it now.
2. A community moderator decides the case.
3. A breach alerts once and never repeats, so the breached count on `/moderation/sla` is the list of what is still overdue.
4. Note the cause when several cases breach together: staffing, a stale monitor or a failing channel.

### escalated

1. An admin opens the case from the alert.
2. Rule on it. A moderator cannot apply a terminal decision to an escalated case.
3. The case keeps its original due time, because escalation changes no SLA value.

## Stale monitor

`/moderation/sla` shows a red banner when the last completed sweep is older than 5 minutes.
The banner comes from the API, so it needs no worker.
A running worker can cause it too: a sweep that cannot read cases, claim alerts or record an outcome ends without its stamp, and alerts may be stuck.

1. Check the flags. The worker evaluates `moderation_sla_monitoring_enabled` and `moderation_console_enabled` for the subject `system:moderation-sla`. A rule that targets only moderators opens the page and leaves the worker off, and the banner is then correct.
2. Check that the hosted worker `couture-cast/community-worker` is running on Northflank, and read its logs for `community_sweep_failed`, `moderation_sla_detection_failed`, `moderation_sla_claim_failed`, `moderation_sla_alert_processing_failed` and `moderation_sla_flag_unavailable`. A `prismaCode` field names a database failure.
3. Restart the worker if it is down.
4. Work the queue by hand from `/moderation` until the banner clears. Alerts missed during the outage are detected on the first sweep back. A case that passed its due time alerts as `breached` only.

The same page shows the oldest post waiting in `pending_review`, which is the signal for a dead screening worker.

## Failing channel

`/moderation/sla` counts failing alerts and names the last error of each.
Attempts retry after 1, 2, 4, 8, 16, then every 30 minutes while the case is still open.
The third failed attempt owes one `JobFailure` row, the error log `moderation_sla_delivery_failed` and a PostHog event of the same name.
They are written in the same sweep, or a later one if that write fails, even if the alert has delivered by then.

1. Run the drill to confirm: `npm run moderation:sla:drill -- --env-file .env.prod`.
2. Fix the webhook or its destination. Alerts still relevant then deliver by themselves, with no operator step.
3. Work breached cases from `/moderation` meanwhile.
4. Remove the failure row in the Supabase SQL editor once fixed. Rows stay until removed, because the job that prunes them runs on `maintenance`, which no hosted process consumes:

   ```sql
   DELETE FROM "JobFailure" WHERE job_id = 'moderation_sla_delivery__<alertId>';
   ```

Do not use the admin `failed-jobs/retry` route for these rows.
It adds a `retry` job that `maintenance` logs as unknown and ignores, no hosted process consumes that queue, and it deletes the row while redelivering nothing.

Closed codes: `timeout`, `network`, `http_3xx`, `http_4xx`, `http_5xx`, `invalid_config` and `interrupted`.
`interrupted` means a worker stopped during an attempt.

## Push to moderator devices

Since 2026-11-19 an alert can reach a moderator's phone without any outside account.
With no webhook URL set, the sweep sends each alert by Expo push, the provider the app already uses for community notifications, to every device with push permission granted of the accounts named in `MODERATION_OPS_PUSH_USER_IDS`.
The value is a comma-separated list of account ids, set on the worker that runs the sweep: the Northflank service `community-worker`.
An account receives alerts only after signing in to the mobile app on a device and allowing notifications.
With no such device the attempt fails as `invalid_config`, the alert stays owed, and `/moderation/sla` still shows it.
A screening hold is due 30 minutes after it is flagged and is at risk from the start, so its alert is sent on the next sweep.
The sweep polls every minute; disabled flags, an overlapping sweep or a delivery backlog delay it.
The console also re-reads the first page of the queue every minute while it is open.
The notification itself says only that a case needs attention: risk, source and the case link stay behind the console's role check.
When a moderator leaves the role, remove their account id from `MODERATION_OPS_PUSH_USER_IDS` and restart the worker in the same change as the role removal.
Expo's acceptance of a message is recorded as delivered. The accepted ticket ids are stored in `ModerationSlaPushReceipt`, and each sweep reads their receipts every 5 minutes, through worker restarts, until Expo reports or 24 hours pass. A failure Expo reports later (a removed app, bad credentials) is logged as `moderation_sla_push_receipt_failed`, a receipt still missing at 24 hours as `moderation_sla_push_receipt_unknown`, and a failed lookup as `moderation_sla_push_receipt_read_failed`; none of them reopens the alert.
On Android the alert posts to the `community` notification channel, which every registered app version creates, so a moderator on an older build still receives it. That channel has default importance: the alert lands in the notification shade with a sound, and Android does not promise a heads-up banner for it, with the app open or not. On iOS it shows as a banner. The agreed presentation is a notification in the shade with sound; confirm it on each moderator's device in rollout step 3.
`npm run moderation:sla:drill -- --env-file .env.prod` sends one drill alert through the configured channel.

## Webhook setup

The repo holds no email, Slack, PagerDuty or other outbound integration besides Expo push, so a generic webhook is the only other external channel, and a set URL wins over push.
With neither a URL nor push accounts set, alerts appear on `/moderation/sla` as console only, and nobody is notified.

1. Create an incoming webhook at the destination the team reads.
2. Set `MODERATION_OPS_WEBHOOK_URL` on the worker that runs the sweep: the Northflank service `community-worker`.
3. Set `APP_URL` beside it, or the alert links fall back to a bare path.
4. Keep the same value in `.env.prod`, and add it to the rotation list in the [secrets guide](./secrets-management.md).
5. Restart the worker, then run the drill.

The URL is a secret and appears in no log, row or error.
HTTPS is required except for loopback, credentials in the URL are refused, and redirects are not followed.
The payload has a `text` field for chat-style webhooks.
Slack and Discord acceptance is unverified, because the repo holds no such account.

## Drill

`npm run moderation:sla:drill` posts one `kind: 'drill'` payload through the real adapter and names no case.
With a webhook URL it touches no table. With push accounts it reads their device tokens through the verified production database client.
It exits 0 on delivery, 1 on a failure and 2 when neither a URL nor push accounts are set.
Add `--local` to run against a loopback server with no configured webhook.
Add `--env-file <path>` to read the URL from a file.

## Rollout

Keep both flags off until each step passes.

1. Deploy the migrations `20261105120000_moderation_sla_monitoring`, `20261119110000_screening_hold_sla` and `20261119120000_moderation_sla_push_channel` before the worker that writes 30-minute screening deadlines or the `push` channel starts. The first is additive; the second widens a check and the third widens one and adds the `ModerationSlaPushReceipt` table, so an older build keeps working beside them.
2. Confirm the hosted worker runs the release: `community-worker@<COMMIT_SHA>`.
3. Set the webhook, or the push accounts, and run the drill, or accept console only. Set `MODERATION_OPS_PUSH_USER_IDS` only after the API and web builds that read the `push` channel are live: an older API or dashboard rejects a monitor row stamped `push`. For push, each named moderator first opens the current app, signs in and allows notifications, and the drill must show the notification on that device before the sweep relies on it.
   Rollback: unset `MODERATION_OPS_PUSH_USER_IDS` and restart the worker first, wait for the next sweep to stamp the monitor row `console`, then roll the API and web back; reload any open dashboard.
4. Turn on `moderation_console_enabled` and `moderation_sla_monitoring_enabled` in PostHog for everyone, or for the subject `system:moderation-sla`, which is the identity the worker evaluates. The fallback table does not carry a production opening, because the `maintenance` job that syncs it has no hosted consumer.
5. Open `/moderation/sla` and wait for the stale banner to clear.
6. Enable the PostHog alert below.
7. The release owner assigns the coverage table.

## Rollback

Turn `moderation_sla_monitoring_enabled` off.
The sweep then reads no feature table, writes nothing and sends nothing, and `/moderation/sla` answers as turned off.
Decisions keep working, and an `escalate` decision still records its alert row.
When the flag returns, rows whose case closed are marked superseded and never sent, and live ones send.

## Dashboards

- `/moderation/sla`: the operator view. It needs no worker, and it is the only view that shows every alert.
- PostHog project `couturecast-prod`: [Moderation SLA dashboard](https://us.posthog.com/project/329012/dashboard/2307559), from the hosted worker's events.
- PostHog alert `Moderation SLA monitor stopped` on the [heartbeat insight](https://us.posthog.com/project/329012/insights/PMQhTqjE): fires when an hour has no `moderation_sla_snapshot`. It is the only push signal for a dead monitor, and it is disabled until step 6 of the rollout, because the flag-off monitor sends no events. It emails its subscribers. Replace the placeholder subscriber with the on-duty responder at rollout.
- Grafana `CoutureCast Moderation SLA`: local stack only, because the hosted image omits the OpenTelemetry SDK. Its case and pending-review panels go empty when `Measurement age` passes 300 seconds, because a gauge repeats its last value with fresh timestamps. See [observability](./observability.md).
