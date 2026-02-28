# CoutureCast — Project Brief

<!-- markdownlint-configure-file {"MD013": false, "MD060": false} -->

Updated: 2026-02-28 — align roadmap authority, age policy, and activation metrics

Version 1.1 — Audience update included

Prepared by: **Mary – Business Analyst (BMAD Method v6)**  
Date: November 2025

---

## 🌤️ 1. Overview

**CoutureCast** is a multi-platform lifestyle app and widget that combines **accurate local weather forecasting** with **personalized outfit recommendations**.

It answers the daily question:

> “What’s the weather today — and what should I wear?”

By integrating **weather data**, **personal wardrobes**, and **style-driven community features**, CoutureCast transforms a routine check into a moment of _inspiration, convenience, and confidence._ Launch localization covers English, Spanish, and French so the experience travels effortlessly with users.

---

## 🎯 2. Target Audience

| Segment                  | Age   | Description                             | Key Motivations                           |
| ------------------------ | ----- | --------------------------------------- | ----------------------------------------- |
| **Teens (13–17)**        | 13–17 | Social, expressive users; trend-focused | Personal style discovery, peer validation |
| **Young Adults (18–29)** | 18–29 | Students, early professionals           | Save time, look stylish, multitask        |
| **Adults (30+)**         | 30–65 | Pragmatic, convenience-driven           | Quick outfit guidance, minimal input      |

**Future Segment:** _CoutureCast Jr._ (Ages 12 and under)  
A separate COPPA-compliant app planned for kids. Until Jr launches, users under 13 cannot access any
main CoutureCast features (core weather/outfit experience or community).

---

## 🧠 3. Problem & Solution

| Problem                                  | Solution                                                                     |
| ---------------------------------------- | ---------------------------------------------------------------------------- |
| Weather apps show numbers, not guidance. | Visual, contextual outfit suggestions linked to real conditions.             |
| Choosing an outfit wastes time.          | AI-powered recommendations based on user wardrobe, preferences, and climate. |
| No social hub for practical fashion.     | Integrated “CoutureCast Community” for sharing outfits and seasonal looks.   |

---

## 💡 4. Key Features

| Category                             | Description                                                                     |
| ------------------------------------ | ------------------------------------------------------------------------------- |
| **Weather Engine**                   | Free: current + hourly (next 24h); Premium: full 7-day forecast                  |
| **Outfit Recommendations**           | AI-driven suggestions mapped to conditions + wardrobe                           |
| **Wardrobe Management**              | Upload clothing photos, categorize, tag comfort/temp rating                     |
| **Customization Controls**           | Toggle between “Simple” and “Detailed” modes; privacy and data toggles          |
| **Community Feed**                   | Share looks, gain feedback, and engage in themed outfit challenges              |
| **Widgets & Smartwatch Integration** | Quick-glance “What to Wear” summaries                                           |
| **Localization**                     | English, Spanish, and French experiences with locale-aware units and legal copy |
| **Monetization Model**               | Freemium: Free same-day guidance; Premium unlocks 7-day forecasts/planner + advanced pairing |
| **Privacy & Security**               | Main product is strictly 13+; under-13 blocked from core/community until separate Jr app launches |

---

## 💰 5. Business Model

| Tier             | Features                                                             | Revenue                       |
| ---------------- | -------------------------------------------------------------------- | ----------------------------- |
| **Free**         | Current conditions + next 24h hourly forecast + same-day outfit suggestion; up to 30 wardrobe items | Ads (non-intrusive)           |
| **Premium**      | Full 7-day weather forecast + 7-day outfit planner, advanced pairing, ad-free, unlimited wardrobe | Subscription (monthly/yearly) |
| **Partnerships** | Sponsored outfits, affiliate shopping links (clearly labeled)        | B2B collaborations            |

---

## 🌍 6. Market Positioning

| Competitor      | Strengths                                                 | Gaps                         |
| --------------- | --------------------------------------------------------- | ---------------------------- |
| **Cladwell**    | Wardrobe management                                       | Lacks cross-platform widgets |
| **Weather Fit** | Weather + outfit widget                                   | No wardrobe uploads          |
| **GetWardrobe** | AI outfits                                                | Weak community engagement    |
| **CoutureCast** | ✅ Multi-platform widgets, ✅ AI + wardrobe, ✅ Community | Unique holistic ecosystem    |

---

## 🧩 7. Technology Stack (Proposed)

| Layer              | Tools / Services                                                    |
| ------------------ | ------------------------------------------------------------------- |
| **Weather API**    | OpenWeather One Call (MVP), upgrade path to WeatherKit              |
| **Backend**        | Node.js + PostgreSQL + Prisma (for wardrobes, preferences)          |
| **Frontend**       | React Native (mobile), Electron (desktop widget), watchOS extension |
| **AI Layer**       | Lightweight rules engine → fine-tuned outfit LLM (Phase 2)          |
| **Auth & Privacy** | OAuth (Google, Apple, Facebook), encrypted local store              |
| **Hosting / CI**   | Vercel / AWS Amplify + GitHub Actions CI/CD                         |
| **Testing**        | Cypress (UI), Playwright (E2E), Pact.js (API contract)              |

---

## 🛡️ 8. Compliance & Ethics

- Main CoutureCast is strictly 13+; users under 13 cannot create accounts or access any core/community features
- Ages 12 and under are deferred to a separate product path: _CoutureCast Jr._ (when launched)
- GDPR/CCPA compliant: consent, deletion, export
- No ad personalization for minors
- Transparent data-use disclosures and parental options planned for future child-friendly version

---

## 🚀 9. Go-To-Market Plan

Phase names and ordering in this brief follow `docs/couturecast_roadmap.md`; roadmap sequencing is the source
of truth if future docs diverge.

| Phase       | Deliverable                                      | Duration           |
| ----------- | ------------------------------------------------ | ------------------ |
| **Phase 1** | MVP Build for 13+ (weather + outfit core, widgets, EN/ES/FR) | 10–12 weeks        |
| **Phase 2** | Community Beta (social feed + moderation + challenges) | +6 weeks           |
| **Phase 3** | Monetization + Wardrobe Uploads                  | +4 weeks           |
| **Phase 4** | Expansion & Jr. planning                          | +6 weeks           |

---

## 📈 10. Success Metrics

| KPI                   | Goal                                       |
| --------------------- | ------------------------------------------ |
| MVP Activation        | ≥ 70% new users complete setup and view first outfit card in ≤ 2 mins |
| Retention (D7)        | ≥ 25%                                      |
| Wardrobe Engagement   | 40%+ upload ≥5 items                       |
| User Satisfaction     | ≥ 4.5/5 average “Outfit Accuracy” rating   |
| Conversion to Premium | ≥ 10% within 90 days                       |

---

## 🧭 11. Summary

**CoutureCast** merges **utility (weather)** and **identity (style)** to become an everyday essential.  
It has clear **product-market fit**, manageable technical scope, and strong **phase-based growth potential.**

---

## 🧱 Requirements backlog (v1)

### Epic 1 — Core Weather Experience

- **User Story 1.1**: As a user, I want to view current temperature, precipitation, and forecast so that I can plan my day.
  - ✅ _Acceptance Criteria:_ Displays temperature, conditions, icons, and “feels like” info; updates automatically every 30 min.
- **User Story 1.2**: As a user, I want to receive weather alerts when conditions change significantly.
  - ✅ _Acceptance Criteria:_ Alerts trigger within 5 minutes when rain probability reaches ≥60% or temperature shifts by ≥8°F within 3 hours; users can independently toggle rain vs. temperature alerts.

### Epic 2 — Outfit Recommendation Engine

- **User Story 2.1**: As a user, I want outfit suggestions based on today’s weather so that I know what to wear.
  - ✅ AC: Engine returns at least one recommendation each for tops, bottoms, and shoes, recalculating when temperature, wind, or precipitation inputs change.
- **User Story 2.2**: As a user, I want to customize my comfort range (e.g., "I run cold") to personalize recommendations.
  - ✅ AC: A 5-level comfort slider shifts recommendation thresholds by up to ±10°F and applies updated thresholds to the next recommendation request.
- **User Story 2.3**: As a premium user, I want to see a 7-day outfit planner.
  - ✅ AC: Planner lists 7 daily outfits; available only in Premium.

### Epic 3 — Wardrobe Management

- **User Story 3.1**: As a user, I can upload clothing photos and categorize them.
  - ✅ AC: Upload flow auto-tags garment type from supported labels (shirt, pants, jacket, shoes, accessory), and users can edit tags before saving.
- **User Story 3.2**: As a user, I can build outfits manually for later use.
  - ✅ AC: Saved outfits appear in library within 2 seconds and are retrievable by tag and weather-condition filters.

### Epic 4 — Community & Social

- **User Story 4.1**: As a user, I can post my daily outfit and view others’ posts.
  - ✅ AC: Default feed ranks posts from locations within ±5°F and matching precipitation type before recency-based fallback.
- **User Story 4.2**: As a user, I can like, comment, and follow friends.
  - ✅ AC: Users can like, comment, and follow/unfollow from feed and profile views; report actions create moderation-queue entries visible within 60 seconds.
- **User Story 4.3**: As a user, I can participate in weekly outfit challenges.
  - ✅ AC: System publishes one challenge every Monday (00:00 local time) with title, rules, and a 7-day submission window.

### Epic 5 — Privacy & Security

- **User Story 5.1**: As a user, I can control data permissions.
  - ✅ AC: Settings provide separate toggles for data sharing, connected-account sync, and profile visibility; each change persists after app restart.
- **User Story 5.2**: As a prospective user, I must pass 13+ age verification before accessing any main CoutureCast features.
  - ✅ AC: Signup requires date of birth; accounts calculated under 13 are blocked from main app login/signup and shown Jr waitlist messaging, while only 13+ users can proceed to core and community experiences.
- **User Story 5.3**: As a user, I can delete my account and data.
  - ✅ AC: GDPR-compliant deletion within 72 hours.

### Epic 6 — Monetization

- **User Story 6.1**: As a user, I can upgrade to Premium via in-app purchase.
  - ✅ AC: Monthly and yearly purchases complete via Stripe or Apple Pay sandbox flows, and Premium entitlement activates in-app within 30 seconds.
- **User Story 6.2**: As an advertiser, I can submit sponsored outfits.
  - ✅ AC: Sponsored label; only shown to 18+ users.

### Epic 7 — Cross-Platform Delivery

- **User Story 7.1**: As a user, I can view CoutureCast as a widget (home/lock screen).
  - ✅ AC: Widget displays current temperature, condition icon, and top outfit recommendation, refreshing at least every 30 minutes.
- **User Story 7.2**: As a smartwatch user, I can see quick outfit icons.
  - ✅ AC: Watch interface syncs selected units and outfit-preference settings from mobile within 60 seconds of a mobile change.

### Epic 8 — Analytics & Insights

- **User Story 8.1**: As an admin, I can track engagement metrics (DAU, retention, outfit shares).
  - ✅ AC: Admin dashboard shows DAU, D7 retention, and outfit-share counts with 7/30/90-day date-range filters.
- **User Story 8.2**: As a data analyst, I can export anonymized usage data.
  - ✅ AC: Export supports CSV and JSON, uses anonymized user IDs, and completes within 2 minutes for datasets up to 1M events.

✅ **Total:** 8 Epics → 19 Core User Stories (MVP + Premium foundation)
