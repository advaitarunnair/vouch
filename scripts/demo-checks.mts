// Runs the demo checks against a running dev server and prints the results.
//   npx tsx scripts/demo-checks.mts [base_url] [slug ...]
import type { CheckView } from "../src/lib/check/types";

const base = process.argv[2] ?? "http://localhost:3000";
const slugs = process.argv.slice(3).length ? process.argv.slice(3) : ["aurora-threads", "glowbox", "flashdeal-outlet"];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

for (const slug of slugs) {
  const res = await fetch(`${base}/share?from=demo&url=${encodeURIComponent(`/shops/${slug}`)}`, { redirect: "manual" });
  const id = res.headers.get("location")!.split("/").pop()!;
  await fetch(`${base}/api/check/${id}/run`, { method: "POST" });
  let view!: CheckView;
  for (let i = 0; i < 60; i++) {
    view = await (await fetch(`${base}/api/check/${id}`)).json();
    if (view.status !== "pending" && view.status !== "running") break;
    await sleep(1000);
  }
  const r = view.result;
  console.log(`\n== ${slug} (${id}) status=${view.status}`);
  for (const [k, s] of Object.entries(r.steps)) console.log(`   [${k}] ${s.status}${s.ms !== undefined ? ` ${s.ms}ms` : ""}${s.note ? ` - ${s.note}` : ""}`);
  if (r.tier1) console.log(`   Tier 1: ${r.tier1.score.score} [${r.tier1.score.range.join("-")}] ${r.tier1.score.label}`);
  if (r.price) {
    console.log(`   price: query="${r.price.query}" verdict=${r.price.check.verdict} median=${r.price.check.market_median}`);
    console.log(`   ${r.price.check.text}`);
    for (const a of r.price.alternatives.slice(0, 4)) console.log(`     alt: ${a.title.slice(0, 40)} $${a.price} @ ${a.domain}`);
  }
}
