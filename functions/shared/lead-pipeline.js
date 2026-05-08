/**
 * D1 + Gmail SMTP helpers for HSG leads (Cloudflare Pages Functions).
 *
 * Lead alerts go to LEAD_RECIPIENTS (hardcoded list).
 * Mail goes through Gmail SMTP using an App Password (TLS on port 465).
 */

import { sendViaGmailSmtp } from "./gmail-smtp.js";

const LEAD_RECIPIENTS = [
  "heavenlyscentgrooming@gmail.com",
  "ramayan@ebonyiris.com",
];

export function csvEscape(value) {
  const s = value == null ? "" : String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function leadsToCsv(rows) {
  const header = [
    "id",
    "created_at",
    "first_name",
    "last_name",
    "email",
    "phone",
    "city",
    "cross_streets",
    "service_type",
    "breed_size",
    "message",
  ];
  const lines = [header.join(",")];
  for (const r of rows) {
    lines.push(
      [
        csvEscape(r.id),
        csvEscape(r.created_at),
        csvEscape(r.first_name),
        csvEscape(r.last_name),
        csvEscape(r.email),
        csvEscape(r.phone),
        csvEscape(r.city),
        csvEscape(r.cross_streets),
        csvEscape(r.service_type),
        csvEscape(r.breed_size),
        csvEscape(r.message),
      ].join(",")
    );
  }
  return lines.join("\r\n");
}

export function utf8ToBase64(str) {
  const bytes = new TextEncoder().encode(str);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

export async function fetchAllLeads(db) {
  const { results } = await db
    .prepare(
      "SELECT id, created_at, first_name, last_name, email, phone, city, cross_streets, service_type, breed_size, message FROM leads ORDER BY id ASC"
    )
    .all();
  return results || [];
}

export async function insertLead(db, row) {
  await db
    .prepare(
      `INSERT INTO leads (created_at, first_name, last_name, email, phone, city, cross_streets, service_type, breed_size, message)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      row.created_at,
      row.first_name,
      row.last_name,
      row.email,
      row.phone,
      row.city,
      row.cross_streets,
      row.service_type,
      row.breed_size,
      row.message
    )
    .run();
}

function esc(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Immediate lead notification (HTML + plain). Reply-To = customer email.
 */
export async function sendLeadNotification(env, lead) {
  const fromEmail = env.GMAIL_SMTP_USER?.trim();
  if (!fromEmail) throw new Error("GMAIL_SMTP_USER is not set.");

  const fullName = `${lead.first_name} ${lead.last_name}`.trim() || "(no name)";
  const subject = `New appointment request — ${lead.service_type} — ${fullName}`;

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

  await sendViaGmailSmtp(env, {
    fromEmail,
    fromName: env.GMAIL_FROM_NAME || "Heavenly Scent Grooming Website",
    to: LEAD_RECIPIENTS,
    replyTo: lead.email || undefined,
    replyToName: fullName || undefined,
    subject,
    textBody: plain,
    htmlBody: html,
  });
}

/**
 * Email full CSV export (digest).
 */
export async function sendLeadsCsvDigest(env) {
  const db = env.DB;
  if (!db) throw new Error("D1 binding DB missing");

  const fromEmail = env.GMAIL_SMTP_USER?.trim();
  if (!fromEmail) throw new Error("GMAIL_SMTP_USER is not set.");

  const rows = await fetchAllLeads(db);
  const csv = leadsToCsv(rows);
  const date = new Date().toISOString().slice(0, 10);
  const subject = `HSG leads export — ${date} (${rows.length} rows)`;
  const csvB64 = utf8ToBase64(csv);

  await sendViaGmailSmtp(env, {
    fromEmail,
    fromName: env.GMAIL_FROM_NAME || "Heavenly Scent Grooming Website",
    to: LEAD_RECIPIENTS,
    subject,
    textBody:
      `Attached: all leads from the website database as of ${date}.\n` +
      `Row count: ${rows.length}.`,
    htmlBody: `<p>Attached: all leads as of <b>${esc(date)}</b>. Rows: ${rows.length}.</p>`,
    attachments: [
      {
        filename: `hsg-leads-${date}.csv`,
        contentType: "text/csv; charset=utf-8",
        base64: csvB64,
      },
    ],
  });
}
