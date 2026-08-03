# Story 3.8 accessibility release evidence

Updated: 2026-08-03: Final automated results and permanent Compliance exception.

## Release disposition

**APPROVED WITH PERMANENT EXCEPTION**

| Field             | Value      |
| ----------------- | ---------- |
| Compliance owner  | Murat      |
| Decision date     | 2026-08-03 |
| Open actions      | 0          |
| Open defects      | 0          |
| Unresolved checks | 0          |

This record supports the Story 3.8 release decision. It does not claim an audited WCAG
conformance certification. Automated checks provide regression evidence. Compliance has
accepted the residual risk for checks that require assistive technology, physical devices,
or human visual and usability judgment.

## Automated evidence

| Evidence                   | Result | Detail                                                                                                                                                         |
| -------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run validate`         | PASS   | Repository typecheck, lint, test, and build gate completed successfully.                                                                                       |
| Mobile Vitest              | PASS   | 25 files and 116 tests passed.                                                                                                                                 |
| Mobile prebuild tests      | PASS   | One widget test and two watchOS tests passed.                                                                                                                  |
| Story 3.8 Playwright       | PASS   | 21 tests passed across route, viewport, state, keyboard, motion, forced-colors, and focus-contrast coverage.                                                   |
| Story 3.6 focus regression | PASS   | Four tests passed. The repaired keyboard case also passed a 10-run burn-in.                                                                                    |
| Lighthouse CI              | PASS   | Four primary routes scored 1.00 for automated accessibility checks.                                                                                            |
| Maestro flow structure     | PASS   | The flow is selectable, resolves to the accessibility flow, and blocks on failure.                                                                             |
| Native Maestro execution   | EXEMPT | `adb` is unavailable and `xcrun simctl` reported zero booted iOS devices. Direct Maestro execution confirmed zero connected devices. Covered by `A11Y-EX-001`. |
| Hosted CI rerun            | CLOSED | The referenced job supplied the failure evidence. Local production E2E and burn-in runs verify the repair. A hosted rerun is outside this local review scope.  |

## Web route matrix

| Route                 | Viewport or fixture           | Result |
| --------------------- | ----------------------------- | ------ |
| `/`                   | Desktop                       | PASS   |
| `/`                   | Mobile                        | PASS   |
| `/community`          | Desktop                       | PASS   |
| `/community`          | Mobile                        | PASS   |
| `/wardrobe`           | Desktop                       | PASS   |
| `/wardrobe`           | Mobile                        | PASS   |
| `/settings`           | Desktop                       | PASS   |
| `/settings`           | Mobile                        | PASS   |
| `/signup`             | Desktop                       | PASS   |
| `/guardian/accept`    | Desktop                       | PASS   |
| `/guardian/dashboard` | Authenticated desktop fixture | PASS   |
| `/teen/dashboard`     | Authenticated desktop fixture | PASS   |

Every route was scanned after its main content reached a stable state. Axe checks included
`wcag2a` and `wcag2aa` tags and returned zero violations.

## Dynamic web state matrix

| State or behavior                                                 | Result                               |
| ----------------------------------------------------------------- | ------------------------------------ |
| Skip link, unique main landmark, forward order, and reverse order | PASS                                 |
| Chip arrow keys, Home, End, Tab exit, and selected state          | PASS                                 |
| Static garment and lookbook cards excluded from routine Tab order | PASS                                 |
| Information banner status semantics                               | PASS                                 |
| Severe weather alert and alert deep-link focus                    | PASS                                 |
| Community deep-link focus                                         | PASS                                 |
| Validation error and success feedback                             | PASS                                 |
| Baseline web modal inventory                                      | PASS: no production web modal exists |
| Reduced motion                                                    | PASS                                 |
| Forced colors                                                     | PASS                                 |
| Light, dark, gold, and alert focus contrast                       | PASS                                 |

## Lighthouse results

Lighthouse scores cover its automated rules. Manual audit items remain within the approved
exception.

| Route        | Accessibility score | Result |
| ------------ | ------------------- | ------ |
| `/`          | 1.00                | PASS   |
| `/community` | 1.00                | PASS   |
| `/wardrobe`  | 1.00                | PASS   |
| `/settings`  | 1.00                | PASS   |

Retained local reports are generated under `playwright/artifacts/lighthouse/` by
`npm run test:a11y:lighthouse`. Lighthouse CI working data remains under `.lighthouseci/`.

## Mobile automated matrix

| Screen or behavior                                                       | Result |
| ------------------------------------------------------------------------ | ------ |
| Home and bottom tabs                                                     | PASS   |
| Chip selection and announcements                                         | PASS   |
| Weather and garment descriptions                                         | PASS   |
| Critical weather urgency                                                 | PASS   |
| Garment modal semantics, initial focus, selection, and focus restoration | PASS   |
| Reduced-motion query, event race, rejection, and cleanup                 | PASS   |
| All ten supported locales                                                | PASS   |
| Signup, guardian, teen, Wardrobe, Settings, and generic modal semantics  | PASS   |

## Human and device-dependent matrix

Every row below has the terminal result `EXEMPT` under the permanent Compliance decision in
`A11Y-EX-001`.

| Check                                            | Result | Tester               | Date       |
| ------------------------------------------------ | ------ | -------------------- | ---------- |
| macOS Safari with VoiceOver                      | EXEMPT | Compliance exception | 2026-08-03 |
| Windows Chrome with NVDA                         | EXEMPT | Compliance exception | 2026-08-03 |
| Windows Firefox with NVDA                        | EXEMPT | Compliance exception | 2026-08-03 |
| iOS with VoiceOver                               | EXEMPT | Compliance exception | 2026-08-03 |
| Android with TalkBack                            | EXEMPT | Compliance exception | 2026-08-03 |
| Keyboard and reverse Tab usability review        | EXEMPT | Compliance exception | 2026-08-03 |
| 200% and 400% zoom, reflow, and text spacing     | EXEMPT | Compliance exception | 2026-08-03 |
| Dynamic Type, font scaling, and orientation      | EXEMPT | Compliance exception | 2026-08-03 |
| Forced colors and color-independence judgment    | EXEMPT | Compliance exception | 2026-08-03 |
| Switch access                                    | EXEMPT | Compliance exception | 2026-08-03 |
| Manual touch-target and visual-contrast judgment | EXEMPT | Compliance exception | 2026-08-03 |
| Native Maestro flow on Android and iOS           | EXEMPT | Compliance exception | 2026-08-03 |

## Permanent Compliance exception

| Field                  | Value                                                                                                                                                                                                                 |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ID                     | `A11Y-EX-001`                                                                                                                                                                                                         |
| Status                 | APPROVED, PERMANENT                                                                                                                                                                                                   |
| Scope                  | All human assistive-technology, device-dependent, speech-output, visual-judgment, reflow, scaling, orientation, switch-access, and native Maestro execution checks listed above                                       |
| Affected WCAG criteria | 1.3.1, 1.4.4, 1.4.10, 1.4.12, 2.1.1, 2.1.2, 2.4.3, 2.4.7, 3.2.1, 4.1.2, and 4.1.3                                                                                                                                     |
| User impact            | Residual risk remains for screen-reader speech quality, keyboard usability, zoom and reflow quality, font scaling, switch access, and physical-device behavior.                                                       |
| Mitigation             | Semantic implementation, zero Axe violations, four Lighthouse scores of 1.00, production interaction tests, localization tests, motion and focus tests, a blocking selectable Maestro flow, and the complete QA guide |
| Owner                  | Murat                                                                                                                                                                                                                 |
| Remediation date       | None. Permanent risk acceptance for Story 3.8.                                                                                                                                                                        |
| Approval               | Murat selected option 2 and approved the permanent exception on 2026-08-03 in the collaboration session.                                                                                                              |

## Review issue ledger

| Finding                                  | Resolution                                                                           | Status |
| ---------------------------------------- | ------------------------------------------------------------------------------------ | ------ |
| Release evidence and Compliance approval | This executed record and `A11Y-EX-001`                                               | CLOSED |
| Honest completion state                  | Story and sprint aligned to `done` after terminal evidence                           | CLOSED |
| Skip targets on every route              | Unique route main targets and route tests                                            | CLOSED |
| Static cards in routine Tab order        | Static cards removed from Tab order                                                  | CLOSED |
| Hand-written focus trap                  | Unused implementation and misleading test deleted                                    | CLOSED |
| Gold-only focus styling                  | Surface-aware essential outline and decorative halo                                  | CLOSED |
| Accessibility formatters                 | Locale-aware, finite-safe, and deduplicated                                          | CLOSED |
| Image and weather descriptions           | Localized production owners wired                                                    | CLOSED |
| Live announcements                       | Localized urgency, deduplication, coalescing, and web live region                    | CLOSED |
| Reduced motion                           | Race-safe hook consumed by production motion                                         | CLOSED |
| Native modal and banner semantics        | Isolation, names, state, focus, and urgency hardened                                 | CLOSED |
| Formatter and hook tests                 | Edge cases and consumer behavior covered                                             | CLOSED |
| Playwright matrix                        | Routes, states, keyboard, motion, colors, and contrast covered                       | CLOSED |
| Lighthouse gate                          | Configuration, script, workflow, and reports added                                   | CLOSED |
| Maestro coverage                         | Navigation, state, modal behavior, selection, and blocking workflow added            | CLOSED |
| QA protocol                              | Full matrix, fields, exception process, and retest rules added                       | CLOSED |
| Learning path and story accuracy         | Records aligned with executed evidence and exception                                 | CLOSED |
| Story 3.6 CI focus assertion             | Updated to the black essential outline and gold halo contract; 10-run burn-in passed | CLOSED |

## Final decision

Story 3.8 is approved with permanent exception `A11Y-EX-001`. Every review finding has a
terminal resolution. Open actions, open defects, and unresolved checks are all zero.
