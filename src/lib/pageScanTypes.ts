// Page-scan result types and evidence verification (pure; unit-tested).

export type Severity = "low" | "medium" | "high";

export interface ScanFinding {
  type: string;
  severity: Severity;
  explanation: string;
  /** Quotes confirmed to appear in the page text. */
  evidence: string[];
  /** False when the AI's quotes couldn't be found in the page (severity is then lowered). */
  verified: boolean;
}

export interface PageScan {
  risks: ScanFinding[];
  positives: ScanFinding[];
  summary: string;
}

export const RISK_LABELS: Record<string, string> = {
  fake_countdown: "Countdown timer pressure",
  extreme_discount: "Extreme discount",
  missing_contact: "No contact details",
  vague_returns: "Vague returns policy",
  pressure_tactics: "Pressure tactics",
  unrealistic_claims: "Unrealistic claims",
  other: "Other concern",
};

export const POSITIVE_LABELS: Record<string, string> = {
  contact_details: "Contact details listed",
  clear_returns: "Clear returns policy",
  business_identity: "Says who runs the business",
  transparent_pricing: "Transparent pricing",
};

const normalise = (s: string) =>
  s
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim();

/** True when the quote appears in the page text (case, quote-style and whitespace insensitive). */
export function quoteInText(quote: string, text: string): boolean {
  const q = normalise(quote).replace(/^["'.…]+|["'.…]+$/g, "");
  return q.length >= 3 && normalise(text).includes(q);
}

const ABSENCE_TYPES = new Set(["missing_contact", "vague_returns"]);
const lower = (s: Severity): Severity => (s === "high" ? "medium" : "low");

interface RawFinding {
  type: string;
  severity: Severity;
  explanation: string;
  evidence: string[];
}

/**
 * Keeps only quotes that really appear on the page. A finding whose quotes were all
 * invented is kept at lower severity and marked unverified, except findings about
 * something missing (no contact details), which can't always be quoted.
 */
export function verifyFindings(raw: { risks: RawFinding[]; positives: RawFinding[]; summary: string }, text: string): PageScan {
  const check = (f: RawFinding, isRisk: boolean): ScanFinding | null => {
    const evidence = [...new Set(f.evidence.map((e) => e.trim()).filter((e) => quoteInText(e, text)))].slice(0, 3);
    const hadQuotes = f.evidence.length > 0;
    if (evidence.length > 0 || (isRisk && ABSENCE_TYPES.has(f.type) && !hadQuotes)) {
      return { ...f, evidence, verified: true };
    }
    if (!isRisk) return null; // unsupported positives are dropped entirely
    return { ...f, evidence: [], severity: lower(f.severity), verified: false };
  };
  return {
    risks: raw.risks.map((f) => check(f, true)).filter((f): f is ScanFinding => !!f),
    positives: raw.positives.map((f) => check(f, false)).filter((f): f is ScanFinding => !!f),
    summary: raw.summary,
  };
}
