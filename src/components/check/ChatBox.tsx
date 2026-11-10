"use client";

import { useRef, useState } from "react";

const SOURCE_LABELS: Record<string, string> = {
  paypal_payments: "PayPal payments",
  paypal_disputes: "PayPal disputes",
  page_scan: "Page scan",
  page_text: "Shop page",
  price_check: "Price comparison",
  domain_age: "Domain age",
  identification: "Shop identification",
};

interface Turn {
  role: "user" | "assistant";
  content: string;
  sources?: string[];
  grounded?: boolean;
}

/** Grounded Q&A: answers come only from this check's data and the shop page. */
export function ChatBox({ id, suggestions }: { id: string; suggestions: string[] }) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  async function ask(question: string) {
    const q = question.trim();
    if (!q || busy) return;
    setBusy(true);
    setError(null);
    setInput("");
    const history = turns.map(({ role, content }) => ({ role, content }));
    setTurns((t) => [...t, { role: "user", content: q }]);
    try {
      const res = await fetch(`/api/check/${id}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q, history }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Something went wrong");
      setTurns((t) => [...t, { role: "assistant", content: body.answer, sources: body.sources, grounded: body.grounded }]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setTurns((t) => t.slice(0, -1));
      setInput(q);
    } finally {
      setBusy(false);
      setTimeout(() => endRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }), 50);
    }
  }

  return (
    <section className="rounded-2xl bg-white p-5 ring-1 ring-slate-200">
      <h2 className="text-lg font-semibold">Ask about this shop</h2>
      <p className="mt-1 text-sm text-slate-500">Answers come only from this check&apos;s data and the shop&apos;s page.</p>

      {turns.length === 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {suggestions.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => ask(s)}
              disabled={busy}
              className="rounded-full border border-slate-300 px-3 py-1.5 text-left text-sm hover:border-slate-500 disabled:opacity-50"
            >
              {s}
            </button>
          ))}
        </div>
      )}

      {turns.length > 0 && (
        <div className="mt-3 space-y-3" aria-live="polite">
          {turns.map((t, i) => (
            <div key={i} className={t.role === "user" ? "flex justify-end" : ""}>
              <div className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm ${t.role === "user" ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-800"}`}>
                <p>{t.content}</p>
                {t.role === "assistant" && t.sources && t.sources.length > 0 && (
                  <p className="mt-2 flex flex-wrap gap-1">
                    {t.sources.map((s) => (
                      <span key={s} className="rounded-full bg-white px-2 py-0.5 text-[11px] text-slate-500 ring-1 ring-slate-200">
                        {SOURCE_LABELS[s] ?? s}
                      </span>
                    ))}
                  </p>
                )}
              </div>
            </div>
          ))}
          {busy && <p className="text-sm text-slate-400">Thinking…</p>}
          <div ref={endRef} />
        </div>
      )}

      <form
        className="mt-3 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          ask(input);
        }}
      >
        <label htmlFor="chat-q" className="sr-only">
          Your question
        </label>
        <input
          id="chat-q"
          value={input}
          maxLength={500}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask a question"
          className="min-w-0 flex-1 rounded-xl border border-slate-300 px-3 py-2 outline-none focus:border-emerald-500"
        />
        <button type="submit" disabled={busy || !input.trim()} className="rounded-xl bg-slate-900 px-4 py-2 font-medium text-white disabled:opacity-40">
          Ask
        </button>
      </form>
      {error && <p className="mt-2 text-sm text-rose-600">{error}</p>}
    </section>
  );
}
