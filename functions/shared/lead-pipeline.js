/**
 * D1 + Gmail SMTP helpers for HSG leads (Cloudflare Pages Functions).
 *
 * Notifications go only to JILL_NOTIFY_EMAIL (hardcoded). No BCC/CC.
 * Mail is sent through Gmail’s SMTP using an App Password (TLS on port 465).
 */

import { sendViaGmailSmtp } from "./gmail-smtp.js";

/** Single inbox for lead alerts and CSV digests — not configurable via env (avoids misrouting). */
const JILL_NOTIFY_EMAIL = "heavenlyscentmobile@gmail.com";

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
      "SELECT id, created_at, first_name, last_name, email, phone, service_type, breed_size, message FROM leads ORDER BY id ASC"
    )
    .all();
  return results || [];
}

export async function insertLead(db, row) {
  await db
    .prepare(
      `INSERT INTO leads (created_at, first_name, last_name, email, phone, service_type, breed_size, message)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      row.created_at,
      row.first_name,
      row.last_name,
      row.email,
      row.phone,
      row.service_type,
      row.breed_size,
      row.message
    )
    .run();
}

function escapeHtml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Immediate lead notification (HTML + plain). Reply-To = customer email (so Jill can hit Reply).
 */
export async function sendLeadNotification(env, lead) {
  const fromEmail = env.GMAIL_SMTP_USER?.trim();
  if (!fromEmail) {
    throw new Error("GMAIL_SMTP_USER is not set.");
  }

  const to = JILL_NOTIFY_EMAIL;
  const fullName = `${lead.first_name} ${lead.last_name}`.trim() || "(no name)";
  const subject = `New appointment request — ${lead.service_type} — ${fullName}`;
  const plain =
    `New appointment request — Heavenly Scent website\n\n` +
    `Time: ${lead.created_at}\n` +
    `Name: ${fullName}\n` +
    `Email: ${lead.email}\n` +
    `Phone: ${lead.phone || "—"}\n` +
    `Service: ${lead.service_type}\n` +
    `Breed / size: ${lead.breed_size || "—"}\n\n` +
    `Message:\n${lead.message || "—"}`;

  const html =
    `<div style="font-family:Arial,sans-serif;max-width:600px;padding:16px;">` +
    `<h2 style="color:#0F2A4A;">New appointment request</h2>` +
    `<p style="color:#666;font-size:13px;">${escapeHtml(lead.created_at)}</p>` +
    `<table style="font-size:14px;line-height:1.6;">` +
    `<tr><td><b>Name</b></td><td>${escapeHtml(fullName)}</td></tr>` +
    `<tr><td><b>Email</b></td><td>${escapeHtml(lead.email)}</td></tr>` +
    `<tr><td><b>Phone</b></td><td>${escapeHtml(lead.phone || "—")}</td></tr>` +
    `<tr><td><b>Service</b></td><td>${escapeHtml(lead.service_type)}</td></tr>` +
    `<tr><td><b>Breed / size</b></td><td>${escapeHtml(lead.breed_size || "—")}</td></tr></table>` +
    `<p><b>Message</b></p><p>${escapeHtml(lead.message || "—").replace(/\n/g, "<br>")}</p></div>`;

  await sendViaGmailSmtp(env, {
    fromEmail,
    fromName: env.GMAIL_FROM_NAME || "Heavenly Scent Website",
    to,
    toName: "Jill",
    replyTo: lead.email || undefined,
    replyToName: fullName || undefined,
    subject,
    textBody: plain,
    htmlBody: html,
  });
}

/**
 * Email full CSV export (digest). Uses Gmail SMTP with attachment.
 */
export async function sendLeadsCsvDigest(env) {
  const db = env.DB;
  if (!db) throw new Error("D1 binding DB missing");

  const fromEmail = env.GMAIL_SMTP_USER?.trim();
  if (!fromEmail) throw new Error("GMAIL_SMTP_USER is not set.");

  const rows = await fetchAllLeads(db);
  const csv = leadsToCsv(rows);
  const to = JILL_NOTIFY_EMAIL;
  const date = new Date().toISOString().slice(0, 10);
  const subject = `HSG leads export — ${date} (${rows.length} rows)`;
  const csvB64 = utf8ToBase64(csv);

  await sendViaGmailSmtp(env, {
    fromEmail,
    fromName: env.GMAIL_FROM_NAME || "Heavenly Scent Website",
    to,
    toName: "Jill",
    subject,
    textBody:
      `Attached: all leads from the website database as of ${date}.\n` +
      `Import the CSV into your CRM. Row count: ${rows.length}.`,
    htmlBody: `<p>Attached: all leads as of <b>${escapeHtml(date)}</b>. Rows: ${rows.length}. Import the CSV into your CRM.</p>`,
    attachments: [
      {
        filename: `hsg-leads-${date}.csv`,
        contentType: "text/csv; charset=utf-8",
        base64: csvB64,
      },
    ],
  });
}
