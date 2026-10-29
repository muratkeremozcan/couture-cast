// Maestro's host GraalJS/OkHttp client coordinates the owned Node harness.
const action = MAESTRO_RAPID_ACTION
if (action !== 'acquire' && action !== 'release')
  throw new Error('Unknown rapid watermark control action')
const response = http.post(MAESTRO_RAPID_CONTROL_URL + '/' + action, { body: '' })
if (response.status !== 200)
  throw new Error('Rapid watermark control failed: ' + action + ':' + response.status)
