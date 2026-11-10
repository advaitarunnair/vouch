# PayPal sandbox setup

Vouch's "Verified by PayPal payments" scores come from real PayPal **sandbox** data. This guide sets up the
accounts, seeds payment history for the three fictional shops, and creates buyer disputes against
FlashDeal Outlet.

> Transaction Search can take **up to 3 hours** to show new transactions (per PayPal's API reference),
> so run the seed as early as possible.

## 1. Sandbox accounts

In the [PayPal Developer Dashboard](https://developer.paypal.com/dashboard/) → **Testing Tools → Sandbox Accounts**:

| Account | Type | Used for |
|---|---|---|
| Aurora Threads | Business (US) | trusted shop |
| Glowbox | Business (US) | mixed shop |
| FlashDeal Outlet | Business (US) | high-risk shop |
| Demo Buyer | Personal (US) | checkout testing and opening disputes |

Note each account's email. Use the sandbox account's **View/Edit** screen to see or set its password.

## 2. One REST app per shop

**Apps & Credentials → Sandbox → Create App**, type *Merchant*, linked to that shop's business account.
Copy the **Client ID** and **Secret**. In each app's **Features** list, check that these are switched on:

- **Advanced Credit and Debit Card Payments** — the seed script pays with a PayPal sandbox test card
  (`payment_source.card`), so no buyer has to approve 85 orders by hand.
- **Transaction Search** — needed for `GET /v1/reporting/transactions`.
- **Customer Disputes** — on by default; needed for the Disputes API.

## 3. `.env.local`

```bash
cp .env.example .env.local
```

Fill in `SHOP_AURORA_CLIENT_ID/SECRET`, `SHOP_GLOWBOX_CLIENT_ID/SECRET`, `SHOP_FLASHDEAL_CLIENT_ID/SECRET`,
and keep `PAYPAL_ENV=sandbox` (the code refuses any other value).

## 4. Seed payment history

```bash
npm run seed -- check            # each app logs in, has Transaction Search, and is a separate account
npm run seed -- seed --dry-run   # print the plan; makes no API calls
npm run seed                     # create + capture orders, then refund a subset
```

| Shop | Orders | Distinct buyers | Refunds |
|---|---|---|---|
| Aurora Threads | 40 | 24 (12 buyers come back) | 2 |
| Glowbox | 25 | 21 | 4 |
| FlashDeal Outlet | 20 | 20 | 8 |

How it works:
- `POST /v2/checkout/orders` with `intent: CAPTURE` and a sandbox test card in `payment_source.card`.
  PayPal completes the payment in one step; if an order comes back `APPROVED` instead, the script calls
  `POST /v2/checkout/orders/{id}/capture`.
- `purchase_units[0].custom_id` holds a stable synthetic buyer id (e.g. `buyer-aur-007`). Transaction
  Search returns it as `transaction_info.custom_field`, which is how Vouch counts distinct and repeat buyers.
- Refunds use `POST /v2/payments/captures/{capture_id}/refund` with no amount, which is a full refund.
- Progress is saved to `scripts/.seed-state.json` (gitignored). Re-running **resumes** instead of duplicating;
  `--fresh` starts a new batch, which adds more transactions on top of the old ones.
- `--shop aurora|glowbox|flashdeal` limits a run to one shop.

If card payments are not enabled you will see a hint in the output. Enable the feature from step 2, or seed by
hand with PayPal-wallet orders (see step 5: `wallet` and `capture-wallet` work for any shop).

## 5. Buyer disputes against FlashDeal Outlet (manual)

Card-paid seed orders aren't linked to a PayPal buyer account, so a buyer can't dispute them. Disputes need a
payment made **from the sandbox personal account**:

1. Create PayPal-wallet orders and print their approval links:
   ```bash
   npm run seed -- wallet --shop flashdeal --count 4
   ```
2. Open each link in a private window, log in as the **Demo Buyer** sandbox personal account, and approve.
   (You're redirected back to the FlashDeal demo page; that's expected.)
3. Capture the approved orders:
   ```bash
   npm run seed -- capture-wallet --shop flashdeal
   ```
4. Log in to <https://www.sandbox.paypal.com/> as the Demo Buyer. Open the Resolution Center
   (<https://www.sandbox.paypal.com/disputes/>) or the payment in **Activity**, and report a problem with each
   FlashDeal payment. Choose *I didn't receive it* (INR) or *Not as described* (SNAD). Do this for 3 of the 4.
5. Optional: settle disputes so some count as **lost by the seller**. The sandbox-only
   `POST /v1/customer/disputes/{id}/adjudicate` endpoint needs the dispute to be `UNDER_REVIEW`, so the script
   first escalates any `INQUIRY` disputes to a claim:
   ```bash
   npm run seed -- disputes --shop flashdeal                      # list
   npm run seed -- disputes --shop flashdeal --settle BUYER_FAVOR # escalate, seller response, adjudicate
   ```
   Each run moves every dispute one step: INQUIRY disputes are escalated to a claim; claims waiting on the
   seller get a short seller response (`provide-evidence`, multipart with an `input` JSON part), which moves
   them to `UNDER_REVIEW`; once PayPal offers the `adjudicate` action, they are settled. The sandbox processes
   each step in the background, so re-run every few minutes until all show `RESOLVED`.
   (`--accept <id>` / `--accept-all` makes the seller accept a claim instead; in testing the sandbox rejected
   this with `INSUFFICIENT_FUNDS` at the chargeback stage despite a positive balance.)

PayPal's dispute testing guide also lets you create a buyer transaction with **Send and Request → Send money**
to the shop's business email, then dispute that payment.

## 6. Check what the APIs return

```bash
npm run seed -- summary
```

Prints, per shop, the last 30 days of Transaction Search results (count, event codes, distinct `custom_field`
buyers) and the number of disputes. Empty results in the first few hours are normal.

## Known limitations

- Sandbox transactions are always dated "now", so every shop's payment history starts on the day you seed.
  Trading-history age is therefore short for all three shops.
- Sandbox data is shared by everyone holding the app credentials. Don't run `--fresh` casually, because it
  changes the demo numbers.
