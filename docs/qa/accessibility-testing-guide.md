# CoutureCast accessibility testing guide

This protocol evaluates WCAG 2.1 Level A and AA behavior on web and native mobile.
Automated checks cover detectable rules. Human evaluation covers speech quality, reading
order, focus logic, reflow, color meaning, and task usability.

## Release gate

A release record must contain one terminal result for every matrix row: `PASS`, `FAIL`,
`EXEMPT`, or `NOT APPLICABLE`. `FAIL` blocks release unless Compliance approves an exception.
An empty row, `PENDING`, or an unowned follow-up does not satisfy the gate.

Automated commands:

```text
npm run test --workspace @couture/utils
npm run test --workspace mobile
npm run test --workspace web
npm run test:pw-local -- playwright/tests/accessibility-hardening.spec.ts
npm run test:a11y:lighthouse
npm run validate
```

Playwright stores traces, screenshots, videos, and reports under `playwright/artifacts/` and
`playwright/playwright-report/`. Lighthouse stores JSON and HTML reports under
`playwright/artifacts/lighthouse/`. Maestro stores screenshots and JUnit output under
`maestro/artifacts/`.

## Automated scope

The Playwright suite runs axe with `wcag2a`, `wcag2aa`, `wcag21a`, and `wcag21aa` tags. It
allows zero violations at every impact level. Primary routes run at 1440 by 900 and 375 by
812. The complete route inventory is:

| Surface | Routes |
| --- | --- |
| Primary web | `/`, `/community`, `/wardrobe`, `/settings` |
| Account web | `/signup`, `/guardian/accept`, `/guardian/dashboard`, `/teen/dashboard` |
| Dynamic web | Invalid link banner, selected chips, severe alert, community target, validation error, successful feedback |

Lighthouse CI requires an accessibility score of `1.0`. That score represents Lighthouse's
automated rules only. It does not establish WCAG conformance.

The Maestro flow verifies Home, Community, tab selection, chip selection, garment swap,
choice state, the information modal, close behavior, and stable identifiers. Maestro does
not verify spoken output or contrast.

## Human test environments

Record exact versions in the release evidence before execution.

| Platform | Browser or app | Assistive technology |
| --- | --- | --- |
| Current macOS | Safari | VoiceOver |
| Current Windows | Chrome or Firefox | NVDA |
| Current iOS | CoutureCast app | VoiceOver |
| Supported Android API range | CoutureCast app | TalkBack |

Use a production build and deterministic test accounts. Reset app data between account-role
flows. Do not record real wardrobe, location, or identity data in evidence.

## Web route procedure

Run every web route at desktop and mobile widths. Protected routes use guardian and teen
fixtures as appropriate.

1. Press `Tab` from the top of the page. Confirm Skip to main content receives focus first.
2. Activate the skip link. Confirm focus and scroll move to the single main landmark.
3. Traverse forward and backward. Confirm visible focus, logical order, and no focus trap.
4. Exercise chip controls with Left Arrow, Right Arrow, Home, End, Tab, and Shift+Tab.
5. Confirm noninteractive outfit and lookbook cards do not enter routine Tab order.
6. At 200 percent and 400 percent zoom, confirm content reflows without horizontal loss of
   meaning or operation.
7. Apply WCAG text spacing overrides. Confirm no clipped, overlapping, or missing content.
8. Enable forced colors and reduced motion. Confirm focus remains visible and state changes
   remain immediate.
9. Open every available dynamic state. Confirm status updates are polite, critical weather
   is assertive, dismiss buttons have useful names, and focus remains predictable.
10. Inspect each informative image once in the accessibility tree. Confirm decorative art is
    silent and descriptions are concise.

## Native screen and flow procedure

Execute Home, Wardrobe, Community, Settings, signup, guardian acceptance, guardian dashboard,
teen dashboard, information modal, and garment swap modal. Execute bottom-tab navigation,
forecast refresh, chip changes, garment swap, severe alert, and feedback banner flows.

For VoiceOver and TalkBack:

1. Traverse by swipe, touch exploration, headings, controls, and containers.
2. Confirm weather speaks localized condition, temperature, unit, and relevant alert detail
   once. Confirm glyphs and ambient art remain silent.
3. Confirm garment controls speak a useful localized name, category, role, and state.
4. Change chips rapidly. Confirm one final polite update and no duplicate message.
5. Refresh the forecast and swap a garment. Confirm polite speech without focus movement.
6. Present a critical weather warning. Confirm immediate speech and uninterrupted operation.
7. Open the garment modal. Confirm its name, initial focus, choice states, modal isolation,
   Android Back behavior, close control, and focus restoration or logical successor.
8. Enable reduced motion. Confirm animated scrolling and modal slide motion stop.
9. Test the largest supported font scale in portrait and landscape. Confirm complete reading,
   visible controls, and 44 dp targets with safe spacing.
10. Repeat primary flows with Switch Control or Switch Access.

## Manual matrix dimensions

Each screen or route receives separate rows for the dimensions below when behavior differs.

| Dimension | Required coverage |
| --- | --- |
| Theme | Light, dark, forced colors where supported |
| Input | Keyboard, touch, switch input |
| Direction | Forward and reverse focus traversal |
| Scale | 100 percent, 200 percent, 400 percent web zoom; largest native font scale |
| Layout | Mobile, desktop, portrait, landscape |
| Motion | Default and reduced motion |
| Semantics | Names, roles, states, landmarks, headings, live regions |
| Visual | Text contrast, non-text contrast, focus appearance, color independence |

## Evidence row fields

Every executed row records:

- route, screen, or flow
- theme and viewport or device
- operating system and version
- browser or app build
- assistive technology and version
- tester and date
- result
- evidence path or URL
- linked defect or approved exception

## Defect and exception rules

A defect record contains the WCAG criterion, user impact, reproduction steps, affected
surfaces, owner, terminal disposition, fix reference, and retest evidence.

An exception contains the same facts plus mitigation, accountable owner, remediation date or
an explicit permanent-risk decision, and written Compliance approval. Product convenience,
schedule pressure, and automated scores are insufficient reasons.

After a fix, rerun the original environment, its nearest alternate environment, axe for the
affected route, the focused Playwright or Maestro flow, and the changed workspace tests. Close
the defect only after evidence links are attached.
