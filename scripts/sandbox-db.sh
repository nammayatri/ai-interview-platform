#!/usr/bin/env bash
# Run SQL against the GCP *sandbox* database through the running app pod (the DB has a private IP).
# Uses the app's own DATABASE_URL (role atlas_rw). Always pins the sandbox kube context; never touches prod.
#   scripts/sandbox-db.sh -c "select count(*) from users"
#   scripts/sandbox-db.sh -f migrations/003_dsa_review.sql
set -euo pipefail
CTX="gke_ny-sandbox_asia-south1_gke-kurukshetra"
NS="ojudge"
POD=$(kubectl --context "$CTX" -n "$NS" get pods -o name | grep 'pod/ai-interview-platform-' | head -1)
[ -n "$POD" ] || { echo "app pod not found in $NS on $CTX" >&2; exit 1; }

case "${1:-}" in
  -c) SQL="${2:?missing SQL}" ;;
  -f) SQL="$(cat "${2:?missing file}")" ;;
  *) echo "usage: $0 -c \"SQL\" | -f file.sql" >&2; exit 2 ;;
esac

printf '%s' "$SQL" | kubectl --context "$CTX" -n "$NS" exec -i "$POD" -- node -e '
const { Pool } = require("pg");
let sql = "";
process.stdin.on("data", (d) => (sql += d));
process.stdin.on("end", async () => {
  const p = new Pool({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 8000 });
  try {
    const res = await p.query(sql);
    for (const r of Array.isArray(res) ? res : [res]) {
      if (r.rows && r.rows.length) console.log(JSON.stringify(r.rows, null, 1));
      else console.log((r.command || "OK") + (r.rowCount != null ? " " + r.rowCount : ""));
    }
  } catch (e) { console.error("SQL ERROR:", e.message); process.exitCode = 1; }
  finally { await p.end(); }
});'
