import Link from "next/link";
import { CheckInput } from "@/components/CheckInput";
import { ProductArt } from "@/components/ProductArt";
import { VouchWordmark } from "@/components/VouchLogo";
import { SHOPS, formatPrice } from "@/lib/shops";

const DEMO_HINT: Record<string, string> = {
  trusted: "Long PayPal history",
  mixed: "Some refunds",
  risky: "Pressure tactics",
};

export default function Home() {
  return (
    <div className="min-h-dvh">
      <header className="mx-auto flex max-w-2xl items-center justify-between px-4 py-4">
        <VouchWordmark />
        <Link href="/feed" className="text-sm font-medium text-slate-600 hover:text-slate-900">
          Demo feed
        </Link>
      </header>

      <main className="mx-auto max-w-2xl px-4 pb-16">
        <section className="pt-6 pb-8">
          <p className="mb-3 inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700 ring-1 ring-emerald-200">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
            Trust scores from PayPal payment history
          </p>
          <h1 className="text-4xl font-bold leading-tight tracking-tight sm:text-5xl">
            Reviews can be faked.
            <br />
            <span className="text-emerald-600">Payments can&apos;t.</span>
          </h1>
          <p className="mt-4 text-lg text-slate-600">
            Check an online shop before you buy. Vouch looks at how real buyers paid, came back, and got refunds — then
            lets you pay safely with PayPal.
          </p>
        </section>

        <CheckInput />

        <section className="mt-10">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-500">Try a demo check</h2>
          <ul className="grid gap-3 sm:grid-cols-3">
            {SHOPS.map((shop) => (
              <li key={shop.slug}>
                <Link
                  href={`/share?url=${encodeURIComponent(`/shops/${shop.slug}`)}`}
                  className="flex items-center gap-3 rounded-2xl bg-white p-3 ring-1 ring-slate-200 transition hover:ring-slate-400 sm:flex-col sm:items-start"
                >
                  <ProductArt kind={shop.product.art} className="h-14 w-14 shrink-0 rounded-xl sm:h-auto sm:w-full" />
                  <div className="min-w-0">
                    <p className="font-semibold">{shop.name}</p>
                    <p className="truncate text-sm text-slate-500">
                      {shop.product.name} · {formatPrice(shop.product.price)}
                    </p>
                    <p className="mt-1 text-xs text-slate-400">{DEMO_HINT[shop.demoProfile]}</p>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-slate-500">
            All demo shops are fictional and hosted by Vouch.{" "}
            <Link href="/feed" className="underline">
              Open the demo feed
            </Link>{" "}
            to share an ad to Vouch like you would from your phone.
          </p>
        </section>

        <section className="mt-12 grid gap-4 sm:grid-cols-3">
          {[
            ["1. Share or paste", "Send Vouch a shop link from any app, or upload a screenshot of an ad."],
            ["2. We check payments", "If the shop sells with PayPal, its score comes from real payment, refund and dispute history."],
            ["3. Buy safely", "Trusted shop? Pay with PayPal. High risk? See safer places to buy the same thing."],
          ].map(([t, d]) => (
            <div key={t} className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
              <p className="font-semibold">{t}</p>
              <p className="mt-1 text-sm text-slate-600">{d}</p>
            </div>
          ))}
        </section>
      </main>
    </div>
  );
}
