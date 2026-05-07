/**
 * Send email via MailChannels (free, built into Cloudflare Workers/Pages).
 * No API key, no password, no SMTP — just a fetch() to api.mailchannels.net.
 * Reply-To is set to the form submitter so Jill hits Reply and it goes to them.
 *
 * Docs: https://docs.mailchannels.net/transactional/getting-started
 */

const RECIPIENTS = [
  { email: "heavenlyscentgrooming@gmail.com", name: "Heavenly Scent Grooming" },
  { email: "ramayan@ebonyiris.com",           name: "Ramayan – Ebony Iris Media" },
];
const FROM_EMAIL = "noreply@heavenlyscentgrooming.pages.dev";
const FROM_NAME  = "Heavenly Scent Grooming Website";

export async function sendLeadNotification(env, lead) {
  const fullName = `${lead.first_name} ${lead.last_name}`.trim() || "(no name)";

  const plain =
    `New appointment request — Heavenly Scent website\n\n` +
    `Time:          ${lead.created_at}\n` +
    `Name:          ${fullName}\n` +
    `Email:         ${lead.email}\n` +
    `Phone:         ${lead.phone || "—"}\n` +
    `City:          ${lead.city || "—"}\n` +
    `Cross Streets: ${lead.cross_streets || "—"}\n` +
    `Service:       ${lead.service_type}\n` +
    `Breed / Size:  ${lead.breed_size || "—"}\n\n` +
    `Message:\n${lead.message || "—"}`;

  const html = `
<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px;background:#f9f9f9;">
  <div style="background:#0F2A4A;padding:20px 24px;border-radius:8px 8px 0 0;">
    <h2 style="color:#C9A96E;margin:0;font-size:20px;">New Appointment Request</h2>
    <p style="color:rgba(255,255,255,0.6);margin:4px 0 0;font-size:13px;">${esc(lead.created_at)}</p>
  </div>
  <div style="background:white;padding:24px;border:1px solid #e8e4de;border-top:none;border-radius:0 0 8px 8px;">
    <table style="width:100%;border-collapse:collapse;font-size:14px;">
      <tr><td style="padding:6px 0;color:#888;width:130px;">Name</td><td style="padding:6px 0;color:#0F2A4A;font-weight:600;">${esc(fullName)}</td></tr>
      <tr><td style="padding:6px 0;color:#888;">Email</td><td style="padding:6px 0;"><a href="mailto:${esc(lead.email)}" style="color:#C9A96E;">${esc(lead.email)}</a></td></tr>
      <tr><td style="padding:6px 0;color:#888;">Phone</td><td style="padding:6px 0;color:#0F2A4A;">${esc(lead.phone || "—")}</td></tr>
      <tr><td style="padding:6px 0;color:#888;">City</td><td style="padding:6px 0;color:#0F2A4A;">${esc(lead.city || "—")}</td></tr>
      <tr><td style="padding:6px 0;color:#888;">Cross Streets</td><td style="padding:6px 0;color:#0F2A4A;">${esc(lead.cross_streets || "—")}</td></tr>
      <tr><td style="padding:6px 0;color:#888;">Service</td><td style="padding:6px 0;color:#0F2A4A;font-weight:600;">${esc(lead.service_type)}</td></tr>
      <tr><td style="padding:6px 0;color:#888;">Breed / Size</td><td style="padding:6px 0;color:#0F2A4A;">${esc(lead.breed_size || "—")}</td></tr>
    </table>
    ${lead.message ? `
    <div style="margin-top:16px;padding:16px;background:#f7f5f0;border-radius:6px;border-left:3px solid #C9A96E;">
      <p style="margin:0 0 6px;color:#888;font-size:11px;text-transform:uppercase;letter-spacing:0.08em;">Message</p>
      <p style="margin:0;color:#333;font-size:14px;line-height:1.6;">${esc(lead.message).replace(/\n/g, "<br>")}</p>
    </div>` : ""}
    <div style="margin-top:24px;padding-top:16px;border-top:1px solid #eee;text-align:center;">
      <a href="mailto:${esc(lead.email)}" style="display:inline-block;background:#C9A96E;color:#0F2A4A;font-weight:700;padding:10px 28px;border-radius:9999px;font-size:13px;text-decoration:none;">
        Reply to ${esc(lead.first_name)}
      </a>
    </div>
  </div>
</div>`.trim();

  const res = await fetch("https://api.mailchannels.net/tx/v1/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      personalizations: [{
        to: RECIPIENTS,
        reply_to: { email: lead.email, name: fullName },
      }],
      from:    { email: FROM_EMAIL, name: FROM_NAME },
      subject: `New appointment request — ${lead.service_type} — ${fullName}`,
      content: [
        { type: "text/plain", value: plain },
        { type: "text/html",  value: html  },
      ],
    }),
  });

  if (res.status !== 202 && res.status !== 200) {
    const body = await res.text();
    throw new Error(`MailChannels error ${res.status}: ${body}`);
  }
}

function esc(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
