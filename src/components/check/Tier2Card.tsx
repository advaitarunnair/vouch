"use client";

import type { CheckResult } from "@/lib/check/types";
import { POSITIVE_LABELS, RISK_LABELS } from "@/lib/pageScanTypes";
import type { Tier2Label, Tier2Score } from "@/lib/score/tier2";

const STYLE: Record<Tier2Label, { ring: string; text: string; bg: string; bar: string }> = {
  "Likely OK (unverified)": { ring: "ring-sky-300", text: "text-sky-700", bg: "bg-sky-50", bar: "bg-sky-500" },
  Unverified: { ring: "ring-amber-300", text: "text-amber-700", bg: "bg-amber-50", bar: "bg-amber-500" },
  "High risk": { ring: "ring-rose-300", text: "text-rose-700", bg: "bg-rose-50", bar: "bg-rose-500" },
};

function Quotes({ evidence }: { evidence?: string[] }) {
  if (!evidence?.length) return null;
  return (
    <span className="mt-1 block space-y-1">
      {evidence.map((q) => (
        <q key={q} className="block border-l-2 border-slate-300 pl-2 text-xs italic text-slate-500">
          {q}
        </q>
      ))}
    </span>
  );
}

export function Tier2ScoreCard({ score, result }: { score: Tier2Score; result: CheckResult }) {
  const style = STYLE[score.label];
  const sig = result.signals;
  const age = sig?.domain;

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
        <dl className="mt-3 divide-y divide-slate-200">
          <Row label="Domain age" source={age?.source ? `Domain registry (RDAP via ${age.source})` : "Domain registry (RDAP)"}>
            {sig?.hosted
              ? "Demo page hosted by Vouch"
              : age?.age_days != null
                ? `${age.domain}, registered ${new Date(age.registered_at!).toLocaleDateString("en-US", { dateStyle: "medium" })}`
                : "Unknown"}
          </Row>
          <Row label="Secure connection" source="Connection check">
            {sig?.https == null ? "Not checked" : sig.https ? "Yes (HTTPS)" : "No"}
          </Row>
          <Row label="Price" source="Channel3 price comparison">
            {result.price ? result.price.check.text : "Not compared"}
          </Row>
        </dl>
        {sig?.scan && (
          <div className="mt-3">
            <p className="font-medium text-slate-700">Page scan by Claude</p>
            <p className="mt-1 text-slate-600">{sig.scan.summary}</p>
            <ul className="mt-2 space-y-2">
              {sig.scan.risks.map((r, i) => (
                <li key={`r${i}`} className="text-slate-700">
                  <span className="font-medium text-rose-700">{RISK_LABELS[r.type] ?? r.type}</span> ({r.severity}
                  {r.verified ? "" : ", quote not found on page"}): {r.explanation}
                  <Quotes evidence={r.evidence} />
                </li>
              ))}
              {sig.scan.positives.map((p, i) => (
                <li key={`p${i}`} className="text-slate-700">
                  <span className="font-medium text-emerald-700">{POSITIVE_LABELS[p.type] ?? p.type}</span>: {p.explanation}
                  <Quotes evidence={p.evidence} />
                </li>
              ))}
            </ul>
          </div>
        )}
        <p className="mt-3 text-xs leading-relaxed text-slate-500">
          {score.signalsUsed} public signal{score.signalsUsed === 1 ? "" : "s"} combined in a weighted model. Without payment history the score is
          capped at 85, and the range comes from {score.model.draws.toLocaleString()} simulations that also vary each signal&apos;s weight.
        </p>
      </details>
    </section>
  );
}

function Row({ label, source, children }: { label: string; source: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-2">
      <dt className="min-w-0 flex-1">
        <span className="block text-slate-700">{label}</span>
        <span className="block text-xs text-slate-400">{source}</span>
      </dt>
      <dd className="min-w-0 max-w-[60%] break-words text-right font-medium">{children}</dd>
    </div>
  );
}
