// ─────────────────────────────────────────────────────────────────────────────
// PODCHAIN Demo API — Proof Routes
// POST /tasks/:id/complete
// GET  /tasks/:id/proof
// ─────────────────────────────────────────────────────────────────────────────

import type { PodChain } from "podchain";
import { json } from "../index";

export async function handleCompleteTask(
  req: Request,
  taskId: string,
  podchain: PodChain
): Promise<Response> {
  let body: Record<string, unknown>;

  try {
    body = await req.json();
  } catch {
    return json({ success: false, error: "PAYLOAD_MALFORMED", message: "Request body is not valid JSON" }, 400);
  }

  const { riderId, payload, signature } = body;

  if (!riderId || !payload || !signature) {
    return json({ success: false, error: "MISSING_FIELDS", message: "riderId, payload, and signature are required" }, 400);
  }

  const certificate = await podchain.verifyAndStore({
    taskId,
    riderId: riderId as string,
    payload: payload as string,
    signature: signature as string,
  });

  return json({
    success: true,
    proofId: certificate.proofId,
    taskId: certificate.taskId,
    chainHash: certificate.chainHash,
    chainPosition: certificate.chainPosition,
    offlineSubmitted: certificate.offlineSubmitted,
    issuedAt: certificate.receivedAt,
  });
}

export async function handleGetProof(
  req: Request,
  taskId: string,
  podchain: PodChain
): Promise<Response> {
  const certificate = await podchain.getProof(taskId);

  if (!certificate) {
    return json({ success: false, error: "PROOF_NOT_FOUND", message: `No proof found for task ${taskId}` }, 404);
  }

  return json({ success: true, proof: certificate });
}
