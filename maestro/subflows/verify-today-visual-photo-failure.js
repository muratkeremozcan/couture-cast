const response = http.get(MAESTRO_TODAY_FIXTURE_URL + 'missing-requested')
if (response.status !== 204)
  throw new Error('The Today slot did not request the failing photo: ' + response.status)
