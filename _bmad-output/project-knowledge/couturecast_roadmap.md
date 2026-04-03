<!-- Step 1 step 2 owner: searchable owner anchor -->

# CoutureCast — Project Roadmap (Updated)

<!-- markdownlint-configure-file {"MD013": false, "MD060": false} -->

Updated: 2026-02-28 — sync with brief governance and clarified activation thresholds

Prepared by: **John – Product Manager (BMAD Method v6)**  
Date: November 2025  
Version: 1.3 — BMAD Integration + GitHub Preservation

---

## 🧭 1. Project Level Assessment

| Dimension               | Assessment                        | Justification                                                                                         |
| ----------------------- | --------------------------------- | ----------------------------------------------------------------------------------------------------- |
| **Scope Level**         | Level 2 (Focused PRD + Tech Spec) | Single cross-platform app with moderate complexity, clear user segmentation, and defined premium path |
| **Dependencies**        | Medium                            | Weather APIs, OAuth, AI rule engine, wardrobe database                                                |
| **Risk**                | Medium                            | Privacy compliance, AI accuracy, cross-platform QA                                                    |
| **Delivery Complexity** | Medium-High                       | Multiple integrations + design + mobile + community moderation                                        |

🟡 **Conclusion:** Manageable for a 2–3 person product pod (PM + Dev + QA/UX) with parallel backend/UX workstreams.

---

## 🗓️ 2. Phase Roadmap (PRD Planning Timeline)

| Phase                                         | Duration    | Goals                                                             | Key Deliverables (BMAD Standard)                                                                                              |
| --------------------------------------------- | ----------- | ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| **Phase 1 — MVP Build**                       | 10–12 weeks | Deliver weather + outfit engine + widgets + EN/ES/FR localization | BMAD Epic Cards (1–2,7,8), PRD artifact in GitHub repo                                                                        |
| **Phase 2 — Community Beta**                  | +6 weeks    | Social features + moderation + compliance readiness               | BMAD Workflow docs for Epic 4, moderation policy + ops staffing plan, age-gate/privacy readiness sign-off before beta opening |
| **Phase 3 — Monetization + Wardrobe Uploads** | +4 weeks    | Subscription system + wardrobe uploads                            | BMAD finance/commerce module spec; wardrobe integration plan                                                                  |
| **Phase 4 — Expansion & Jr. Planning**        | +6 weeks    | Begin COPPA-safe app for U13                                      | BMAD compliance + educational UX deliverables preserved in repo                                                               |

📌 **Sequencing rule:** This phase order is the roadmap source of truth; prioritization, KPI targets, and launch gates follow this sequence.

🕓 **Total roadmap:** ~6 months to full market readiness.

---

## 🧱 3. MVP Definition (Phase 1)

**In-Scope MVP Epics:**

- Epic 1 (Weather Core)
- Epic 2 (Outfit Engine)
- Epic 7 (Cross-Platform Delivery → Widgets & Watch Integration)
- Epic 8 (Analytics)
- Localization baseline covering English, Spanish, and French with locale-aware units and legal copy

**MVP Out of Scope:**

- Community sharing (Epic 4)
- Wardrobe uploads (Epic 3 → moved to Phase 3)
- Premium subscriptions (Epic 6)

**Success Gate:**  
“User can open the app in any launch language, see weather, get an outfit suggestion, and access it from their widget/watch in under 2 minutes.”

---

## 🎨 4. Product Deliverables by Role (BMAD-Compliant)

| Role        | Deliverable                                                                                    | Output Format                               | Preservation                                      |
| ----------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------- | ------------------------------------------------- |
| **UX / UI** | Mockups: “What to Wear” screen + widget + watch view + localized copy specs                    | Figma → BMAD Design Export                  | Saved to GitHub `/design/` folder                 |
| **Dev**     | Frontend (React Native), backend API (Node/Prisma), weather integration, localization pipeline | Code + Markdown BMAD module docs            | GitHub `/src/` + `/_bmad-output/` folders         |
| **PM**      | PRD, user flow charts, release checklist                                                       | BMAD project YAML + Markdown brief          | GitHub `/_bmad-output/planning-artifacts/` folder |
| **QA**      | Acceptance test scripts (mapped to backlog AC) + localization regression pack                  | Cypress / Playwright suite + BMAD test YAML | GitHub `/tests/` folder                           |

All deliverables follow **BMAD Method v6 repository structure**, ensuring full traceability and automated artifact preservation under version control.

---

## ⚙️ 5. Technical Risks and Mitigations

| Risk                                | Impact                     | Mitigation                                                                 |
| ----------------------------------- | -------------------------- | -------------------------------------------------------------------------- |
| API rate limits                     | Outages or stale weather   | Cache hourly, fallback to secondary API                                    |
| AI outfit rules too basic           | Poor UX                    | Add manual override + user feedback loop                                   |
| Widget sync issues across platforms | UX inconsistency           | Use shared RN component logic and watchOS mirroring                        |
| Localization quality gaps           | Brand dilution, user churn | Implement translation QA workflow + native-language review before release  |
| Social moderation (Phase 2)         | Reputational risk          | Moderation SOP + ops readiness gate required before Community Beta opening |
| Privacy violations (13+)            | Legal risk                 | Age-gate and minimal data storage validated before Community Beta opening  |

---

## 🧩 6. KPI Alignment by Phase

| Phase        | KPIs                                                                       | Target                                        |
| ------------ | -------------------------------------------------------------------------- | --------------------------------------------- |
| MVP          | Activation (≥70%), Aha Time < 60s, End-to-first-outfit < 2 min (guardrail) | Validate core UX with fast value confirmation |
| Beta         | Engagement (D7 ≥25%), Post Rate ≥30%                                       | Validate community value                      |
| Monetization | Conversion ≥10%, Retention (M3 ≥20%)                                       | Validate business model                       |
| Expansion    | Jr. Waitlist Signups ≥1,000                                                | Validate kid-friendly demand                  |

`Aha Time < 60s` is the optimization KPI; `< 2 min` is the hard launch guardrail for full first-value completion.

---

## 📊 7. Risk-Based Prioritization Matrix (Updated)

| Priority  | Feature                         | Rationale                                                                          |
| --------- | ------------------------------- | ---------------------------------------------------------------------------------- |
| 🔥 **P0** | Weather + Outfit Core           | Must-have for primary value proposition                                            |
| 🟢 **P1** | **Widgets & Watch Integration** | Highest visibility; multiplatform access drives retention & brand stickiness early |
| 🟣 **P2** | Community + Challenges          | Phase 2 growth lever after moderation + age-gate readiness are signed off          |
| 🔵 **P3** | **Wardrobe Uploads**            | Personalization layer scheduled in Phase 3 after Community Beta validation         |
| ⚫ **P4** | Ads + Brand Collabs             | Revenue enabler once user audience matures                                         |

---

## 🧩 8. Stakeholder Alignment & Comms Plan

| Stakeholder               | Interest          | Communication Cadence |
| ------------------------- | ----------------- | --------------------- |
| **Founder/Product Owner** | Strategic vision  | Bi-weekly review      |
| **Dev Lead**              | Execution & scope | Weekly sync           |
| **UX Lead**               | Design alignment  | 2x weekly             |
| **QA / Test Architect**   | Risk visibility   | Sprint-end demo       |
| **Marketing**             | Launch prep       | 3 weeks pre-launch    |

All updates and retros are stored as **BMAD sprint logs** in the GitHub `/_bmad-output/implementation-artifacts/` directory.

---

## 🚀 9. Launch Readiness Criteria

✅ MVP features complete & tested  
✅ Weather API stable & caching verified  
✅ Widget + Watch UI responsive and synced  
✅ BMAD documents validated and merged in repo  
✅ No critical UX blockers  
✅ Analytics integrated (DAU, retention, widget usage)  
✅ Marketing site + onboarding video ready

---

## 📦 10. Deliverable Summary

**Artifacts produced under `plan-project` (v1.3):**

- Updated roadmap timeline with reprioritized widget milestone
- MVP scope matrix (Widgets = P1)
- Risk register revision
- Launch checklist v2
- KPI alignment table
- All deliverables to be stored and versioned within **GitHub using BMAD Method structure**

**Total Duration:** ~6 months (including QA + Beta feedback)

**Next Step:** Run Phase 1 exit review and open Community Beta only after moderation + age-gate/privacy readiness gates are signed off.
