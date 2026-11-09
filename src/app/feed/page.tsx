import type { Metadata } from "next";
import Link from "next/link";
import { ProductArt } from "@/components/ProductArt";
import { ShareButton } from "@/components/ShareButton";
import { SHOPS } from "@/lib/shops";

export const metadata: Metadata = {
  title: "Demo feed | Vouch",
  description: "A generic demo feed of short ads from fictional shops. Share one to Vouch to check it.",
};

export default function FeedPage() {
  return (
    <div className="h-dvh snap-y snap-mandatory overflow-y-scroll bg-black text-white">
      <div className="fixed inset-x-0 top-0 z-20 flex items-center justify-between bg-gradient-to-b from-black/70 to-transparent px-4 py-3">
        <span className="text-sm font-semibold tracking-wide">Demo feed</span>
        <Link href="/" className="rounded-full bg-white/15 px-3 py-1 text-xs backdrop-blur">
          Back to Vouch
        </Link>
      </div>

      {SHOPS.map((shop) => (
        <article
          key={shop.slug}
          className="relative mx-auto flex h-dvh max-w-md snap-start flex-col justify-end overflow-hidden"
          style={{ background: `linear-gradient(160deg, ${shop.theme.bg} 0%, ${shop.theme.accent} 130%)` }}
        >
          <div className="absolute inset-x-0 top-16 flex justify-center px-10">
            <ProductArt kind={shop.product.art} className="w-full max-w-xs rounded-3xl shadow-2xl" />
          </div>

          <div className="relative z-10 bg-gradient-to-t from-black/85 via-black/60 to-transparent px-4 pb-8 pt-24 pr-20">
            <p className="text-sm font-semibold">
              {shop.name} <span className="font-normal opacity-70">· Sponsored (demo)</span>
            </p>
            <p className="mt-1 text-2xl font-bold leading-tight">{shop.ad.hook}</p>
            <p className="mt-2 text-sm opacity-90">{shop.ad.caption}</p>
            <Link
              href={`/shops/${shop.slug}`}
              className="mt-4 inline-block rounded-full bg-white px-5 py-2 text-sm font-semibold text-black"
            >
              Shop now
            </Link>
          </div>

          <div className="absolute bottom-28 right-3 z-10 flex flex-col items-center gap-5">
            <ShareButton
              title={`${shop.product.name} | ${shop.name}`}
              text={shop.ad.caption}
              path={`/shops/${shop.slug}`}
              className="flex flex-col items-center gap-1 rounded-full p-2 text-white drop-shadow"
            />
            <Link
              href={`/share?url=${encodeURIComponent(`/shops/${shop.slug}`)}`}
              className="flex flex-col items-center gap-1 p-2 text-white drop-shadow"
              aria-label={`Check ${shop.name} with Vouch`}
            >
              <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M12 3l7 3v5c0 5-3 8-7 10-4-2-7-5-7-10V6z" />
                <path d="M9 12l2 2 4-4" />
              </svg>
              <span className="text-xs font-medium">Vouch</span>
            </Link>
          </div>
        </article>
      ))}
    </div>
  );
}
