// Vercel serverless function: GET /api/counts
//
// Relays the confirmed-order counts from the Apps Script, so visitors don't wait on it.
// Google's script server can take 30+ seconds to answer; Vercel's edge keeps the last
// answer and serves it instantly, refreshing it in the background (at most ~1 min old).
//
// Keep ENDPOINT in sync with form.endpoint in config.js.
const ENDPOINT =
  "https://script.google.com/macros/s/AKfycbyM-mcTGy_hC2scVAfDLEmKWT4ez4x30zcUsygm-O2MeJ9Vxwt9DeSzDd4-NhreL-vM/exec";

// Google's reply page sometimes answers 404 at random, so try a few times.
async function fetchCounts(deadline) {
  while (Date.now() < deadline) {
    try {
      const r = await fetch(ENDPOINT + "?action=counts", { redirect: "follow" });
      if (r.ok) {
        const data = await r.json();
        if (data && data.ok && typeof data.counts === "object") return data.counts;
      }
    } catch { /* try again */ }
    await new Promise((done) => setTimeout(done, 800));
  }
  return null;
}

module.exports = async (req, res) => {
  const counts = await fetchCounts(Date.now() + 50000); // function limit is 60s (vercel.json)
  if (counts) {
    res.setHeader("Cache-Control", "public, s-maxage=60, stale-while-revalidate=86400");
    res.status(200).json({ ok: true, counts });
  } else {
    res.setHeader("Cache-Control", "no-store");
    res.status(502).json({ ok: false });
  }
};
