import {
  federatedSignupForbiddenSchema,
  federatedSignupInputSchema,
  federatedSignupStatusResponseSchema,
  signupInputSchema,
  signupResponseSchema,
  type FederatedSignupInput,
  type FederatedSignupRefusalCode,
  type FederatedSignupStatus,
  type SignupInput,
  type SignupResponse,
} from '@couture/api-client/contracts/http'
import { resolveMobileApiBaseUrl } from './api-client'

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
    const message = await readErrorMessage(response)
    throw response.status === 403 ? new SignupRefusedError(message) : new Error(message)
  }

  return signupResponseSchema.parse(await response.json())
}

/** Story 6.17 D3: the federated finish-step endpoints, with the Google identity's bearer. */
export class FederatedSignupError extends Error {
  override name = 'FederatedSignupError'
  constructor(
    readonly status: number,
    message: string,
    /** The 403 refusal code (`underage`, `federated_guardian_minor`); clients branch on it. */
    readonly code?: FederatedSignupRefusalCode
  ) {
    super(message)
  }
}

async function readFederatedError(response: Response) {
  let body: unknown
  try {
    body = await response.json()
  } catch {
    body = null
  }
  const refusal = federatedSignupForbiddenSchema.safeParse(body)
  const message =
    body &&
    typeof body === 'object' &&
    'message' in body &&
    typeof body.message === 'string'
      ? body.message
      : `Signup failed with status ${response.status}`
  return new FederatedSignupError(
    response.status,
    message,
    refusal.success ? refusal.data.code : undefined
  )
}

async function federatedRequest(
  method: 'GET' | 'POST' | 'DELETE',
  accessToken: string,
  body: unknown,
  fetchImpl: typeof fetch
) {
  const response = await fetchImpl(
    `${resolveMobileApiBaseUrl()}/api/v1/auth/signup/federated`,
    {
      method,
      headers: {
        authorization: `Bearer ${accessToken}`,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }
  )
  if (!response.ok) throw await readFederatedError(response)
  return response
}

export async function fetchMobileFederatedSignupStatus(
  accessToken: string,
  fetchImpl: typeof fetch = fetch
): Promise<FederatedSignupStatus> {
  const response = await federatedRequest('GET', accessToken, undefined, fetchImpl)
  return federatedSignupStatusResponseSchema.parse(await response.json()).status
}

export async function submitMobileFederatedSignup(
  accessToken: string,
  input: FederatedSignupInput,
  fetchImpl: typeof fetch = fetch
): Promise<SignupResponse> {
  const payload = federatedSignupInputSchema.parse(input)
  const response = await federatedRequest('POST', accessToken, payload, fetchImpl)
  return signupResponseSchema.parse(await response.json())
}

export async function abandonMobileFederatedSignup(
  accessToken: string,
  fetchImpl: typeof fetch = fetch
): Promise<void> {
  await federatedRequest('DELETE', accessToken, undefined, fetchImpl)
}
