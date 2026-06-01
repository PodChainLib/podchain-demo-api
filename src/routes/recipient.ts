// ─────────────────────────────────────────────────────────────────────────────
// PODCHAIN Demo API — Recipient Routes (Tier 3)
// GET  /confirm/:taskId          — serves the WebCrypto signing page
// POST /confirm/:taskId/sign     — receives the recipient's signature
// ─────────────────────────────────────────────────────────────────────────────

import type { PodChain } from "podchain";
import type { Tier3RecipientConfirmation } from "podchain";
import { json } from "../index";

// ── POST /confirm/:taskId/sign ────────────────────────────────────────────────

export async function handleRecipientConfirmation(
  req: Request,
  taskId: string,
  podchain: PodChain
): Promise<Response> {
  let body: Record<string, unknown>;

  try {
    body = await req.json();
  } catch {
    return json(
      { success: false, error: "PAYLOAD_MALFORMED", message: "Request body is not valid JSON" },
      400
    );
  }

  const confirmation = body as unknown as Tier3RecipientConfirmation;

  if (!confirmation.sessionPublicKey || !confirmation.signature || !confirmation.signedPayload) {
    return json(
      { success: false, error: "MISSING_FIELDS", message: "sessionPublicKey, signature, and signedPayload are required" },
      400
    );
  }

  await podchain.recordRecipientConfirmation({ taskId, confirmation });

  return json({ success: true, taskId, confirmedAt: new Date().toISOString() });
}

// ── GET /confirm/:taskId — Tier 3 recipient signing page ──────────────────────
//
// A self-contained HTML page that uses the W3C Web Cryptography API to:
//   1. Generate an ephemeral ECDSA P-256 key pair in-browser
//   2. Sign a confirmation payload containing the taskId and nonce
//   3. POST the signature and session public key back to the platform
//
// No application install required. Works in any modern browser.
// The session private key is never exported or transmitted.

export async function handleRecipientSigningPage(
  req: Request,
  taskId: string,
  url: URL
): Promise<Response> {
  const nonce = url.searchParams.get("nonce");

  if (!nonce) {
    return new Response("Invalid confirmation link — missing nonce.", { status: 400 });
  }

  const baseUrl = `${url.protocol}//${url.host}`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Confirm Delivery — PODCHAIN</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: #f5f5f5;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 1.5rem;
    }
    .card {
      background: #fff;
      border-radius: 12px;
      padding: 2rem;
      max-width: 420px;
      width: 100%;
      box-shadow: 0 2px 16px rgba(0,0,0,0.08);
    }
    .logo { font-size: 0.75rem; font-weight: 700; color: #888; letter-spacing: 0.1em; margin-bottom: 1.5rem; }
    h1 { font-size: 1.2rem; font-weight: 700; color: #111; margin-bottom: 0.5rem; }
    p  { font-size: 0.9rem; color: #555; line-height: 1.6; margin-bottom: 1.25rem; }
    .task-id { font-family: monospace; font-size: 0.8rem; background: #f0f0f0; padding: 0.4rem 0.6rem; border-radius: 6px; color: #333; margin-bottom: 1.5rem; word-break: break-all; }
    button {
      width: 100%;
      padding: 0.875rem;
      background: #111;
      color: #fff;
      border: none;
      border-radius: 8px;
      font-size: 1rem;
      font-weight: 600;
      cursor: pointer;
      transition: background 0.15s;
    }
    button:hover { background: #333; }
    button:disabled { background: #aaa; cursor: not-allowed; }
    .status {
      margin-top: 1rem;
      padding: 0.75rem;
      border-radius: 8px;
      font-size: 0.875rem;
      text-align: center;
      display: none;
    }
    .status.success { background: #d1fae5; color: #065f46; display: block; }
    .status.error   { background: #fee2e2; color: #991b1b; display: block; }
    .status.loading { background: #e0f2fe; color: #0369a1; display: block; }
  </style>
</head>
<body>
<div class="card">
  <div class="logo">PODCHAIN · PROOF OF DELIVERY</div>
  <h1>Confirm your delivery</h1>
  <p>A delivery agent is waiting to complete your delivery. Tap the button below to confirm you have received your package.</p>
  <div class="task-id">Delivery reference: ${taskId}</div>
  <button id="confirmBtn">I confirm receipt</button>
  <div class="status" id="status"></div>
</div>

<script>
(async function () {
  const TASK_ID = ${JSON.stringify(taskId)};
  const NONCE   = ${JSON.stringify(nonce)};
  const API_URL = ${JSON.stringify(`${baseUrl}/confirm/${taskId}/sign`)};

  const btn    = document.getElementById('confirmBtn');
  const status = document.getElementById('status');

  function setStatus(msg, type) {
    status.textContent = msg;
    status.className   = 'status ' + type;
  }

  btn.addEventListener('click', async () => {
    btn.disabled = true;
    setStatus('Generating confirmation signature…', 'loading');

    try {
      // Step 1 — Generate an ephemeral ECDSA P-256 key pair in-browser.
      // The private key is never exported or transmitted.
      const keyPair = await crypto.subtle.generateKey(
        { name: 'ECDSA', namedCurve: 'P-256' },
        true,
        ['sign', 'verify']
      );

      // Step 2 — Export the session public key as JWK.
      const sessionPublicKey = await crypto.subtle.exportKey('jwk', keyPair.publicKey);

      // Step 3 — Construct the confirmation payload.
      const timestamp = new Date().toISOString();
      const signedPayload = {
        nonce:     NONCE,
        statement: 'I confirm receipt of this delivery',
        taskId:    TASK_ID,
        timestamp,
      };

      // Step 4 — Sign the canonically serialised payload.
      // Keys are sorted alphabetically to match the server's verification logic.
      const canonical   = JSON.stringify(Object.fromEntries(
        Object.entries(signedPayload).sort(([a], [b]) => a.localeCompare(b))
      ));
      const payloadBytes = new TextEncoder().encode(canonical);
      const sigBuffer    = await crypto.subtle.sign(
        { name: 'ECDSA', hash: { name: 'SHA-256' } },
        keyPair.privateKey,
        payloadBytes
      );

      // Step 5 — Encode signature as base64url (IEEE P1363 format).
      const sigBytes = new Uint8Array(sigBuffer);
      const b64url   = btoa(String.fromCharCode(...sigBytes))
        .replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=+$/, '');

      // Step 6 — Submit to the platform.
      setStatus('Submitting confirmation…', 'loading');

      const res = await fetch(API_URL, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ sessionPublicKey, signature: b64url, signedPayload }),
      });

      const data = await res.json();

      if (data.success) {
        setStatus('✓ Delivery confirmed. You may close this page.', 'success');
        btn.style.display = 'none';
      } else {
        setStatus('Confirmation failed: ' + (data.message ?? 'Unknown error'), 'error');
        btn.disabled = false;
      }
    } catch (err) {
      console.error(err);
      setStatus('An error occurred. Please try again.', 'error');
      btn.disabled = false;
    }
  });
})();
</script>
</body>
</html>`;

  return new Response(html, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}
