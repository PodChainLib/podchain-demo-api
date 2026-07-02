import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createServer } from "node:net";
import {
  canonicalSerialise,
  hashCoordinates,
  toBase64Url,
} from "../../podchain/src/crypto/utils.ts";
import type {
  DeliveryPayload,
  PublicKeyJWK,
  Tier3RecipientConfirmation,
} from "../../podchain/src/types.ts";

type TestKeyPair = {
  publicKeyJwk: PublicKeyJWK;
  privateKey: CryptoKey;
};

type SeededTask = {
  taskId: string;
  tier: 1 | 2 | 3;
  token?: string;
  otp?: string;
  deepLink?: string;
};

let apiProcess: Bun.Subprocess<"ignore", "pipe", "pipe">;
let tempDir: string;
let baseUrl: string;

describe("PODCHAIN demo API end-to-end flows", () => {
  beforeAll(async () => {
    const port = await getFreePort();
    baseUrl = `http://127.0.0.1:${port}`;
    tempDir = await mkdtemp(join(tmpdir(), "podchain-demo-api-"));

    apiProcess = Bun.spawn(["bun", "run", resolve(import.meta.dir, "../src/index.ts")], {
      cwd: tempDir,
      env: {
        ...process.env,
        PORT: String(port),
        BASE_URL: baseUrl,
      },
      stdout: "pipe",
      stderr: "pipe",
    });

    await waitForServer();
  });

  afterAll(async () => {
    apiProcess.kill();
    await Promise.race([apiProcess.exited, sleep(1_000)]);
    await rm(tempDir, { recursive: true, force: true });
  });

  test("bootstraps a rider and completes tier 1, tier 2 QR/OTP, and tier 3 browser-confirmed deliveries", async () => {
    const riderKeyPair = await generateKeyPair();
    const riderId = `rider_demo_${crypto.randomUUID().slice(0, 8)}`;

    const bootstrap = await postJson("/demo/bootstrap", {
      riderId,
      publicKey: riderKeyPair.publicKeyJwk,
      tiers: [1, 2, 3],
      count: 1,
      reset: true,
    });

    expect(bootstrap.status).toBe(200);
    expect(bootstrap.body.success).toBe(true);
    expect(bootstrap.body.seededCount).toBe(3);

    const tasks = bootstrap.body.tasks as SeededTask[];
    expect(tasks.map((task) => task.tier).sort()).toEqual([1, 2, 3]);

    const tier1 = taskForTier(tasks, 1);
    const tier2 = taskForTier(tasks, 2);
    const tier3 = taskForTier(tasks, 3);

    const listedTasks = await getJson(`/tasks?riderId=${encodeURIComponent(riderId)}`);
    expect(listedTasks.body.tasks).toHaveLength(3);

    const tier1Token = await getJson(`/tasks/${tier1.taskId}/recipient-token`);
    expect(tier1Token.body.token).toBe(tier1.token);
    const tier1Certificate = await completeDelivery({
      task: tier1,
      riderId,
      privateKey: riderKeyPair.privateKey,
      recipientProof: tier1Token.body.token as string,
    });
    expect(tier1Certificate.chainPosition).toBe(1);

    const tier2Token = await getJson(`/tasks/${tier2.taskId}/recipient-token`);
    expect(tier2Token.body.otp).toBe(tier2.otp);
    expect(tier2Token.body.qrPayload).toBe(tier2.otp);
    const tier2Certificate = await completeDelivery({
      task: tier2,
      riderId,
      privateKey: riderKeyPair.privateKey,
      recipientProof: tier2Token.body.qrPayload as string,
    });
    expect(tier2Certificate.chainPosition).toBe(2);

    const tier3TokenBefore = await getJson(`/tasks/${tier3.taskId}/recipient-token`);
    expect(tier3TokenBefore.body.status).toBe("pending");
    expect(tier3TokenBefore.body.deepLink).toBe(tier3.deepLink);
    expect(tier3TokenBefore.body.deepLink).toContain(`/confirm/${tier3.taskId}`);

    const recipientConfirmation = await signRecipientConfirmation(
      tier3.taskId,
      tier3TokenBefore.body.deepLinkNonce as string
    );
    const confirmationResult = await postJson(
      `/confirm/${tier3.taskId}/sign`,
      recipientConfirmation
    );
    expect(confirmationResult.status).toBe(200);
    expect(confirmationResult.body.success).toBe(true);

    const tier3TokenAfter = await getJson(`/tasks/${tier3.taskId}/recipient-token`);
    expect(tier3TokenAfter.body.status).toBe("confirmed");
    expect(typeof tier3TokenAfter.body.confirmationJson).toBe("string");

    const tier3Certificate = await completeDelivery({
      task: tier3,
      riderId,
      privateKey: riderKeyPair.privateKey,
      recipientProof: tier3TokenAfter.body.confirmationJson as string,
    });
    expect(tier3Certificate.chainPosition).toBe(3);

    const chainReport = await getJson("/chain/verify");
    expect(chainReport.body.chainIntact).toBe(true);
    expect(chainReport.body.recordsChecked).toBe(3);
    expect(chainReport.body.terminalHash).toBe(tier3Certificate.chainHash);
  });
});

async function completeDelivery(input: {
  task: SeededTask;
  riderId: string;
  privateKey: CryptoKey;
  recipientProof: string;
}): Promise<Record<string, unknown>> {
  const payload: DeliveryPayload = {
    coordHash: await hashCoordinates(6.5244 + input.task.tier / 10_000, 3.3792),
    recipientProof: input.recipientProof,
    riderId: input.riderId,
    schemaVersion: "1.0",
    signedAt: new Date().toISOString(),
    taskId: input.task.taskId,
  };
  const canonicalPayload = canonicalSerialise(payload);
  const signature = await signString(input.privateKey, canonicalPayload);

  const completed = await postJson(`/tasks/${input.task.taskId}/complete`, {
    riderId: input.riderId,
    payload: canonicalPayload,
    signature,
  });

  expect(completed.status).toBe(200);
  expect(completed.body.success).toBe(true);
  expect(completed.body.chainHash).toMatch(/^[0-9a-f]{64}$/);

  const proof = await getJson(`/tasks/${input.task.taskId}/proof`);
  expect(proof.body.success).toBe(true);
  expect(proof.body.proof.tier).toBe(input.task.tier);
  expect(proof.body.proof.recipientProof).toBe(input.recipientProof);

  return completed.body as Record<string, unknown>;
}

async function signRecipientConfirmation(
  taskId: string,
  nonce: string
): Promise<Tier3RecipientConfirmation> {
  const keyPair = await generateKeyPair();
  const signedPayload = {
    nonce,
    statement: "I confirm receipt of this delivery" as const,
    taskId,
    timestamp: new Date().toISOString(),
  };

  return {
    sessionPublicKey: keyPair.publicKeyJwk,
    signature: await signString(keyPair.privateKey, canonicalJson(signedPayload)),
    signedPayload,
  };
}

async function generateKeyPair(): Promise<TestKeyPair> {
  const generated = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"]
  );
  const jwk = await crypto.subtle.exportKey("jwk", generated.publicKey);

  return {
    publicKeyJwk: {
      kty: "EC",
      crv: "P-256",
      x: jwk.x as string,
      y: jwk.y as string,
      key_ops: ["verify"],
      ext: true,
    },
    privateKey: generated.privateKey,
  };
}

async function signString(privateKey: CryptoKey, value: string): Promise<string> {
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: { name: "SHA-256" } },
    privateKey,
    new TextEncoder().encode(value)
  );
  return toBase64Url(signature);
}

function canonicalJson(value: Record<string, unknown>): string {
  const ordered: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort()) {
    ordered[key] = value[key];
  }
  return JSON.stringify(ordered);
}

function taskForTier(tasks: SeededTask[], tier: 1 | 2 | 3): SeededTask {
  const task = tasks.find((candidate) => candidate.tier === tier);
  if (!task) throw new Error(`Missing tier ${tier} task`);
  return task;
}

async function postJson(path: string, body: unknown): Promise<{
  status: number;
  body: Record<string, unknown>;
}> {
  const res = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return {
    status: res.status,
    body: (await res.json()) as Record<string, unknown>,
  };
}

async function getJson(path: string): Promise<{
  status: number;
  body: Record<string, unknown>;
}> {
  const res = await fetch(`${baseUrl}${path}`);
  return {
    status: res.status,
    body: (await res.json()) as Record<string, unknown>,
  };
}

async function waitForServer(): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const res = await fetch(`${baseUrl}/chain/verify`);
      if (res.ok) return;
    } catch {
      // Server is still starting.
    }
    await sleep(100);
  }

  const stdout = await new Response(apiProcess.stdout).text();
  const stderr = await new Response(apiProcess.stderr).text();
  throw new Error(`Demo API did not start.\nstdout:\n${stdout}\nstderr:\n${stderr}`);
}

async function getFreePort(): Promise<number> {
  return new Promise((resolvePort, rejectPort) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        rejectPort(new Error("Unable to allocate a TCP port"));
        return;
      }
      const { port } = address;
      server.close(() => resolvePort(port));
    });
    server.on("error", rejectPort);
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}
