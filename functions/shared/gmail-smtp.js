/**
 * Send mail via Gmail SMTP from Cloudflare Workers/Pages (TCP port 465).
 * Workers cannot use port 25; Gmail submission is typically 465 (TLS) or 587 (STARTTLS).
 *
 * Setup: Google Account → Security → 2-Step Verification → App passwords
 *   → generate an app password for "Mail". Put it in GMAIL_SMTP_APP_PASSWORD (Secret).
 *
 * Env:
 *   GMAIL_SMTP_USER          — full Gmail address (must match the account that owns the app password)
 *   GMAIL_SMTP_APP_PASSWORD  — 16-character app password (spaces optional)
 *   GMAIL_FROM_NAME          — optional display name for From:
 *   GMAIL_SMTP_HOST          — optional, default smtp.gmail.com
 *   GMAIL_SMTP_PORT          — optional, default 465
 */

import { connect } from "cloudflare:sockets";

function utf8ToBase64(str) {
  const bytes = new TextEncoder().encode(str);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function foldBase64(b64) {
  if (!b64) return "";
  const chunks = b64.match(/.{1,76}/g);
  return chunks ? chunks.join("\r\n") : "";
}

function foldUtf8Base64(str) {
  return foldBase64(utf8ToBase64(str));
}

function dotStuff(body) {
  return body
    .split("\r\n")
    .map((line) => (line.startsWith(".") ? "." + line : line))
    .join("\r\n");
}

function encodeSubject(subject) {
  if (/^[\x20-\x7E]*$/.test(subject)) return subject;
  return "=?UTF-8?B?" + utf8ToBase64(subject) + "?=";
}

/**
 * @param {object} opts
 * @param {string} opts.fromEmail
 * @param {string} opts.fromName
 * @param {string} opts.to
 * @param {string} [opts.toName]
 * @param {string} [opts.replyTo]
 * @param {string} [opts.replyToName]
 * @param {string} opts.subject
 * @param {string} opts.textBody
 * @param {string} opts.htmlBody
 * @param {{ filename: string, contentType: string, base64: string }[]} [opts.attachments]
 */
export async function sendViaGmailSmtp(env, opts) {
  const user = env.GMAIL_SMTP_USER?.trim();
  const pass = env.GMAIL_SMTP_APP_PASSWORD?.replace(/\s/g, "") || "";
  if (!user || !pass) {
    throw new Error(
      "Set GMAIL_SMTP_USER and GMAIL_SMTP_APP_PASSWORD in Cloudflare Pages (use a Gmail App Password)."
    );
  }

  const host = env.GMAIL_SMTP_HOST || "smtp.gmail.com";
  const port = Number(env.GMAIL_SMTP_PORT) || 465;
  const fromEmail = opts.fromEmail || user;

  const socket = connect({ hostname: host, port }, { secureTransport: "on" });
  await socket.opened;

  const reader = socket.readable.getReader();
  const writer = socket.writable.getWriter();
  const enc = new TextEncoder();
  const dec = new TextDecoder();

  let pending = "";

  async function readResponse() {
    const lines = [];
    while (true) {
      while (!pending.includes("\r\n")) {
        const { done, value } = await reader.read();
        if (done) throw new Error("SMTP connection closed unexpectedly");
        pending += dec.decode(value, { stream: true });
      }
      const idx = pending.indexOf("\r\n");
      const line = pending.slice(0, idx);
      pending = pending.slice(idx + 2);
      lines.push(line);
      if (line.length >= 4 && line[3] === " ") break;
    }
    return lines[lines.length - 1];
  }

  async function sendLine(line) {
    await writer.write(enc.encode(line + "\r\n"));
  }

  async function cmd(line) {
    await sendLine(line);
    return readResponse();
  }

  await readResponse();

  let r = await cmd("EHLO heavenlyscentgrooming.pages.dev");
  if (!/^250/.test(r)) throw new Error("EHLO failed: " + r);

  await cmd("AUTH LOGIN");
  await cmd(btoa(user));
  r = await cmd(btoa(pass));
  if (!/^235/.test(r)) throw new Error("Gmail SMTP auth failed. Use an App Password (16 chars), not your normal password: " + r);

  r = await cmd(`MAIL FROM:<${fromEmail}>`);
  if (!/^250/.test(r)) throw new Error("MAIL FROM failed: " + r);

  r = await cmd(`RCPT TO:<${opts.to}>`);
  if (!/^250/.test(r)) throw new Error("RCPT TO failed: " + r);

  r = await cmd("DATA");
  if (!/^354/.test(r)) throw new Error("DATA not accepted: " + r);

  const mime = buildMimeMessage(opts);
  const body = dotStuff(mime);
  await writer.write(enc.encode(body + "\r\n.\r\n"));

  r = await readResponse();
  if (!/^250/.test(r)) throw new Error("Message not accepted by Gmail: " + r);

  try {
    await cmd("QUIT");
  } catch {
    /* ignore */
  }
  await writer.close();
  try {
    await socket.close();
  } catch {
    /* ignore */
  }
}

function buildMimeMessage(opts) {
  const fromName = opts.fromName || "Heavenly Scent";
  const subject = encodeSubject(opts.subject);
  const date = new Date().toUTCString();

  let headers = [
    `From: ${fromName} <${opts.fromEmail}>`,
    opts.toName ? `To: ${opts.toName} <${opts.to}>` : `To: ${opts.to}`,
    `Subject: ${subject}`,
    `Date: ${date}`,
    "MIME-Version: 1.0",
  ];

  if (opts.replyTo) {
    const rt = opts.replyToName ? `${opts.replyToName} <${opts.replyTo}>` : opts.replyTo;
    headers.push(`Reply-To: ${rt}`);
  }

  const altB = "alt_" + randomBoundary();
  const altPart =
    `--${altB}\r\n` +
    "Content-Type: text/plain; charset=UTF-8\r\n" +
    "Content-Transfer-Encoding: base64\r\n\r\n" +
    foldUtf8Base64(opts.textBody) +
    "\r\n" +
    `--${altB}\r\n` +
    "Content-Type: text/html; charset=UTF-8\r\n" +
    "Content-Transfer-Encoding: base64\r\n\r\n" +
    foldUtf8Base64(opts.htmlBody) +
    "\r\n" +
    `--${altB}--`;

  if (!opts.attachments?.length) {
    headers.push(`Content-Type: multipart/alternative; boundary="${altB}"`);
    return headers.join("\r\n") + "\r\n\r\n" + altPart;
  }

  const mixB = "mix_" + randomBoundary();
  headers.push(`Content-Type: multipart/mixed; boundary="${mixB}"`);

  let mix =
    `--${mixB}\r\n` +
    `Content-Type: multipart/alternative; boundary="${altB}"\r\n\r\n` +
    altPart +
    "\r\n";

  for (const a of opts.attachments) {
    mix +=
      `--${mixB}\r\n` +
      `Content-Type: ${a.contentType}\r\n` +
      "Content-Transfer-Encoding: base64\r\n" +
      `Content-Disposition: attachment; filename="${a.filename.replace(/"/g, "")}"\r\n\r\n` +
      foldBase64(a.base64) +
      "\r\n";
  }
  mix += `--${mixB}--`;

  return headers.join("\r\n") + "\r\n\r\n" + mix;
}

function randomBoundary() {
  const a = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(a, (b) => b.toString(16).padStart(2, "0")).join("");
}
