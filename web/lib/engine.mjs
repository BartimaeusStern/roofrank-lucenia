// Lucenia (OpenSearch-wire-compatible) client. One client, reused by scripts + API.
import { Client } from "@opensearch-project/opensearch";

export const INDEX = "parcels";

export const client = new Client({
  node: process.env.ENGINE_URL || "https://localhost:9200",
  auth: { username: "admin", password: process.env.LUCENIA_ADMIN_PASSWORD || "RoofRank!2026Dev" },
  // local self-signed dev node; production terminates TLS with a real CA.
  ssl: { rejectUnauthorized: false },
});

// Run a raw _search (hybrid fusion is done client-side in query.mjs; see the
// note there on why Lucenia can't use an OpenSearch normalization pipeline).
export async function search(body) {
  const { body: res } = await client.transport.request({ method: "POST", path: `/${INDEX}/_search`, body });
  return res;
}
