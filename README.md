# Kaos KMSR — Pre-Order Site

Static site (HTML/CSS/JS, no build step). Deployed from GitHub via Vercel.
Orders go to a Google Sheet; payment screenshots go to a Google Drive folder.

```
index.html          page structure
styles.css          all styling + animation
main.js             rendering, forms, motion
config.js           ← everything you edit day to day
apps-script/Code.gs the order backend (paste into Google Apps Script)
assets/             tee images, logo, QRIS, favicon
```

## How the order counter works

The progress bars count automatically from the Google Sheet. Every row in **Orders**
whose **Status** is `Confirmed` adds its Qty to that product's bar. `Pending` and
`Cancelled` rows don't count, so new orders only show up after you've checked the payment.

To confirm an order: set its Status cell to `Confirmed` (run `setup` once to get a
dropdown in that column). The site picks it up the next time someone loads the page.

The `counts` in `config.js` are only a fallback, shown if the sheet can't be reached.

## Connecting the order form (Google Sheet)

One-time setup, about 5 minutes:

1. Create a new Google Sheet (e.g. "KMSR Pre-Orders").
2. In the sheet: **Extensions → Apps Script**.
3. Delete what's in `Code.gs` and paste the contents of [`apps-script/Code.gs`](apps-script/Code.gs). Save.
4. In the function dropdown pick **setup** → **Run**. Approve the permissions prompt
   (it needs your Sheet and Drive to store orders and screenshots). This creates the
   `Orders` and `Custom interest` tabs and a Drive folder called
   "KMSR pre-order payment proofs".
5. **Deploy → New deployment** → type **Web app**:
   - Execute as: **Me**
   - Who has access: **Anyone**
   - Deploy, then copy the **Web app URL** (ends in `/exec`).
6. Paste that URL into `config.js` → `form.endpoint`.
7. Place one test order on the live site with any screenshot and check that a row and
   the image appear. Delete the test row afterwards.

If you edit `Code.gs` later, paste the new version, save, then use
**Deploy → Manage deployments → ✏️ Edit → Version: New version → Deploy**
so the same URL keeps working. (A "New deployment" would give you a different URL.)

While `form.endpoint` isn't set, submitting on `localhost` runs in demo mode (nothing is sent,
the payload is logged to the browser console) so you can preview the success screen.
On the real domain it shows "Ordering isn't connected yet".

An order can hold several tees (e.g. a Regular and a Boxy). Each tee becomes its own
row; the rows share the order code, name, WhatsApp and payment screenshot, and the first
row's Notes starts with the order total. Confirm each row as usual.

Each order row has: time, order code (e.g. `KM-4F2QAB`, also shown to the buyer),
product, size, qty, price, total, name, WhatsApp, notes, a link to the payment
screenshot, and a Status column (starts as `Pending`).

## QRIS

`assets/qris.jpg` is the full QRIS poster (what "Save QR image" downloads, so phone users
can open it from their gallery in an e-wallet). `assets/qris-code.png` is just the code,
cropped from it, shown in the form. If your QRIS changes, replace both and check the new
crop still scans.

## Deadlines

`deadline: null` shows "Deadline to be announced". Set a date to start the countdown:

```js
deadline: "2026-10-12T23:59:00+07:00",
```

When the time passes, that tee's order button and form option close automatically.

## Swapping in real photos

Put front and back photos in `assets/` and point `images.front` / `images.back` at them.
Set `imageNote: ""` to remove the "Design preview" label. The current images are cut
from the vendor's design mockups (Regular and Oversize Boxy).

## Motion

The site is animated: intro counter, spinning star, tilted marquees that react to scroll speed,
flip-able tees (click/tap), tilt + spotlight on hover, a custom cursor, count-up progress,
a star burst after ordering, and an easter egg (click the big star 12 times).

Visitors whose device is set to "reduce motion" get a calmer version (fades only). To see
the full version on such a device, open the site with `?motion=full` once
(`?motion=auto` resets it).

## Deploying

1. Push this folder to a GitHub repo.
2. In Vercel: **Add New → Project**, import the repo, framework preset **Other**,
   no build command, output directory = root. Deploy.
3. Every push to `main` redeploys automatically.

## Running locally

```bash
python -m http.server 5173
```

Then open http://localhost:5173.

## Still to fill in

- [ ] Deadline date/time for each tee
- [ ] Apps Script URL (`form.endpoint`) + one test order
- [ ] Real photos, when ready
- [ ] Contact handles (optional — the footer hides the "Questions" block while they're empty)
