/**
 * GET /api/leads-export?token=YOUR_SECRET — download all leads as CSV (CRM import).
 * Set LEADS_ADMIN_SECRET in Pages environment.
 */

import { fetchAllLeads, leadsToCsv } from "../shared/lead-pipeline.js";

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method !== "GET") {
    return new Response("Method not allowed", { status: 405 });
  }

  const secret = env.LEADS_ADMIN_SECRET;
  if (!secret || typeof secret !== "string") {
    return new Response("Export not configured.", { status: 503 });
  }

  const url = new URL(request.url);
  if (url.searchParams.get("token") !== secret) {
    return new Response("Unauthorized", { status: 401 });
  }

  if (!env.DB) {
    return new Response("Database not bound.", { status: 503 });
  }

  const rows = await fetchAllLeads(env.DB);
  const csv = leadsToCsv(rows);
  const filename = `hsg-leads-${new Date().toISOString().slice(0, 10)}.csv`;

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
