/**
 * Heavenly Scent Grooming — Contact Form Worker
 * ─────────────────────────────────────────────
 * Deploy as:  hsg-form  (Cloudflare Workers)
 * Does two things on every submission:
 *   1. Emails Jill at heavenlyscentmobile@gmail.com via MailChannels
 *   2. Appends a row to the HSG Leads Google Sheet via Apps Script webhook
 *
 * Environment variable to set in the Worker dashboard:
 *   SHEETS_WEBHOOK_URL  →  the /exec URL from the deployed Apps Script
 *   (see google-sheets-webhook.js for setup instructions)
 */

const RECIPIENT_EMAIL = "heavenlyscentmobile@gmail.com";
const RECIPIENT_NAME  = "Jill Fischer – Heavenly Scent Grooming";
const SENDER_EMAIL    = "noreply@heavenlyscentgrooming.pages.dev";
const SENDER_NAME     = "Heavenly Scent Website";

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
      const formData  = await request.formData();

      // Honeypot
      if (formData.get("honeypot")) {
        return new Response(JSON.stringify({ success: true }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const firstName   = formData.get("firstName")   || "";
      const lastName    = formData.get("lastName")    || "";
      const email       = formData.get("email")       || "";
      const phone       = formData.get("phone")       || "";
      const breedSize   = formData.get("breedSize")   || "";
      const serviceType = formData.get("serviceType") || "";
      const message     = formData.get("message")     || "";
      const fullName    = `${firstName} ${lastName}`.trim();
      const timestamp   = new Date().toLocaleString("en-US", { timeZone: "America/Detroit" });

      // ── 1. Email via MailChannels ────────────────────────────────────────
      const htmlBody = `
<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px;background:#f9f9f9;">
  <div style="background:#0F2A4A;padding:20px 24px;border-radius:8px 8px 0 0;">
    <h2 style="color:#C9A96E;margin:0;font-size:20px;">New Appointment Request</h2>
    <p style="color:rgba(255,255,255,0.6);margin:4px 0 0;font-size:13px;">Heavenly Scent Grooming Website &bull; ${timestamp}</p>
  </div>
  <div style="background:white;padding:24px;border:1px solid #e8e4de;border-top:none;border-radius:0 0 8px 8px;">
    <table style="width:100%;border-collapse:collapse;font-size:14px;">
      <tr><td style="padding:8px 0;color:#888;width:120px;">Name</td><td style="padding:8px 0;color:#0F2A4A;font-weight:600;">${fullName}</td></tr>
      <tr><td style="padding:8px 0;color:#888;">Email</td><td style="padding:8px 0;"><a href="mailto:${email}" style="color:#C9A96E;">${email}</a></td></tr>
      <tr><td style="padding:8px 0;color:#888;">Phone</td><td style="padding:8px 0;color:#0F2A4A;">${phone || "Not provided"}</td></tr>
      <tr><td style="padding:8px 0;color:#888;">Service</td><td style="padding:8px 0;color:#0F2A4A;font-weight:600;">${serviceType}</td></tr>
      <tr><td style="padding:8px 0;color:#888;">Breed/Size</td><td style="padding:8px 0;color:#0F2A4A;">${breedSize || "Not provided"}</td></tr>
    </table>
    ${message ? `<div style="margin-top:16px;padding:16px;background:#f7f5f0;border-radius:6px;border-left:3px solid #C9A96E;">
      <p style="margin:0 0 6px;color:#888;font-size:12px;text-transform:uppercase;letter-spacing:0.08em;">Message</p>
      <p style="margin:0;color:#333;font-size:14px;line-height:1.6;">${message}</p>
    </div>` : ""}
    <div style="margin-top:24px;padding-top:16px;border-top:1px solid #eee;text-align:center;">
      <a href="mailto:${email}" style="display:inline-block;background:#C9A96E;color:#0F2A4A;font-weight:700;padding:10px 24px;border-radius:9999px;font-size:13px;text-decoration:none;">Reply to ${firstName}</a>
    </div>
  </div>
</div>`.trim();

      const mailPromise = fetch("https://api.mailchannels.net/tx/v1/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          personalizations: [{
            to: [{ email: RECIPIENT_EMAIL, name: RECIPIENT_NAME }],
            reply_to: { email, name: fullName },
          }],
          from: { email: SENDER_EMAIL, name: SENDER_NAME },
          subject: `New Appointment Request – ${serviceType} – ${fullName}`,
          content: [
            { type: "text/plain", value: `Name: ${fullName}\nEmail: ${email}\nPhone: ${phone}\nService: ${serviceType}\nBreed/Size: ${breedSize}\nMessage: ${message}` },
            { type: "text/html",  value: htmlBody },
          ],
        }),
      });

      // ── 2. Google Sheets via Apps Script webhook ─────────────────────────
      const SHEETS_URL = "https://script.google.com/macros/s/AKfycbyJZkfTLAsv-4C-Zv_9-joFpcOis1VESWWFFzBSpE4SL1WlqoNrkOp6w2hyvsOpQqFiIg/exec";
      const sheetsPromise = fetch(SHEETS_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              timestamp,
              firstName,
              lastName,
              email,
              phone,
              serviceType,
              breedSize,
              message,
            }),
          });

      // Fire both in parallel
      const [mailRes] = await Promise.all([mailPromise, sheetsPromise]);

      if (mailRes.status === 202 || mailRes.status === 200) {
        return new Response(JSON.stringify({ success: true }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      } else {
        const err = await mailRes.text();
        console.error("MailChannels error:", mailRes.status, err);
        return new Response(JSON.stringify({ success: false, error: "Mail delivery failed" }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

    } catch (err) {
      console.error("Worker error:", err);
      return new Response(JSON.stringify({ success: false, error: err.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  },
};
