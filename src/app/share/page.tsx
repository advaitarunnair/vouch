import Link from "next/link";
import { VouchWordmark } from "@/components/VouchLogo";

// Phase 1 placeholder. Phase 2 turns this into the PWA share target that
// extracts the URL, starts a check and redirects to /check/[id].
function firstUrl(...candidates: (string | undefined)[]): string | null {
  for (const c of candidates) {
    if (!c) continue;
    if (c.startsWith("/")) return c;
    const m = c.match(/https?:\/\/[^\s<>"']+/i);
    if (m) return m[0];
  }
  return null;
}

export default async function SharePage({
  searchParams,
}: {
  searchParams: Promise<{ url?: string; text?: string; title?: string }>;
}) {
  const sp = await searchParams;
  const url = firstUrl(sp.url, sp.text, sp.title);

  return (
    <div className="mx-auto max-w-md px-4 py-6">
      <Link href="/">
        <VouchWordmark />
      </Link>
      <div className="mt-10 rounded-2xl bg-white p-6 ring-1 ring-slate-200">
        {url ? (
          <>
            <p className="text-sm text-slate-500">Link received</p>
            <p className="mt-1 break-all font-mono text-sm">{url}</p>
            <p className="mt-4 text-slate-600">Trust scoring is being built (Phases 4–7).</p>
          </>
        ) : (
          <p className="text-slate-600">We couldn&apos;t find a link in what was shared. Try pasting it on the home page.</p>
        )}
      </div>
    </div>
  );
}
