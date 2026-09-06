# CoutureCast portfolio and licensing update

Updated: 2026-09-06: capture repository scale, portfolio positioning, and licensing decision

## Purpose

Use this brief when updating Murat's personal website, project portfolio, biography, case studies,
or any agent context that describes CoutureCast.

The repository is still growing.
Treat the measurements below as the verified 2026-09-06 snapshot.

## Executive summary

CoutureCast has grown into a real cross-platform consumer product and a substantial solo engineering
project.
It combines a NestJS API, Next.js web application, Expo mobile application, native Swift and Kotlin
surfaces, PostgreSQL and Prisma persistence, generated OpenAPI clients, background processing,
analytics, payments, community features, and several layers of automated testing.

The strongest portfolio number is 254,055 hand-written code lines, split almost evenly between
125,023 source lines and 129,032 test lines.
The repository contains 434 tracked test files and 19 GitHub Actions workflow definitions.

Large open-source repositories can be much bigger.
CoutureCast is unusual because one person built this breadth with AI agents while maintaining a
source-to-test ratio slightly above 1:1.
The project shows what agent-assisted product engineering looks like when architecture, contracts,
security, accessibility, and verification remain first-class work.

The repository will remain public because public visibility is central to the portfolio value and
keeps its standard GitHub-hosted Actions runners and CodeRabbit reviews free.
The code remains proprietary under an all-rights-reserved source notice.
Public access allows people to inspect the work.
Reuse, modification, distribution, hosting, and commercialization rights remain withheld.

## Verified repository snapshot

| Measure                                       |                     Verified value |
| --------------------------------------------- | ---------------------------------: |
| Tracked files                                 |                              1,452 |
| Total tracked lines                           |                            418,508 |
| TS, TSX, JS, Swift, and Kotlin family code    |                            271,189 |
| Generated OpenAPI client code                 |                             17,134 |
| Hand-written code                             |                            254,055 |
| Source code                                   |                            125,023 |
| Test code                                     |                            129,032 |
| Tracked test files                            |                                434 |
| Markdown                                      |                       52,028 lines |
| BMAD project knowledge and delivery artifacts | 52,525 lines across all file types |
| JSON                                          |                       77,585 lines |
| YAML                                          |                        8,091 lines |
| SQL                                           |                        3,233 lines |
| GitHub Actions workflows                      |                                 19 |
| Application workspaces                        |                                  3 |
| Shared package workspaces                     |                                  7 |

The 418,508-line total includes documentation, package-lock data, generated code, configuration,
and other tracked assets.
Use 254,055 as the hand-written code figure.
Use 125,023 source lines and 129,032 test lines when describing the engineering balance.

The count treats TypeScript, TSX, JavaScript variants, Swift, and Kotlin as code.
It excludes `packages/api-client/src/generated/` from hand-written code.
Files named with `.spec` or `.test` are classified as tests, which keeps the split reproducible.

## Current delivery state

The repository is public at `github.com/muratkeremozcan/couture-cast`.
GitHub records its creation on 2025-11-24.
The current Git history contains Murat's two Git author identities, both belonging to the same person.

Epic 6, Community Beta, is in progress.
Story 6.1, the climate-band community feed, is recorded as done.
Stories 6.2 through 6.5 cover reactions and comments, locale highlights, social exports, and
moderation queue SLA tracking.

Describe CoutureCast as an active product build.
Revenue and completed launch claims require evidence from the live product before publication.

## Product shape

CoutureCast answers a simple daily question: what is the weather, and what should I wear?
The implementation reaches well beyond a weather screen.

### Product surfaces

1. A Next.js web application.
2. An Expo and React Native mobile application.
3. A NestJS API and worker layer.
4. Native Swift watch integration.
5. Kotlin Android integration.
6. Widget and glance experiences.

### Product capabilities

1. Weather-aware outfit recommendations.
2. Personal comfort calibration.
3. Seven-day outfit planning.
4. Wardrobe capture, smart tagging, and outfit capsules.
5. Palette analysis from consented user imagery.
6. Premium subscriptions and affiliate commerce.
7. A climate-aware community feed with moderation and challenges.
8. English, Spanish, and French localization.
9. Teen privacy and guardian controls.
10. Analytics, operational controls, and failure recovery.

### Engineering spine

1. Contract-first HTTP design with OpenAPI and generated clients.
2. PostgreSQL and Prisma data modeling with row-level security tests.
3. Redis and background-worker paths for scheduled and asynchronous work.
4. Feature flags and analytics boundaries.
5. Shared schemas, fixtures, factories, and test utilities across applications.
6. Deterministic local and CI environments for product verification.

## Testing and quality story

The test volume matters because the layers cover different failure classes.
The repository implements a layered quality architecture.

The repository contains:

1. Unit and component tests with Vitest and browser-backed component execution.
2. API and database integration tests.
3. Consumer and provider contract tests with Pact.
4. OpenAPI generation and schema drift checks with Optic.
5. Web end-to-end tests with Playwright across local, preview, and production configurations.
6. Mobile end-to-end flows with Maestro on Android and iOS.
7. Performance smoke, load, spike, soak, and ramp profiles with k6.
8. Accessibility checks with axe and Lighthouse.
9. Security checks, including secret scanning and row-level security coverage.
10. Burn-in workflows and reusable CI actions for reliability and review evidence.
11. TeA test-review automation inside pull requests.

The near 1:1 source-to-test ratio is the headline proof point.
It demonstrates that AI-assisted speed is paired with executable evidence.

## Why this improves Murat's online profile

CoutureCast gives Murat evidence across several professional dimensions at once.

### Product engineering

He took a consumer idea through product definition, architecture, implementation, cross-platform
delivery, monetization foundations, and release planning.
The repository exposes the engineering work behind the product.

### Test architecture

The project demonstrates Murat's actual specialty at product scale.
Testing spans component, integration, contract, end-to-end, mobile, performance, accessibility,
security, and production-oriented paths.
The tests are integrated into delivery gates and reusable tooling.

### AI-era engineering leadership

The project shows effective orchestration of AI agents across a large codebase.
BMAD artifacts preserve requirements, decisions, architecture, stories, reviews, and test strategy.
Human ownership remains visible in the system design, quality bar, corrections, and final decisions.

### Architecture and maintainability

The monorepo uses contracts and shared packages to keep web, mobile, API, and native surfaces aligned.
The public history shows sustained work across product code, infrastructure, documentation, and
quality systems.

### Commercial credibility

CoutureCast has subscriptions, affiliate commerce, privacy controls, analytics, and community
operations in its product model.
It reads as a product being prepared for real users and revenue.

## Approved portfolio positioning

### Short profile line

Built CoutureCast, a public-source, proprietary cross-platform fashion and weather product with
254,000 hand-written lines and a source-to-test ratio above 1:1.

### Project card

CoutureCast is a cross-platform fashion and weather product spanning web, mobile, API, widgets, and
native watch experiences.
I built it as a real consumer product, including personalization, wardrobe workflows, subscriptions,
community features, privacy controls, analytics, and the delivery platform around them.
Its 254,000 hand-written code lines include 129,000 lines of tests across unit, component, contract,
integration, web and mobile end-to-end, performance, accessibility, and security layers.

### Case-study introduction

CoutureCast is my proof that AI-assisted development can produce a serious product when the agents
work inside a strong architecture and every important behavior has executable evidence.
The repository contains 254,055 hand-written code lines, with 125,023 in source files and 129,032 in
test files.
It covers three application workspaces, seven shared packages, native mobile integrations, 434 test
files, and 19 GitHub Actions workflows.
I use it to demonstrate product engineering, test architecture, and the level of verification needed
to ship agent-assisted software with confidence.

### Repository label

Public proprietary source.
All rights reserved by Murat K Ozcan.
The code is visible for evaluation and portfolio review.
No permission is granted to use, copy, modify, distribute, host, or deploy it.

## Licensing decision

The decision is to keep CoutureCast public and proprietary.

The root `LICENSE` is an all-rights-reserved proprietary source notice.
It identifies `Murat K Ozcan` as the copyright owner for 2024-2026.
The README carries the same usage notice.
The root and API package manifests use `UNLICENSED`, and workspace packages are marked private to
prevent accidental publication.

The expanded license change exists in the current local working tree and awaits Murat's commit.
The published GitHub repository retains its previous shorter all-rights-reserved notice until that
commit reaches the remote.

GitHub's Terms allow users to view and fork a public repository through GitHub functionality.
Those platform permissions do not create a general right to deploy or commercialize the code.

The license protects the implementation, tests, documentation, and original assets.
Copyright does not reserve product ideas, systems, methods, program logic, or independently written
implementations.

### Why the repository stays public

1. The code and test architecture are direct portfolio evidence.
2. Public repositories receive free standard GitHub-hosted Actions minutes.
3. CodeRabbit provides its full public-repository review program without a paid subscription.
4. Public history establishes a visible timeline of the product and its engineering decisions.
5. The product benefits from public credibility while the license withholds reuse rights.

Verified external references:

1. GitHub Actions billing: https://docs.github.com/en/billing/concepts/product-billing/github-actions
2. CodeRabbit public repository program: https://www.coderabbit.ai/oss
3. GitHub public repository license rules:
   https://docs.github.com/en/enterprise-cloud@latest/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/licensing-a-repository
4. Copyright coverage for computer programs: https://www.copyright.gov/register/tx-programs.html

## Free protection plan after Epic 6

Murat wants a low-maintenance plan he can complete from his computer without paying attorneys or
registration services.
Kerem has stored the full Epic 6 handoff in persistent memory.

The required actions are:

1. Verify the license owner, years, package privacy flags, and `UNLICENSED` metadata.
2. Audit repository authors and any outside contributions.
3. Create a timestamped GitHub release with commit SHA, source archives, and checksums.
4. Generate a `PROVENANCE.md` record from Git history and test evidence.
5. Identify one small private server-side seam before future differentiating logic is implemented.
6. Search public code for distinctive copied strings and preserve evidence when matches appear.

The likely private seam is future learning and ranking logic inside the personalization layer.
Current deterministic implementations can remain public.
Future fine-tuned models, proprietary evaluation corpora, learned ranking, and derived user-data
logic can sit behind a private service while public adapters, contracts, and tests preserve the
portfolio story.

## Instructions for web agents

1. Lead with 254,055 hand-written code lines and the 125,023 to 129,032 source/test split.
2. Describe the project as solo-built and agent-assisted.
3. Show the test layers and product surfaces because they establish the repository's shape.
4. Use `public proprietary source` or `public-source, proprietary` for the repository.
5. Link to the GitHub repository as inspectable proof.
6. State that Epic 6 remains in progress when discussing current status.
7. Keep future revenue language forward-looking until payment evidence exists.
8. Present the license as an intentional product and portfolio decision.
9. Explain that implementation reuse is prohibited.
10. Keep independent product ideas outside the protection claim.

Avoid these claims:

1. `418,508 lines of code.` That number includes documentation, JSON, generated code, and assets.
2. `Open source.` The repository is public proprietary source under an all-rights-reserved notice.
3. `Nobody can copy the idea.` Copyright protects the implementation.
4. `A completed commercial product.` Epic 6 and later delivery remain active.
5. Direct line-count comparisons with named projects unless every repository is measured with the
   same method and revision.

## Source files for future refreshes

1. Product brief: `_bmad-output/project-knowledge/couturecast_brief.md`
2. Roadmap: `_bmad-output/project-knowledge/couturecast_roadmap.md`
3. Architecture: `_bmad-output/planning-artifacts/architecture.md`
4. Sprint status: `_bmad-output/implementation-artifacts/sprint-status.yaml`
5. License: `LICENSE`
6. Repository introduction: `README.md`
