# Secret rotation runbook

Updated: 2026-10-16 - written after rotating `GUARDIAN_INVITE_JWT_SECRET` and
`VERCEL_AUTOMATION_BYPASS_SECRET`, which PR #145 found serialized into Playwright artifacts.

This runbook extends the [rotation procedure](secrets-management.md#rotation-procedure) with the
rules that keep a value out of logs, chat, and agent context while it moves between stores.

## Ground rules

- A value never appears in a command argument, a log line, a report, or a chat. Generate it inside
  the process that stores it, or pipe it from a `0600` temp file into the store's stdin.
- Every store gets its own value unless a consumer has to match another store. Two stores that
  share a value double the blast radius of one leak.
- couture-cast is public, so its Actions logs are public. A workflow that handles a value registers
  `::add-mask::` before any other use, never runs `set -x`, and never prints a response body.
- Rotation is not finished until the old value stops working everywhere. Check it with a request
  that carries the old value and expect a rejection.
- Never rerun a GitHub Actions run created before commit `08890519` (PR #145). A rerun executes the
  pre-fix workflow with the current secrets and can write them into a report artifact again.

## Where each store is changed

| Store                                   | Mechanism                                                                                                                                   |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| GitHub repository secret                | `gh secret set NAME --repo muratkeremozcan/couture-cast` with the value on stdin                                                            |
| Vercel project env var                  | REST `PATCH /v9/projects/{project}/env/{id}` or `POST /v10/projects/{project}/env`, type `sensitive` (development targets take `encrypted`) |
| Vercel Protection Bypass for Automation | REST `PATCH /v1/projects/{project}/protection-bypass` with `generate`, then `update` with `isEnvVar: true`, then `revoke` for the old one   |
| Local `.env*` files                     | a script that rewrites only the `KEY=` line, keeps the file mode, and prints only the path                                                  |

Without a Vercel CLI login, the Vercel steps run in a temporary workflow on a throwaway branch that
uses the `VERCEL_TOKEN` repository secret. A value that has to reach both GitHub and Vercel travels
through a temporary repository secret that is deleted afterwards.

## Order for a bypass-style credential (several may be active)

1. Add the new secret on every project that shares it (web and API share one value, because CI
   sends one value to both preview origins) and make it the system env var.
2. Update the GitHub secret and local `.env.preview` / `.env.prod`.
3. Verify a preview run or a direct probe passes with the new value.
4. Revoke every old automation secret and confirm each now gets the Vercel login redirect.

## Order for an app-owned signing key (one active value)

1. Set a new value per Vercel target; redeploy the API deployments that serve traffic.
2. Probe the new deployment without touching data. For the guardian key, a token signed with the
   new key must reach the invitation lookup (404) and a token signed with any other key must be
   rejected (400).
3. Update the GitHub secret and local files, then run `pr-pw-e2e-local.yml`.
4. Outstanding tokens signed with the old key stop working; for guardian invitations that means
   every pending invite must be sent again.

## Old deployments

Both Vercel projects use Standard Protection (`all_except_custom_domains`), so every generated
deployment URL needs a Vercel login or a valid bypass secret. Once the old bypass is revoked, old
deployments that still carry an old key cannot be reached from outside. Check this setting before
relying on it; if it changes, retire old deployments instead.
