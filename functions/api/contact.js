/**
 * POST /api/contact — save lead to D1, email Jill via Gmail SMTP (immediate, Reply-To = customer).
 *
 * Cloudflare Pages → Production (and Preview if needed):
 *   GMAIL_SMTP_USER          — Jill’s Gmail address (same account as the app password)
 *   GMAIL_SMTP_APP_PASSWORD  — Gmail “App password” (store as Secret)
 *   GMAIL_FROM_NAME          — optional display name for From:
 *
 * Lead mail always goes to heavenlyscentmobile@gmail.com (hardcoded in lead-pipeline.js).
 * Bind D1 as DB and run schema/leads.sql.
 *
 * Gmail: https://support.google.com/accounts/answer/185833
 */

import { insertLead, sendLeadNotification } from "../shared/lead-pipeline.js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (request.method !== "POST") {
    return new Response(JSON.stringify({ success: false, error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    if (!env.DB) {
      return new Response(
        JSON.stringify({
          success: false,
          error:
            "Database not configured. Bind a D1 database to this project as DB and run schema/leads.sql.",
        }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const formData = await request.formData();

    if (formData.get("honeypot")) {
      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const first_name = String(formData.get("firstName") || "").trim();
    const last_name = String(formData.get("lastName") || "").trim();
    const email = String(formData.get("email") || "").trim();
    const phone = String(formData.get("phone") || "").trim();
    const breed_size = String(formData.get("breedSize") || "").trim();
    const service_type = String(formData.get("serviceType") || "").trim();
    const message       = String(formData.get("message")      || "").trim();
    const city          = String(formData.get("city")         || "").trim();
    const cross_streets = String(formData.get("crossStreets") || "").trim();
    const created_at = new Date().toISOString();

    if (!first_name || !last_name || !email || !phone || !breed_size || !service_type || !message || !city || !cross_streets) {
      return new Response(JSON.stringify({ success: false, error: "Please fill in all required fields." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const row = {
      created_at,
      first_name,
      last_name,
      email,
      phone,
      city,
      cross_streets,
      service_type,
      breed_size,
      message,
    };

    await insertLead(env.DB, row);

    try {
      await sendLeadNotification(env, row);
    } catch (mailErr) {
      console.error("Gmail SMTP error:", mailErr);
      return new Response(
        JSON.stringify({
          success: false,
          error: "Your request was saved but the notification email could not be sent. Please call (734) 218-6141.",
        }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("contact function error:", err);
    return new Response(JSON.stringify({ success: false, error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
}
