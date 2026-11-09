import { VouchMark } from "@/components/VouchLogo";

export const metadata = { title: "Offline | Vouch" };

export default function Offline() {
  return (
    <div className="mx-auto flex min-h-dvh max-w-sm flex-col items-center justify-center gap-4 px-6 text-center">
      <VouchMark className="h-14 w-14" />
      <h1 className="text-xl font-semibold">You&apos;re offline</h1>
      <p className="text-slate-600">
        Vouch needs a connection to check a shop with PayPal. Reconnect and share the link again.
      </p>
    </div>
  );
}
