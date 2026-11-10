"use client";

import { loadCoreSdkScript } from "@paypal/paypal-js/sdk-v6";
import { useEffect, useRef, useState } from "react";

// PayPal JavaScript SDK v6 (sandbox): PayPal + Pay Later buttons and Pay Later messaging.
// The order is created and captured by our server with the shop's credentials; the
// browser only passes the order ID back and forth.

type Status = "loading" | "ready" | "unavailable" | "paying" | "error";

export function PayPalCheckout({ checkId, clientId, amount, currency }: { checkId: string; clientId: string; amount: string; currency: string }) {
  const buttonsRef = useRef<HTMLDivElement>(null);
  const messageRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<Status>("loading");
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const cleanups: (() => void)[] = [];

    // Server creates the order; resolves to { orderId } as the v6 session expects.
    const createOrder = async (): Promise<{ orderId: string }> => {
      const res = await fetch("/api/checkout/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ check_id: checkId }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Couldn't create the order");
      return { orderId: body.orderId };
    };

    const sessionCallbacks = {
      onApprove: async ({ orderId }: { orderId: string }) => {
        setStatus("paying");
        const res = await fetch(`/api/checkout/orders/${orderId}/capture`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ check_id: checkId }),
        });
        const body = await res.json();
        if (!res.ok) {
          setStatus("ready");
          setNotice(body.error ?? "Payment couldn't be completed.");
          return;
        }
        window.location.assign(`/checkout/success/${orderId}`);
      },
      onCancel: () => setNotice("Payment cancelled. You haven't been charged."),
      onError: (err: Error) => {
        console.error("PayPal error", err);
        setNotice("Something went wrong with PayPal. Please try again.");
      },
    };

    (async () => {
      try {
        const paypal = await loadCoreSdkScript({ environment: "sandbox" });
        if (!paypal || cancelled) return;
        const sdk = await paypal.createInstance({
          clientId,
          components: ["paypal-payments", "paypal-messages"],
          pageType: "product-details",
          testBuyerCountry: "US", // sandbox only: show US Pay Later offers wherever the tester is
        });
        const methods = await sdk.findEligibleMethods({ currencyCode: currency, amount });
        if (cancelled) return;

        // Pay Later messaging for this amount: add the element, then fetch its content.
        const message = document.createElement("paypal-message");
        message.amount = amount;
        message.currencyCode = currency;
        message.buyerCountry = "US";
        messageRef.current?.replaceChildren(message);
        const messages = sdk.createPayPalMessages({ currencyCode: currency, buyerCountry: "US" });
        // The <paypal-message> element exposes setContent() at runtime (not yet in the published types).
        const target = message as HTMLElement & { setContent?: (content: Record<string, unknown>) => void };
        messages
          .fetchContent({
            amount,
            currencyCode: currency,
            buyerCountry: "US",
            logoType: "WORDMARK",
            logoPosition: "LEFT",
            textColor: "BLACK",
            onContentReady: (content) => target.setContent?.(content),
          })
          .catch((e: unknown) => console.info("No Pay Later message for this purchase", e)); // throws when Pay Later isn't offered

        const container = buttonsRef.current;
        if (!container) return;
        container.replaceChildren();

        if (methods.isEligible("paypal")) {
          const session = sdk.createPayPalOneTimePaymentSession(sessionCallbacks);
          const button = document.createElement("paypal-button");
          button.type = "pay";
          const onClick = () => {
            setNotice(null);
            // Don't await createOrder before start(): it must run in the click's user gesture.
            session.start({ presentationMode: "auto" }, createOrder()).catch((e: Error) => sessionCallbacks.onError(e));
          };
          button.addEventListener("click", onClick);
          container.appendChild(button);
          cleanups.push(() => {
            button.removeEventListener("click", onClick);
            session.destroy();
          });
        }

        if (methods.isEligible("paylater")) {
          const { productCode, countryCode } = methods.getDetails("paylater");
          const session = sdk.createPayLaterOneTimePaymentSession(sessionCallbacks);
          const button = document.createElement("paypal-pay-later-button");
          button.productCode = productCode;
          button.countryCode = countryCode;
          const onClick = () => {
            setNotice(null);
            session.start({ presentationMode: "auto" }, createOrder()).catch((e: Error) => sessionCallbacks.onError(e));
          };
          button.addEventListener("click", onClick);
          container.appendChild(button);
          cleanups.push(() => {
            button.removeEventListener("click", onClick);
            session.destroy();
          });
        }

        setStatus(container.childElementCount > 0 ? "ready" : "unavailable");
      } catch (err) {
        console.error("PayPal SDK failed to load", err);
        if (!cancelled) setStatus("error");
      }
    })();

    return () => {
      cancelled = true;
      cleanups.forEach((c) => c());
    };
  }, [checkId, clientId, amount, currency]);

  return (
    <div className="mt-3">
      <div ref={messageRef} className="min-h-5 text-sm" aria-label="Pay Later offer" />
      <div ref={buttonsRef} className="mt-2 grid gap-2 [&>*]:block [&>*]:w-full" />
      {status === "loading" && <p className="text-sm text-slate-500">Loading PayPal…</p>}
      {status === "paying" && <p className="mt-2 text-sm font-medium text-slate-700">Completing your payment…</p>}
      {status === "unavailable" && <p className="text-sm text-slate-500">PayPal isn&apos;t available for this purchase right now.</p>}
      {status === "error" && <p className="text-sm text-rose-600">PayPal couldn&apos;t load. Check your connection and refresh.</p>}
      {notice && <p className="mt-2 text-sm text-amber-700">{notice}</p>}
      <p className="mt-2 text-xs text-slate-500">PayPal sandbox: no real money moves. Buyer Protection applies to eligible PayPal purchases.</p>
    </div>
  );
}
