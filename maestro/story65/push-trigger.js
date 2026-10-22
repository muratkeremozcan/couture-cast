// Story 6.5 owner: ask the runner's one-shot local trigger to deliver the prepared simctl
// push now, so the iOS banner appears while this flow is already watching for it.
const response = http.post(MAESTRO_PUSH_URL, { body: '' })
if (response.status !== 200)
  throw new Error(`Push trigger failed with ${response.status}`)
output.pushed = true
