"use client";

import { useState } from "react";

// Uses the Web Share API when available (Android → Vouch share target),
// otherwise copies the link to the clipboard.
export function ShareButton({ title, text, path, className = "" }: { title: string; text: string; path: string; className?: string }) {
  const [status, setStatus] = useState<"idle" | "copied" | "error">("idle");

  async function onShare() {
    const url = new URL(path, window.location.origin).toString();
    if (navigator.share) {
      try {
        await navigator.share({ title, text, url });
        return;
      } catch (err) {
        if ((err as DOMException)?.name === "AbortError") return; // user closed the sheet
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      setStatus("copied");
    } catch {
      window.prompt("Copy this link:", url);
      setStatus("error");
    }
    setTimeout(() => setStatus("idle"), 2000);
  }

  return (
    <button type="button" onClick={onShare} className={className} aria-label={`Share ${title}`}>
      <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M4 12v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7" />
        <path d="M16 6l-4-4-4 4" />
        <path d="M12 2v14" />
      </svg>
      <span className="text-xs font-medium">{status === "copied" ? "Copied!" : "Share"}</span>
    </button>
  );
}
