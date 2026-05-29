// ─────────────────────────────────────────────────────────────────────────────
// PODCHAIN Demo API — Entry Point
//
// A minimal logistics platform backend demonstrating the podchain library.
// Built with Bun.serve() — no web framework, no boilerplate.
//
// Run:  bun run src/index.ts
// ─────────────────────────────────────────────────────────────────────────────

import { Database } from "bun:sqlite";
import { PodChain } from "../../podchain/src/index";
import { SQLiteAdapter } from "../../podchain/src/adapters/sqlite-adapter";
import { handleRegisterRider } from "./routes/riders";
import { handleCreateTask, handleGetToken } from "./routes/tasks";
import { handleCompleteTask, handleGetProof } from "./routes/proofs";
import { handleVerifyChain } from "./routes/chain";
import { handleRecipientConfirmation, handleRecipientSigningPage } from "./routes/recipient";
import { PodChainError } from "../../podchain/src/errors";

// ── Initialise Storage and Protocol ──────────────────────────────────────────

const db = new Database("podchain-demo.db");
const storage = new SQLiteAdapter(db);
export const podchain = new PodChain({ storage });

console.log("✓ podchain initialised with SQLite storage");

// ── Request Router ────────────────────────────────────────────────────────────

async function route(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const method = req.method;
  const path = url.pathname;

  // Route matching — minimal router without a framework dependency
  if (method === "POST" && path === "/riders/register")
    return handleRegisterRider(req, podchain);

  if (method === "POST" && path === "/tasks")
    return handleCreateTask(req, podchain);

  const taskTokenMatch = path.match(/^\/tasks\/([^/]+)\/recipient-token$/);
  if (method === "GET" && taskTokenMatch)
    return handleGetToken(req, taskTokenMatch[1]!, podchain);

  const taskCompleteMatch = path.match(/^\/tasks\/([^/]+)\/complete$/);
  if (method === "POST" && taskCompleteMatch)
    return handleCompleteTask(req, taskCompleteMatch[1]!, podchain);

  const taskProofMatch = path.match(/^\/tasks\/([^/]+)\/proof$/);
  if (method === "GET" && taskProofMatch)
    return handleGetProof(req, taskProofMatch[1]!, podchain);

  if (method === "GET" && path === "/chain/verify")
    return handleVerifyChain(req, podchain);

  // Tier 3 recipient signing
  const recipientConfirmMatch = path.match(/^\/confirm\/([^/]+)\/sign$/);
  if (method === "POST" && recipientConfirmMatch)
    return handleRecipientConfirmation(req, recipientConfirmMatch[1]!, podchain);

  const recipientPageMatch = path.match(/^\/confirm\/([^/]+)$/);
  if (method === "GET" && recipientPageMatch)
    return handleRecipientSigningPage(req, recipientPageMatch[1]!, url);

  return json({ success: false, error: "NOT_FOUND", message: "Route not found" }, 404);
}

// ── Global Error Handler ──────────────────────────────────────────────────────

async function handleRequest(req: Request): Promise<Response> {
  try {
    return await route(req);
  } catch (err) {
    if (err instanceof PodChainError) {
      return json(err.toJSON(), err.httpStatus);
    }
    console.error("Unhandled error:", err);
    return json(
      { success: false, error: "INTERNAL_ERROR", message: "An unexpected error occurred" },
      500
    );
  }
}

// ── Utility ───────────────────────────────────────────────────────────────────

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// ── Server ────────────────────────────────────────────────────────────────────

const PORT = Number(process.env["PORT"] ?? 3000);

Bun.serve({
  port: PORT,
  fetch: handleRequest,
});

console.log(`✓ podchain-demo-api listening on http://localhost:${PORT}`);
