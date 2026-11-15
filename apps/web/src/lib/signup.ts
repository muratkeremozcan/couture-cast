import {
  signupInputSchema,
  signupResponseSchema,
  type SignupInput,
  type SignupResponse,
} from '@couture/api-client/contracts/http'
import { resolveWebApiBaseUrl } from './api-client'

/**
 * Story 6.16 D2: the API refused the person (age or consent, HTTP 403), as opposed to a
 * payload, address or network failure the visitor can retry.
 */
export class SignupRefusedError extends Error {
  override name = 'SignupRefusedError'
}

async function readErrorMessage(response: Response) {
  try {
    const body = (await response.json()) as { message?: string }
    return body.message ?? `Signup failed with status ${response.status}`
  } catch {
    return `Signup failed with status ${response.status}`
  }
}

export async function submitWebSignup(
  input: SignupInput,
  fetchImpl: typeof fetch = fetch
): Promise<SignupResponse> {
  const payload = signupInputSchema.parse(input)
  const response = await fetchImpl(`${resolveWebApiBaseUrl()}/api/v1/auth/signup`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    credentials: 'include',
    body: JSON.stringify(payload),
  })

  if (!response.ok) {
    const message = await readErrorMessage(response)
    throw response.status === 403 ? new SignupRefusedError(message) : new Error(message)
  }

  return signupResponseSchema.parse(await response.json())
}
