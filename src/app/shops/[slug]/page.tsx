import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { FakeCountdown } from "@/components/FakeCountdown";
import { ProductArt } from "@/components/ProductArt";
import { SHOPS, formatPrice, getShop } from "@/lib/shops";

export function generateStaticParams() {
  return SHOPS.map((s) => ({ slug: s.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const shop = getShop(slug);
  if (!shop) return {};
  const title = `${shop.product.name} | ${shop.name}`;
  const description = `${shop.tagline}. ${shop.product.description}`;
  return {
    title,
    description,
    openGraph: { title, description, siteName: shop.name, type: "website" },
  };
}

export default async function ShopPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const shop = getShop(slug);
  if (!shop) notFound();
  const { product, theme } = shop;
  const risky = shop.demoProfile === "risky";

  return (
    <div style={{ background: theme.bg, color: theme.text }} className="min-h-dvh">
      <div className="bg-slate-900 px-4 py-2 text-center text-xs text-slate-200">
        Fictional demo shop hosted by Vouch. Nothing here is for sale.{" "}
        <Link href="/" className="underline">
          Back to Vouch
        </Link>
      </div>

      {shop.urgency && (
        <div className="sticky top-0 z-10 bg-rose-600 px-4 py-2 text-center text-sm font-bold text-white">
          {shop.urgency.banner} <FakeCountdown seconds={shop.urgency.countdownSeconds} />
        </div>
      )}

      <header className="mx-auto flex max-w-3xl items-center justify-between px-4 py-5">
        <div>
          <p className={`text-xl font-bold ${risky ? "uppercase italic tracking-tight" : "tracking-tight"}`}>{shop.name}</p>
          <p className="text-sm opacity-75">{shop.tagline}</p>
        </div>
        <nav className="hidden gap-4 text-sm sm:flex">
          <a href="#about">About</a>
          <a href="#returns">Returns</a>
          {shop.contact && <a href="#contact">Contact</a>}
        </nav>
      </header>

      <main className="mx-auto max-w-3xl px-4 pb-16">
        <section className="grid gap-6 sm:grid-cols-2">
          <div className="overflow-hidden rounded-2xl shadow-sm ring-1 ring-black/5">
            <ProductArt kind={product.art} className="block h-auto w-full" />
          </div>
          <div className="flex flex-col gap-4">
            <h1 className="text-2xl font-semibold leading-tight">{product.name}</h1>
            <div className="flex items-baseline gap-3">
              <span className="text-3xl font-bold" style={{ color: theme.accent }}>
                {formatPrice(product.price)}
              </span>
              {product.compareAtPrice && (
                <>
                  <span className="text-lg line-through opacity-60">{formatPrice(product.compareAtPrice)}</span>
                  <span className="rounded-full px-2 py-0.5 text-xs font-bold text-white" style={{ background: theme.accent }}>
                    -{Math.round((1 - product.price / product.compareAtPrice) * 100)}%
                  </span>
                </>
              )}
            </div>
            {shop.urgency && (
              <p className="animate-pulse font-semibold text-rose-700">
                ⚠️ Only {shop.urgency.stockLeft} left in stock! 27 people are viewing this right now!
              </p>
            )}
            <p className="leading-relaxed">{product.description}</p>
            <ul className="list-disc space-y-1 pl-5 text-sm">
              {product.bullets.map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ul>
            <button
              type="button"
              disabled
              className="mt-2 cursor-not-allowed rounded-full px-6 py-3 font-semibold text-white opacity-90"
              style={{ background: theme.accent }}
              title="Demo shop: check it with Vouch first"
            >
              {risky ? "BUY NOW BEFORE IT'S GONE" : "Add to bag"}
            </button>
            <a
              href={`/share?from=demo&url=${encodeURIComponent(`/shops/${shop.slug}`)}`}
              className="text-center text-sm font-medium underline underline-offset-4"
            >
              Check this shop with Vouch
            </a>
          </div>
        </section>

        <section id="about" className="mt-12">
          <h2 className="mb-2 text-lg font-semibold">About {shop.name}</h2>
          {shop.about.map((p) => (
            <p key={p} className="mb-2 leading-relaxed opacity-90">
              {p}
            </p>
          ))}
        </section>

        <section id="returns" className="mt-8">
          <h2 className="mb-2 text-lg font-semibold">Returns &amp; refunds</h2>
          <ul className="list-disc space-y-1 pl-5 opacity-90">
            {shop.returns.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        </section>

        <section id="contact" className="mt-8">
          <h2 className="mb-2 text-lg font-semibold">Contact</h2>
          {shop.contact ? (
            <address className="not-italic leading-relaxed opacity-90">
              {shop.contact.email && <div>Email: {shop.contact.email}</div>}
              {shop.contact.phone && <div>Phone: {shop.contact.phone}</div>}
              {shop.contact.address && <div>Address: {shop.contact.address}</div>}
            </address>
          ) : (
            <p className="opacity-90">Please use the chat bubble for all enquiries.</p>
          )}
        </section>
      </main>
    </div>
  );
}
