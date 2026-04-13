/**
 * POST /api/leads-digest — email Jill the full CSV (same as the daily cron). Optional manual trigger.
 * Header: Authorization: Bearer <LEADS_ADMIN_SECRET>
 */

import { sendLeadsCsvDigest } from "../shared/lead-pipeline.js";

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method !== "POST") {
    return new Response(JSON.stringify({ ok: false, error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

  const secret = env.LEADS_ADMIN_SECRET;
  if (!secret) {
    return new Response(JSON.stringify({ ok: false, error: "LEADS_ADMIN_SECRET not set" }), {
      status: 503,
      headers: { "Content-Type": "application/json" },
    });
  }

  const auth = request.headers.get("Authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (token !== secret) {
    return new Response(JSON.stringify({ ok: false, error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    await sendLeadsCsvDigest(env);
    return new Response(JSON.stringify({ ok: true }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error(e);
    return new Response(JSON.stringify({ ok: false, error: e.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
