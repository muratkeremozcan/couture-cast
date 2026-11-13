# iOS native flake log (story 6.15)

Updated: 2026-11-13 — the iOS shards moved from macos-15 (iOS 18.5 simulator) to macos-26 (iOS 26.5).

Every red or flaky iOS native job is TEA-owned. Each row names the run and job, the signature, the
evidence that classifies it and where it stands. Times are Chicago.

| Date  | Run / job                              | Signature                                                          | Classification and evidence                                                                                           | Status                                                          |
| ----- | -------------------------------------- | ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| 11-12 | 131221970170 (macos-15, shard 2)       | `ios_flow_deadline_record_missing` at the first flow               | Harness: the flow-deadline worker exited without writing its timing record                                            | Open, fix in the option (a) PR                                  |
| 11-13 | 43371567368 shard 3 (dispatch)         | First `open-app` killed at the 120 s cap                           | iOS 26.5: simulator `mediaanalysisd` at 235 percent; boot 154 s against 64 to 93 s on iOS 18.5                        | 240 s cap (PR 219), `mediaanalysisd` boot-out (PR 219)          |
| 11-13 | 43371494463 shard 1 (push)             | First `open-app` killed at the 120 s cap                           | iOS 26.5: simulator `mediaanalysisd` at 224 percent                                                                   | Same as above                                                   |
| 11-13 | 43385098696 shard 4 (PR 219 dispatch)  | `signin-verify`: community preferences GET answered 503 four times | API's 1950 ms community authorization budget expired under host contention; simulator `mediaanalysisd` at 228 percent | `mediaanalysisd` boot-out (PR 219)                              |
| 11-13 | 43385098696 shard 2                    | `signin-request` killed at its 120 s budget                        | Simulator `mediaanalysisd` at 230 percent                                                                             | `mediaanalysisd` boot-out (PR 219)                              |
| 11-13 | 43385098696 Expo Go                    | `signin-request` killed at 120 s during Maestro Hide Keyboard      | No hot simulator process; host load1 122 at the failure                                                               | Open: iOS 26.5 runtime; option (a) moves the shards to iOS 18.5 |
| 11-13 | 43385098696 shard 3                    | XCUITest accessibility audit could not find `share-card-cancel`    | No hot simulator process                                                                                              | Open: iOS 26.5 runtime; option (a)                              |
| 11-13 | 43387583730 shard 4 (story, cd2fc7a5)  | First `open-app` stalled to the 240 s cap with the app alive       | Post-kill capture: 77-node screen, no alert, app process running; Maestro driver start 84 s; no hot simulator process | Open: iOS 26.5 runtime; option (a)                              |
| 11-13 | 43385098696 shard 1                    | First `open-app` passed at 203 s                                   | Over the 192 s line (80 percent of 240 s), a C-15 finding                                                             | Recorded                                                        |
| 11-13 | 43393247650 shard 2 (PR 219, 8f9d5dc2) | `ios_flow_deadline_record_missing` at the first flow               | Same harness signature as 11-12; host so loaded a 2 s `ps` took over 8 s; `mediaanalysisd` stayed out (idle)          | Rerun of shard 2 (coordinator); fix in the option (a) PR        |

Decisions: C-15 (240 s cap, post-kill diagnostics) and C-16 (shards on the iOS 18.5 simulator with an
iOS 26.5 nightly canary) in the story 6.15 test design.
