# Pact

Local consumer-driven contract tests for `CoutureCastWeb` and `CoutureCastMobile`
against `CoutureCastApi`.
Generated pact files are written to `pacts/`; diagnostics go to `pact/artifacts/`.

## End To End

Run the full blocking workflow:

```bash
npm run test:pact
```

This validates the generated OpenAPI document, generates the web and mobile consumer
pacts with a determinism check, and verifies the provider against them.

## Consumer

Generate the consumer pacts:

```bash
npm run test:pact:consumer
```

## Provider

Verify the API against the generated local pacts:

```bash
npm run test:pact:provider
```

Run `npm run test:pact:consumer` first if the local web or mobile pact file does not
exist under `pacts/`.

## Can I Deploy

There is no Pact Broker in this local setup. The local can-I-deploy decision is:

```bash
npm run test:pact
```

If it passes, the checked-in apps satisfy the local consumer/provider contract gate.
If a broker is added later, use the pactjs-utils broker flow after publishing pacts:
`pact-broker can-i-deploy --pacticipant <name> --version <sha> --to-environment <env>`.
