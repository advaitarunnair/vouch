"use client";

import type { CheckResult } from "@/lib/check/types";
import { POSITIVE_LABELS, RISK_LABELS } from "@/lib/pageScanTypes";

export function Quotes({ evidence }: { evidence?: string[] }) {
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

export function Row({ label, source, children }: { label: string; source: string; children: React.ReactNode }) {
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

/** Public signals (domain, HTTPS, price, page scan), each with its source. Shown for every shop. */
export function SignalsDetails({ result }: { result: CheckResult }) {
  const sig = result.signals;
  const age = sig?.domain;
  return (
    <>
      <dl className="divide-y divide-slate-200">
        <Row label="Domain age" source={age?.source ? `Domain registry (RDAP via ${age.source})` : "Domain registry (RDAP)"}>
          {sig?.hosted
            ? "Demo page hosted by Vouch"
            : age?.age_days != null
              ? `${age.domain}, registered ${new Date(age.registered_at!).toLocaleDateString("en-US", { dateStyle: "medium" })}`
              : "Unknown"}
        </Row>
        <Row label="Secure connection" source="Connection check">
          {sig?.https == null ? (sig?.hosted ? "Demo page" : "Not checked") : sig.https ? "Yes (HTTPS)" : "No"}
        </Row>
        <Row label="Price" source="Channel3 price comparison">
          {result.price ? result.price.check.text : "Not compared"}
        </Row>
      </dl>
      {sig?.scan ? (
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
      ) : (
        sig?.scan_error && <p className="mt-3 text-xs text-slate-500">Page scan unavailable: {sig.scan_error}</p>
      )}
    </>
  );
}
