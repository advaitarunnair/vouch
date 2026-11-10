"use client";

import { useEffect, useState } from "react";
import type { AlternativesView } from "@/lib/alternatives";
import { RETAILER_TRUST_LABEL } from "@/lib/alternativesRank";
import type { CheckResult } from "@/lib/check/types";

const money = (n: number, currency = "USD") => new Intl.NumberFormat("en-US", { style: "currency", currency }).format(n);

/** Is the checked shop one we'd happily send a buyer to? */
export function shopVerdict(r: CheckResult): "trusted" | "caution" | "risky" {
  if (r.tier1) return r.tier1.score.label === "Trusted" ? "trusted" : r.tier1.score.label === "Use caution" ? "caution" : "risky";
  if (r.tier2) return r.tier2.label === "High risk" ? "risky" : "caution";
  return "caution";
}

export function WhereToBuy({ id, result, checkout }: { id: string; result: CheckResult; checkout?: React.ReactNode }) {
  const [data, setData] = useState<AlternativesView | null>(null);
  const [failed, setFailed] = useState(false);
  const verdict = shopVerdict(result);
  const idn = result.identification;

  useEffect(() => {
    fetch(`/api/check/${id}/alternatives`, { cache: "no-store" })
      .then((r) => r.json())
      .then(setData)
      .catch(() => setFailed(true));
  }, [id]);

  return (
    <section className="rounded-2xl bg-white p-5 ring-1 ring-slate-200">
      <h2 className="text-lg font-semibold">{verdict === "risky" ? "Safer places to buy this" : "Where to buy"}</h2>

      {verdict === "risky" && (
        <p className="mt-2 rounded-xl bg-rose-50 p-3 text-sm text-rose-800 ring-1 ring-rose-200">
          We wouldn&apos;t buy from {idn?.shop_name ?? "this shop"}. Here are similar products from retailers with a longer track record.
        </p>
      )}

      {/* The checked shop first when it's trustworthy (or worth considering). */}
      {verdict !== "risky" && idn?.shop_name && (
        <div className={`mt-3 rounded-xl p-3 ring-1 ${verdict === "trusted" ? "bg-emerald-50 ring-emerald-200" : "bg-amber-50 ring-amber-200"}`}>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">This shop</p>
              <p className="font-semibold">{idn.shop_name}</p>
              <p className="truncate text-sm text-slate-600">{idn.product}</p>
            </div>
            <div className="shrink-0 text-right">
              {idn.price && <p className="font-semibold">{idn.price}</p>}
              <p className={`text-xs font-medium ${verdict === "trusted" ? "text-emerald-700" : "text-amber-700"}`}>
                {result.tier1?.score.label ?? result.tier2?.label}
              </p>
            </div>
          </div>
          {checkout}
        </div>
      )}

      <div className="mt-4">
        {verdict !== "risky" && <p className="text-sm font-medium text-slate-600">Or compare with other retailers</p>}
        {!data && !failed && <p className="mt-2 text-sm text-slate-400">Finding similar products…</p>}
        {(failed || data?.error) && <p className="mt-2 text-sm text-slate-500">Couldn&apos;t load alternatives right now.</p>}
        {data && !data.error && data.alternatives.length === 0 && <p className="mt-2 text-sm text-slate-500">No similar products found at established retailers.</p>}
        <ul className="mt-2 space-y-2">
          {data?.alternatives.map((a) => (
            <li key={`${a.product_id}-${a.domain}`}>
              <a
                href={a.url}
                target="_blank"
                rel="noopener noreferrer sponsored"
                className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 p-3 hover:border-slate-400"
              >
                <span className="min-w-0">
                  <span className="line-clamp-2 text-sm font-medium">{a.title}</span>
                  <span className="mt-0.5 block text-xs text-slate-500">{a.domain}</span>
                </span>
                <span className="shrink-0 text-right">
                  <span className="block font-semibold">{money(a.price, a.currency)}</span>
                  <span className={`block text-xs ${a.trust === "established" ? "text-emerald-700" : "text-slate-500"}`}>
                    {RETAILER_TRUST_LABEL[a.trust]}
                    {a.domain_age_years !== null ? ` · ${a.domain_age_years}y` : ""}
                  </span>
                </span>
              </a>
            </li>
          ))}
        </ul>
        {data && data.alternatives.length > 0 && (
          <p className="mt-2 text-xs text-slate-400">
            Similar products found by Channel3 for &ldquo;{data.query}&rdquo;. Retailer labels come from domain age (RDAP); these retailers
            have no PayPal history in Vouch. Links may earn a commission.
          </p>
        )}
      </div>
    </section>
  );
}
