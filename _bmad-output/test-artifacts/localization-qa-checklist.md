# Localization infrastructure QA checklist

This checklist separates automated evidence from manual device and service checks. A checked
item has executable evidence in this repository. Unchecked items still require a human run
against a live mobile build and backend.

## Supported locale matrix

| Locale   | Language and region    | Temperature | Currency     | Measurement |
| :------- | :--------------------- | :---------- | :----------- | :---------- |
| `en-US`  | English, United States | Fahrenheit  | USD          | Inches      |
| `en-CA`  | English, Canada        | Celsius     | CAD          | Centimeters |
| `es-419` | Spanish, Latin America | Celsius     | USD or local | Centimeters |
| `fr-CA`  | French, Canada         | Celsius     | CAD          | Centimeters |
| `fr-FR`  | French, France         | Celsius     | EUR          | Centimeters |
| `tr-TR`  | Turkish, Turkey        | Celsius     | TRY          | Centimeters |
| `de-DE`  | German, Germany        | Celsius     | EUR          | Centimeters |
| `it-IT`  | Italian, Italy         | Celsius     | EUR          | Centimeters |
| `pt-BR`  | Portuguese, Brazil     | Celsius     | BRL          | Centimeters |
| `pt-PT`  | Portuguese, Portugal   | Celsius     | EUR          | Centimeters |

## Automated evidence

- [x] Canonical manifest contains exactly the 10 supported locales.
- [x] Mobile catalogs have exact key parity with `en-US`.
- [x] Formatter tests cover temperature, currency, and measurement units.
- [x] First launch resolves exact, regional, and language-only device locales.
- [x] Missing translation keys fall back to English.
- [x] The Settings screen persists `tr-TR`, calls the generated profile API, emits
      `locale_switched`, and renders `Ayarlar`.
- [x] The hero requests `locale=tr-TR` and renders `Açık`, `Saatlik tahmin`, and
      `Genişlet (48 sa)`.
- [x] Server tests cover explicit query, saved preference, weighted `Accept-Language`,
      English Fahrenheit notes, localized cache isolation, and custom badge preservation.
- [x] The generated SDK contract covers ritual locale queries and profile locale updates.
- [x] The Maestro flow switches to Turkish and verifies localized navigation and hero copy.

Automated commands:

```sh
node tools/sync-i18n.js
npm run test --workspace mobile
npm run test --workspace api
npm run test --workspace @couture/api-client
npm run test:pact
```

## Manual device checks

- [ ] Run `maestro/localization.yaml` on the supported iOS build.
- [ ] Run `maestro/localization.yaml` on the supported Android build.
- [ ] Inspect the language grid at small and large text sizes for clipping, overlap, and
      inaccessible controls.
- [ ] Verify safe-area spacing on devices with and without display cutouts.
- [ ] Force a profile-sync failure, confirm the localized retry notice, relaunch, and confirm
      the pending locale sync completes.
- [ ] Disable the network after loading English, switch to Turkish, and confirm no English
      ritual response is served from the local cache.

## Live service checks

- [ ] Confirm `UserProfile.preferences.locale` is updated without losing unrelated JSON
      preference fields.
- [ ] Confirm a request with `locale=tr-TR` overrides a conflicting saved locale and
      `Accept-Language` value.
- [ ] Confirm a saved `en-US` preference overrides `Accept-Language: tr-TR`.
- [ ] Inspect PostHog for `locale_switched` with `from_locale`, `to_locale`, `locale`, and an
      ISO timestamp.
- [ ] Confirm normal mobile screen and capture events include the active `locale` property.
