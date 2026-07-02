# PODCHAIN Demo Test Run

This runbook verifies the complete PODCHAIN demo across:

- Demo API backend
- Demo Flutter rider app
- `podchain` TypeScript protocol library
- `podchain_flutter` mobile signing library
- Tier 1 passive-token delivery
- Tier 2 OTP and QR-code delivery
- Tier 3 recipient browser signing
- Proof Certificate issuance
- Hash-chain integrity verification

Use this as the canonical demo checklist before showing the system.

## 1. Preconditions

Repository layout expected by this runbook:

```text
/Users/colman/arena/podchain/
  podchain/
  podchain-demo-api/
  podchain-demo-app/
  podchain_flutter/
```

Required local tools:

- Bun
- Flutter SDK
- A simulator, emulator, or device for the Flutter rider app
- A browser for the Tier 3 recipient signing page

For Android emulator, run the app with:

```bash
flutter run --dart-define=PODCHAIN_API_BASE_URL=http://10.0.2.2:3000
```

For iOS simulator on the same Mac, the default app URL works:

```text
http://127.0.0.1:3000
```

## 2. Automated Verification

Run these before the manual demo.

### 2.1 Protocol Library

```bash
cd /Users/colman/arena/podchain/podchain
bun test
bun run typecheck
```

Expected result:

- All protocol unit tests pass.
- TypeScript typecheck exits with status `0`.

This covers canonical payload serialization, ECDSA verification, token validation, replay rejection, malformed payload rejection, timestamp checks, key revocation, and hash-chain tests.

### 2.2 Demo API End-to-End Test

```bash
cd /Users/colman/arena/podchain/podchain-demo-api
bun test
```

Expected result:

- `tests/demo-e2e.test.ts` passes.

What this test does:

1. Starts the real demo API against a temporary SQLite database.
2. Generates a real ECDSA P-256 rider key pair.
3. Calls `POST /demo/bootstrap`.
4. Seeds one Tier 1, one Tier 2, and one Tier 3 task.
5. Retrieves the Tier 1 passive token.
6. Signs and submits a real Tier 1 delivery payload.
7. Retrieves the Tier 2 OTP and QR payload.
8. Signs and submits a real Tier 2 delivery payload.
9. Generates a real ephemeral browser-style Tier 3 recipient key pair.
10. Signs the recipient confirmation payload.
11. Calls `POST /confirm/:taskId/sign`.
12. Retrieves the stored Tier 3 confirmation JSON.
13. Signs and submits a real Tier 3 rider payload.
14. Calls `GET /chain/verify`.
15. Asserts `chainIntact: true` and `recordsChecked: 3`.

This is the fastest proof that the demo is wired to the actual PODCHAIN protocol, not a mock path.

### 2.3 Flutter Mobile Library

```bash
cd /Users/colman/arena/podchain/podchain_flutter
flutter test
```

Expected result:

- All tests pass.

This verifies mobile-side canonical serialization and coordinate hashing match the server protocol.

### 2.4 Demo App

```bash
cd /Users/colman/arena/podchain/podchain-demo-app
flutter analyze
flutter test
```

Expected result:

- `flutter analyze` reports no issues.
- Widget tests pass.

This verifies the app can present built-in test riders before backend registration.

## 3. Start the Demo API

From a terminal:

```bash
cd /Users/colman/arena/podchain/podchain-demo-api
PORT=3000 BASE_URL=http://127.0.0.1:3000 bun run src/index.ts
```

Expected startup log:

```text
podchain initialised with SQLite storage
podchain-demo-api listening on http://localhost:3000
```

Keep this terminal running for the rest of the manual demo.

Optional clean run:

```bash
cd /Users/colman/arena/podchain/podchain-demo-api
rm -f podchain-demo.db podchain-demo.db-shm podchain-demo.db-wal
```

Only do this if old demo data is not needed. A clean database makes chain positions start at `1`.

## 4. API Health Check

In a second terminal:

```bash
curl -sS http://127.0.0.1:3000/chain/verify
```

Expected response on a clean DB:

```json
{
  "success": true,
  "chainIntact": true,
  "recordsChecked": 0,
  "terminalHash": "<genesis hash>",
  "verifiedAt": "<iso timestamp>"
}
```

If the DB already contains proofs, `recordsChecked` will be greater than `0`. That is acceptable if `chainIntact` is `true`.

## 5. Start the Demo App

For iOS simulator:

```bash
cd /Users/colman/arena/podchain/podchain-demo-app
flutter run
```

For Android emulator:

```bash
cd /Users/colman/arena/podchain/podchain-demo-app
flutter run --dart-define=PODCHAIN_API_BASE_URL=http://10.0.2.2:3000
```

Expected first screen:

- Title: `PODCHAIN`
- Screen: `Delivery Agent Sign In`
- Built-in rider profiles are visible.
- Unregistered built-in riders are marked as creating a test rider.

## 6. Create a Test Rider and Seed Demo Tasks

In the app:

1. Select any built-in rider, for example `Aisha Mohammed`.
2. Tap `Continue`.

Expected behavior:

1. `podchain_flutter` generates or retrieves a real ECDSA P-256 rider key.
2. The app sends the public JWK to `POST /riders/register`.
3. If the rider already exists, the API accepts the idempotent demo login path.
4. The app loads tasks with `GET /tasks?riderId=...`.
5. If the rider has no pending tasks, the API creates one pending task per tier.

Expected task list:

- One Tier 1 passive-token delivery.
- One Tier 2 OTP delivery.
- One Tier 3 two-sided-signing delivery.

## 7. Tier 1 Demo: Passive Token Delivery

Open the Tier 1 task in the app.

Expected screen:

- The task is labeled passive token.
- No recipient code is required.

Run the flow:

1. Tap `Confirm Delivery & Sign`.
2. The app retrieves the passive token from:

```text
GET /tasks/:taskId/recipient-token
```

3. The app records GPS coordinates or falls back to demo coordinates if GPS is unavailable.
4. `podchain_flutter` builds the canonical payload:

```json
{
  "coordHash": "<sha256 of coordinates>",
  "recipientProof": "<tier 1 raw passive token>",
  "riderId": "<rider id>",
  "schemaVersion": "1.0",
  "signedAt": "<device iso timestamp>",
  "taskId": "<task id>"
}
```

5. The app signs the canonical JSON with the rider private key.
6. The app submits:

```text
POST /tasks/:taskId/complete
```

Expected server verification:

1. Payload parses as canonical JSON.
2. Payload `riderId` matches request `riderId`.
3. Payload `taskId` matches URL task ID.
4. Registered rider public key is loaded.
5. ECDSA P-256 signature verifies.
6. Task exists, is pending, and belongs to the rider.
7. Tier 1 passive token hash matches the stored token hash.
8. Timestamp is within the accepted window.
9. Token is consumed atomically.
10. Proof Certificate is stored.
11. Task status becomes `completed`.
12. Proof is appended to the hash chain.

Expected app result:

- Success screen shows `Delivery Confirmed`.
- Success screen shows Proof ID.
- Success screen shows Chain Hash.
- Success screen shows Chain Position.

Optional API check:

```bash
curl -sS http://127.0.0.1:3000/tasks/<tier1-task-id>/proof
```

Expected response:

- `success: true`
- `proof.tier: 1`
- `proof.recipientProof` equals the Tier 1 raw passive token used by the app.

## 8. Tier 2 Demo: OTP and QR Delivery

Open the Tier 2 task in the app.

Expected screen:

- The task is labeled OTP confirmation.
- The app shows a demo OTP.
- The app shows the QR payload.
- The app offers manual entry and QR scanning.

Run the manual OTP flow:

1. Use the visible demo OTP or ask the recipient to provide it.
2. Enter the 6-digit code.
3. Confirm that the app shows `Code accepted - ready to sign`.
4. Tap `Confirm Delivery & Sign`.

Run the QR variant:

1. Tap `Scan QR`.
2. Scan a QR code containing either:

```text
123456
```

or:

```text
podchain://confirm?otp=123456
```

3. The scanner extracts the 6-digit code.
4. Tap `Confirm Delivery & Sign`.

Expected server verification:

1. Payload signature and task ownership checks pass.
2. Tier 2 submitted OTP is hashed.
3. Hash matches the stored OTP hash.
4. OTP has not expired.
5. Token is consumed atomically.
6. Proof Certificate is stored and chained.

Expected app result:

- Success screen shows Proof ID.
- Success screen shows Chain Hash.
- Success screen shows Chain Position.

Optional API check:

```bash
curl -sS http://127.0.0.1:3000/tasks/<tier2-task-id>/recipient-token
curl -sS http://127.0.0.1:3000/tasks/<tier2-task-id>/proof
```

Expected token response before completion:

- `tier: 2`
- `otp` is present for demo use.
- `qrPayload` equals the OTP for demo use.

Expected proof response after completion:

- `proof.tier: 2`
- `proof.recipientProof` equals the submitted OTP.

## 9. Tier 3 Demo: Recipient Browser Signing

Open the Tier 3 task in the app.

Expected screen:

- The task is labeled two-sided signing.
- The app shows a recipient signing link.
- The app offers `Copy link`.
- The app offers `Check confirmation status`.

Run the recipient browser flow:

1. Copy the recipient signing link from the app.
2. Open the link in a browser.
3. Browser page should show `Confirm your delivery`.
4. Click `I confirm receipt`.

Expected browser behavior:

1. Browser generates an ephemeral ECDSA P-256 key pair.
2. Browser exports only the ephemeral public key.
3. Browser builds a confirmation payload:

```json
{
  "nonce": "<deep-link nonce>",
  "statement": "I confirm receipt of this delivery",
  "taskId": "<task id>",
  "timestamp": "<browser iso timestamp>"
}
```

4. Browser canonicalizes that payload by sorting keys.
5. Browser signs the canonical JSON using WebCrypto.
6. Browser submits:

```text
POST /confirm/:taskId/sign
```

Expected API behavior:

1. Task has a Tier 3 token.
2. Signed payload task ID matches URL task ID.
3. Nonce hashes to the stored nonce hash.
4. Browser ECDSA signature verifies against the submitted ephemeral public key.
5. API stores the full confirmation JSON in the token record.
6. Token is not consumed yet.

Return to the rider app:

1. Tap `Check confirmation status`.
2. The app polls:

```text
GET /tasks/:taskId/recipient-token
```

3. When confirmed, the API returns:

```json
{
  "status": "confirmed",
  "confirmationJson": "<full tier 3 confirmation JSON>"
}
```

4. The app uses `confirmationJson` as `recipientProof`.
5. Tap `Confirm Delivery & Sign`.

Expected server verification:

1. Rider payload signature verifies.
2. Task exists and belongs to the rider.
3. Tier 3 recipient proof equals the stored browser confirmation JSON.
4. Token is consumed atomically.
5. Proof Certificate is stored and chained.

Expected app result:

- Success screen shows Proof ID.
- Success screen shows Chain Hash.
- Success screen shows Chain Position.

Optional API check:

```bash
curl -sS http://127.0.0.1:3000/tasks/<tier3-task-id>/proof
```

Expected proof response:

- `proof.tier: 3`
- `proof.recipientProof` is the stored confirmation JSON.

## 10. Verify Chain Integrity

After completing all three tiers:

```bash
curl -sS http://127.0.0.1:3000/chain/verify
```

Expected response on a clean DB:

```json
{
  "success": true,
  "chainIntact": true,
  "recordsChecked": 3,
  "terminalHash": "<tier 3 chain hash>",
  "verifiedAt": "<iso timestamp>"
}
```

If the database was not clean, expected response is:

- `success: true`
- `chainIntact: true`
- `recordsChecked` equals total stored Proof Certificates.
- `terminalHash` equals the latest Proof Certificate chain hash.

Cross-check:

1. The Tier 1 proof should have a lower `chainPosition` than Tier 2.
2. The Tier 2 proof should have a lower `chainPosition` than Tier 3.
3. Each proof's `prevHash` should equal the previous proof's `chainHash`.
4. The chain report `terminalHash` should equal the last proof's `chainHash`.

## 11. Negative Checks

These checks prove rejection paths are active.

### 11.1 Wrong Tier 2 OTP

Use any incorrect 6-digit OTP for a Tier 2 task.

Expected result:

- Submission fails.
- API error code is `TOKEN_INVALID`.
- No Proof Certificate is issued.
- Token remains unconsumed.

### 11.2 Tier 3 Before Browser Confirmation

Try to complete a Tier 3 delivery before opening the recipient link.

Expected result:

- Submission fails.
- API error code is `RECIPIENT_PROOF_INVALID`.
- No Proof Certificate is issued.
- Token remains unconsumed.

### 11.3 Replay Completed Delivery

Submit the same completed task again.

Expected result:

- Submission fails.
- API error code is `TASK_ALREADY_COMPLETED` or `TOKEN_CONSUMED`, depending on where the duplicate request is rejected.
- No second Proof Certificate is issued.

### 11.4 Tampered Payload

Modify any field in the signed payload after signing.

Expected result:

- Submission fails.
- API error code is `SIGNATURE_INVALID` or `PAYLOAD_MALFORMED`.
- No token is consumed.
- No Proof Certificate is issued.

## 12. Demo Acceptance Checklist

The demo is complete only when all items are true:

- Automated protocol tests pass.
- Protocol typecheck passes.
- Demo API E2E test passes.
- Flutter mobile library tests pass.
- Demo app analysis passes.
- Demo app widget test passes.
- API starts on `http://127.0.0.1:3000`.
- App can select or create a test rider.
- App shows three pending tasks, one per tier.
- Tier 1 completes using passive token retrieval.
- Tier 2 completes using OTP entry.
- Tier 2 QR payload is visible and scannable.
- Tier 3 browser link opens and records recipient WebCrypto signature.
- Tier 3 rider app polling detects confirmation.
- Tier 3 completes using stored confirmation JSON as `recipientProof`.
- Each completed delivery issues a Proof Certificate.
- Each app success screen shows Proof ID, Chain Hash, and Chain Position.
- `GET /chain/verify` returns `chainIntact: true`.
- Completed tasks disappear from the pending task list after refresh.

## 13. Troubleshooting

### App cannot reach API

Check the base URL:

- iOS simulator: `http://127.0.0.1:3000`
- Android emulator: `http://10.0.2.2:3000`
- Physical device: use the Mac's LAN IP and set `BASE_URL`/`PODCHAIN_API_BASE_URL` accordingly.

### Tier 3 browser link uses the wrong host

Set `BASE_URL` when starting the API:

```bash
BASE_URL=http://<reachable-host>:3000 PORT=3000 bun run src/index.ts
```

### Chain positions do not start at 1

The database already has Proof Certificates. This is valid if `chainIntact` is true.

For a clean demo, stop the API and remove the SQLite files:

```bash
rm -f podchain-demo.db podchain-demo.db-shm podchain-demo.db-wal
```

### Rider already exists

The demo registration endpoint treats this as acceptable for repeat demos. Existing rider keys must still match the device key for successful signature verification.

### GPS permission fails

The demo app falls back to `0.0,0.0` coordinates so the signing path remains demonstrable. The signed payload still contains a real coordinate hash.

## 14. Last Verified Baseline

Baseline verified on July 2, 2026:

- `podchain`: `bun test` passed.
- `podchain`: `bun run typecheck` passed.
- `podchain-demo-api`: `bun test` passed.
- `podchain_flutter`: `flutter test` passed.
- `podchain-demo-app`: `flutter analyze` passed.
- `podchain-demo-app`: `flutter test` passed.
- Live `GET /chain/verify` returned `chainIntact: true`.
