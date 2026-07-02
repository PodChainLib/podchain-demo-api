// ─────────────────────────────────────────────────────────────────────────────
// PODCHAIN Demo API — Task Routes
// POST /tasks
// GET  /tasks?riderId=...
// GET  /tasks/:id/recipient-token
// GET  /demo/seed?riderId=...&tiers=1,2,3&count=1&reset=true
// POST /demo/bootstrap
// ─────────────────────────────────────────────────────────────────────────────

import type { Database } from "bun:sqlite";
import type { PodChain } from "podchain";
import { PodChainError } from "podchain";
import { json } from "../index";

type DemoTaskTemplate = {
  recipientName: string;
  recipientPhone: string;
  deliveryAddress: string;
  tier: 1 | 2 | 3;
};

const _kDemoTaskTemplates: DemoTaskTemplate[] = [
  {
    recipientName: "Chidi Okeke",
    recipientPhone: "+2348012345678",
    deliveryAddress: "14 Broad Street, Lagos",
    tier: 1,
  },
  {
    recipientName: "Amina Bello",
    recipientPhone: "+2348098765432",
    deliveryAddress: "22 Ahmadu Bello Way, Victoria Island, Lagos",
    tier: 2,
  },
  {
    recipientName: "Tunde Adeyemi",
    recipientPhone: "+2347034567890",
    deliveryAddress: "5 Admiralty Way, Lekki Phase 1, Lagos",
    tier: 3,
  },
];

type RawTaskRow = {
  task_id: string;
  rider_id: string;
  recipient_name: string;
  recipient_phone: string;
  delivery_address: string;
  tier: number;
  status: string;
  created_at: string;
};

type RawTokenRow = {
  token_id: string;
  token_hash: string;
  tier: number;
  consumed: number;
  issued_at: string;
  expires_at: string | null;
};

type RawSeedRow = {
  raw_token: string | null;
  otp: string | null;
  deep_link_nonce: string | null;
};

function listRegisteredRiders(db: Database): string[] {
  const rows = db
    .query(
      `SELECT rider_id
       FROM key_registry
       WHERE revoked_at IS NULL
       ORDER BY rider_id ASC`
    )
    .all() as Array<{ rider_id: string }>;

  return rows.map((row) => row.rider_id);
}

function ensureDemoSchema(db: Database): void {
  db.run(`
    CREATE TABLE IF NOT EXISTS demo_task_seed_data (
      task_id          TEXT PRIMARY KEY,
      rider_id         TEXT NOT NULL,
      tier             INTEGER NOT NULL,
      raw_token        TEXT,
      otp              TEXT,
      deep_link_nonce  TEXT,
      created_at       TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

async function createAndStoreDemoTask(
  riderId: string,
  template: DemoTaskTemplate,
  podchain: PodChain,
  db: Database
): Promise<{
  taskId: string;
  tier: 1 | 2 | 3;
  createdAt: string;
  rawToken: string | null;
  otp: string | null;
  deepLinkNonce: string | null;
}> {
  const created = await podchain.createTask({
    riderId,
    recipientName: template.recipientName,
    recipientPhone: template.recipientPhone,
    deliveryAddress: template.deliveryAddress,
    tier: template.tier,
  });

  db.run(
    `INSERT OR REPLACE INTO demo_task_seed_data
       (task_id, rider_id, tier, raw_token, otp, deep_link_nonce, created_at)
     VALUES
       ($taskId, $riderId, $tier, $rawToken, $otp, $deepLinkNonce, $createdAt)`,
    {
      $taskId: created.taskId,
      $riderId: riderId,
      $tier: created.tier,
      $rawToken: created.rawToken,
      $otp: created.otp,
      $deepLinkNonce: created.deepLinkNonce,
      $createdAt: created.createdAt,
    }
  );

  return created;
}

async function ensureSeedTasksForRider(
  riderId: string,
  podchain: PodChain,
  db: Database
): Promise<void> {
  const row = db
    .query(
      `SELECT COUNT(*) as count
       FROM tasks
       WHERE rider_id = $riderId AND status = 'pending'`
    )
    .get({ $riderId: riderId }) as { count: number } | null;

  if ((row?.count ?? 0) > 0) return;

  for (const template of _kDemoTaskTemplates) {
    await createAndStoreDemoTask(riderId, template, podchain, db);
  }
}

function parseTierSet(raw: string | null): Array<1 | 2 | 3> {
  return parseTiers(raw);
}

function parseTiers(raw: unknown): Array<1 | 2 | 3> {
  if (raw == null) return [1, 2, 3];

  let candidates: Array<string | number> = [];

  if (typeof raw === "string") {
    if (raw.trim() === "") return [1, 2, 3];
    candidates = raw.split(",").map((value) => value.trim());
  } else if (Array.isArray(raw)) {
    candidates = raw.filter(
      (value): value is string | number =>
        typeof value === "string" || typeof value === "number"
    );
  } else {
    return [];
  }

  const parsed = candidates
    .map((value) => Number.parseInt(String(value).trim(), 10))
    .filter((value): value is 1 | 2 | 3 => value === 1 || value === 2 || value === 3);

  return Array.from(new Set(parsed));
}

function parsePositiveInt(raw: string | null, fallback: number): number {
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function parsePositiveIntUnknown(raw: unknown, fallback: number): number {
  if (raw == null) return fallback;
  if (typeof raw === "number") {
    if (!Number.isFinite(raw) || raw <= 0) return fallback;
    return Math.floor(raw);
  }
  if (typeof raw === "string") {
    return parsePositiveInt(raw, fallback);
  }
  return fallback;
}

function parseBool(raw: string | null): boolean {
  if (!raw) return false;
  const normalized = raw.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

function parseBoolUnknown(raw: unknown): boolean {
  if (typeof raw === "boolean") return raw;
  if (typeof raw === "number") return raw === 1;
  if (typeof raw === "string") return parseBool(raw);
  return false;
}

function expandTemplate(
  tier: 1 | 2 | 3,
  sequence: number
): DemoTaskTemplate {
  const base = _kDemoTaskTemplates.find((candidate) => candidate.tier === tier)!;
  return {
    tier: base.tier,
    recipientName: `${base.recipientName} - Demo ${sequence}`,
    recipientPhone: base.recipientPhone,
    deliveryAddress: `${base.deliveryAddress} (Demo ${sequence})`,
  };
}

type SeedTaskInput = {
  riderId: string;
  tiers: Array<1 | 2 | 3>;
  count: number;
  reset: boolean;
  baseUrl: string;
};

async function seedDemoTasks(
  input: SeedTaskInput,
  podchain: PodChain,
  db: Database
): Promise<Array<Record<string, unknown>>> {
  const { riderId, tiers, count, reset, baseUrl } = input;

  if (reset) {
    const deletableTaskRows = db
      .query(
        `SELECT t.task_id
         FROM tasks t
         LEFT JOIN proof_certificates p ON p.task_id = t.task_id
         WHERE t.rider_id = $riderId
           AND t.status = 'pending'
           AND p.task_id IS NULL`
      )
      .all({ $riderId: riderId }) as Array<{ task_id: string }>;

    for (const row of deletableTaskRows) {
      db.run(`DELETE FROM recipient_tokens WHERE task_id = $taskId`, { $taskId: row.task_id });
      db.run(`DELETE FROM demo_task_seed_data WHERE task_id = $taskId`, { $taskId: row.task_id });
      db.run(`DELETE FROM tasks WHERE task_id = $taskId`, { $taskId: row.task_id });
    }
  }

  const createdTasks: Array<Record<string, unknown>> = [];
  let sequence = 1;

  for (let i = 0; i < count; i += 1) {
    for (const tier of tiers) {
      const template = expandTemplate(tier, sequence);
      const created = await createAndStoreDemoTask(riderId, template, podchain, db);
      createdTasks.push({
        taskId: created.taskId,
        tier: created.tier,
        recipientName: template.recipientName,
        deliveryAddress: template.deliveryAddress,
        createdAt: created.createdAt,
        token: created.rawToken,
        otp: created.otp,
        deepLink: created.deepLinkNonce
          ? `${baseUrl}/confirm/${created.taskId}?nonce=${created.deepLinkNonce}`
          : null,
      });
      sequence += 1;
    }
  }

  return createdTasks;
}

export async function handleSeedDemoTasks(
  req: Request,
  podchain: PodChain,
  db: Database
): Promise<Response> {
  ensureDemoSchema(db);

  const url = new URL(req.url);
  const riderId = url.searchParams.get("riderId");
  const tiers = parseTierSet(url.searchParams.get("tiers"));
  const count = Math.min(parsePositiveInt(url.searchParams.get("count"), 1), 20);
  const shouldReset = parseBool(url.searchParams.get("reset"));
  const baseUrl = process.env["BASE_URL"] ?? "https://demo.podchain.ng";

  if (!riderId) {
    return json(
      {
        success: false,
        error: "MISSING_FIELDS",
        message: "riderId query parameter is required",
      },
      400
    );
  }

  if (tiers.length === 0) {
    return json(
      {
        success: false,
        error: "INVALID_TIER",
        message: "tiers must contain one or more of: 1,2,3",
      },
      400
    );
  }

  try {
    const createdTasks = await seedDemoTasks(
      {
        riderId,
        tiers,
        count,
        reset: shouldReset,
        baseUrl,
      },
      podchain,
      db
    );

    return json({
      success: true,
      riderId,
      resetApplied: shouldReset,
      seededCount: createdTasks.length,
      tiers,
      tasks: createdTasks,
    });
  } catch (error) {
    if (error instanceof PodChainError && error.code === "KEY_NOT_FOUND") {
      const registeredRiders = listRegisteredRiders(db);
      return json(
        {
          success: false,
          error: "RIDER_NOT_REGISTERED",
          message:
            "Rider key is not registered yet. Login once in the demo app as this rider (or call POST /riders/register) before seeding tasks.",
          riderId,
          registeredRiders,
        },
        400
      );
    }
    throw error;
  }
}

export async function handleDemoBootstrap(
  req: Request,
  podchain: PodChain,
  db: Database
): Promise<Response> {
  ensureDemoSchema(db);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json(
      {
        success: false,
        error: "PAYLOAD_MALFORMED",
        message: "Request body is not valid JSON",
      },
      400
    );
  }

  const riderId = body["riderId"];
  const publicKey = body["publicKey"];
  const tiers = parseTiers(body["tiers"]);
  const count = Math.min(parsePositiveIntUnknown(body["count"], 1), 20);
  const shouldReset = parseBoolUnknown(body["reset"]);
  const baseUrl = process.env["BASE_URL"] ?? "https://demo.podchain.ng";

  if (!riderId || typeof riderId !== "string") {
    return json(
      {
        success: false,
        error: "MISSING_FIELDS",
        message: "riderId is required",
      },
      400
    );
  }

  if (!publicKey || typeof publicKey !== "object" || Array.isArray(publicKey)) {
    return json(
      {
        success: false,
        error: "MISSING_FIELDS",
        message: "publicKey (JWK) is required",
      },
      400
    );
  }

  if (tiers.length === 0) {
    return json(
      {
        success: false,
        error: "INVALID_TIER",
        message: "tiers must contain one or more of: 1,2,3",
      },
      400
    );
  }

  let alreadyRegistered = false;
  try {
    await podchain.registerKey({
      riderId,
      publicKey: publicKey as never,
    });
  } catch (error) {
    if (error instanceof PodChainError && error.code === "RIDER_ALREADY_EXISTS") {
      alreadyRegistered = true;
    } else {
      throw error;
    }
  }

  const createdTasks = await seedDemoTasks(
    {
      riderId,
      tiers,
      count,
      reset: shouldReset,
      baseUrl,
    },
    podchain,
    db
  );

  return json({
    success: true,
    riderId,
    registered: !alreadyRegistered,
    alreadyRegistered,
    resetApplied: shouldReset,
    seededCount: createdTasks.length,
    tiers,
    tasks: createdTasks,
  });
}

export async function handleListDemoRiders(
  _req: Request,
  db: Database
): Promise<Response> {
  const registeredRiders = listRegisteredRiders(db);
  return json({
    success: true,
    registeredRiders,
  });
}

export async function handleListTasks(
  req: Request,
  podchain: PodChain,
  db: Database
): Promise<Response> {
  ensureDemoSchema(db);

  const url = new URL(req.url);
  const riderId = url.searchParams.get("riderId");

  if (!riderId) {
    return json(
      {
        success: false,
        error: "MISSING_FIELDS",
        message: "riderId query parameter is required",
      },
      400
    );
  }

  try {
    await ensureSeedTasksForRider(riderId, podchain, db);
  } catch (error) {
    if (error instanceof PodChainError && error.code === "KEY_NOT_FOUND") {
      return json(
        {
          success: false,
          error: "RIDER_NOT_REGISTERED",
          message:
            "Rider key is not registered yet. Complete rider key registration before loading tasks.",
        },
        400
      );
    }
    throw error;
  }

  const rows = db
    .query(
      `SELECT task_id, rider_id, recipient_name, recipient_phone, delivery_address,
              tier, status, created_at
       FROM tasks
       WHERE rider_id = $riderId AND status = 'pending'
       ORDER BY created_at DESC`
    )
    .all({ $riderId: riderId }) as RawTaskRow[];

  const tasksForRider = rows.map((row) => ({
    taskId: row.task_id,
    riderId: row.rider_id,
    recipientName: row.recipient_name,
    recipientPhone: row.recipient_phone,
    deliveryAddress: row.delivery_address,
    tier: row.tier,
    status: row.status,
    createdAt: row.created_at,
  }));

  return json({
    success: true,
    riderId,
    tasks: tasksForRider,
  });
}

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
  db: Database
): Promise<Response> {
  ensureDemoSchema(db);
  const requestUrl = new URL(req.url);
  const baseUrl = process.env["BASE_URL"] ?? `${requestUrl.protocol}//${requestUrl.host}`;

  const task = db
    .query(
      `SELECT task_id, rider_id, recipient_name, recipient_phone, delivery_address,
              tier, status, created_at
       FROM tasks
       WHERE task_id = $taskId`
    )
    .get({ $taskId: taskId }) as RawTaskRow | null;

  if (!task) {
    return json(
      {
        success: false,
        error: "TASK_NOT_FOUND",
        message: `Task ${taskId} does not exist`,
      },
      404
    );
  }

  const token = db
    .query(
      `SELECT token_id, token_hash, tier, consumed, issued_at, expires_at
       FROM recipient_tokens
       WHERE task_id = $taskId`
    )
    .get({ $taskId: taskId }) as RawTokenRow | null;

  if (!token) {
    return json(
      {
        success: false,
        error: "TOKEN_NOT_FOUND",
        message: `No recipient token found for task ${taskId}`,
      },
      404
    );
  }

  const seedData = db
    .query(
      `SELECT raw_token, otp, deep_link_nonce
       FROM demo_task_seed_data
       WHERE task_id = $taskId`
    )
    .get({ $taskId: taskId }) as RawSeedRow | null;

  const tokenHash = token.token_hash;
  const isTier3Confirmed =
    token.tier === 3 &&
    tokenHash.trim().startsWith("{") &&
    tokenHash.trim().endsWith("}");

  const base = {
    success: true,
    taskId,
    tier: token.tier,
    status: isTier3Confirmed ? "confirmed" : task.status,
    consumed: token.consumed === 1,
    issuedAt: token.issued_at,
    expiresAt: token.expires_at,
  };

  if (token.tier === 1) {
    return json({
      ...base,
      token: seedData?.raw_token ?? null,
    });
  }

  if (token.tier === 2) {
    const otp = seedData?.otp ?? null;
    return json({
      ...base,
      otp,
      qrPayload: otp,
    });
  }

  if (token.tier === 3) {
    const deepLinkNonce = seedData?.deep_link_nonce ?? null;
    return json({
      ...base,
      deepLinkNonce,
      deepLink: deepLinkNonce
        ? `${baseUrl}/confirm/${taskId}?nonce=${deepLinkNonce}`
        : null,
      confirmationJson: isTier3Confirmed ? tokenHash : null,
    });
  }

  return json(base);
}
