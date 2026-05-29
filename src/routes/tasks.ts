// ─────────────────────────────────────────────────────────────────────────────
// PODCHAIN Demo API — Task Routes
// POST /tasks
// GET  /tasks/:id/recipient-token
// ─────────────────────────────────────────────────────────────────────────────

import type { PodChain } from "../../../podchain/src/index.ts";
import { json } from "../index.ts";

export async function handleCreateTask(
  req: Request,
  podchain: PodChain
): Promise<Response> {
  let body: Record<string, unknown>;

  try {
    body = await req.json();
  } catch {
    return json({ success: false, error: "PAYLOAD_MALFORMED", message: "Request body is not valid JSON" }, 400);
  }

  const { riderId, recipientName, recipientPhone, deliveryAddress, tier } = body;

  if (!riderId || !recipientName || !recipientPhone || !deliveryAddress || !tier) {
    return json({ success: false, error: "MISSING_FIELDS", message: "riderId, recipientName, recipientPhone, deliveryAddress, and tier are required" }, 400);
  }

  const result = await podchain.createTask({
    riderId: riderId as string,
    recipientName: recipientName as string,
    recipientPhone: recipientPhone as string,
    deliveryAddress: deliveryAddress as string,
    tier: tier as 1 | 2 | 3,
  });

  const baseUrl = process.env["BASE_URL"] ?? "https://demo.podchain.ng";

  return json(
    {
      success: true,
      taskId: result.taskId,
      tier: result.tier,
      createdAt: result.createdAt,
      // Tier 1: include raw token for the rider app to retrieve
      ...(result.rawToken && { recipientToken: result.rawToken }),
      // Tier 2: OTP dispatched — in production, send via SMS provider here
      ...(result.otp && { otpDispatched: true, otp: result.otp }), // Remove otp from production response
      // Tier 3: deep link for the recipient
      ...(result.deepLinkNonce && {
        deepLink: `${baseUrl}/confirm/${result.taskId}?nonce=${result.deepLinkNonce}`,
      }),
    },
    201
  );
}

export async function handleGetToken(
  req: Request,
  taskId: string,
  podchain: PodChain
): Promise<Response> {
  // In a full production implementation this would retrieve the token
  // status. For the demo, we return a basic status response.
  // The token itself is only returned at task creation for Tier 1.
  return json({ success: true, taskId, status: "pending" });
}
