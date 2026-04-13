/**
 * HEAVENLY SCENT GROOMING — Form handler (Google Apps Script)
 * ───────────────────────────────────────────────────────────
 * One webhook does both:
 *   • Emails Jill the full submission (MailApp, from her Google account)
 *   • Appends a row to “HSG Leads” in the spreadsheet this script is bound to
 *
 * SETUP (one time):
 *
 * 1. Create a Google Sheet (or open an existing one). Extensions → Apps Script.
 * 2. New project → name it “HSG Form Leads”. Paste this entire file. Save.
 * 3. First time: Run the function `setup` from the editor (select it, click Run).
 *    Authorize spreadsheet + Mail access when prompted.
 * 4. Deploy → New deployment → Type: Web app
 *    - Execute as: Me
 *    - Who has access: Anyone
 * 5. Copy the Web App URL (ends in /exec).
 * 6. Cloudflare Pages → your project → Settings → Environment variables → Production:
 *      SHEETS_WEBHOOK_URL = <paste the /exec URL>
 *7. Redeploy the site (or wait for the next build) so the variable is live.
 *
 * To change Jill’s inbox, edit NOTIFY_EMAIL below.
 */

const NOTIFY_EMAIL = "heavenlyscentmobile@gmail.com";
const SHEET_NAME = "HSG Leads";

const COLUMNS = [
  "Timestamp",
  "First Name",
  "Last Name",
  "Email",
  "Phone",
  "Service Type",
  "Breed / Size",
  "Message",
  "Status",
  "Notes",
];

function escapeHtml_(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function doPost(e) {
  let data;
  try {
    data = JSON.parse(e.postData.contents);
  } catch (err) {
    return jsonOut_(false, "Invalid JSON");
  }

  const firstName = data.firstName || "";
  const lastName = data.lastName || "";
  const fullName = (firstName + " " + lastName).trim() || "(no name)";
  const email = data.email || "";
  const phone = data.phone || "";
  const serviceType = data.serviceType || "";
  const breedSize = data.breedSize || "";
  const message = data.message || "";
  const timestamp =
    data.timestamp ||
    new Date().toLocaleString("en-US", { timeZone: "America/Detroit" });

  let sheetSaved = false;
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = ss.getSheetByName(SHEET_NAME);

    if (!sheet) {
      sheet = ss.insertSheet(SHEET_NAME);
      formatHeaders(sheet);
    }

    sheet.appendRow([
      timestamp,
      firstName,
      lastName,
      email,
      phone,
      serviceType,
      breedSize,
      message,
      "New",
      "",
    ]);

    const lastRow = sheet.getLastRow();
    sheet.getRange(lastRow, 1, 1, COLUMNS.length).setVerticalAlignment("middle").setWrap(false);

    if (lastRow % 2 === 0) {
      sheet.getRange(lastRow, 1, 1, COLUMNS.length).setBackground("#f7f5f0");
    }

    const statusCell = sheet.getRange(lastRow, 9);
    statusCell.setFontWeight("bold").setFontColor("#b8860b");

    sheetSaved = true;
  } catch (err) {
    console.error("Sheet error:", err);
  }

  const plain =
    "New appointment request — Heavenly Scent website\n\n" +
    "Time: " +
    timestamp +
    "\n" +
    "Name: " +
    fullName +
    "\n" +
    "Email: " +
    email +
    "\n" +
    "Phone: " +
    (phone || "—") +
    "\n" +
    "Service: " +
    serviceType +
    "\n" +
    "Breed / size: " +
    (breedSize || "—") +
    "\n\n" +
    "Message:\n" +
    (message || "—");

  const ef = escapeHtml_;
  const htmlBody =
    '<div style="font-family:Arial,sans-serif;max-width:600px;padding:16px;">' +
    '<h2 style="color:#0F2A4A;">New appointment request</h2>' +
    "<p style=\"color:#666;font-size:13px;\">" +
    ef(timestamp) +
    "</p>" +
    "<table style=\"font-size:14px;line-height:1.6;\">" +
    "<tr><td><b>Name</b></td><td>" +
    ef(fullName) +
    "</td></tr>" +
    "<tr><td><b>Email</b></td><td>" +
    ef(email) +
    "</td></tr>" +
    "<tr><td><b>Phone</b></td><td>" +
    ef(phone || "—") +
    "</td></tr>" +
    "<tr><td><b>Service</b></td><td>" +
    ef(serviceType) +
    "</td></tr>" +
    "<tr><td><b>Breed / size</b></td><td>" +
    ef(breedSize || "—") +
    "</td></tr></table>" +
    "<p><b>Message</b></p><p>" +
    ef(message || "—").replace(/\n/g, "<br>") +
    "</p></div>";

  const subject = "New appointment request — " + serviceType + " — " + fullName;

  let emailSent = false;
  try {
    MailApp.sendEmail({
      to: NOTIFY_EMAIL,
      replyTo: email || undefined,
      subject: subject,
      body: plain,
      htmlBody: htmlBody,
    });
    emailSent = true;
  } catch (err) {
    console.error("Mail error:", err);
    return jsonOut_(false, "Could not send email: " + err.message, sheetSaved);
  }

  return jsonOut_(true, null, sheetSaved);
}

function jsonOut_(success, error, sheetSaved) {
  const payload = { success: success, sheetSaved: !!sheetSaved };
  if (error) payload.error = error;
  return ContentService.createTextOutput(JSON.stringify(payload)).setMimeType(
    ContentService.MimeType.JSON
  );
}

function formatHeaders(sheet) {
  sheet.appendRow(COLUMNS);

  const headerRange = sheet.getRange(1, 1, 1, COLUMNS.length);
  headerRange
    .setBackground("#0F2A4A")
    .setFontColor("#C9A96E")
    .setFontWeight("bold")
    .setFontSize(11)
    .setHorizontalAlignment("center")
    .setVerticalAlignment("middle")
    .setWrap(false);

  sheet.setRowHeight(1, 36);

  const widths = [160, 110, 110, 220, 130, 140, 180, 280, 110, 200];
  widths.forEach((w, i) => sheet.setColumnWidth(i + 1, w));

  sheet.setFrozenRows(1);

  const statusRule = SpreadsheetApp.newDataValidation()
    .requireValueInList(
      ["New", "Contacted", "Scheduled", "Completed", "No Response"],
      true
    )
    .build();
  sheet.getRange(2, 9, 1000, 1).setDataValidation(statusRule);
}

/** Run once from the Apps Script editor to create the sheet and headers. */
function setup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) {
    throw new Error("Open the script from the Google Sheet: Extensions → Apps Script.");
  }
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    formatHeaders(sheet);
  }
  Logger.log("HSG Leads sheet is ready (or already existed).");
}
