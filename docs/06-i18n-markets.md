# 06 – Internationalization & Market Strategy

## Language rollout

**Launch:** English + **Spanish, French, German** (as specified).

**Recommended order for the next wave (requested advice):**

| Priority | Language | Why |
|----------|----------|-----|
| 1 | **Portuguese (Brazilian)** | Brazil is one of the world's largest mobile-social gaming markets with a strong outdoor/party-game culture and very high social-sharing rates (the app's growth engine). Localization cost is low coming off Spanish tooling. Price sensitivity is handled by regional store tiers, not by skipping the market |
| 2 | **Japanese** | Highest mobile ARPU among large markets and strong photo-game culture (purikura heritage). The bar is high: quality localization (not translation alone), store-page craft, and culturally tuned marketing are prerequisites — budget accordingly |
| 3 | Korean | Similar high-ARPU, social-gaming-dense market; group activity culture fits the product |
| 4 | Italian / Dutch | Cheap EU expansions once FR/DE tooling exists |
| Later | Indonesian, Hindi | Huge audiences, ad/volume plays — revisit when free-tier economics justify |

**Market-entry notes:**

- **EU (DE/FR at launch):** high purchasing power; GDPR compliance is the entry ticket (doc 07). German users are notably privacy-sensitive — the "face detection only, no recognition" stance is a marketable trust point there.
- **LatAm (ES, then PT-BR):** growth market; use regional price tiers ($1.99-equivalent Tier 2). Expect heavier free-tier usage — the referral loop (doc 08) matters most here.
- **Japan/Korea:** monetization depth; enter only with full localization quality.

## Legal per market (summary — details in doc 07)

| Regime | Applies | Key obligations for PhotoChase |
|--------|---------|-------------------------------|
| **GDPR** (EU/EEA/UK) | DE, FR, ES + all EU users | Lawful basis for photos/GPS, DSRs (export/delete), data-minimization, age 16 default digital-consent age (member states vary 13–16) — we gate at 16 in EU without parental consent flows |
| **LGPD** (Brazil) | PT-BR launch | GDPR-like; appoint a DPO-equivalent contact; DSR flows reuse GDPR machinery |
| **APPI** (Japan) | JP launch | Consent for sensitive data, cross-border transfer disclosures |
| **COPPA** (US) | Always | Age gate 13+; no ad personalization for under-16s anywhere as a simplifying global rule |
| **BIPA (Illinois) / CUBI (Texas)** | US | Avoid biometric classification entirely: face *detection* without templates or identification (doc 04/07) |
| Store rules | Global | Apple/Google require in-app links to the privacy policy; Apple privacy nutrition labels and Google Data Safety form must match actual behavior |

## Engineering approach

- **i18next + ICU MessageFormat** across mobile and web; keys in `packages/shared` so both platforms share one catalog. No concatenated strings; all plurals/genders via ICU.
- **Locale-aware everything:** dates, numbers, units (meters/feet for GPS distances), currency display from store/Stripe price localization.
- **Pseudo-localization build** in CI from day one (doc 05) so layouts survive long German compounds before German exists.
- **RTL-ready layout** (logical properties, start/end not left/right) — cheap now, expensive to retrofit if Arabic/Hebrew ever make the list.
- Translation workflow: source-of-truth catalog in repo → TMS (e.g., Crowdin/Lokalise) → PR-based round-trips; screenshots attached to keys for context (voting labels like "Craziest Pose" need cultural adaptation, not literal translation).
- Store listings, ads categories, and share-card templates localized alongside the app — the share card is the most-seen surface in a new market.
