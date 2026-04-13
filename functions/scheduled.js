/**
 * Daily CSV digest emailed to Jill (Gmail SMTP, same as /api/contact).
 * Cloudflare → Workers & Pages → this project → Triggers → Cron, e.g. `0 14 * * *` (14:00 UTC).
 * Requires: DB, GMAIL_SMTP_USER, GMAIL_SMTP_APP_PASSWORD (and optional GMAIL_FROM_NAME).
 */

import { sendLeadsCsvDigest } from "./shared/lead-pipeline.js";

export default {
  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(
      (async () => {
        try {
          await sendLeadsCsvDigest(env);
        } catch (e) {
          console.error("scheduled digest failed:", e);
        }
      })()
    );
  },
};
