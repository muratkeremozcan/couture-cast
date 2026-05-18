# @couture/k6-utils

Shared k6 utilities and load profiles for the Couture Cast monorepo.

## Overview

This package provides a set of TypeScript utilities designed specifically for k6's `goja` runtime. It handles common concerns like authentication, encryption, and load profile management.

## Features

- **JWT**: Signing and verification (HS256, RS256) compatible with k6's `crypto` and `encoding` modules.
- **Crypto**: AES-CBC encryption via WebCrypto.
- **Config**: Environment-aware configuration loader with support for arrival-rate auto-scaling.
- **Distributions**: Weighted pick and Zipfian index helpers for realistic data selection.
- **Reporting**: Machine-parseable summary generation (JSON) for CI/CD integration.
- **Load Profiles**: Standardized JSON templates for smoke, constant-rate, ramp-up, soak, and spike tests.

## Usage

Internal utility package. Consumed by the root `k6/` workspace.

```typescript
import { encode } from '@couture/k6-utils/jwt'
import { getConfig } from '@couture/k6-utils/config'

const token = encode({ sub: '123' }, 'secret')
const config = getConfig()
```

## Development

- `npm run build`: Compiles TypeScript to `dist/`.
- `npm run typecheck`: Validates types.
