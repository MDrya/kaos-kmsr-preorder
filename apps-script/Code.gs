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
  "Name", "WhatsApp", "Notes", "Payment proof", "Status", "WhatsApp confirm",
];
const CUSTOM_HEADERS = ["Submitted", "Name", "WhatsApp", "Size", "Request"];
const COL = {};
ORDER_HEADERS.forEach(function (h, i) { COL[h] = i; }); // 0-based column index by header

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

    // One order can hold several tees ("items"); older pages send a single flat tee.
    const items = Array.isArray(data.items) && data.items.length
      ? data.items.slice(0, 10)
      : [{ product: data.product, size: data.size, quantity: data.quantity, unit_price: data.unit_price, total: data.total }];

    if (!data.name || !data.whatsapp || items.some(function (it) { return !it || !it.product; })) {
      return json({ ok: false, error: "Missing required fields." });
    }

    // A retry of an order that already went through (same order ref): don't save it twice.
    const ref = clean(data.order_ref, 20);
    if (ref && refExists(ref)) return json({ ok: true, duplicate: true });

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
      const fileName = [ref, clean(data.name, 40), clean(proof.name, 80)].join(" - ");
      const file = folder().createFile(Utilities.newBlob(bytes, proof.type, fileName));
      proofUrl = file.getUrl();
    } else {
      return json({ ok: false, error: "Please attach your payment screenshot." });
    }

    // one row per tee, all sharing the order ref, name and payment proof
    const now = new Date();
    let notes = clean(data.notes, 600);
    if (items.length > 1) notes = ("Order total " + clean(data.order_total, 20) + " (" + items.length + " lines). " + notes).trim();
    const rows = items.map(function (it, i) {
      return [
        now,
        ref,
        clean(it.product, 40),
        clean(it.size, 20),
        Math.max(1, Math.min(10, Number(it.quantity) || 1)),
        clean(it.unit_price, 20),
        clean(it.total, 20),
        clean(data.name, 80),
        text(clean(data.whatsapp, 20)),
        i === 0 ? notes : "",
        proofUrl,
        "Pending",
        "",
      ];
    });
    const sh = sheet(ss, ORDERS_SHEET, ORDER_HEADERS);
    sh.getRange(sh.getLastRow() + 1, 1, rows.length, ORDER_HEADERS.length).setValues(rows);
    return json({ ok: true });
  } catch (err) {
    return json({ ok: false, error: "Server error. Please try again." });
  } finally {
    lock.releaseLock();
  }
}

// GET ?action=counts      → confirmed shirts per product, for the progress bars on the site
// GET ?action=check&ref=… → whether an order is in the sheet (the site asks this when
//                           Google's reply to a submit gets lost on the way back)
// Plain GET just confirms the backend is live.
function doGet(e) {
  const p = (e && e.parameter) || {};
  if (p.action === "counts") return json({ ok: true, counts: confirmedCounts() });
  if (p.action === "check") return json({ ok: true, found: refExists(String(p.ref || "").slice(0, 20)) });
  return json({ ok: true, message: "KMSR order backend is running." });
}

function orderRows() {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(ORDERS_SHEET);
  if (!sh || sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, ORDER_HEADERS.length).getValues();
}

function refExists(ref) {
  if (!ref) return false;
  return orderRows().some(function (r) { return String(r[COL["Order ref"]]) === ref; });
}

// Sums Qty of rows whose Status is "Confirmed", grouped by Product.
// Cached for a minute so a busy page doesn't re-read the sheet on every visit.
function confirmedCounts() {
  const cache = CacheService.getScriptCache();
  const hit = cache.get("counts");
  if (hit) return JSON.parse(hit);

  const counts = {};
  orderRows().forEach(function (r) {
    if (String(r[COL["Status"]]).trim().toLowerCase() !== "confirmed") return;
    const product = String(r[COL["Product"]]).trim();
    counts[product] = (counts[product] || 0) + (Number(r[COL["Qty"]]) || 0);
  });
  cache.put("counts", JSON.stringify(counts), 60);
  return counts;
}

// Runs when you edit the sheet by hand.
// - clears the count cache so the site shows new numbers right away
// - when a row's Status becomes "Confirmed", puts a one-tap WhatsApp link in
//   "WhatsApp confirm" with the confirmation message already written
function onEdit(e) {
  CacheService.getScriptCache().remove("counts");
  if (!e || !e.range) return;
  const sh = e.range.getSheet();
  if (sh.getName() !== ORDERS_SHEET) return;

  const statusCol = COL["Status"] + 1;
  if (e.range.getColumn() > statusCol || e.range.getLastColumn() < statusCol) return;
  const first = Math.max(2, e.range.getRow());
  const last = e.range.getLastRow();
  if (last < first) return;

  const waCol = COL["WhatsApp confirm"] + 1;
  if (!sh.getRange(1, waCol).getValue()) sh.getRange(1, waCol).setValue("WhatsApp confirm").setFontWeight("bold");

  const all = orderRows();
  for (let r = first; r <= last; r++) {
    const row = all[r - 2];
    if (!row) continue;
    const cell = sh.getRange(r, waCol);
    const confirmed = String(row[COL["Status"]]).trim().toLowerCase() === "confirmed";
    const formula = confirmed ? waFormula(row, all) : "";
    if (formula) cell.setFormula(formula);
    else cell.clearContent();
  }
}

// The confirmation message for one order (all rows that share its order ref).
function waFormula(row, all) {
  const phone = waNumber(row[COL["WhatsApp"]]);
  if (!phone) return "";
  const ref = String(row[COL["Order ref"]]);
  const lines = all.filter(function (r) { return String(r[COL["Order ref"]]) === ref; });
  const items = lines.map(function (r) {
    return "• " + r[COL["Product"]] + " " + r[COL["Size"]] + " × " + r[COL["Qty"]];
  }).join("\n");
  const total = lines.reduce(function (sum, r) {
    return sum + (Number(String(r[COL["Total"]]).replace(/[^0-9]/g, "")) || 0);
  }, 0);
  const firstName = String(row[COL["Name"]]).trim().split(/\s+/)[0];

  const msg =
    "Halo " + firstName + "!\n" +
    "Pembayaran pre-order Kaos KMSR kamu sudah kami terima dan konfirmasi.\n\n" +
    "Kode order: " + ref + "\n" + items + "\n" +
    "Total: Rp " + total.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".") + "\n\n" +
    "Kaos diproduksi setelah batch mencapai 12 pcs. Kalau sampai deadline batch belum tercapai, " +
    "uang kamu dikembalikan penuh. Terima kasih! ★" + "\n\n" +
    "Pssttt, pingin kaosnya diproduksi:D share link ke teman kamu, capai milestonesnya bersama :DD";

  // api.whatsapp.com keeps emoji intact; the wa.me short link can turn them into "?"
  const url = "https://api.whatsapp.com/send?phone=" + phone + "&text=" + encodeURIComponent(msg);
  return '=HYPERLINK("' + url.replace(/"/g, '""') + '", "Kirim WA ➜")';
}

// 0812… / +62812… / 812… → 62812…
function waNumber(value) {
  let d = String(value || "").replace(/\D/g, "");
  if (d.charAt(0) === "0") d = "62" + d.slice(1);
  else if (d.charAt(0) === "8") d = "62" + d;
  return d.length >= 10 ? d : "";
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
// Safe to run again: it also adds the "WhatsApp confirm" header and links for rows
// that are already Confirmed.
function setup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const orders = sheet(ss, ORDERS_SHEET, ORDER_HEADERS);
  // Status dropdown: only "Confirmed" rows count toward the quota on the site
  const status = COL["Status"] + 1;
  orders.getRange(2, status, orders.getMaxRows() - 1, 1).setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInList(["Pending", "Confirmed", "Cancelled"], true).build()
  );
  if (orders.getLastRow() > 1) onEdit({ range: orders.getRange(2, status, orders.getLastRow() - 1, 1) });
  else orders.getRange(1, COL["WhatsApp confirm"] + 1).setValue("WhatsApp confirm").setFontWeight("bold");
  sheet(ss, CUSTOM_SHEET, CUSTOM_HEADERS);
  folder();
}
