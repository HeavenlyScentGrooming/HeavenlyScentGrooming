/**
 * HEAVENLY SCENT GROOMING — Google Sheets Webhook
 * ─────────────────────────────────────────────────
 * SETUP (one time, ~3 minutes):
 *
 * 1. Go to script.google.com → New Project → name it "HSG Form Leads"
 * 2. Delete the default code, paste this entire file
 * 3. Click Save
 * 4. Click Deploy → New Deployment
 *    - Type: Web App
 *    - Execute as: Me
 *    - Who has access: Anyone
 * 5. Click Deploy → copy the Web App URL (ends in /exec)
 * 6. In Cloudflare Workers dashboard → hsg-form → Settings → Variables
 *    Add: SHEETS_WEBHOOK_URL = <paste the /exec URL>
 * 7. Done — every form submission now appends a row to the sheet
 *
 * The script auto-creates the sheet "HSG Leads" with headers on first run.
 */

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
  "Status",       // for Jill to track (New / Scheduled / Completed / No Response)
  "Notes",        // free-form follow-up notes
];

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    const ss    = SpreadsheetApp.getActiveSpreadsheet();
    let sheet   = ss.getSheetByName(SHEET_NAME);

    // Create sheet with headers if it doesn't exist
    if (!sheet) {
      sheet = ss.insertSheet(SHEET_NAME);
      formatHeaders(sheet);
    }

    // Append the new lead row
    sheet.appendRow([
      data.timestamp   || new Date().toLocaleString("en-US", { timeZone: "America/Detroit" }),
      data.firstName   || "",
      data.lastName    || "",
      data.email       || "",
      data.phone       || "",
      data.serviceType || "",
      data.breedSize   || "",
      data.message     || "",
      "New",           // default status
      "",              // notes — blank
    ]);

    // Light formatting on the new row
    const lastRow = sheet.getLastRow();
    sheet.getRange(lastRow, 1, 1, COLUMNS.length)
      .setVerticalAlignment("middle")
      .setWrap(false);

    // Zebra stripe
    if (lastRow % 2 === 0) {
      sheet.getRange(lastRow, 1, 1, COLUMNS.length)
        .setBackground("#f7f5f0");
    }

    // Bold + gold the Status cell if "New"
    const statusCell = sheet.getRange(lastRow, 9);
    statusCell.setFontWeight("bold").setFontColor("#b8860b");

    return ContentService
      .createTextOutput(JSON.stringify({ success: true }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ success: false, error: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
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

  // Column widths
  const widths = [160, 110, 110, 220, 130, 140, 180, 280, 110, 200];
  widths.forEach((w, i) => sheet.setColumnWidth(i + 1, w));

  // Freeze header row
  sheet.setFrozenRows(1);

  // Status column dropdown
  const statusRule = SpreadsheetApp.newDataValidation()
    .requireValueInList(["New", "Contacted", "Scheduled", "Completed", "No Response"], true)
    .build();
  sheet.getRange(2, 9, 1000, 1).setDataValidation(statusRule);
}

// Run this manually once from the Apps Script editor to pre-create the sheet
function setup() {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  let sheet   = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    formatHeaders(sheet);
    SpreadsheetApp.getUi().alert("✅ HSG Leads sheet created with headers.");
  } else {
    SpreadsheetApp.getUi().alert("Sheet already exists.");
  }
}
