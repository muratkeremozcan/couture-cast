# CoutureCast uncoached phone study

Use the [first outfit and first garment protocol](../planning-artifacts/ux-first-outfit-first-garment.md#uncoached-phone-usability-plan).
Recruit about six participants, three teens aged 13 to 17 and three adults. Include at
least one returning adult. This is a directional study of discoverability and comprehension.

## Organizer setup

1. Obtain adult consent and, for each teen, parent or guardian permission and teen assent.
   Participation is voluntary and can end at any time. Keep consent records outside this sheet.
2. Open an isolated build with synthetic accounts and storage. Record the build revision,
   platforms and whether the build simulates sign-in. Give each participant a fresh browser
   state, a disposable empty member account and a separate populated account for returning
   member tasks. Keep account credentials out of the notes.
3. Load the same [neutral garment fixture](../../apps/api/test/fixtures/garment-tagging/neutral-top.png)
   onto each phone. Use synthetic eligibility details on a task card when needed. Preflight
   all routes and verify the fixture uploads and reaches confirmed tags before the study.
4. If comparing two builds, alternate which one participants use first. Record task order.
   Keep names, exact ages, locations, account identifiers, photos and recordings out of results.

## Task cards

1. **Guest Home.** “See if you can find a look you'd wear.” Start at signed-out Home. Observe
   first tap, time to first outfit, whether the participant changes anything and where they stop.
   At completion or two minutes, ask “What would you do next?” Then ask “Would you try another
   look?” Record spontaneous changes separately from answers to the second question.
2. **Empty member Home.** “Add one item of clothing you could use here.” Start at Home with
   an empty wardrobe and the fixture available on the phone. Observe first tap, permission
   confusion, backtracking, time to confirmed tags and whether the participant knows it saved.
3. **Returning member Home.** “Find today's outfit, see what you could wear later in the week,
   and look at what other people are wearing. Return Home when you're done.” Start with the
   populated fixture. Record which actions the participant finds and where they stall.

Present one card at a time. Record any help before giving it. Ask which look or wording
caused hesitation and what the weather label meant.

## Anonymous results

Record one row per task attempt. Use `completed unprompted`, `completed after help`,
`stopped` or `blocked by the build` for the outcome. Mark timing as elapsed seconds.

| Session | Cohort | Platform / build       | Task / order       | First tap  | Elapsed seconds | Outcome                       | Change or stop reason                                                                             | Weather interpretation |
| ------- | ------ | ---------------------- | ------------------ | ---------- | --------------- | ----------------------------- | ------------------------------------------------------------------------------------------------- | ---------------------- |
| G01     | Adult  | Phone web / `5862e9cf` | Guest Home / first | Unreported | Unreported      | Made two looks, self-reported | Could not save or preview the looks. Could not find a mini skirt. Hosiery options were unchecked. | Unreported             |

Summarize completion, assistance, repeat actions and abandonment by cohort. Record
the build or task condition behind any blocked run.

## Preflight and recruitment

On 2026-11-20, the isolated web browser and Android emulator each uploaded the fixture
garment and confirmed its tags. Web showed the saved garment after reload. Android showed
it as ready in Wardrobe and deleted the fixture during teardown.

Participant outreach began on 2026-11-20. One adult opted in and received an expiring
guest-task link after a phone-width browser opened the exact isolated preview and reached
the sample flow. The guest pilot was self-reported. The member tasks and additional
participants have no outcomes yet.
