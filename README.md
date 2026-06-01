# podchain-demo-api

Demo backend for PODCHAIN flows.

## Demo Data Seeding

Use the demo endpoints to create tasks for the mobile app without building an admin UI.

### Prerequisites

1. Run the API:
   - `bun run src/index.ts`
2. Ensure the rider is registered (login once in `podchain-demo-app` as that rider, or call `POST /riders/register`).

If rider registration has not happened yet, seeding returns:

```json
{
  "success": false,
  "error": "RIDER_NOT_REGISTERED",
  "message": "Rider key is not registered yet. Login once in the demo app as this rider (or call POST /riders/register) before seeding tasks."
}
```

### Seed Endpoint

- `GET /demo/seed?riderId=...&tiers=1,2,3&count=1&reset=true`

Query params:

- `riderId` required, must match a registered rider.
- `tiers` optional, CSV of any of `1,2,3` (default: `1,2,3`).
- `count` optional, number of task sets to create (default: `1`, max: `20`).
- `reset` optional (`true|false|1|0`), clears pending uncompleted tasks for that rider before seeding.

Example calls:

- `http://127.0.0.1:3000/demo/seed?riderId=rider_aisha_004&tiers=1,2,3&count=1&reset=true`
- `http://127.0.0.1:3000/demo/seed?riderId=rider_aisha_004&tiers=2&count=2`
- `http://127.0.0.1:3000/demo/seed?riderId=rider_aisha_004&tiers=3&count=2`

### Bootstrap Endpoint (Register + Seed)

- `POST /demo/bootstrap`

Body:

```json
{
  "riderId": "rider_aisha_004",
  "publicKey": { "kty": "EC", "crv": "P-256", "x": "...", "y": "..." },
  "tiers": [1, 2, 3],
  "count": 1,
  "reset": true
}
```

Notes:

- `tiers` can be an array (`[1,2,3]`) or CSV string (`"1,2,3"`).
- `count` default is `1`, max is `20`.
- `reset` clears pending, uncompleted tasks for that rider before seeding.
- If rider already exists, bootstrap continues and only seeds tasks.

### List Registered Riders

- `GET /demo/riders`

Example:

- `http://127.0.0.1:3000/demo/riders`

Response shape:

```json
{
  "success": true,
  "registeredRiders": ["rider_aisha_004", "rider_emeka_001"]
}
```
