// Runs checks against a running dev server and prints every step's result.
//   npx tsx scripts/demo-checks.mts [base_url] [shop-slug | https://url ...]
import type { CheckView } from "../src/lib/check/types";

const base = process.argv[2] ?? "http://localhost:3000";
const targets = process.argv.slice(3).length ? process.argv.slice(3) : ["aurora-threads", "glowbox", "flashdeal-outlet"];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const sign = (d: string) => (d === "positive" ? "+" : d === "negative" ? "-" : ".");

for (const target of targets) {
  const url = /^https?:\/\//.test(target) ? target : `/shops/${target}`;
  const res = await fetch(`${base}/share?from=demo&url=${encodeURIComponent(url)}`, { redirect: "manual" });
  const id = res.headers.get("location")!.split("/").pop()!;
  await fetch(`${base}/api/check/${id}/run`, { method: "POST" });
  let view!: CheckView;
  for (let i = 0; i < 90; i++) {
    view = await (await fetch(`${base}/api/check/${id}`)).json();
    if (view.status !== "pending" && view.status !== "running") break;
    await sleep(1000);
  }
  const r = view.result;
  console.log(`\n== ${target} (${id}) status=${view.status}`);
  for (const [k, s] of Object.entries(r.steps)) console.log(`   [${k}] ${s.status}${s.ms !== undefined ? ` ${s.ms}ms` : ""}${s.note ? ` - ${s.note}` : ""}`);
  if (r.tier1) console.log(`   Tier 1: ${r.tier1.score.score} [${r.tier1.score.range.join("-")}] ${r.tier1.score.label}`);
  if (r.price) {
    console.log(`   price: query="${r.price.query}" verdict=${r.price.check.verdict} median=${r.price.check.market_median}`);
    console.log(`   ${r.price.check.text}`);
  }
  if (r.signals) {
    const sg = r.signals;
    const dom = sg.domain ? `${sg.domain.domain} ${sg.domain.age_days}d via ${sg.domain.source}` : "-";
    console.log(`   signals: hosted=${sg.hosted} https=${sg.https} domain=${dom}${sg.scan_error ? ` scan_error=${sg.scan_error}` : ""}`);
    for (const f of sg.scan?.risks ?? []) console.log(`     risk ${f.type} (${f.severity}${f.verified ? "" : ", unverified"}): ${f.evidence.map((e) => `"${e}"`).join(" ")}`);
    for (const f of sg.scan?.positives ?? []) console.log(`     good ${f.type}: ${f.evidence.map((e) => `"${e}"`).join(" ")}`);
  }
  if (r.tier2) {
    console.log(`   Tier 2: ${r.tier2.score} [${r.tier2.range.join("-")}] ${r.tier2.label} (${r.tier2.signalsUsed} signals)`);
    for (const x of r.tier2.reasons) console.log(`     ${sign(x.direction)} ${x.text}`);
  }
}
