/**
 * D1 + Gmail SMTP helpers for HSG leads (Cloudflare Pages Functions).
 *
 * Notifications go only to JILL_NOTIFY_EMAIL (hardcoded). No BCC/CC.
 * Mail is sent through Gmail’s SMTP using an App Password (TLS on port 465).
 */

import { sendLeadNotification as sendViaMailChannels } from "./mailchannels.js";


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


/**
 * Immediate lead notification (HTML + plain). Reply-To = customer email (so Jill can hit Reply).
 */
export async function sendLeadNotification(env, lead) {
  await sendViaMailChannels(env, lead);
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

  await sendViaMailChannels(env, lead);
}
