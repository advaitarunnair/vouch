import Link from "next/link";
import { VouchMark } from "@/components/VouchLogo";

export default function NotFound() {
  return (
    <div className="mx-auto flex min-h-dvh max-w-sm flex-col items-center justify-center gap-4 px-6 text-center">
      <VouchMark className="h-14 w-14" />
      <h1 className="text-xl font-semibold">We couldn&apos;t find that page</h1>
      <p className="text-slate-600">The check or page may have expired. Checks are kept while the demo server is running.</p>
      <Link href="/" className="rounded-xl bg-slate-900 px-5 py-2.5 font-medium text-white">
        Check a shop
      </Link>
    </div>
  );
}
