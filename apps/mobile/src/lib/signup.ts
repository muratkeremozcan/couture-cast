import {
  signupInputSchema,
  signupResponseSchema,
  type SignupInput,
  type SignupResponse,
} from '@couture/api-client/contracts/http'
import { resolveMobileApiBaseUrl } from './api-client'

async function readErrorMessage(response: Response) {
  try {
    const body = (await response.json()) as { message?: string }
    return body.message ?? `Signup failed with status ${response.status}`
  } catch {
    return `Signup failed with status ${response.status}`
  }
}

export async function submitMobileSignup(
  input: SignupInput,
  fetchImpl: typeof fetch = fetch
): Promise<SignupResponse> {
  const payload = signupInputSchema.parse(input)
  const response = await fetchImpl(`${resolveMobileApiBaseUrl()}/api/v1/auth/signup`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify(payload),
  })

  if (!response.ok) {
    throw new Error(await readErrorMessage(response))
  }

  return signupResponseSchema.parse(await response.json())
}
