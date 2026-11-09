// Single source of truth for the three fictional shops Vouch hosts.
// All names, products and copy are invented for the demo.

export type ShopSlug = "aurora-threads" | "glowbox" | "flashdeal-outlet";

export type ProductArtKind = "scarf" | "mask" | "earbuds";

export interface Shop {
  slug: ShopSlug;
  name: string;
  tagline: string;
  /** Expected outcome, used for demo labels only — never for scoring. */
  demoProfile: "trusted" | "mixed" | "risky";
  theme: { bg: string; accent: string; text: string };
  product: {
    name: string;
    price: number;
    compareAtPrice?: number;
    currency: "USD";
    description: string;
    bullets: string[];
    art: ProductArtKind;
  };
  about: string[];
  returns: string[];
  contact: { email?: string; phone?: string; address?: string } | null;
  urgency?: { countdownSeconds: number; stockLeft: number; banner: string };
  ad: { caption: string; hook: string };
}

export const SHOPS: Shop[] = [
  {
    slug: "aurora-threads",
    name: "Aurora Threads",
    tagline: "Slow-made knitwear from a small studio",
    demoProfile: "trusted",
    theme: { bg: "#f4efe8", accent: "#7a4b2a", text: "#2b1d12" },
    product: {
      name: "Merino Rib Scarf",
      price: 48,
      currency: "USD",
      description:
        "A soft, warm rib-knit scarf in 100% merino wool. Knitted in small batches and finished by hand.",
      bullets: [
        "100% extra-fine merino wool, 180 cm × 30 cm",
        "Ships in 1–2 business days with tracking",
        "Hand wash cold, dry flat",
      ],
      art: "scarf",
    },
    about: [
      "Aurora Threads is a two-person knitwear studio founded in 2019. We design every piece ourselves and work with one family-run mill.",
      "We publish our order volumes and return rates every quarter because we think shoppers deserve to know who they're buying from.",
    ],
    returns: [
      "30-day returns on unworn items, no questions asked.",
      "We email a prepaid return label within 1 business day of your request.",
      "Refunds go back to your original payment method within 5 business days of the item arriving.",
    ],
    contact: {
      email: "hello@aurora-threads.example",
      phone: "+1 (555) 014-2290",
      address: "Studio 4, 118 Mill Lane, Portland, OR 97201, USA",
    },
    ad: {
      hook: "The scarf our customers buy twice",
      caption: "Merino rib scarf, $48. 30-day free returns. Made in small batches.",
    },
  },
  {
    slug: "glowbox",
    name: "Glowbox",
    tagline: "At-home beauty tech",
    demoProfile: "mixed",
    theme: { bg: "#fbeef6", accent: "#c0267a", text: "#3a0f27" },
    product: {
      name: "LED Glow Mask",
      price: 69,
      compareAtPrice: 119,
      currency: "USD",
      description:
        "A flexible LED face mask with red and blue light modes. Ten-minute sessions, USB-C rechargeable.",
      bullets: [
        "Red and blue light modes",
        "USB-C rechargeable, about 8 sessions per charge",
        "Ships in 5–12 business days",
      ],
      art: "mask",
    },
    about: [
      "Glowbox brings salon-style beauty tech home. We launched in 2024 and ship from partner warehouses.",
      "Results vary from person to person.",
    ],
    returns: [
      "Returns accepted within 14 days of delivery.",
      "Opened items are refunded as store credit only.",
      "Customer pays return shipping.",
    ],
    contact: { email: "support@glowbox.example" },
    ad: {
      hook: "Glow-up in 10 minutes a day?",
      caption: "LED Glow Mask now $69 (was $119). Limited launch pricing.",
    },
  },
  {
    slug: "flashdeal-outlet",
    name: "FlashDeal Outlet",
    tagline: "Unbeatable prices — today only!!",
    demoProfile: "risky",
    theme: { bg: "#fff7d6", accent: "#e11d48", text: "#1f1300" },
    product: {
      name: "ProSound Max Wireless Earbuds",
      price: 12.99,
      compareAtPrice: 129.99,
      currency: "USD",
      description:
        "PREMIUM noise cancelling earbuds!!! Studio quality sound, 72H battery, waterproof, best in the world. 90% OFF TODAY ONLY.",
      bullets: [
        "Active noise cancelling (ANC) + transparency mode",
        "72 hour battery life!!!",
        "FREE SHIPPING worldwide",
      ],
      art: "earbuds",
    },
    about: [
      "We are leading global outlet with millions of happy customer. Best quality best price guaranteed.",
    ],
    returns: [
      "Contact us for return eligibility. Some items are final sale.",
      "Refund processed after inspection.",
    ],
    contact: null,
    urgency: {
      countdownSeconds: 9 * 60 + 59,
      stockLeft: 3,
      banner: "🔥 90% OFF — ENDS IN",
    },
    ad: {
      hook: "90% OFF premium earbuds 😱",
      caption: "Only 3 left!! $12.99 (was $129.99). Deal ends in minutes.",
    },
  },
];

export function getShop(slug: string): Shop | undefined {
  return SHOPS.find((s) => s.slug === slug);
}

export function formatPrice(amount: number, currency = "USD"): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(amount);
}
