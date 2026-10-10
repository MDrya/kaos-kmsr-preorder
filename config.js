/* =====================================================================
   KAOS KMSR — SITE CONFIG
   Everything you normally need to edit lives in this file.
   Anything marked TODO is still a placeholder.
   ===================================================================== */

window.KMSR_CONFIG = {
  /* ---------------------------------------------------------------
     ORDER COUNTERS
     The site counts these automatically from the Google Sheet: every
     row in "Orders" whose Status is "Confirmed" adds its Qty.
     The numbers below are only a fallback if the sheet can't be reached.
     --------------------------------------------------------------- */
  counts: {
    regular: 0,
    boxy: 0,
  },

  // Minimum orders for a batch to be produced.
  quota: 12,

  // Extra charge per big size, added to each product's base price (Rupiah).
  // A product can override this with its own sizeSurcharge.
  sizeSurcharge: {
    "2XL": 7500,
    "3XL": 15000,
    "4XL": 22500,
  },

  timeZone: "Asia/Jakarta",
  timeZoneLabel: "WIB",

  /* ---------------------------------------------------------------
     PRODUCTS
     deadline: "2026-10-12T23:59:00+07:00" format, or null = "TBA"
     --------------------------------------------------------------- */
  products: {
    regular: {
      name: "Regular Tee",
      shortName: "Regular",
      fit: "Regular fit · S–4XL",
      price: 94999, // base price for S–XL
      deadline: null, // TODO e.g. "2026-10-12T23:59:00+07:00"
      description:
        "The everyday cut. Chest logo up front, the full KMSR star across the back. Made only if the batch fills.",
      specs: [
        ["Fabric", "Combed 24s Biowash"],
        ["Fit", "Regular"],
        ["Colour", "Black"],
        ["Print", "Front chest + full back"],
      ],
      sizes: ["S", "M", "L", "XL", "2XL", "3XL", "4XL"],
      sizeChart: {
        columns: ["Size", "Width", "Length"],
        rows: [
          ["S", 45, 68],
          ["M", 48, 70],
          ["L", 51, 72],
          ["XL", 54, 74],
          ["2XL", 58, 76],
          ["3XL", 62, 79],
          ["4XL", 66, 83],
        ],
      },
      images: { front: "assets/tee-front.png", back: "assets/tee-back.png" },
      imageAlt: "Kaos KMSR Regular Tee",
      imageNote: "Design preview", // set "" once you have real photos
    },

    boxy: {
      name: "Boxy Tee",
      shortName: "Boxy",
      fit: "Oversize boxy · S–XL",
      price: 99999, // base price for S–XL
      deadline: null, // TODO
      description:
        "Wide, cropped, dropped shoulders. Same print, heavier attitude. Made only if the batch fills.",
      specs: [
        ["Fabric", "Combed 24s Biowash"],
        ["Fit", "Oversize boxy"],
        ["Colour", "Black"],
        ["Print", "Front chest + full back"],
      ],
      sizes: ["S", "M", "L", "XL"],
      sizeChart: {
        columns: ["Size", "Width", "Length", "Sleeve"],
        rows: [
          ["S", 53, 62, 20],
          ["M", 55, 64, 22],
          ["L", 57, 66, 24],
          ["XL", 59, 68, 25],
        ],
      },
      images: { front: "assets/boxy-front.png", back: "assets/boxy-back.png" },
      imageAlt: "Kaos KMSR Boxy Tee",
      imageNote: "Design preview",
    },
  },

  /* ---------------------------------------------------------------
     FORM BACKEND — Google Sheet via Apps Script (see README.md)
     --------------------------------------------------------------- */
  form: {
    // TODO paste your Apps Script web app URL (ends in /exec)
    endpoint: "https://script.google.com/macros/s/AKfycbyM-mcTGy_hC2scVAfDLEmKWT4ez4x30zcUsygm-O2MeJ9Vxwt9DeSzDd4-NhreL-vM/exec",
    maxUploadMB: 8,
  },

  /* ---------------------------------------------------------------
     PAYMENT — QRIS
     --------------------------------------------------------------- */
  payment: {
    method: "QRIS",
    qrisImage: "assets/qris-placeholder.svg", // TODO replace with your QRIS, e.g. "assets/qris.png"
    merchantName: "", // optional, shown under the QR (e.g. the name QRIS displays)
    note: "Pay the exact total, then upload the screenshot below.",
  },

  /* ---------------------------------------------------------------
     CONTACT — optional. Leave "" to hide.
     --------------------------------------------------------------- */
  contact: {
    whatsapp: "",        // international format, digits only, e.g. "6281234567890"
    whatsappDisplay: "",
    instagram: "",       // without @
    line: "",
  },

  customSizes: ["S", "M", "L", "XL", "2XL", "3XL", "4XL", "Not sure yet"],
};
