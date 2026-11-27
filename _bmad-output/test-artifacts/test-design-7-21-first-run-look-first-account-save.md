# Test design for CC-7.21 First run

| ID          | Priority         | Acceptance evidence                                                                                                                                                                                                                                                                                                                                                  |
| ----------- | ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 7.21-ENTRY  | P0               | At 390 × 844, signed-out Today opens with a single sample teaser and Show me looks as its primary action. Sign in and Create account are text links. After the age check, a complete look, the mood row, Shuffle, Swap, and Save are usable before signup. AC1, AC2                                                                                                  |
| 7.21-AGE    | P0               | An under-13 visitor stays on the age gate with the message visible. No look, save action, or account request is available from that step. AC2, AC6                                                                                                                                                                                                                   |
| 7.21-CANCEL | P0               | Cancel the age check, account sheet, signup, sign-in, and review. Auth cancellation returns to the same preview and preserves the selected pieces. Cancel review to discard the entire offer or keep existing answers to save the selected look with no preference writes. AC3, AC4, AC6                                                                             |
| 7.21-ADULT  | P0               | Use the existing real-session lane to enter a different mood, color, and comfort setting, then swap a piece. Signup uses the age gate birthdate. After real OTP sign-in, review shows the selected answers and the account stays at defaults until confirmation. Confirm, observe the save status, and reload Looks > Saved to verify the same pieces. AC3, AC4, AC6 |
| 7.21-TEEN   | P0               | Use the real-session lane with guardian consent required. A pending teen and a teen whose guardian accepts the invitation both review and save the guest look. The pending account retains its status. The guardian route sweep checks the new owner allowances, and the consent suites retain a forbidden write check. AC4, AC5, AC6                                |
| 7.21-NATIVE | P0               | Run the signed-out Android Maestro journey through the age check and account sheet, and run the real OTP conversion through review and Looks > Saved. Check cancellation preserves the visible look and signup can submit using the age gate birthdate. AC1 through AC4, AC6                                                                                         |
| 7.21-TIME   | Release evidence | Record browser time from opening Today to a complete interactive look. The automated time covers a scripted visit. The 30-second median for visitors remains unmeasured following the Epic 7 decision to replace formal studies with the owner's walkthrough. AC2                                                                                                    |

Use unique synthetic emails and age-relative teen birthdates. Reuse the existing Playwright
fixtures, isolated real-session database, guardian policy lane, and native OTP runner. Assert the
account state before and after confirmation. Verify the saved look from the rendered collection after
reload so a transient confirmation alone cannot satisfy the story.

Run static checks locally and execute acceptance in GitHub Actions. Check every workflow for the
PR head SHA and inspect retries for flaky tests.

[Playwright assertions](https://playwright.dev/docs/test-assertions) ·
[Maestro visibility assertions](https://docs.maestro.dev/reference/commands-available/assertvisible)
