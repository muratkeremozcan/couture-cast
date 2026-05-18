# k6 Performance Testing

Performance baseline scenarios and load profiles for Couture Cast APIs.

## Directory Structure

- `tests/`: k6 test scripts (bundled with esbuild).
- `helpers/`: Shared k6 helpers (API wrappers, configuration).
- `scripts/`: Environment and test runner scripts.
- `configs/`: (Internal) default k6 configurations.

## Usage

### Local Smoke Tests

Runs 1 VU / 1 iteration across all scenarios to verify API health and basic functionality.

```bash
npm run test:k6          # Alias for test:k6:local
npm run test:k6:local
```

### Local Load Tests

To run with a specific load profile, set the `TEST_CONFIG` environment variable to one of the templates in `packages/k6-utils/templates/load-profiles/`.

Available profiles: `constant-rate`, `ramp-up`, `soak`, `spike`.

```bash
# Run with a constant arrival rate
TEST_CONFIG=packages/k6-utils/templates/load-profiles/constant-rate.json npm run test:k6:local

# Run with a soak test profile
TEST_CONFIG=packages/k6-utils/templates/load-profiles/soak.json npm run test:k6:local
```

### Remote Smoke Tests

```bash
npm run test:k6:preview  # Target Vercel Preview
npm run test:k6:prod     # Target Production
```

### Manual Load Testing (GitHub Actions)

Load tests can be triggered manually via the **k6 load** workflow in GitHub Actions. Supported profiles:

- `smoke` (1 VU, 1 iter)
- `constant-rate`
- `ramp-up`
- `soak`
- `spike`

## Implementation Details

- **Utility Package**: Core logic (JWT, AES, summary handling) is encapsulated in `packages/k6-utils`.
- **Bundling**: Tests are written in TypeScript and bundled via `esbuild` before execution.
- **Thresholds**: Each scenario has defined SLOs for latency (p95) and error rate.
- **Infra Delay**: The runner automatically calculates a network baseline before evaluating thresholds.
