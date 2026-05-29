// ─────────────────────────────────────────────────────────────────────────────
// PODCHAIN Demo API — Rider Routes
// POST /riders/register
// ─────────────────────────────────────────────────────────────────────────────

import type { PodChain } from "../../../podchain/src/index.ts";
import { PodChainError } from "../../../podchain/src/errors.ts";
import { json } from "../index.ts";

export async function handleRegisterRider(
  req: Request,
  podchain: PodChain
): Promise<Response> {
  let body: Record<string, unknown>;

  try {
    body = await req.json();
  } catch {
    return json({ success: false, error: "PAYLOAD_MALFORMED", message: "Request body is not valid JSON" }, 400);
  }

  const { riderId, publicKey } = body;

  if (!riderId || typeof riderId !== "string") {
    return json({ success: false, error: "MISSING_FIELDS", message: "riderId is required" }, 400);
  }

  if (!publicKey || typeof publicKey !== "object") {
    return json({ success: false, error: "MISSING_FIELDS", message: "publicKey (JWK) is required" }, 400);
  }

  await podchain.registerKey({ riderId, publicKey: publicKey as never });

  return json({ success: true, riderId, registeredAt: new Date().toISOString() }, 201);
}
