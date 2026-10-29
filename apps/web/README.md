This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Testing

`npm test` runs the Vitest suite under jsdom with the MSW mock server. It is the run that gates.
`npm run vitest:open` opens the same specs in a real browser for debugging one file at a time;
a full run there still fails specs that mock modules or touch Node-only APIs.

### Delaying mocked responses

A test that passes only when its mocked response lands before the first assertion shows up when
every response is late. `MSW_TEST_DELAY_MS` answers each mocked request that many milliseconds
late (a number from 1 to 1000; unset, empty or 0 is off, anything else that is not a finite
number in range stops the run with an error). `MSW_TEST_DELAY_RANDOM=1` turns the fixed delay
into a uniform one between 0 and that value; unset, empty, `0` or `false` keeps it fixed.

```bash
MSW_TEST_DELAY_MS=100 npm exec -- vitest run src/app/components/subscription-section.test.tsx
MSW_TEST_DELAY_MS=100 MSW_TEST_DELAY_RANDOM=1 npm exec -- vitest run
```

Nothing is delayed while fake timers are installed, and a request is delayed once however many
handler sets a test registers. The request-ownership specs pin latency budgets on purpose, so
run the whole suite at 100 or below. When a test fails only under the delay, make it wait on the
exact state it asserts (a role, an attribute such as `aria-busy`, a recorded call), never on a
longer timeout. The switch lives in `src/test-utils/msw/runtime.ts`.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
