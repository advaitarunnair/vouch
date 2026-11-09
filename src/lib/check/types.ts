// Shape of checks.result_json, shared by the server pipeline and the result page.
import type { Identification } from "@/lib/identify";

export type StepKey = "identify" | "paypal" | "page" | "price";
export type StepStatus = "pending" | "running" | "done" | "skipped" | "error";

export interface StepState {
  status: StepStatus;
  ms?: number;
  note?: string;
}

export interface PageSnapshot {
  url: string;
  https: boolean;
  status: number;
  title?: string;
  description?: string;
  /** Visible page text (capped). Used by the page scan and the grounded chatbot. */
  text: string;
  fetched_at: string;
}

export interface CheckResult {
  steps: Record<StepKey, StepState>;
  identification?: Identification;
  page?: PageSnapshot;
  error?: string;
}

export const STEP_LABELS: Record<StepKey, string> = {
  identify: "Identify the shop",
  paypal: "PayPal payment history",
  page: "Scan the shop page",
  price: "Compare prices",
};

export const emptyResult = (): CheckResult => ({
  steps: {
    identify: { status: "pending" },
    paypal: { status: "pending" },
    page: { status: "pending" },
    price: { status: "pending" },
  },
});

/** Public view of a check returned by GET /api/check/[id]. */
export interface CheckView {
  id: string;
  status: "pending" | "running" | "needs_confirmation" | "done" | "error";
  source: string;
  input_url: string | null;
  has_screenshot: boolean;
  created_at: string;
  updated_at: string;
  result: CheckResult;
}
