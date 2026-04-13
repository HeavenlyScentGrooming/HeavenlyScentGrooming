/**
 * Heavenly Scent Grooming — optional standalone Worker
 * The live site uses Pages /api/contact instead. If you deploy this Worker,
 * it only forwards the form to Google Apps Script (same as functions/api/contact.js).
 *
 * Env: SHEETS_WEBHOOK_URL = Web App /exec URL (see google-sheets-webhook.js)
 */

export default {
  async fetch(request, env) {
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

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

      const url = env.SHEETS_WEBHOOK_URL;
      if (!url) {
        return new Response(JSON.stringify({ success: false, error: "SHEETS_WEBHOOK_URL not set" }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const timestamp = new Date().toLocaleString("en-US", { timeZone: "America/Detroit" });
      const payload = {
        timestamp,
        firstName: formData.get("firstName") || "",
        lastName: formData.get("lastName") || "",
        email: formData.get("email") || "",
        phone: formData.get("phone") || "",
        serviceType: formData.get("serviceType") || "",
        breedSize: formData.get("breedSize") || "",
        message: formData.get("message") || "",
      };

      const hookRes = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const text = await hookRes.text();
      let ok = false;
      try {
        ok = JSON.parse(text).success === true;
      } catch {
        /* ignore */
      }

      if (hookRes.ok && ok) {
        return new Response(JSON.stringify({ success: true }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      return new Response(JSON.stringify({ success: false, error: text.slice(0, 200) }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    } catch (err) {
      return new Response(JSON.stringify({ success: false, error: err.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  },
};
