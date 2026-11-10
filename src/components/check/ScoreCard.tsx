"use client";

import type { Tier1Result } from "@/lib/check/types";
import type { TrustLabel } from "@/lib/score/tier1";

const LABEL_STYLE: Record<TrustLabel, { ring: string; text: string; bg: string; bar: string }> = {
  Trusted: { ring: "ring-emerald-300", text: "text-emerald-700", bg: "bg-emerald-50", bar: "bg-emerald-500" },
  "Use caution": { ring: "ring-amber-300", text: "text-amber-700", bg: "bg-amber-50", bar: "bg-amber-500" },
  "High risk": { ring: "ring-rose-300", text: "text-rose-700", bg: "bg-rose-50", bar: "bg-rose-500" },
};

const pct = (x: number) => `${Math.round(x * 100)}%`;

function timeAgo(iso: string): string {
  const mins = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  return `${Math.round(mins / 60)} h ago`;
}

export function Tier1ScoreCard({ tier1 }: { tier1: Tier1Result }) {
  const { score, features: f, sources } = tier1;
  const style = LABEL_STYLE[score.label];
  const TS = "PayPal Transaction Search API";
  const DS = "PayPal Disputes API";

  const metrics: { label: string; value: string; source: string }[] = [
    { label: "Completed payments (30 days)", value: String(f.payments), source: TS },
    { label: "Distinct buyers", value: String(f.distinctBuyers), source: TS },
    { label: "Repeat-buyer rate", value: f.distinctBuyers ? pct(f.repeatBuyers / f.distinctBuyers) : "–", source: TS },
    { label: "Refund rate", value: `${pct(f.refundedPayments / f.payments)} (${f.refundedPayments})`, source: TS },
    { label: "Dispute rate", value: `${pct(f.disputes / f.payments)} (${f.disputes})`, source: DS },
    { label: "Disputes lost by seller", value: String(f.disputesLost), source: DS },
    {
      label: "First PayPal sale",
      value: f.firstPaymentAt ? new Date(f.firstPaymentAt).toLocaleDateString("en-US", { dateStyle: "medium" }) : "–",
      source: TS,
    },
  ];

  return (
    <section className={`rounded-2xl bg-white p-5 ring-2 ${style.ring}`}>
      <div className="flex items-start justify-between gap-3">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-900 px-3 py-1 text-xs font-semibold text-white">
          <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
            <path d="M5 12l5 5L20 7" />
          </svg>
          Verified by PayPal payments
        </span>
        <span className="text-xs text-slate-400">Updated {timeAgo(tier1.fetched_at)}</span>
      </div>

      <div className="mt-4 flex items-end gap-4">
        <p className={`text-6xl font-bold tabular-nums leading-none ${style.text}`}>{score.score}</p>
        <div className="pb-1">
          <p className={`inline-block rounded-full px-2.5 py-0.5 text-sm font-semibold ${style.bg} ${style.text}`}>{score.label}</p>
          <p className="mt-1 text-xs text-slate-500">out of 100</p>
        </div>
      </div>
      <p className="mt-3 text-slate-700">{score.summary}</p>

      <div className="mt-4" aria-label={`90% confidence range ${score.range[0]} to ${score.range[1]}`}>
        <div className="relative h-2 rounded-full bg-slate-100">
          <div
            className={`absolute h-2 rounded-full opacity-40 ${style.bar}`}
            style={{ left: `${score.range[0]}%`, width: `${Math.max(1, score.range[1] - score.range[0])}%` }}
          />
          <div className={`absolute -top-1 h-4 w-1 rounded ${style.bar}`} style={{ left: `calc(${score.score}% - 2px)` }} />
        </div>
        <p className="mt-1.5 text-xs text-slate-500">
          90% confidence range: {score.range[0]}–{score.range[1]}
        </p>
      </div>

      <ul className="mt-4 space-y-2">
        {score.reasons.map((r) => (
          <li key={r.key} className="flex gap-2 text-sm">
            <span
              className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full text-xs font-bold ${
                r.direction === "positive" ? "bg-emerald-100 text-emerald-700" : r.direction === "negative" ? "bg-rose-100 text-rose-700" : "bg-slate-100 text-slate-500"
              }`}
              aria-hidden="true"
            >
              {r.direction === "positive" ? "+" : r.direction === "negative" ? "−" : "·"}
            </span>
            <span>{r.text}</span>
          </li>
        ))}
      </ul>

      <details className="mt-4 rounded-xl bg-slate-50 p-3 text-sm">
        <summary className="cursor-pointer font-medium text-slate-700">How this score was worked out</summary>
        <dl className="mt-3 divide-y divide-slate-200">
          {metrics.map((m) => (
            <div key={m.label} className="flex items-baseline justify-between gap-3 py-2">
              <dt>
                <span className="block text-slate-700">{m.label}</span>
                <span className="block text-xs text-slate-400">{m.source}</span>
              </dt>
              <dd className="font-semibold tabular-nums">{m.value}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-3 text-xs leading-relaxed text-slate-500">
          Problem-order rate {pct(score.model.failureRate.observed)} observed, smoothed to {pct(score.model.failureRate.smoothed)} with a
          neutral prior worth 20 orders, so small shops aren&apos;t judged on a handful of sales. The range comes from{" "}
          {score.model.draws.toLocaleString()} simulations. Read live from the shop&apos;s PayPal sandbox account ({sources.apiCalls} API
          calls, {sources.transactionsScanned} transactions).
        </p>
      </details>
    </section>
  );
}
