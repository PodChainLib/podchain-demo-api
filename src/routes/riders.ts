// ─────────────────────────────────────────────────────────────────────────────
// PODCHAIN Demo API — Rider Routes
// POST /riders/register
// ─────────────────────────────────────────────────────────────────────────────

import type { PodChain } from "podchain";
import { PodChainError } from "podchain";
import { json } from "../index";

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

  try {
    await podchain.registerKey({ riderId, publicKey: publicKey as never });
  } catch (error) {
    if (error instanceof PodChainError && error.code === "RIDER_ALREADY_EXISTS") {
      return json(
        {
          success: true,
          riderId,
          alreadyRegistered: true,
          registeredAt: null,
        },
        200
      );
    }
    throw error;
  }

  return json(
    {
      success: true,
      riderId,
      alreadyRegistered: false,
      registeredAt: new Date().toISOString(),
    },
    201
  );
}
