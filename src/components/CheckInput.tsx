"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

export function CheckInput() {
  const router = useRouter();
  const [link, setLink] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [shot, setShot] = useState<{ name: string; preview: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const value = link.trim();
    if (!value) {
      setError("Paste a link to a shop or product page.");
      return;
    }
    const withScheme = /^https?:\/\//i.test(value) || value.startsWith("/") ? value : `https://${value}`;
    try {
      new URL(withScheme, window.location.origin);
    } catch {
      setError("That doesn't look like a link. Try copying it again.");
      return;
    }
    setError(null);
    router.push(`/share?url=${encodeURIComponent(withScheme)}`);
  }

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("Please choose an image file (PNG or JPG).");
      return;
    }
    setError(null);
    setShot({ name: file.name, preview: URL.createObjectURL(file) });
  }

  return (
    <div className="w-full">
      <form onSubmit={onSubmit} className="flex flex-col gap-2 sm:flex-row">
        <label htmlFor="shop-link" className="sr-only">
          Shop link
        </label>
        <input
          id="shop-link"
          type="text"
          inputMode="url"
          autoComplete="off"
          placeholder="Paste a shop link"
          value={link}
          onChange={(e) => setLink(e.target.value)}
          className="min-w-0 flex-1 rounded-2xl border border-slate-300 bg-white px-4 py-3 text-base shadow-sm outline-none focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/20"
        />
        <button type="submit" className="rounded-2xl bg-slate-900 px-6 py-3 font-semibold text-white hover:bg-slate-800">
          Check shop
        </button>
      </form>

      <div className="mt-3 flex items-center gap-3">
        <span className="h-px flex-1 bg-slate-200" />
        <span className="text-xs uppercase tracking-wider text-slate-400">or</span>
        <span className="h-px flex-1 bg-slate-200" />
      </div>

      <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onFile} />
      <button
        type="button"
        onClick={() => fileRef.current?.click()}
        className="mt-3 flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-slate-300 bg-white px-4 py-3 font-medium text-slate-700 hover:border-slate-400"
      >
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="3" y="3" width="18" height="18" rx="3" />
          <circle cx="9" cy="9" r="2" />
          <path d="M21 15l-5-5L5 21" />
        </svg>
        Upload a screenshot
      </button>

      {shot && (
        <div className="mt-3 flex items-center gap-3 rounded-2xl bg-white p-3 ring-1 ring-slate-200">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={shot.preview} alt="Uploaded screenshot preview" className="h-16 w-16 rounded-lg object-cover" />
          <div className="min-w-0 text-sm">
            <p className="truncate font-medium">{shot.name}</p>
            <p className="text-slate-500">Screenshot analysis is wired up in Phase 4.</p>
          </div>
        </div>
      )}

      {error && (
        <p role="alert" className="mt-2 text-sm text-rose-600">
          {error}
        </p>
      )}
    </div>
  );
}
