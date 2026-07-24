# 07 – Privacy & Security

PhotoChase's core loop collects the two most sensitive consumer data classes at once: **photos of people's faces** and **precise GPS locations**. Getting this right is a product feature (trust) and a legal requirement (stores + GDPR/LGPD/COPPA/BIPA).

## Data map

| Data | Purpose | Retention | Notes |
|------|---------|-----------|-------|
| Account (email, display name, linked IdPs) | Auth, account linking | Life of account | Verified-email linking only (doc 02) |
| Photos (faces required by game rules) | Gameplay, rating, reveals | Default 30 days post-game (free), configurable up to 1 year (paid); export-then-delete available | Private by default; sharing is an explicit per-photo action |
| GPS at capture/check-in | Location scoring, geofencing, timing | Raw coordinates deleted 30 days post-game; retained thereafter only as computed scores and coarse (city-level) history | Precision minimization by design |
| Face-detection result (boolean + bounding box) | Face-rule enforcement | With the photo | **No biometric templates, no identity matching, ever** — keeps us outside BIPA/CUBI/GDPR special-category biometrics |
| AI judging scores | Paid scoring | With the game record | Derived data, no raw image retention at the provider (zero-retention API terms required of any provider) |
| Votes, scores, game history | Gameplay, profiles | Life of account | |
| Referral attribution | Growth credits | 90 days | Doc 08 |
| Purchase/entitlement | Billing | Legal minimum | Held by stores/RevenueCat/Stripe; we store entitlement state only |

## Consent model

- **Joining a game = participating consent:** the join screen states plainly that gameplay involves being photographed by teammates and location recording during rounds, with a link to the full policy. This is the contractual/consent basis for processing.
- **Sharing is a separate consent:** posting a comparison externally (doc 08) always passes a "everyone in this photo OK with this?" gate; any signed-in user appearing in a game can request takedown of a shared card from within the app.
- **Location permission UX:** pre-permission explainer screens ("we record location only during rounds, for scoring"); background location only for geofenced advanced play, requested separately and only when that config is on.
- **Age gate:** 13+ globally, 16+ in the EU (no parental-consent flows in v1 — under-age users are simply not supported). Neutral date-of-birth gate, no ad personalization for anyone under 16 anywhere.

## User rights (DSR) flows

In-app (web + mobile) self-service: export my data (photos + history archive), delete my account (cascades to photos, votes, GPS; anonymizes game records others depend on), unlink providers, per-game photo deletion. Target SLA: automated, < 24 h. These flows satisfy GDPR/LGPD/CCPA simultaneously — build once.

## Policy pages (required deliverables)

Both stores require a privacy policy URL; we ship **Privacy Policy** and **Security** pages on the web (linked from mobile settings and both store listings), written in plain language:

- Privacy Policy outline: what we collect (the table above, humanized) · why (gameplay) · what we never do (sell data, face recognition, track outside rounds) · retention & deletion · sharing controls · children · your rights & how to exercise them in-app · regional addenda (GDPR/LGPD/CCPA) · contact.
- Security page outline: encryption in transit/at rest · private-by-default photos · account security & provider linking · vulnerability disclosure contact (security@) · subprocessor list.
- Apple privacy nutrition labels and Google Data Safety form filled from the data map — and kept in sync by treating the data map as source of truth in code review.

## Security architecture

- **Photo access:** S3 objects are never public. Uploads via short-lived presigned URLs scoped to (user, game, expected content-type/size); reads via CloudFront signed cookies scoped per game membership. IDs are ULIDs (unguessable); membership is checked server-side on every object grant.
- **Join codes:** short-lived lookup with per-IP/per-device rate limiting and lockout — 6-char codes are guessable only without throttling.
- **AuthZ matrix:** role checks (host/member/judge/spectator) on every endpoint, tested exhaustively (doc 05). Entitlements enforced server-side.
- **Transport/at rest:** TLS everywhere; SSE-KMS on S3/DynamoDB; secrets in AWS Secrets Manager; no credentials in the client bundle.
- **Abuse & content safety:** in-app report on any photo; Rekognition moderation labels screen uploads on shared/spectator-visible surfaces; blocked users can't rejoin a host's games.
- **Supply chain/CI:** dependency audit + secret scanning + SAST in CI; CDK-synthesized IAM is least-privilege per Lambda; prod account isolated in AWS Organizations.
- **Ops:** access-logged admin tooling only (no direct DB pokes); incident-response runbook with user-notification thresholds per GDPR 72-hour rule.
