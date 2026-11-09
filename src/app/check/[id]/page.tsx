import Link from "next/link";
import { notFound } from "next/navigation";
import { VouchWordmark } from "@/components/VouchLogo";
import { getCheck } from "@/lib/db";

export const dynamic = "force-dynamic";

const STEPS = ["Identify the shop", "PayPal payment history", "Scan the shop page", "Compare prices"];

// Phase 2 placeholder: shows the check was created. Phase 7 replaces this with
// live step progress, the verdict, breakdown, alternatives and chatbot.
export default async function CheckPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const check = getCheck(id);
  if (!check) notFound();

  return (
    <div className="mx-auto max-w-md px-4 py-4">
      <Link href="/">
        <VouchWordmark />
      </Link>

      <div className="mt-8 rounded-2xl bg-white p-5 ring-1 ring-slate-200">
        <p className="text-sm text-slate-500">Checking</p>
        <p className="mt-1 break-all font-mono text-sm">{check.input_url}</p>

        <ol className="mt-5 space-y-3">
          {STEPS.map((s) => (
            <li key={s} className="flex items-center gap-3 text-slate-500">
              <span className="h-2.5 w-2.5 rounded-full bg-slate-300" />
              {s}
            </li>
          ))}
        </ol>

        <p className="mt-5 rounded-xl bg-amber-50 p-3 text-sm text-amber-800 ring-1 ring-amber-200">
          Check <span className="font-mono">{check.id}</span> was created. Scoring is wired up in Phases 4–7.
        </p>
      </div>
    </div>
  );
}
