import { NextResponse, after } from "next/server";
import { runCheck } from "@/lib/check/pipeline";
import { createCheck, saveUpload } from "@/lib/db";

export const dynamic = "force-dynamic";

const MAX_BYTES = 5 * 1024 * 1024;
const TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

// Screenshot upload: stores the image, creates a check and starts it.
export async function POST(req: Request) {
  const form = await req.formData().catch(() => null);
  const file = form?.get("image");
  if (!(file instanceof File)) return NextResponse.json({ error: "Attach a screenshot image" }, { status: 400 });
  if (!TYPES.has(file.type)) return NextResponse.json({ error: "Use a PNG, JPG, WebP or GIF image" }, { status: 415 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: "That image is over 5 MB" }, { status: 413 });

  const check = createCheck({ source: "screenshot", text: file.name });
  saveUpload(check.id, file.type, Buffer.from(await file.arrayBuffer()));
  after(() => runCheck(check.id));
  return NextResponse.json({ id: check.id }, { status: 201 });
}
