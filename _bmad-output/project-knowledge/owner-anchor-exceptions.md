# Owner Anchor Exceptions

Updated: 2026-04-03 - record exact owner IDs whose primary target is non-commentable or unstable

Use this file only when the primary target cannot safely carry a stable in-file owner comment.

- Step 2 step 1 owner: source lives in `package.json` and `turbo.json` (JSON config files; no stable in-file comment anchor).
- Step 2 step 5 owner: source lives in `packages/api-client/package.json` and `packages/db/package.json` (JSON config files; no stable in-file comment anchor).
- Step 10 step 5 owner: source lives in `.env.local`, `.env.dev`, and `.env.prod` (environment files; do not rely on shared in-file owner comments there).
- Story 0.9 Task 3 step 1 owner: source lives in `package.json` and `package-lock.json` (`package-lock.json` is generated and should not carry a stable owner comment).
- Story 0.9 Task 3 step 2 owner: source lives in `openapitools.json` (JSON config file; no stable in-file comment anchor).
