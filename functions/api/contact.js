/**
 * Cloudflare Pages Function — POST /api/contact
 *
 * Forwards the form to your Google Apps Script web app, which:
 *   • Sends the lead to Jill’s email (MailApp)
 *   • Adds a row to the HSG Leads sheet
 *
 * Cloudflare Pages → Settings → Environment variables (Production):
 *   SHEETS_WEBHOOK_URL = full Web App URL ending in /exec
 * (Create the script from worker/google-sheets-webhook.js — see file header.)
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function webhookResponseOk(status, bodyText) {
  if (status < 200 || status >= 300) return false;
  const t = (bodyText || "").trim();
  if (!t) return false;
  if (/page not found|does not exist|file you have requested/i.test(t)) return false;
  try {
    const j = JSON.parse(t);
    return j.success === true;
  } catch {
    return false;
  }
}

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
    const formData = await request.formData();

    if (formData.get("honeypot")) {
      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const webhookUrl = env.SHEETS_WEBHOOK_URL;
    if (!webhookUrl || typeof webhookUrl !== "string") {
      console.error("SHEETS_WEBHOOK_URL is not set in Pages environment.");
      return new Response(
        JSON.stringify({
          success: false,
          error:
            "Form is not configured yet. Set SHEETS_WEBHOOK_URL in Cloudflare Pages (Apps Script web app URL).",
        }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const firstName = formData.get("firstName") || "";
    const lastName = formData.get("lastName") || "";
    const email = formData.get("email") || "";
    const phone = formData.get("phone") || "";
    const breedSize = formData.get("breedSize") || "";
    const serviceType = formData.get("serviceType") || "";
    const message = formData.get("message") || "";
    const timestamp = new Date().toLocaleString("en-US", { timeZone: "America/Detroit" });

    const payload = {
      timestamp,
      firstName,
      lastName,
      email,
      phone,
      serviceType,
      breedSize,
      message,
    };

    const hookRes = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const text = await hookRes.text();

    if (webhookResponseOk(hookRes.status, text)) {
      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.error("Apps Script webhook failed:", hookRes.status, text.slice(0, 500));
    let detail = "Could not deliver your request.";
    try {
      const j = JSON.parse(text);
      if (j.error) detail = j.error;
    } catch {
      /* ignore */
    }
    return new Response(JSON.stringify({ success: false, error: detail }), {
      status: 500,
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
