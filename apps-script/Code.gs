/**
 * Kaos KMSR — order backend (Google Apps Script)
 *
 * Receives submissions from the website, writes them to this spreadsheet,
 * and saves payment screenshots to a Google Drive folder.
 * Setup steps are in README.md ("Connecting the order form").
 */

const ORDERS_SHEET = "Orders";
const CUSTOM_SHEET = "Custom interest";
const PROOF_FOLDER = "KMSR pre-order payment proofs";
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif", "image/gif", "application/pdf"];

const ORDER_HEADERS = [
  "Submitted", "Order ref", "Product", "Size", "Qty", "Unit price", "Total",
  "Name", "WhatsApp", "Notes", "Payment proof", "Status",
];
const CUSTOM_HEADERS = ["Submitted", "Name", "WhatsApp", "Size", "Request"];

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const data = JSON.parse(e.postData.contents);
    if (data._gotcha) return json({ ok: true }); // spam bot filled the hidden field

    const ss = SpreadsheetApp.getActiveSpreadsheet();

    if (data.form_type === "custom") {
      sheet(ss, CUSTOM_SHEET, CUSTOM_HEADERS).appendRow([
        new Date(),
        clean(data.name, 80),
        text(clean(data.whatsapp, 20)),
        clean(data.size, 20),
        clean(data.custom_request, 600),
      ]);
      return json({ ok: true });
    }

    if (!data.name || !data.whatsapp || !data.product) {
      return json({ ok: false, error: "Missing required fields." });
    }

    let proofUrl = "";
    const proof = data.payment_proof;
    if (proof && proof.data) {
      if (ALLOWED_TYPES.indexOf(proof.type) === -1) {
        return json({ ok: false, error: "Payment proof must be an image or PDF." });
      }
      const bytes = Utilities.base64Decode(proof.data);
      if (bytes.length > MAX_FILE_BYTES) {
        return json({ ok: false, error: "Payment proof is too large." });
      }
      const fileName = [clean(data.order_ref, 20), clean(data.name, 40), clean(proof.name, 80)].join(" - ");
      const file = folder().createFile(Utilities.newBlob(bytes, proof.type, fileName));
      proofUrl = file.getUrl();
    } else {
      return json({ ok: false, error: "Please attach your payment screenshot." });
    }

    sheet(ss, ORDERS_SHEET, ORDER_HEADERS).appendRow([
      new Date(),
      clean(data.order_ref, 20),
      clean(data.product, 40),
      clean(data.size, 10),
      Number(data.quantity) || 1,
      clean(data.unit_price, 20),
      clean(data.total, 20),
      clean(data.name, 80),
      text(clean(data.whatsapp, 20)),
      clean(data.notes, 600),
      proofUrl,
      "Pending",
    ]);
    return json({ ok: true });
  } catch (err) {
    return json({ ok: false, error: "Server error. Please try again." });
  } finally {
    lock.releaseLock();
  }
}

// Lets you open the /exec URL in a browser to check it's live.
function doGet() {
  return json({ ok: true, message: "KMSR order backend is running." });
}

function sheet(ss, name, headers) {
  let sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  if (sh.getLastRow() === 0) {
    sh.appendRow(headers);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, headers.length).setFontWeight("bold");
  }
  return sh;
}

function folder() {
  const it = DriveApp.getFoldersByName(PROOF_FOLDER);
  return it.hasNext() ? it.next() : DriveApp.createFolder(PROOF_FOLDER);
}

// Trim, cap length, and stop spreadsheet formula injection (=, +, -, @).
function clean(value, max) {
  let s = String(value == null ? "" : value).trim().slice(0, max);
  if (/^[=+\-@]/.test(s)) s = "'" + s;
  return s;
}

// Keep phone numbers as text so the leading 0 survives.
function text(s) {
  return s.charAt(0) === "'" ? s : "'" + s;
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// Run this once from the editor to grant permissions and create the sheets/folder.
function setup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  sheet(ss, ORDERS_SHEET, ORDER_HEADERS);
  sheet(ss, CUSTOM_SHEET, CUSTOM_HEADERS);
  folder();
}
