"use client";

import Link from "next/link";
import { useEffect } from "react";
import { VouchMark } from "@/components/VouchLogo";

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <div className="mx-auto flex min-h-dvh max-w-sm flex-col items-center justify-center gap-4 px-6 text-center">
      <VouchMark className="h-14 w-14" />
      <h1 className="text-xl font-semibold">Something went wrong</h1>
      <p className="text-slate-600">Vouch hit an unexpected problem. Please try again.</p>
      <div className="flex gap-3">
        <button type="button" onClick={reset} className="rounded-xl border border-slate-300 px-5 py-2.5 font-medium">
          Try again
        </button>
        <Link href="/" className="rounded-xl bg-slate-900 px-5 py-2.5 font-medium text-white">
          Home
        </Link>
      </div>
    </div>
  );
}
