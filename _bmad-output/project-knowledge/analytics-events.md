# Analytics events

Updated: 2026-03-03 - Added Task 2 analytics event schemas, tracking helpers, and validation notes.

Status: active

## Event catalog

Source of truth:

- `packages/api-client/src/types/analytics-events.ts`

| Event name                 | Trigger                      | Input payload (camelCase)                                                  | PostHog properties (snake_case)                                                 | Helper                             |
| -------------------------- | ---------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | ---------------------------------- |
| `ritual_created`           | User completes ritual flow   | `userId`, `locationId`, `timestamp`, `ritualType?`, `weatherContext?`      | `user_id`, `location_id`, `timestamp`, `ritual_type?`, `weather_context?`       | `trackRitualCreated(...)`          |
| `wardrobe_upload_started`  | User starts wardrobe upload  | `userId`, `itemId`, `fileSize`, `timestamp`, `itemCount?`, `uploadSource?` | `user_id`, `item_id`, `file_size`, `timestamp`, `item_count?`, `upload_source?` | `trackWardrobeUploadStarted(...)`  |
| `alert_received`           | User receives an alert       | `userId`, `alertType`, `severity`, `timestamp`, `weatherSeverity?`         | `user_id`, `alert_type`, `severity`, `timestamp`, `weather_severity?`           | `trackAlertReceived(...)`          |
| `moderation_action`        | Moderator takes an action    | `moderatorId`, `targetId`, `action`, `reason`, `timestamp`, `contentType?` | `moderator_id`, `target_id`, `action`, `reason`, `timestamp`, `content_type?`   | `trackModerationAction(...)`       |
| `guardian_consent_granted` | Guardian grants teen consent | `guardianId`, `teenId`, `consentLevel`, `timestamp`                        | `guardian_id`, `teen_id`, `consent_level`, `timestamp`, `consent_timestamp`     | `trackGuardianConsentGranted(...)` |

## Validation strategy

- Each event has a dedicated Zod input schema and inferred TypeScript type.
- Each helper validates the input shape, transforms keys to PostHog properties, then validates the output property schema.
- Returned helper payload shape matches server capture expectations:
  - `distinctId`
  - `event`
  - `properties`

## Testing notes

Validation and tests should follow `_bmad-output/test-artifacts/test-design-system.md` Analytics Validation Strategy:

- Integration:
  - mock PostHog capture calls
  - assert event name and required properties
  - assert helper-level schema parsing rejects invalid payloads
- E2E:
  - verify event appears in PostHog test project for P0/P1 user journeys
- Privacy:
  - block PII from event payloads unless explicitly approved by product/legal

## Usage example

```ts
import { trackRitualCreated } from '@couture/api-client'

const payload = trackRitualCreated({
  userId: 'user_123',
  locationId: 'loc_456',
  timestamp: new Date().toISOString(),
  ritualType: 'daily',
})

posthog.capture(payload.event, payload.properties)
```
