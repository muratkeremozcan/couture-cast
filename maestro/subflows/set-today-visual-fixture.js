// Learning path Step 71: Today's outfit as a picture.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-71-todays-outfit-as-a-picture
if (!MAESTRO_TODAY_FIXTURE_URL)
  throw new Error('Today visual fixtures require the Android visual runner')

const response = http.post(MAESTRO_TODAY_FIXTURE_URL + TODAY_VARIANT, { body: '' })
if (response.status !== 204)
  throw new Error('Could not select the Today visual fixture: ' + response.status)
