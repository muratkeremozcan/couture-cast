# Story 0.13: Scaffold cross-surface E2E automation

Status: in-progress

## Story

As the master test architect,
I want baseline Playwright and Maestro smoke harnesses wired into CI,
so that web and mobile journeys are validated end-to-end before feature teams branch off.

## Acceptance Criteria

1. Add Playwright (Chromium) dependencies and a shared root-level `playwright/config` folder that reads `WEB_E2E_BASE_URL`, defaults to `http://localhost:3005`, pins headless execution, emits HTML/trace artifacts, and tags suites per docs/test-design-system.md Test Framework guidance. Provide scripts `npm run test:pw-local` (plus other deployment aliases) that build `apps/web`, serve it on port 3005, and run `playwright test --project=chromium` with zero hard waits.
2. Create a smoke spec under `playwright/tests/` that validates the Next.js landing route renders the couture hero copy, accessibility landmarks, and health pings for the Nest API BFF, using the selector guidelines and accessibility checks called out in docs/test-design-system.md (axe-core integration + P0 focus handling).
3. Scaffold Maestro under `maestro/` (e.g., `sanity.yaml`, `.maestro/config.yaml`) that launches the Expo Router tabs template via `MOBILE_E2E_APP_URL` and surfaces logs/artifacts. Provide scripts `npm run test:mobile:e2e` and `npm run test:mobile:e2e:ci` that install Maestro (locally + CI) and run the flow headlessly or against Maestro Cloud when no simulator is available.
4. Update documentation and CI: extend README with prerequisites (Node 24, Expo Go scripted install, Android Emulator), describe how to run the new commands alongside `npm run dev`, and update `.github/workflows/pr-checks.yml` with an `e2e` job that reuses the install cache, runs `npm run build`, executes both smoke commands, uploads Playwright HTML/trace plus Maestro logs, and publishes a soft-fail status while suites stabilize. (docs/test-design-system playbook pending)

## Tasks / Subtasks

- [x] Task 1: Playwright harness (AC: #1, #2)
  - [x] Install `@playwright/test@latest` at the workspace root and add `playwright/config/*.config.ts` with a base + local environment split.
  - [x] Configure Chromium-only project with retries=0, reporter=`['line',{ reporter: 'html', outputFolder: 'playwright/playwright-report' }]`, trace on first retry, and baseURL driven by `WEB_E2E_BASE_URL`.
  - [x] Create smoke spec (e.g., `playwright/tests/home.spec.ts`) that warms up the Nest API health endpoint, loads `/`, verifies couture hero copy, nav tabs, and `data-testid` instrumentation.
  - [x] Add scripts `test:pw-local`, `test:pw-dev`, `test:pw-stage`, and helper commands to the root package.json; document how they build once and rely on Playwright's `webServer` hook to launch the app headlessly.

- [x] Task 2: Maestro harness (AC: #3)
  - [x] Add `maestro/sanity.yaml` that starts the Expo app via dev server, backs out of modals, and captures a smoke screenshot (lightweight sanity).
  - [x] Add `.maestro/config.yaml` (or `maestro.config.json`) to centralize env vars (Expo username, dev server URL, Maestro Cloud credentials if needed).
  - [x] Provide scripts `test:mobile:e2e`, `test:mobile:e2e:ci`, and `maestro:install` that fetch the Maestro CLI (Brew on macOS/Linux, npm exec fallback on CI) before running flows.
  - [x] Ensure Expo Metro bundler is started/stubbed for CI (either via `expo start --offline --http 8082` or a mocked bundle) so Maestro can attach deterministically.

- [x] Task 3: Documentation + DX updates (AC: #4)
  - [x] Update README commands + prerequisites with the new e2e scripts, emulator/Maestro expectations, and troubleshooting steps (scripted Expo Go install).
  - [x] Add a short “E2E smoke playbook” subsection to docs/test-design-system.md describing when to run Playwright vs Maestro and how to tag @p0 smoke tests; include env hints (`WEB_E2E_BASE_URL`, `MOBILE_E2E_APP_URL`) and artifact publishing.

- [ ] Task 4: CI integration (AC: #4)
  - [ ] Update `.github/workflows/pr-checks.yml` with a new `e2e` job that depends on build/test, restores the npm + Playwright caches, runs both smoke commands, and uploads `playwright/playwright-report` + Maestro logs.
  - [ ] Wire optional gating: mark the job as `continue-on-error: true` initially while suites mature, but still surface statuses in PRs.
  - [ ] Emit CI telemetry (e.g., `E2E_SMOKE_STATUS` summary) so PostHog/Grafana dashboards can capture smoke stability alongside build stats.

## Dev Notes

### Status snapshot (2025-11-17)

- ✅ Playwright harness + CI scripts complete (Task 1)
- ✅ Maestro scaffolding, scripts, and run orchestration complete (Task 2)
- ⚠️ Documentation/CI updates (Tasks 3–4) still pending
- ⚠️ Local mobile smoke currently blocked on missing device emulators—see “Maestro setup + operational notes”

**Next actions**
1. Follow “Maestro setup + operational notes” (below) to install Xcode Simulator and Android Studio/AVD locally so `npm run start:mobile:e2e` succeeds.
2. Mirror those prerequisites in CI (Android SDK install or Maestro Cloud tokens) before wiring the `pr-checks` e2e job.
3. Once device access is solved, update README + docs/test-design-system.md per Task 3, then add the CI job per Task 4.

### Maestro setup + operational notes

> **No paid cloud dependency** – everything below assumes local macOS simulators/emulators only.

#### One-time prerequisites (macOS)

1. **Xcode + CLI tools** – install from the App Store, launch once, then `sudo xcode-select --switch /Applications/Xcode.app`. Verify with `xcodebuild -version`.
2. **(Optional) idb-companion** – improves iOS simulator reliability:  
   ```bash
   brew tap facebook/fb
   brew install facebook/fb/idb-companion
   ```
3. **Android Studio + SDK** – download from <https://developer.android.com/studio>, install platform-tools/build-tools/command-line tools via SDK Manager, create a Pixel 8 (API 34) AVD in Device Manager, and boot it once. Verify with `adb devices`.
4. **Maestro CLI** – `npm run maestro:install --silent` (wraps brew/curl installer) and confirm `maestro --version`.
5. **Expo Go install (scripted)** – boot the emulator, then run `npm run mobile:expo-go` to download and install the latest Expo Go APK via adb. Avoids Play Store login prompts.

#### Per-run workflow

1. **Boot the emulator/simulator**  
   - iOS: `open -a Simulator` → choose device → confirm `xcrun simctl list devices | grep Booted`.  
   - Android: `~/Library/Android/sdk/emulator/emulator -avd Pixel_8_API_34 -no-snapshot &` → `adb wait-for-device`.
2. **Run the one-shot smoke**  
   ```bash
   npm run test:mobile:e2e
   ```  
   This installs Maestro if missing, reuses an existing Metro if running, or starts one; loads Expo Go via dev URL; backs out of modals; captures a smoke screenshot.

Quick reference:

```bash
npm run maestro:install --silent
npm run mobile:device              # optional helper
npm run start:mobile:e2e
MOBILE_E2E_SKIP_SERVER=1 npm run test:e2e:mobile:attached
```

#### GitHub Actions (macOS runner, emulator)

```yaml
- name: Install Android SDK
  run: |
    brew install --cask android-commandlinetools
    yes | sdkmanager --licenses
    sdkmanager "platform-tools" "platforms;android-34" "system-images;android-34;google_apis_playstore;x86_64" "emulator"
- name: Create AVD
  run: avdmanager create avd -n pixel_ci -k "system-images;android-34;google_apis_playstore;x86_64" --device "pixel_7"
- name: Start emulator
  run: |
    nohup $ANDROID_HOME/emulator/emulator -avd pixel_ci -no-window -no-audio -gpu swiftshader_indirect -no-boot-anim &
    adb wait-for-device
    adb shell input keyevent 82
- name: Run Maestro smoke
  env:
    MOBILE_E2E_SKIP_SERVER: "1"
  run: npm run test:e2e:mobile:ci
```

#### Troubleshooting

- Ensure `maestro devices list` shows at least one entry before running the flow.
- If Expo sticks on “Waiting on http://localhost:8081”, adjust `MOBILE_E2E_APP_URL` / `MOBILE_E2E_HEALTH_URL` (default fallback: 19000 → 8081).
- Reboot simulators via `scripts/reset-simulator.sh` (requires sudo) if they get stuck.
- Keep a single Metro server alive to avoid port battles; use `MOBILE_E2E_SKIP_SERVER=1` whenever possible.

### Architecture Context

- `docs/bmm-architecture-20251110.md` (Project Structure & Task Graph sections) confirms Expo, Next.js, and Nest apps already share npm workspaces with Turbo orchestrating `lint → test → build`, so the Playwright/Maestro harnesses should live inside ` and reuse existing scripts rather than creating new top-level commands.  
  [Source: docs/bmm-architecture-20251110.md#Project-Structure]
- Story 0-1’s Dev Agent Record notes that `npm run dev`, `npm run test`, and `npm run build` already pass across all apps, and ` exists as a placeholder. We should reuse that folder for Playwright/Maestro configs instead of scattering files across apps.  
  [Source: docs/sprint-artifacts/0-1-initialize-turborepo-monorepo.md#Dev-Agent-Record]

### Testing Context

- `docs/test-design-system.md` mandates Playwright for web/widgets and Maestro for Expo, with smoke (@p0) vs regression (@p1) tags, axe-core a11y checks, and device matrix coverage (Chromium desktop + Expo simulator).  
  [Source: docs/test-design-system.md#Test-framework]
- The same doc’s CI matrix section requires storing Playwright HTML/trace artifacts and wiring Maestro into selective pipelines alongside PostHog telemetry, so the e2e job must upload artifacts even while optional.  
  [Source: docs/test-design-system.md#Cross-Surface-Device-Matrix]
- Accessibility gates (axe-core) and localization checks must run inside Playwright; seed factories from CC-0.10 will eventually power richer data, but this story focuses on framework plumbing with placeholder assertions.  
  [Source: docs/test-design-system.md#Accessibility-Test-Matrix]

### Project Structure Notes

- Place Playwright config + smoke specs under `/playwright/` with `tsconfig` references to shared lint rules; this avoids conflicting tsconfigs inside app directories.
- Maestro flows live under `maestro/` so both harnesses share the same workspace dependencies and can be invoked via root scripts.
- Add `test:e2e:*` scripts to `package.json` and document them in README’s command table; ensure they respect Turbo’s dependency graph if we later promote them into `turbo.json`.

### References

- [Source: docs/epics.md#Story-CC-0.13-Scaffold-cross-surface-E2E-automation]
- [Source: docs/test-design-system.md#Test-framework]
- [Source: docs/test-design-system.md#Cross-Surface-Device-Matrix]
- [Source: docs/bmm-architecture-20251110.md#Project-Structure]
- [Source: docs/sprint-artifacts/0-1-initialize-turborepo-monorepo.md#Dev-Agent-Record]

## Dev Agent Record

### Context Reference

- docs/sprint-artifacts/stories/0-13-scaffold-cross-surface-e2e-automation.context.xml (generated 2025-11-16)

### Agent Model Used

<!-- Will be filled when Dev agent executes -->

### Debug Log References

### Completion Notes List

### File List

## Change Log

| Date | Author | Change |
| ---- | ------ | ------ |
| 2025-11-17 | Bob (Scrum Master) | Story drafted from Epic 0, CC-0.13 acceptance criteria |
