import { describe, expect, it } from "vitest";
import { computeFeatures, isRefund, isSale, splitWindows, toPayPalDate, type DisputeInfo, type TxnDetail } from "./features";

const DAY = 86_400_000;
const now = new Date("2026-11-10T12:00:00Z");
const ago = (days: number) => new Date(now.getTime() - days * DAY).toISOString().replace(/\.\d{3}Z$/, "Z");

let n = 0;
const sale = (buyer: string, days = 1, code = "T0005", amount = "48.00"): TxnDetail => ({
  transaction_info: {
    transaction_id: `SALE${++n}`,
    transaction_event_code: code,
    transaction_status: "S",
    transaction_amount: { value: amount, currency_code: "USD" },
    transaction_initiation_date: ago(days),
    custom_field: buyer,
  },
});
const refund = (of: TxnDetail, status = "S"): TxnDetail => ({
  transaction_info: {
    transaction_id: `REF${++n}`,
    transaction_event_code: "T1107",
    transaction_status: status,
    transaction_amount: { value: `-${of.transaction_info.transaction_amount!.value}`, currency_code: "USD" },
    transaction_initiation_date: ago(0.5),
    custom_field: of.transaction_info.custom_field,
    paypal_reference_id: of.transaction_info.transaction_id,
  },
});

describe("splitWindows", () => {
  it("splits a range into <= 31-day windows, newest first, with no gaps", () => {
    const start = new Date(now.getTime() - 100 * DAY);
    const w = splitWindows(start, now);
    expect(w).toHaveLength(4);
    expect(w[0].end).toEqual(now);
    expect(w.at(-1)!.start).toEqual(start);
    for (let i = 0; i < w.length; i++) {
      expect(w[i].end.getTime() - w[i].start.getTime()).toBeLessThanOrEqual(31 * DAY);
      if (i > 0) expect(w[i].end).toEqual(w[i - 1].start);
    }
  });

  it("returns one window for 30 days and none for an empty range", () => {
    expect(splitWindows(new Date(now.getTime() - 30 * DAY), now)).toHaveLength(1);
    expect(splitWindows(now, now)).toHaveLength(0);
  });

  it("formats dates the way Transaction Search requires", () => {
    expect(toPayPalDate(new Date("2026-11-10T02:41:04.123Z"))).toBe("2026-11-10T02:41:04Z");
  });
});

describe("event classification", () => {
  it("treats positive T00xx as sales and T1107 as refunds, ignoring holds and corrections", () => {
    expect(isSale(sale("a").transaction_info)).toBe(true);
    expect(isSale(sale("a", 1, "T0006").transaction_info)).toBe(true);
    expect(isSale({ transaction_id: "x", transaction_event_code: "T1900", transaction_amount: { value: "5000", currency_code: "USD" } })).toBe(false);
    expect(isSale({ transaction_id: "x", transaction_event_code: "T1110", transaction_amount: { value: "-12", currency_code: "USD" } })).toBe(false);
    expect(isSale({ ...sale("a").transaction_info, transaction_status: "D" })).toBe(false);
    expect(isRefund(refund(sale("a"), "P").transaction_info)).toBe(true);
  });
});

describe("computeFeatures", () => {
  it("counts sales, distinct and repeat buyers, refunds and disputes", () => {
    const a1 = sale("buyer-a");
    const a2 = sale("buyer-a", 2);
    const b1 = sale("buyer-b");
    const c1 = sale("buyer-c", 3, "T0006", "12.99");
    const old = sale("buyer-d", 45); // outside the 30-day window
    const correction: TxnDetail = {
      transaction_info: { transaction_id: "C1", transaction_event_code: "T1900", transaction_status: "S", transaction_amount: { value: "5000", currency_code: "USD" }, transaction_initiation_date: ago(5) },
    };
    const rows = [a1, a2, b1, c1, old, correction, refund(b1), refund(b1, "P")];
    const disputes: DisputeInfo[] = [
      { dispute_id: "D1", create_time: ago(1), dispute_outcome: { outcome_code: "RESOLVED_BUYER_FAVOUR" }, disputed_transactions: [{ seller_transaction_id: c1.transaction_info.transaction_id }] },
      { dispute_id: "D2", create_time: ago(1), dispute_outcome: { outcome_code: "RESOLVED_SELLER_FAVOUR" }, disputed_transactions: [{ seller_transaction_id: b1.transaction_info.transaction_id }] },
      { dispute_id: "D3", create_time: ago(90), dispute_outcome: { outcome_code: "RESOLVED_BUYER_FAVOUR" } }, // outside window
    ];
    const { features, sources } = computeFeatures(rows, disputes, { now, windowDays: 30, firstPaymentAt: ago(45) });

    expect(features.payments).toBe(4);
    expect(features.distinctBuyers).toBe(3);
    expect(features.repeatBuyers).toBe(1);
    expect(features.refundedPayments).toBe(1); // two refund rows for the same sale count once
    expect(features.disputes).toBe(2);
    expect(features.disputesLost).toBe(1);
    expect(features.problemOrders).toBe(2); // b1 (refunded + disputed) and c1 (disputed)
    expect(features.tradingDays).toBe(45);
    expect(sources.eventCodes).toMatchObject({ T0005: 4, T0006: 1, T1107: 2, T1900: 1 });
  });

  it("falls back to payer account ids when custom_field is missing, and handles no sales", () => {
    const s: TxnDetail = { ...sale(""), payer_info: { account_id: "PAYER1" } };
    s.transaction_info.custom_field = undefined;
    const { features } = computeFeatures([s, { ...sale(""), payer_info: { account_id: "PAYER1" } }], [], { now, windowDays: 30, firstPaymentAt: null });
    expect(features.distinctBuyers).toBe(1);
    expect(features.repeatBuyers).toBe(1);

    const empty = computeFeatures([], [], { now, windowDays: 30, firstPaymentAt: null }).features;
    expect(empty.payments).toBe(0);
    expect(empty.tradingDays).toBe(0);
  });
});
