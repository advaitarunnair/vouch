import type { ShopSlug } from "@/lib/shops";

// Posts in Vouch's generic "Demo feed". Sharing one sends a social-style post link
// (/feed/p/<id>) rather than the shop link, so Vouch must work out the shop from the
// post's link preview metadata. All creators and posts are fictional.
export interface DemoPost {
  id: string;
  shopSlug: ShopSlug;
  creator: string;
  hook: string;
  caption: string;
  /** Whether the post names the shop. Unnamed posts exercise the "Is this the shop?" step. */
  namesShop: boolean;
}

export const POSTS: DemoPost[] = [
  {
    id: "cozy-scarf",
    shopSlug: "aurora-threads",
    creator: "@knit_and_tea",
    hook: "The scarf our customers buy twice",
    caption: "Merino rib scarf from Aurora Threads, $48. 30-day free returns. Made in small batches.",
    namesShop: true,
  },
  {
    id: "glow-mask",
    shopSlug: "glowbox",
    creator: "@skinlab_sam",
    hook: "Glow-up in 10 minutes a day?",
    caption: "Trying the Glowbox LED Glow Mask, now $69 (was $119). Limited launch pricing.",
    namesShop: true,
  },
  {
    id: "earbuds-90",
    shopSlug: "flashdeal-outlet",
    creator: "@dealhunter.daily",
    hook: "90% OFF premium earbuds 😱",
    caption: "FlashDeal Outlet has ProSound Max earbuds for $12.99 (was $129.99). Only 3 left!! Deal ends in minutes.",
    namesShop: true,
  },
  {
    id: "mask-secret",
    shopSlug: "glowbox",
    creator: "@glowgirl.diaries",
    hook: "My skin secret 🤫✨",
    caption: "This LED face mask changed my routine. Red light every night. Link in bio, use my code GLOW10!",
    namesShop: false,
  },
];

export const getPost = (id: string) => POSTS.find((p) => p.id === id);
