// ─────────────────────────────────────────────────────────────────────────────
// PODCHAIN Demo API — Chain Verification Route
// GET /chain/verify
// ─────────────────────────────────────────────────────────────────────────────

import type { PodChain } from "../../../podchain/src/index.ts";
import { json } from "../index.ts";

export async function handleVerifyChain(
  req: Request,
  podchain: PodChain
): Promise<Response> {
  const report = await podchain.verifyChain();
  return json({ success: true, ...report });
}
