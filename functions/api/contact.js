/**
 * Cloudflare Pages Function — POST /api/contact
 *
 * Cloudflare Pages → Settings → Environment variables (production):
 *   SHEETS_WEBHOOK_URL — Apps Script Web App /exec URL (required if sheet logging is used)
 *   RESEND_API_KEY — https://resend.com API key (recommended for email)
 *   RESEND_FROM — optional, e.g. "Heavenly Scent <mail@yourdomain.com>"
 * If RESEND_FROM is unset, uses onboarding@resend.dev. For testing without a domain, create the
 * Resend account with the same address as RECIPIENT_EMAIL so test sends are allowed.
 *
 * Without RESEND_API_KEY, email goes through MailChannels; the From address must be on a zone
 * in this Cloudflare account with SPF: include:relay.mailchannels.net
 *   MAIL_FROM_EMAIL, MAIL_FROM_NAME — optional overrides for MailChannels
 */

const RECIPIENT_EMAIL = "heavenlyscentmobile@gmail.com";
const RECIPIENT_NAME = "Jill Fischer – Heavenly Scent Grooming";
const DEFAULT_SENDER_EMAIL = "noreply@heavenlyscentgrooming.pages.dev";
const DEFAULT_SENDER_NAME = "Heavenly Scent Website";

const DEFAULT_SHEETS_URL =
  "https://script.google.com/macros/s/AKfycbyJZkfTLAsv-4C-Zv_9-joFpcOis1VESWWFFzBSpE4SL1WlqoNrkOp6w2hyvsOpQqFiIg/exec";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function mailChannelsFrom(env) {
  return {
    email: env.MAIL_FROM_EMAIL || DEFAULT_SENDER_EMAIL,
    name: env.MAIL_FROM_NAME || DEFAULT_SENDER_NAME,
  };
}

async function sendViaResend(env, { subject, plain, htmlBody, replyEmail, replyName }) {
  const from = env.RESEND_FROM || "Heavenly Scent Grooming <onboarding@resend.dev>";
  return fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [RECIPIENT_EMAIL],
      reply_to: replyEmail,
      subject,
      text: plain,
      html: htmlBody,
    }),
  });
}

async function sendViaMailChannels(env, { subject, plain, htmlBody, replyEmail, replyName }) {
  const from = mailChannelsFrom(env);
  return fetch("https://api.mailchannels.net/tx/v1/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      personalizations: [
        {
          to: [{ email: RECIPIENT_EMAIL, name: RECIPIENT_NAME }],
          reply_to: { email: replyEmail, name: replyName },
        },
      ],
      from,
      subject,
      content: [
        { type: "text/plain", value: plain },
        { type: "text/html", value: htmlBody },
      ],
    }),
  });
}

function sheetsLooksSuccessful(status, bodyText) {
  if (status < 200 || status >= 300) return false;
  const t = (bodyText || "").trim();
  if (!t) return false;
  if (/page not found|does not exist|file you have requested/i.test(t)) return false;
  try {
    const j = JSON.parse(t);
    return j.success === true;
  } catch {
    return true;
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

    const firstName = formData.get("firstName") || "";
    const lastName = formData.get("lastName") || "";
    const email = formData.get("email") || "";
    const phone = formData.get("phone") || "";
    const breedSize = formData.get("breedSize") || "";
    const serviceType = formData.get("serviceType") || "";
    const message = formData.get("message") || "";
    const fullName = `${firstName} ${lastName}`.trim();
    const timestamp = new Date().toLocaleString("en-US", { timeZone: "America/Detroit" });

    const plain = `Name: ${fullName}\nEmail: ${email}\nPhone: ${phone}\nService: ${serviceType}\nBreed/Size: ${breedSize}\nMessage: ${message}`;

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

    const subject = `New Appointment Request – ${serviceType} – ${fullName}`;
    const mailPayload = { subject, plain, htmlBody, replyEmail: email, replyName: fullName };

    const mailPromise = env.RESEND_API_KEY
      ? sendViaResend(env, mailPayload)
      : sendViaMailChannels(env, mailPayload);

    const sheetsUrl = env.SHEETS_WEBHOOK_URL || DEFAULT_SHEETS_URL;
    const sheetsPromise = fetch(sheetsUrl, {
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

    const [mailRes, sheetsRes] = await Promise.all([mailPromise, sheetsPromise]);
    const sheetsText = await sheetsRes.text();

    const mailOk = env.RESEND_API_KEY
      ? mailRes.ok
      : mailRes.status === 202 || mailRes.status === 200;

    if (!mailOk) {
      const errText = await mailRes.text();
      console.error(env.RESEND_API_KEY ? "Resend error:" : "MailChannels error:", mailRes.status, errText);
    }

    const sheetsOk = sheetsLooksSuccessful(sheetsRes.status, sheetsText);
    if (!sheetsOk) {
      console.error("Sheets webhook error:", sheetsRes.status, sheetsText.slice(0, 200));
    }

    if (mailOk || sheetsOk) {
      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(
      JSON.stringify({
        success: false,
        error:
          "Could not save your request. Add RESEND_API_KEY in Cloudflare Pages (see functions/api/contact.js) and set SHEETS_WEBHOOK_URL to a live Apps Script URL.",
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (err) {
    console.error("contact function error:", err);
    return new Response(JSON.stringify({ success: false, error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
}
