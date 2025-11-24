# CoutureCast — Project Brief

_(Version 1.1 — Audience Update Included)_

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
A simplified, COPPA-compliant educational app for kids, with no social features and parental supervision.

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
| **Weather Engine**                   | Real-time local & hourly weather; 7-day forecast (premium)                      |
| **Outfit Recommendations**           | AI-driven suggestions mapped to conditions + wardrobe                           |
| **Wardrobe Management**              | Upload clothing photos, categorize, tag comfort/temp rating                     |
| **Customization Controls**           | Toggle between “Simple” and “Detailed” modes; privacy and data toggles          |
| **Community Feed**                   | Share looks, gain feedback, and engage in themed outfit challenges              |
| **Widgets & Smartwatch Integration** | Quick-glance “What to Wear” summaries                                           |
| **Localization**                     | English, Spanish, and French experiences with locale-aware units and legal copy |
| **Monetization Model**               | Freemium: Free daily forecasts, Premium for extended insights and wardrobe AI   |
| **Privacy & Security**               | Designed for users 13+; opt-in data linking, OAuth for external accounts        |

---

## 💰 5. Business Model

| Tier             | Features                                                             | Revenue                       |
| ---------------- | -------------------------------------------------------------------- | ----------------------------- |
| **Free**         | Daily weather + outfit suggestion; limited wardrobe items            | Ads (non-intrusive)           |
| **Premium**      | 7-day forecast, advanced outfit pairing, ad-free, unlimited wardrobe | Subscription (monthly/yearly) |
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

- Users under 13 excluded (separate product: _CoutureCast Jr._)
- GDPR/CCPA compliant: consent, deletion, export
- No ad personalization for minors
- Transparent data-use disclosures and parental options planned for future child-friendly version

---

## 🚀 9. Go-To-Market Plan

| Phase       | Deliverable                                      | Duration           |
| ----------- | ------------------------------------------------ | ------------------ |
| **Phase 1** | MVP for 13+ (CoutureCast App + Widget)           | 10–12 weeks        |
| **Phase 2** | Community Beta (Social feed + Gamified features) | +6 weeks           |
| **Phase 3** | Launch of CoutureCast Jr.                        | +3 months post MVP |
| **Phase 4** | Brand partnerships & analytics dashboards        | Ongoing            |

---

## 📈 10. Success Metrics

| KPI                   | Goal                                       |
| --------------------- | ------------------------------------------ |
| MVP Activation        | ≥ 70% new users complete setup in < 2 mins |
| Retention (D7)        | ≥ 25%                                      |
| Wardrobe Engagement   | 40%+ upload ≥5 items                       |
| User Satisfaction     | ≥ 4.5/5 average “Outfit Accuracy” rating   |
| Conversion to Premium | ≥ 10% within 90 days                       |

---

## 🧭 11. Summary

**CoutureCast** merges **utility (weather)** and **identity (style)** to become an everyday essential.  
It has clear **product-market fit**, manageable technical scope, and strong **phase-based growth potential.**

---

# 🧱 REQUIREMENTS BACKLOG (v1)

### Epic 1 — Core Weather Experience

- **User Story 1.1**: As a user, I want to view current temperature, precipitation, and forecast so that I can plan my day.
  - ✅ _Acceptance Criteria:_ Displays temperature, conditions, icons, and “feels like” info; updates automatically every 30 min.
- **User Story 1.2**: As a user, I want to receive weather alerts when conditions change significantly.
  - ✅ _Acceptance Criteria:_ Push notifications trigger for rain/temp drops; user can toggle alerts.

### Epic 2 — Outfit Recommendation Engine

- **User Story 2.1**: As a user, I want outfit suggestions based on today’s weather so that I know what to wear.
  - ✅ AC: Outfit categories (tops, bottoms, shoes, accessories) adapt to temp/wind/precip.
- **User Story 2.2**: As a user, I want to customize my comfort range (e.g., "I run cold") to personalize recommendations.
  - ✅ AC: Preference slider changes outfit thresholds dynamically.
- **User Story 2.3**: As a premium user, I want to see a 7-day outfit planner.
  - ✅ AC: Planner lists 7 daily outfits; available only in Premium.

### Epic 3 — Wardrobe Management

- **User Story 3.1**: As a user, I can upload clothing photos and categorize them.
  - ✅ AC: Auto-tagging detects garment type (shirt, pants, jacket); editable.
- **User Story 3.2**: As a user, I can build outfits manually for later use.
  - ✅ AC: “Save outfit” function; searchable by tag or condition.

### Epic 4 — Community & Social

- **User Story 4.1**: As a user, I can post my daily outfit and view others’ posts.
  - ✅ AC: Feed sorted by weather similarity (e.g., “others near 60°F and rainy”).
- **User Story 4.2**: As a user, I can like, comment, and follow friends.
  - ✅ AC: Standard engagement features; mod tools in place.
- **User Story 4.3**: As a user, I can participate in weekly outfit challenges.
  - ✅ AC: Auto-generated themes (“Rainy Day Fit”, “Layer Master”).

### Epic 5 — Privacy & Security

- **User Story 5.1**: As a user, I can control data permissions.
  - ✅ AC: Clear toggles for data sharing, API connections.
- **User Story 5.2**: As a user 13+, I confirm my age before accessing community features.
  - ✅ AC: One-time age verification gate.
- **User Story 5.3**: As a user, I can delete my account and data.
  - ✅ AC: GDPR-compliant deletion within 72 hours.

### Epic 6 — Monetization

- **User Story 6.1**: As a user, I can upgrade to Premium via in-app purchase.
  - ✅ AC: Stripe/Apple Pay integration.
- **User Story 6.2**: As an advertiser, I can submit sponsored outfits.
  - ✅ AC: Sponsored label; only shown to 18+ users.

### Epic 7 — Cross-Platform Delivery

- **User Story 7.1**: As a user, I can view CoutureCast as a widget (home/lock screen).
  - ✅ AC: Widget shows weather + outfit summary.
- **User Story 7.2**: As a smartwatch user, I can see quick outfit icons.
  - ✅ AC: Watch interface auto-syncs with mobile settings.

### Epic 8 — Analytics & Insights

- **User Story 8.1**: As an admin, I can track engagement metrics (DAU, retention, outfit shares).
  - ✅ AC: Dashboard in admin portal.
- **User Story 8.2**: As a data analyst, I can export anonymized usage data.
  - ✅ AC: GDPR-compliant export format.

✅ **Total:** 8 Epics → 20 Core User Stories (MVP + Premium foundation)
