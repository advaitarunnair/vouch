"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { STEP_LABELS, type CheckView, type StepKey, type StepState } from "@/lib/check/types";
import type { Identification, ShopCandidate } from "@/lib/identify";
import { Tier1ScoreCard } from "./ScoreCard";
import { Tier2ScoreCard } from "./Tier2Card";

const METHOD_LABEL: Record<Identification["method"], string> = {
  own_shop_page: "Matched from the shop link",
  registry_domain: "Matched from the shop's domain",
  page_domain: "Taken from the link's domain",
  ai_link_preview: "Identified by AI from the link preview",
  ai_screenshot: "Read from your screenshot by AI",
  user_confirmed: "Confirmed by you",
};

export function CheckLive({ initial }: { initial: CheckView }) {
  const [view, setView] = useState(initial);
  const started = useRef(false);

  const refresh = useCallback(async () => {
    const res = await fetch(`/api/check/${initial.id}`, { cache: "no-store" });
    if (res.ok) setView(await res.json());
  }, [initial.id]);

  // Kick the pipeline once (idempotent server-side), then poll while it works.
  useEffect(() => {
    if (!started.current && (view.status === "pending" || view.status === "running")) {
      started.current = true;
      fetch(`/api/check/${initial.id}/run`, { method: "POST" }).catch(() => {});
    }
    if (view.status !== "pending" && view.status !== "running") return;
    const t = setTimeout(refresh, 900);
    return () => clearTimeout(t);
  }, [view, initial.id, refresh]);

  const working = view.status === "pending" || view.status === "running";
  const idn = view.result.identification;

  return (
    <div className="mt-6 space-y-4">
      {/* Verdict first */}
      {view.result.tier1 && <Tier1ScoreCard tier1={view.result.tier1} />}
      {view.result.tier2 && <Tier2ScoreCard score={view.result.tier2} result={view.result} />}

      <section className="rounded-2xl bg-white p-5 ring-1 ring-slate-200">
        <p className="text-sm text-slate-500">{view.source === "screenshot" ? "Checking your screenshot" : "Checking"}</p>
        {view.input_url && <p className="mt-1 break-all font-mono text-sm">{view.input_url}</p>}
        {working && <p className="mt-3 font-semibold text-slate-900">Checking with PayPal…</p>}
        <ol className="mt-4 space-y-3">
          {(Object.keys(STEP_LABELS) as StepKey[]).map((k) => (
            <StepRow key={k} label={STEP_LABELS[k]} state={view.result.steps[k]} />
          ))}
        </ol>
      </section>

      {view.status === "needs_confirmation" && idn && <ConfirmShop id={view.id} idn={idn} onDone={setView} />}

      {idn && view.status !== "needs_confirmation" && idn.shop_name && <ShopCard idn={idn} />}

      {view.status === "error" && (
        <p className="rounded-2xl bg-rose-50 p-4 text-sm text-rose-800 ring-1 ring-rose-200">
          Something went wrong: {view.result.error ?? "unknown error"}.
        </p>
      )}


    </div>
  );
}

function StepRow({ label, state }: { label: string; state: StepState }) {
  const dot =
    state.status === "running" ? (
      <span className="h-3 w-3 animate-spin rounded-full border-2 border-emerald-500 border-t-transparent" />
    ) : state.status === "done" ? (
      <span className="grid h-4 w-4 place-items-center rounded-full bg-emerald-500 text-[10px] text-white">✓</span>
    ) : state.status === "error" ? (
      <span className="grid h-4 w-4 place-items-center rounded-full bg-rose-500 text-[10px] text-white">!</span>
    ) : (
      <span className={`h-2.5 w-2.5 rounded-full ${state.status === "skipped" ? "bg-slate-200" : "bg-slate-300"}`} />
    );
  return (
    <li className="flex items-start gap-3">
      <span className="mt-1 grid w-4 place-items-center">{dot}</span>
      <span className="min-w-0 flex-1">
        <span className={state.status === "pending" || state.status === "skipped" ? "text-slate-400" : "text-slate-900"}>{label}</span>
        {state.note && <span className="block truncate text-sm text-slate-500">{state.note}</span>}
      </span>
      {state.ms !== undefined && state.status !== "skipped" && (
        <span className="text-xs tabular-nums text-slate-400">{(state.ms / 1000).toFixed(1)}s</span>
      )}
    </li>
  );
}

function ShopCard({ idn }: { idn: Identification }) {
  return (
    <section className="rounded-2xl bg-white p-5 ring-1 ring-slate-200">
      <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Shop</p>
      <p className="mt-1 text-xl font-semibold">{idn.shop_name}</p>
      {idn.shop_domain && <p className="text-sm text-slate-500">{idn.shop_domain}</p>}
      {(idn.product || idn.price) && (
        <p className="mt-2 text-sm text-slate-700">
          {idn.product}
          {idn.product && idn.price ? " · " : ""}
          {idn.price}
        </p>
      )}
      <p className="mt-3 inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-600">
        {METHOD_LABEL[idn.method]}
        {idn.confidence < 1 && ` · ${Math.round(idn.confidence * 100)}% confidence`}
      </p>
      <p className="mt-2 text-sm text-slate-500">{idn.evidence}</p>
    </section>
  );
}

function ConfirmShop({ id, idn, onDone }: { id: string; idn: Identification; onDone: (v: CheckView) => void }) {
  const [busy, setBusy] = useState(false);
  const [custom, setCustom] = useState({ name: "", domain: "" });
  const [error, setError] = useState<string | null>(null);

  async function choose(c: Pick<ShopCandidate, "shop_name" | "shop_domain">) {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/check/${id}/confirm`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(c),
    });
    const body = await res.json();
    setBusy(false);
    if (!res.ok) return setError(body.error ?? "Couldn't save that");
    onDone(body);
  }

  return (
    <section className="rounded-2xl bg-white p-5 ring-2 ring-amber-300">
      <p className="text-lg font-semibold">Is this the shop?</p>
      <p className="mt-1 text-sm text-slate-600">
        {idn.shop_name
          ? `We think it's ${idn.shop_name}, but we're only ${Math.round(idn.confidence * 100)}% sure.`
          : "We couldn't tell which shop is selling this."}{" "}
        {idn.evidence}
      </p>
      <div className="mt-4 grid gap-2">
        {idn.candidates.map((c) => (
          <button
            key={`${c.shop_name}-${c.shop_domain}`}
            type="button"
            disabled={busy}
            onClick={() => choose(c)}
            className="flex items-center justify-between rounded-xl border border-slate-200 px-4 py-3 text-left hover:border-slate-400 disabled:opacity-50"
          >
            <span>
              <span className="block font-medium">{c.shop_name}</span>
              {c.shop_domain && <span className="block text-sm text-slate-500">{c.shop_domain}</span>}
            </span>
            {c.registry_slug && <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs text-emerald-700">PayPal history</span>}
          </button>
        ))}
      </div>
      <form
        className="mt-4 grid gap-2 sm:grid-cols-[1fr_1fr_auto]"
        onSubmit={(e) => {
          e.preventDefault();
          if (custom.name.trim()) choose({ shop_name: custom.name.trim(), shop_domain: custom.domain.trim() || null });
        }}
      >
        <input
          value={custom.name}
          onChange={(e) => setCustom({ ...custom, name: e.target.value })}
          placeholder="Another shop's name"
          className="rounded-xl border border-slate-300 px-3 py-2"
        />
        <input
          value={custom.domain}
          onChange={(e) => setCustom({ ...custom, domain: e.target.value })}
          placeholder="Its website (optional)"
          className="rounded-xl border border-slate-300 px-3 py-2"
        />
        <button type="submit" disabled={busy || !custom.name.trim()} className="rounded-xl bg-slate-900 px-4 py-2 font-medium text-white disabled:opacity-40">
          Use this
        </button>
      </form>
      {error && <p className="mt-2 text-sm text-rose-600">{error}</p>}
    </section>
  );
}
