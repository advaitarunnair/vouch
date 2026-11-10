"use client";

import type { CheckResult } from "@/lib/check/types";
import type { Tier2Label, Tier2Score } from "@/lib/score/tier2";
import { Quotes, SignalsDetails } from "./SignalsDetails";

const STYLE: Record<Tier2Label, { ring: string; text: string; bg: string; bar: string }> = {
  "Likely OK (unverified)": { ring: "ring-sky-300", text: "text-sky-700", bg: "bg-sky-50", bar: "bg-sky-500" },
  Unverified: { ring: "ring-amber-300", text: "text-amber-700", bg: "bg-amber-50", bar: "bg-amber-500" },
  "High risk": { ring: "ring-rose-300", text: "text-rose-700", bg: "bg-rose-50", bar: "bg-rose-500" },
};

export function Tier2ScoreCard({ score, result }: { score: Tier2Score; result: CheckResult }) {
  const style = STYLE[score.label];

  return (
    <section className={`rounded-2xl bg-white p-5 ring-2 ${style.ring}`}>
      <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700 ring-1 ring-slate-300">
        <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
          <circle cx="12" cy="12" r="9" />
          <path d="M12 8v5M12 16h.01" />
        </svg>
        No PayPal history: public signals only
      </span>

      <div className="mt-4 flex items-end gap-4">
        <p className={`text-6xl font-bold tabular-nums leading-none ${style.text}`}>{score.score}</p>
        <div className="pb-1">
          <p className={`inline-block rounded-full px-2.5 py-0.5 text-sm font-semibold ${style.bg} ${style.text}`}>{score.label}</p>
          <p className="mt-1 text-xs text-slate-500">out of 100 · lower confidence</p>
        </div>
      </div>
      <p className="mt-3 text-slate-700">{score.summary}</p>

      <div className="mt-4" aria-label={`90% confidence range ${score.range[0]} to ${score.range[1]}`}>
        <div className="relative h-2 rounded-full bg-slate-100">
          <div className={`absolute h-2 rounded-full opacity-40 ${style.bar}`} style={{ left: `${score.range[0]}%`, width: `${Math.max(1, score.range[1] - score.range[0])}%` }} />
          <div className={`absolute -top-1 h-4 w-1 rounded ${style.bar}`} style={{ left: `calc(${score.score}% - 2px)` }} />
        </div>
        <p className="mt-1.5 text-xs text-slate-500">
          90% confidence range: {score.range[0]}–{score.range[1]} (wide, because there are no payments to check)
        </p>
      </div>

      <ul className="mt-4 space-y-3">
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
            <span>
              {r.text}
              <Quotes evidence={r.evidence} />
            </span>
          </li>
        ))}
      </ul>

      <details className="mt-4 rounded-xl bg-slate-50 p-3 text-sm">
        <summary className="cursor-pointer font-medium text-slate-700">How this score was worked out</summary>
        <div className="mt-3">
          <SignalsDetails result={result} />
        </div>
        <p className="mt-3 text-xs leading-relaxed text-slate-500">
          {score.signalsUsed} public signal{score.signalsUsed === 1 ? "" : "s"} combined in a weighted model. Without payment history the score is
          capped at 85, and the range comes from {score.model.draws.toLocaleString()} simulations that also vary each signal&apos;s weight.
        </p>
      </details>
    </section>
  );
}
