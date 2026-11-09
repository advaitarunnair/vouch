import Link from "next/link";
import { notFound } from "next/navigation";
import { CheckLive } from "@/components/check/CheckLive";
import { VouchWordmark } from "@/components/VouchLogo";
import { toView } from "@/lib/check/pipeline";
import { getCheck } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function CheckPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const row = getCheck(id);
  if (!row) notFound();

  return (
    <div className="mx-auto max-w-md px-4 py-4">
      <Link href="/">
        <VouchWordmark />
      </Link>
      <CheckLive initial={toView(row)} />
    </div>
  );
}
