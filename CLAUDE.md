# Vouch — project memory

Submission for the **PayPal AI Hackathon** (Devpost). **Deadline: Nov 12, 2026, 12:00pm Pacific.**
Hosted URL must stay up for judges until **Dec 15, 2026**.

Pitch line: **"Reviews can be faked. Payments can't."**

## What Vouch does
A web app that checks whether an online shop is trustworthy BEFORE you buy, then lets you buy safely with PayPal.
A user shares or pastes a shop link (or uploads a screenshot); Vouch identifies the shop and returns a trust score
with plain-English reasons.

- **Tier 1 — "Verified by PayPal payments"**: shop has PayPal payment history; score is computed from REAL PayPal
  sandbox data via PayPal APIs.
- **Tier 2 — "No PayPal history: public signals only"**: clearly labelled fallback using public signals.
- Trusted shops get a PayPal checkout; risky shops get safer alternatives.

## Hard constraints (never violate)
1. PayPal is CENTRAL and uses the **sandbox**: Transaction Search API, Disputes API, Orders v2, Payments v2 refunds,
   and the PayPal JavaScript SDK with Pay Later messaging. **Never invent "PayPal data"**: Tier 1 numbers must come
   from API responses.
2. AI must be meaningful: vision for screenshots, LLM page analysis, plain-English explanations, grounded chatbot.
3. **No third-party trademarks**: never use TikTok, Instagram, or any real brand names, logos or UI. Only fictional
   shops and a generic "Demo feed".
4. **No scraping social platforms.** Only fetch: pages we host, shop pages a user explicitly submits, WHOIS/RDAP,
   and authorised APIs (PayPal, Channel3, Anthropic).
5. Must work via hosted URL in a desktop browser (paste/upload) and on Android (PWA share target).
6. Public open-source repo, **MIT LICENSE** at root. Everything in English.
7. Everything shown in the demo must genuinely work.
8. Never use the word "scam" in UI copy; use "unverified" or "high risk".
9. Before writing any PayPal or Channel3 integration code, fetch and read the official docs
   (developer.paypal.com: Transaction Search v1, Customer Disputes v1, Orders v2, Payments v2, JS SDK;
   docs.trychannel3.com). Do not guess endpoints, fields or auth flows.

## Stack
- Next.js 15 (App Router) + TypeScript, single app (UI + API routes), Tailwind v4.
- SQLite via better-sqlite3 for checks and cache (OK to reset on redeploy; seeded demo data re-creatable by script).
- Anthropic API for LLM + vision; model name from env `ANTHROPIC_MODEL`.
- Deploy: Render web service (`render.yaml`).

## Env vars (`.env.example`; never commit secrets)
`ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`, `CHANNEL3_API_KEY`, `PAYPAL_ENV=sandbox`, `PAYPAL_CLIENT_ID_PUBLIC`
(JS SDK checkout), and per-shop sandbox REST credentials:
`SHOP_AURORA_CLIENT_ID/SECRET`, `SHOP_GLOWBOX_CLIENT_ID/SECRET`, `SHOP_FLASHDEAL_CLIENT_ID/SECRET`.

## Fictional shops (the only shops we host)
| slug | name | profile | intended score |
|---|---|---|---|
| `aurora-threads` | Aurora Threads | clean policies, contact details, repeat buyers | trusted |
| `glowbox` | Glowbox | mixed signals | mixed |
| `flashdeal-outlet` | FlashDeal Outlet | fake countdown, "90% off", no contact, vague returns, stock-looking images | high risk |

Shop content lives in `src/lib/shops.ts` (single source of truth for pages, feed, demo checks, registry).

## Phases (commit after each)
1. Skeleton: home (paste link, upload screenshot, 3 demo checks), `/shops/[slug]` pages, `/feed` demo feed with Share.
2. PWA: manifest, service worker, `share_target` → `/share` (GET title/text/url) → start check → redirect to result. Install button.
3. `scripts/seed-sandbox.ts`: per-shop Orders v2 create+capture (test card payment_source if supported), synthetic
   buyer id in `custom_id`, refunds via Payments v2. Volumes: aurora ~40 (many repeat, ~2 refunds), glowbox ~25 (~4),
   flashdeal ~20 (~8). `docs/SANDBOX_SETUP.md` for manual disputes. **Run early: Transaction Search lags by hours.**
4. Shop identification: own/normal URL → domain; unknown/social-style link → metadata only + LLM
   `{shop_name, shop_domain, confidence}` (<0.7 → "Is this the shop?"); screenshot → vision
   `{product, price, shop_name, shop_domain}`.
5. Tier 1 score: shop_registry → credentials; Transaction Search last 30 days (pagination, 31-day window) + Disputes.
   Features: completed payments, distinct buyers (custom_field), repeat-buyer rate, refund rate, dispute rate, disputes
   lost, first txn date. Logistic-style weighted model; Beta smoothing of failure rate (prior strength 20 orders);
   Monte Carlo 5,000 Beta draws → 90% range. Top 3 plain-English reasons vs baseline. Cache 1h, "Last updated". Unit tests.
6. Tier 2 score: RDAP domain age, HTTPS, LLM page-risk scan (structured JSON + evidence quotes), Channel3 price check
   (flag far below median). Wider range, clear label.
7. `/check/[id]`: live step progress ("Checking with PayPal..."), verdict first, expandable breakdown with sources,
   reasons, range bar, safer alternatives (Channel3), grounded chatbot (only this check's data + page text;
   "I don't know from the data I have"), 3 suggested questions.
8. PayPal checkout: JS SDK sandbox button + Pay Later messaging for passing Tier 1 shops; server-side Orders v2
   create/capture; success page. High-risk → warning + alternatives.
9. Polish/deploy/docs: graceful fallbacks, step timing logs, `render.yaml`, health endpoint, README (see brief),
   MIT LICENSE.
Optional (only if all above works): web push on check completion; seller page with "Verified by PayPal" badge snippet.

## Conventions
- Mobile-first, clean UI. Fictional brand assets only (CSS/SVG, no real logos).
- Server-only secrets stay in API routes / server modules; only `PAYPAL_CLIENT_ID_PUBLIC` reaches the client.
- Stop and ask the user whenever credentials or a manual step are needed.
