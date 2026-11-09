"use client";

import { useEffect, useState } from "react";

// Intentionally deceptive pattern for the fictional "risky" shop:
// the timer restarts on every page load and loops when it reaches zero.
export function FakeCountdown({ seconds }: { seconds: number }) {
  const [left, setLeft] = useState(seconds);

  useEffect(() => {
    const id = setInterval(() => setLeft((s) => (s <= 1 ? seconds : s - 1)), 1000);
    return () => clearInterval(id);
  }, [seconds]);

  const mm = String(Math.floor(left / 60)).padStart(2, "0");
  const ss = String(left % 60).padStart(2, "0");
  return (
    <span className="font-mono tabular-nums" data-countdown>
      00:{mm}:{ss}
    </span>
  );
}
