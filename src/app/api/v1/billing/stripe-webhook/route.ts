import { NextResponse } from "next/server";
import { db } from "@/server/db";
import { handleStripeEvent, verifyStripeSignature } from "@/server/services/billing";
import { readBodyLimited, route } from "@/server/http";

export const dynamic = "force-dynamic";

/** Stripe calls this. The signature is verified over the raw body before anything is parsed or trusted. */
export const POST = route(async (ctx) => {
  const raw = (await readBodyLimited(ctx.req, 512 * 1024)).toString("utf8");
  if (!verifyStripeSignature(raw, ctx.req.headers.get("stripe-signature"))) {
    return NextResponse.json({ error: { code: "invalid_signature", message: "The signature could not be verified." } }, { status: 400 });
  }
  let event;
  try {
    event = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: { code: "bad_request", message: "Invalid JSON." } }, { status: 400 });
  }
  await db.$queryRaw`SELECT 1`;
  const result = await handleStripeEvent(event);
  return { received: true, handled: result.handled };
});