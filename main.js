/* Kaos KMSR — page logic. Content/values live in config.js. */
(() => {
  "use strict";

  const C = window.KMSR_CONFIG;
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const root = document.documentElement;

  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches && !root.classList.contains("full-motion");
  const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
  const isLocal = location.protocol === "file:" || ["localhost", "127.0.0.1", "[::1]", ""].includes(location.hostname);

  const keys = Object.keys(C.products);
  const pad = (n) => String(n).padStart(2, "0");
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const esc = (s) =>
    String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const money = (n) => (typeof n === "number" ? "Rp " + new Intl.NumberFormat("id-ID").format(n) : String(n));

  // base price + surcharge for big sizes (config.sizeSurcharge, or the product's own)
  const surchargeOf = (key, size) => ((C.products[key].sizeSurcharge || C.sizeSurcharge || {})[size] || 0);
  const priceOf = (key, size) => C.products[key].price + surchargeOf(key, size);
  const bigSizesOf = (key) => (C.products[key].sizes || []).filter((s) => surchargeOf(key, s) > 0);
  const plus = (n) => "+" + new Intl.NumberFormat("id-ID").format(n);
  const choiceMeta = (key) => {
    const p = C.products[key];
    return (bigSizesOf(key).length ? "from " : "") + money(p.price) + (isClosed(key) ? " · closed" : "");
  };

  const goalOf = (key) => C.products[key].goal ?? C.quota;
  const countOf = (key) => Math.max(0, Number(C.counts[key]) || 0);
  const deadlineOf = (key) => (C.products[key].deadline ? new Date(C.products[key].deadline) : null);
  const isClosed = (key) => {
    const d = deadlineOf(key);
    return !!d && Date.now() >= d.getTime();
  };
  const fmtDeadline = (d) =>
    new Intl.DateTimeFormat("en-GB", {
      weekday: "short", day: "numeric", month: "short",
      hour: "2-digit", minute: "2-digit", hour12: false, timeZone: C.timeZone,
    }).format(d) + " " + C.timeZoneLabel;

  /* ---------------------------------------------------------------
     Shared bits
     --------------------------------------------------------------- */
  $$("[data-quota]").forEach((el) => (el.textContent = C.quota));
  $$("[data-year]").forEach((el) => (el.textContent = new Date().getFullYear()));
  const minPrice = Math.min(...keys.map((k) => C.products[k].price));
  $$("[data-price-text]").forEach((el) => (el.textContent = "From " + money(minPrice)));

  /* ---------------------------------------------------------------
     Product sections
     --------------------------------------------------------------- */
  const countdowns = [];

  keys.forEach((key) => {
    const p = C.products[key];
    const sec = $(`[data-product="${key}"]`);
    if (!sec) return;
    const f = (name) => $(`[data-field="${name}"]`, sec);

    f("name").textContent = p.name;
    f("fit").textContent = p.fit;
    f("price").textContent = money(p.price);
    const big = bigSizesOf(key);
    const base = (p.sizes || []).filter((s) => !big.includes(s));
    const baseLabel = base.length > 1 ? `${base[0]}–${base[base.length - 1]}` : base[0] || "";
    f("priceNote").textContent = [baseLabel, ...big.map((s) => `${s} ${plus(surchargeOf(key, s))}`)].filter(Boolean).join(" · ");
    f("priceNote").hidden = !big.length;
    f("description").textContent = p.description;

    f("front").src = p.images.front;
    f("front").alt = `${p.imageAlt || p.name}, front`;
    f("back").src = p.images.back;
    f("back").alt = `${p.imageAlt || p.name}, back`;
    f("imageNote").textContent = p.imageNote || "";
    f("imageNote").hidden = !p.imageNote;

    f("specs").innerHTML = (p.specs || [])
      .map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`)
      .join("");

    // progress
    const goal = goalOf(key);
    const ordered = countOf(key);
    const left = goal - ordered;
    const count = f("ordered");
    count.textContent = pad(ordered);
    count.dataset.countTo = ordered;
    f("goal").textContent = pad(goal);
    const bar = f("bar");
    bar.style.setProperty("--n", goal);
    bar.setAttribute("aria-valuemax", goal);
    bar.setAttribute("aria-valuenow", Math.min(ordered, goal));
    bar.setAttribute("aria-label", `${ordered} of ${goal} ordered`);
    bar.innerHTML = Array.from({ length: goal }, (_, i) => {
      const cls = i < ordered ? "is-filled" : i === ordered ? "is-next" : "";
      return `<span style="--i:${i}"${cls ? ` class="${cls}"` : ""}></span>`;
    }).join("");
    f("remaining").textContent = left > 0
      ? `${left} more to lock this batch in.`
      : "Quota hit — this batch is happening.";
    sec.classList.toggle("is-locked", left <= 0);

    // deadline + countdown
    const d = deadlineOf(key);
    const cd = f("countdown");
    const units = Object.fromEntries($$("[data-unit]", cd).map((el) => [el.dataset.unit, el]));
    if (d) {
      f("deadlineLabel").innerHTML = `Closes <time datetime="${d.toISOString()}">${esc(fmtDeadline(d))}</time>`;
      countdowns.push({ key, end: d.getTime(), units, closed: false });
    } else {
      f("deadlineLabel").innerHTML = "Deadline <strong>to be announced</strong>";
      cd.classList.add("is-tba");
    }

    // size chart + fit visual
    const chart = p.sizeChart;
    if (chart && chart.rows && chart.rows.length) {
      f("sizechartHead").innerHTML = chart.columns.map((c) => `<th scope="col">${esc(c)}</th>`).join("") + `<th scope="col">Price</th>`;
      f("sizechart").innerHTML = chart.rows
        .map((r) => `<tr tabindex="0">${r.map((c, i) => (i === 0 ? `<th scope="row">${esc(c)}</th>` : `<td>${esc(c)}</td>`)).join("")}`
          + `<td class="sizes__price${surchargeOf(key, r[0]) ? " is-up" : ""}">${new Intl.NumberFormat("id-ID").format(priceOf(key, r[0]))}</td></tr>`)
        .join("");
      setupFitViz(sec, chart);
    } else {
      f("sizechartWrap").hidden = true;
    }

    // CTA
    $("[data-order]", sec).addEventListener("click", () => {
      selectProduct(key);
      $("#order-form").scrollIntoView({ behavior: reduced ? "auto" : "smooth" });
      setTimeout(() => {
        const first = $('#order-form input[name="size"]:not(:disabled)') || $("#o-name");
        first.focus({ preventScroll: true });
      }, 700);
    });
  });

  function setupFitViz(sec, chart) {
    const rows = $$("tbody tr", sec);
    const shape = $("[data-fitviz]", sec);
    const label = $("[data-fitviz-label]", sec);
    const cols = chart.columns;
    const maxW = Math.max(...chart.rows.map((r) => r[1]));
    const maxL = Math.max(...chart.rows.map((r) => r[2]));
    let selected = Math.min(1, chart.rows.length - 1);

    const show = (i) => {
      const r = chart.rows[i];
      rows.forEach((tr, j) => tr.classList.toggle("is-active", j === i));
      // exaggerate the difference a little so it reads at a glance
      const sx = 0.55 + 0.45 * ((r[1] / maxW - 0.6) / 0.4);
      const sy = 0.55 + 0.45 * ((r[2] / maxL - 0.6) / 0.4);
      shape.style.transform = `scale(${clamp(sx, 0.4, 1)}, ${clamp(sy, 0.4, 1)})`;
      label.innerHTML = `<strong>${esc(r[0])}</strong> · ${r.slice(1).map((v, k) => `${esc(cols[k + 1][0])} ${esc(v)}`).join(" · ")}`;
    };
    rows.forEach((tr, i) => {
      tr.addEventListener("mouseenter", () => show(i));
      tr.addEventListener("focus", () => show(i));
      tr.addEventListener("click", () => { selected = i; show(i); });
    });
    $("tbody", sec).addEventListener("mouseleave", () => show(selected));
    show(selected);
  }

  function setClosed(key) {
    const sec = $(`[data-product="${key}"]`);
    if (sec) {
      sec.classList.add("is-closed");
      const btn = $("[data-order]", sec);
      btn.disabled = true;
      $("[data-cta-label]", btn).textContent = "Pre-order closed";
    }
    const radio = $(`#order-form input[name="product"][data-key="${key}"]`);
    if (radio) {
      radio.disabled = true;
      radio.checked = false;
      $(".choice__meta", radio.closest(".choice")).textContent = choiceMeta(key);
    }
    renderHeroStatus();
    updateOrderForm();
  }

  function setUnit(el, value) {
    if (el.textContent === value) return;
    el.textContent = value;
    if (reduced) return;
    el.classList.remove("tick");
    void el.offsetWidth;
    el.classList.add("tick");
  }

  function tick() {
    const now = Date.now();
    countdowns.forEach((c) => {
      const ms = Math.max(0, c.end - now);
      setUnit(c.units.d, pad(Math.floor(ms / 864e5)));
      setUnit(c.units.h, pad(Math.floor(ms / 36e5) % 24));
      setUnit(c.units.m, pad(Math.floor(ms / 6e4) % 60));
      setUnit(c.units.s, pad(Math.floor(ms / 1e3) % 60));
      if (ms === 0 && !c.closed) {
        c.closed = true;
        setClosed(c.key);
      }
    });
  }

  /* ---------------------------------------------------------------
     Hero status
     --------------------------------------------------------------- */
  function renderHeroStatus() {
    $("[data-hero-status]").innerHTML = keys.map((key) => {
      const p = C.products[key];
      const goal = goalOf(key);
      const ordered = countOf(key);
      const pct = Math.min(100, (ordered / goal) * 100);
      const d = deadlineOf(key);
      const sub = isClosed(key) ? "Closed" : d ? "Closes " + fmtDeadline(d) : "Deadline TBA";
      return `<li>
        <a href="#${key}">${esc(p.name)}</a>
        <span><span class="num">${pad(ordered)}</span> / ${pad(goal)}</span>
        <span class="mini" aria-hidden="true"><i style="--p:${pct}%"></i></span>
        <span class="sub">${esc(sub)}</span>
      </li>`;
    }).join("");
  }
  renderHeroStatus();

  /* ---------------------------------------------------------------
     Order form
     --------------------------------------------------------------- */
  const form = $("#order-form");
  const qty = $("#qty");
  const sizeField = $("[data-size-field]", form);
  const sizeChoices = $("[data-size-choices]", form);
  const totalEl = $("[data-total]", form);
  const proofInput = $("#o-proof");
  const drop = $("[data-drop]", form);
  const done = $("[data-done]");

  $("[data-product-choices]", form).innerHTML = keys.map((key) => {
    const p = C.products[key];
    const closed = isClosed(key);
    return `<label class="choice">
      <input type="radio" name="product" value="${esc(p.name)}" data-key="${key}" required${closed ? " disabled" : ""}>
      <span class="choice__body">
        <img class="choice__thumb" src="${esc(p.images.front)}" alt="">
        <span class="choice__text">
          <span class="choice__name">${esc(p.shortName)}</span>
          <span class="choice__meta">${esc(choiceMeta(key))}</span>
        </span>
      </span>
    </label>`;
  }).join("");

  // payment block
  const pay = C.payment;
  $("[data-pay-note]", form).textContent = pay.note || "";
  const qrImg = $("[data-qris]", form);
  const qrDl = $("[data-qris-download]", form);
  if (pay.qrisImage) {
    qrImg.src = pay.qrisImage;
    qrDl.href = pay.qrisImage;
    qrDl.setAttribute("download", "KMSR-QRIS" + (pay.qrisImage.match(/\.\w+$/) || [".png"])[0]);
  } else {
    qrImg.closest("figure").hidden = true;
    qrDl.hidden = true;
  }
  $("[data-qris-merchant]", form).textContent = pay.merchantName || "";

  const currentKey = () => $('input[name="product"]:checked', form)?.dataset.key;

  function selectProduct(key) {
    const radio = $(`input[name="product"][data-key="${key}"]`, form);
    if (radio && !radio.disabled) radio.checked = true;
    updateOrderForm();
  }

  let renderedSizesFor = null;
  let lastTotal = "";
  function updateOrderForm() {
    const key = currentKey();
    const shownSizes = (key ? C.products[key] : C.products[keys[0]]).sizes || [];
    const sig = shownSizes.join("|");
    if (sig !== renderedSizesFor) {
      const prev = $('input[name="size"]:checked', form)?.value;
      const shownKey = key || keys[0];
      sizeChoices.innerHTML = shownSizes.map((s, i) => {
        const extra = surchargeOf(shownKey, s);
        return `<label class="chip"><input type="radio" name="size" value="${esc(s)}" required${s === prev ? " checked" : ""}><span style="--i:${i}">${esc(s)}${extra ? `<small>${plus(extra)}</small>` : ""}</span></label>`;
      }).join("");
      if (renderedSizesFor !== null && !reduced) {
        sizeChoices.classList.remove("is-in");
        void sizeChoices.offsetWidth;
        sizeChoices.classList.add("is-in");
      }
      renderedSizesFor = sig;
    }
    const hasSizes = shownSizes.length > 0;
    sizeField.hidden = !hasSizes;
    sizeField.disabled = !hasSizes;

    const n = clampQty();
    const p = key && C.products[key];
    const size = $('input[name="size"]:checked', form)?.value;
    const total = p ? money(priceOf(key, size) * n) : "Pick a tee";
    if (total !== lastTotal) {
      totalEl.textContent = total;
      if (lastTotal && !reduced) {
        totalEl.classList.remove("bump");
        void totalEl.offsetWidth;
        totalEl.classList.add("bump");
      }
      lastTotal = total;
    }

    const allClosed = keys.every(isClosed);
    $('[type="submit"]', form).disabled = allClosed;
    if (allClosed) setStatus($("[data-status]", form), "Pre-orders are closed for this batch.", false);
  }

  function clampQty() {
    const n = parseInt(qty.value, 10);
    return Number.isNaN(n) ? Number(qty.min) : clamp(n, Number(qty.min), Number(qty.max));
  }

  $$("[data-step]", form).forEach((b) =>
    b.addEventListener("click", () => {
      qty.value = clamp(clampQty() + Number(b.dataset.step), Number(qty.min), Number(qty.max));
      updateOrderForm();
    }));
  qty.addEventListener("input", updateOrderForm);
  qty.addEventListener("blur", () => { qty.value = clampQty(); updateOrderForm(); });
  form.addEventListener("change", (e) => {
    if (e.target.name === "product" || e.target.name === "size") updateOrderForm();
    e.target.classList.remove("is-invalid");
  });
  form.addEventListener("input", (e) => e.target.classList.remove("is-invalid"));

  // upload
  const maxBytes = (C.form.maxUploadMB || 8) * 1024 * 1024;
  let thumbURL = null;
  function showFile() {
    const file = proofInput.files[0];
    const empty = $(".drop__empty", drop);
    const info = $(".drop__file", drop);
    if (thumbURL) URL.revokeObjectURL(thumbURL);
    thumbURL = null;
    drop.classList.remove("is-invalid");
    if (!file) { empty.hidden = false; info.hidden = true; return; }
    const okType = file.type.startsWith("image/") || file.type === "application/pdf";
    if (!okType || file.size > maxBytes) {
      proofInput.value = "";
      empty.hidden = false;
      info.hidden = true;
      drop.classList.add("is-invalid");
      setStatus($("[data-status]", form), !okType
        ? "Please upload an image or PDF of your payment."
        : `That file is over ${C.form.maxUploadMB} MB — try a screenshot instead.`, true);
      return;
    }
    const thumb = $("[data-drop-thumb]", drop);
    if (file.type.startsWith("image/")) {
      thumbURL = URL.createObjectURL(file);
      thumb.src = thumbURL;
      thumb.hidden = false;
    } else {
      thumb.hidden = true;
    }
    $("[data-drop-name]", drop).textContent = file.name;
    empty.hidden = true;
    info.hidden = false;
    setStatus($("[data-status]", form), "", false);
  }
  proofInput.addEventListener("change", showFile);
  ["dragenter", "dragover"].forEach((t) => drop.addEventListener(t, () => drop.classList.add("is-drag")));
  ["dragleave", "drop"].forEach((t) => drop.addEventListener(t, () => drop.classList.remove("is-drag")));

  updateOrderForm();

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const status = $("[data-status]", form);
    const btn = $('[type="submit"]', form);
    const key = currentKey();

    if (!key || isClosed(key)) return fail(status, "Pick a tee that's still open.", $('input[name="product"]:not(:disabled)', form));
    const fields = $$("input, textarea", form).filter((el) => !el.disabled && el.type !== "hidden");
    const invalid = fields.find((el) => !el.checkValidity());
    if (invalid) {
      fields.forEach((el) => el.classList.toggle("is-invalid", !el.checkValidity()));
      drop.classList.toggle("is-invalid", !proofInput.checkValidity());
      const msg = invalid.name === "size" ? "Pick a size."
        : invalid === proofInput ? "Upload your payment screenshot."
        : invalid.name === "whatsapp" ? "Check your WhatsApp number."
        : "Fill in the highlighted fields.";
      return fail(status, msg, invalid);
    }

    const p = C.products[key];
    const n = clampQty();
    qty.value = n;
    const fd = new FormData(form);
    const size = fd.get("size") || "One size";
    const unit = priceOf(key, size);
    const total = unit * n;
    const ref = makeRef();

    btn.disabled = true;
    btn.classList.add("is-loading");
    $("[data-submit-label]", btn).textContent = "Sending…";
    setStatus(status, "Uploading your order — don't close this page.", false);
    try {
      await send({
        form_type: "order",
        _gotcha: fd.get("_gotcha") || "",
        order_ref: ref,
        product: p.name,
        size,
        quantity: n,
        unit_price: money(unit),
        total: money(total),
        name: String(fd.get("name")).trim(),
        whatsapp: String(fd.get("whatsapp")).trim(),
        notes: String(fd.get("notes") || "").trim(),
        payment_proof: await fileToPayload(proofInput.files[0]),
      });
      showDone({ ref, p, size, n, total });
      setStatus(status, "", false);
    } catch (err) {
      setStatus(status, err.message, true);
    } finally {
      btn.disabled = false;
      btn.classList.remove("is-loading");
      $("[data-submit-label]", btn).textContent = "Place pre-order";
    }
  });

  function fail(status, msg, focusEl) {
    setStatus(status, msg, true);
    if (focusEl) {
      focusEl.focus({ preventScroll: true });
      (focusEl.closest(".field") || focusEl).scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "center" });
    }
  }

  function showDone({ ref, p, size, n, total }) {
    $("[data-done-summary]").textContent = `${ref} · ${p.name} · ${size} × ${n} · ${money(total)}`;
    form.hidden = true;
    done.hidden = false;
    done.focus({ preventScroll: true });
    done.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "center" });
    setTimeout(() => {
      const r = done.getBoundingClientRect();
      burst(r.left + r.width / 2, r.top + Math.min(r.height, 240) / 2, 48);
    }, 450);
    toast(`Order ${ref} received ★`);
  }

  $("[data-reset]").addEventListener("click", () => {
    form.reset();
    showFile();
    renderedSizesFor = null;
    updateOrderForm();
    done.hidden = true;
    form.hidden = false;
    $('input[name="product"]:not(:disabled)', form)?.focus();
  });

  /* ---------------------------------------------------------------
     Custom interest form
     --------------------------------------------------------------- */
  const custom = $("#custom-form");
  $("[data-custom-sizes]", custom).innerHTML =
    `<option value="" disabled selected>Pick one</option>` +
    C.customSizes.map((s) => `<option>${esc(s)}</option>`).join("");

  custom.addEventListener("submit", async (e) => {
    e.preventDefault();
    const status = $("[data-status]", custom);
    const btn = $('[type="submit"]', custom);
    const fd = new FormData(custom);
    btn.disabled = true;
    setStatus(status, "Sending…", false);
    try {
      await send({
        form_type: "custom",
        _gotcha: fd.get("_gotcha") || "",
        custom_request: String(fd.get("custom_request")).trim(),
        size: fd.get("size"),
        name: String(fd.get("name")).trim(),
        whatsapp: String(fd.get("whatsapp")).trim(),
      });
      custom.innerHTML = `<p class="custom__thanks" tabindex="-1"><strong>Noted.</strong>
        We'll message you if enough people want the same thing and it opens as a batch. Nothing to pay now.</p>`;
      $(".custom__thanks", custom).focus();
      const r = custom.getBoundingClientRect();
      burst(r.left + 60, r.top + 30, 20);
    } catch (err) {
      setStatus(status, err.message, true);
      btn.disabled = false;
    }
  });

  /* ---------------------------------------------------------------
     Submission (Google Apps Script web app)
     --------------------------------------------------------------- */
  async function send(payload) {
    const url = C.form.endpoint;
    if (!url || !/^https:\/\//.test(url)) {
      if (isLocal) {
        console.info("[KMSR] No endpoint set — demo submit (local only):", payload);
        await wait(900);
        return;
      }
      throw new Error("Ordering isn't connected yet. Please check back soon.");
    }
    let res;
    try {
      // a plain string body is sent as text/plain, which avoids a CORS preflight
      res = await fetch(url, { method: "POST", body: JSON.stringify(payload) });
    } catch {
      throw new Error("Couldn't reach the server. Check your connection and try again.");
    }
    let data = null;
    try { data = await res.json(); } catch { /* not JSON */ }
    if (!res.ok || !data || !data.ok) {
      throw new Error((data && data.error) || "Something went wrong. Please try again in a moment.");
    }
  }

  async function fileToPayload(file) {
    if (!file) return null;
    let blob = file;
    let type = file.type;
    let name = file.name;
    // shrink big screenshots before upload
    if (type.startsWith("image/") && type !== "image/gif" && "createImageBitmap" in window) {
      try {
        const bmp = await createImageBitmap(file);
        const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
        const c = document.createElement("canvas");
        c.width = Math.round(bmp.width * scale);
        c.height = Math.round(bmp.height * scale);
        const ctx = c.getContext("2d");
        ctx.fillStyle = "#fff";
        ctx.fillRect(0, 0, c.width, c.height);
        ctx.drawImage(bmp, 0, 0, c.width, c.height);
        const out = await new Promise((r) => c.toBlob(r, "image/jpeg", 0.85));
        if (out && out.size < file.size) {
          blob = out;
          type = "image/jpeg";
          name = name.replace(/\.\w+$/, "") + ".jpg";
        }
      } catch { /* keep the original file */ }
    }
    const data = await new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result).split(",")[1]);
      fr.onerror = () => reject(new Error("Couldn't read that file. Try another screenshot."));
      fr.readAsDataURL(blob);
    });
    return { name, type, data };
  }

  function setStatus(el, text, isError) {
    el.textContent = text;
    el.classList.toggle("is-error", !!isError && !!text);
  }

  function makeRef() {
    const t = Date.now().toString(36).slice(-4);
    const r = Math.random().toString(36).slice(2, 4);
    return ("KM-" + t + r).toUpperCase();
  }

  /* ---------------------------------------------------------------
     Footer contacts
     --------------------------------------------------------------- */
  const ct = C.contact || {};
  const contactItems = [
    ct.whatsapp && `<li><span>WhatsApp</span><a href="https://wa.me/${esc(ct.whatsapp)}" target="_blank" rel="noopener">${esc(ct.whatsappDisplay || ct.whatsapp)}</a></li>`,
    ct.instagram && `<li><span>Instagram</span><a href="https://instagram.com/${esc(ct.instagram)}" target="_blank" rel="noopener">@${esc(ct.instagram)}</a></li>`,
    ct.line && `<li><span>LINE</span><a href="https://line.me/ti/p/~${esc(ct.line)}" target="_blank" rel="noopener">${esc(ct.line)}</a></li>`,
  ].filter(Boolean);
  $("[data-contacts]").innerHTML = contactItems.join("");
  $("[data-contacts-wrap]").hidden = contactItems.length === 0;

  /* ---------------------------------------------------------------
     Countdown
     --------------------------------------------------------------- */
  keys.forEach((key) => { if (isClosed(key)) setClosed(key); });
  countdowns.forEach((cd) => { cd.closed = isClosed(cd.key); });
  tick();
  if (countdowns.length) setInterval(tick, 1000);

  /* =================================================================
     MOTION
     ================================================================= */

  /* ---------- split text into chars ---------- */
  $$("[data-split]").forEach((el) => {
    const heading = el.closest("h1, h2, h3");
    if (heading && !heading.hasAttribute("aria-label")) {
      heading.setAttribute("aria-label", heading.textContent.trim().replace(/\s+/g, " "));
    }
    splitText(el);
  });
  $$(".hero__line").forEach((line, i) => line.style.setProperty("--li", i));

  function splitText(el) {
    let ci = 0;
    const walk = (node) => {
      Array.from(node.childNodes).forEach((child) => {
        if (child.nodeType === 3) {
          const frag = document.createDocumentFragment();
          child.textContent.split(/(\s+)/).forEach((part) => {
            if (!part) return;
            if (/^\s+$/.test(part)) { frag.append(" "); return; }
            const w = document.createElement("span");
            w.className = "word";
            w.setAttribute("aria-hidden", "true");
            for (const ch of part) {
              const c = document.createElement("span");
              c.className = "char";
              c.textContent = ch;
              c.style.setProperty("--ci", ci++);
              w.append(c);
            }
            frag.append(w);
          });
          child.replaceWith(frag);
        } else if (child.nodeType === 1) {
          walk(child);
        }
      });
    };
    walk(el);
  }

  /* ---------- preloader ---------- */
  const pre = $("[data-preloader]");
  const preVisible = pre && getComputedStyle(pre).display !== "none" && !reduced;
  try { sessionStorage.setItem("kmsr-seen", "1"); } catch { /* private mode */ }

  const setLoaded = () => root.classList.add("is-loaded");

  if (preVisible) {
    const countEl = $("[data-preload-count]", pre);
    const start = performance.now();
    const dur = 1100;
    const step = (now) => {
      const t = clamp((now - start) / dur, 0, 1);
      countEl.textContent = pad(Math.round((1 - Math.pow(1 - t, 3)) * C.quota));
      if (t < 1) return requestAnimationFrame(step);
      setTimeout(() => {
        pre.classList.add("is-out");
        setTimeout(setLoaded, 350);
        setTimeout(() => pre.remove(), 1100);
      }, 180);
    };
    requestAnimationFrame(step);
  } else {
    if (pre) pre.remove();
    requestAnimationFrame(setLoaded);
  }

  /* ---------- toast + star burst ---------- */
  const toastEl = $("[data-toast]");
  let toastTimer;
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add("is-on");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove("is-on"), 2600);
  }

  function burst(x, y, n = 30) {
    if (reduced || !document.body.animate) return;
    const colors = ["#e3202a", "#f5ede4", "#ff4a4a", "#a6121a"];
    for (let i = 0; i < n; i++) {
      const s = document.createElement("span");
      s.className = "burst";
      const size = 8 + Math.random() * 18;
      s.style.width = size + "px";
      s.style.height = size * 0.95 + "px";
      s.style.background = colors[i % colors.length];
      document.body.append(s);
      const a = Math.random() * Math.PI * 2;
      const v = 80 + Math.random() * 260;
      const dx = Math.cos(a) * v;
      const dy = Math.sin(a) * v - 60;
      const rot = (Math.random() - 0.5) * 720;
      s.animate([
        { transform: `translate(${x}px, ${y}px) rotate(0deg) scale(1)`, opacity: 1 },
        { transform: `translate(${x + dx}px, ${y + dy + 180}px) rotate(${rot}deg) scale(.2)`, opacity: 0 },
      ], { duration: 900 + Math.random() * 700, easing: "cubic-bezier(.12,.6,.3,1)" }).onfinish = () => s.remove();
    }
  }

  /* ---------- scroll reveal ---------- */
  function countUp(el) {
    const to = Number(el.dataset.countTo) || 0;
    if (to === 0) { el.textContent = pad(to); return; }
    const start = performance.now();
    const dur = 1200;
    const step = (now) => {
      const t = clamp((now - start) / dur, 0, 1);
      el.textContent = pad(Math.round((1 - Math.pow(1 - t, 3)) * to));
      if (t < 1) requestAnimationFrame(step);
    };
    el.textContent = "00";
    requestAnimationFrame(step);
  }

  const onReveal = (el) => {
    el.classList.add("is-in");
    $$("[data-count-to]", el).forEach(countUp);
    const tee = $("[data-tee]", el);
    if (tee && !reduced) {
      setTimeout(() => {
        if (tee.classList.contains("is-flipped")) return;
        tee.classList.add("is-wiggle");
        tee.addEventListener("animationend", () => tee.classList.remove("is-wiggle"), { once: true });
      }, 1300);
    }
  };

  const reveals = $$(".reveal");
  if ("IntersectionObserver" in window) {
    const io = new IntersectionObserver((entries) => {
      entries.forEach((en) => {
        if (en.isIntersecting) {
          onReveal(en.target);
          io.unobserve(en.target);
        }
      });
    }, { threshold: 0, rootMargin: "0px 0px -12% 0px" }); // threshold 0: clip-path hides the clip reveals, so their ratio stays 0
    reveals.forEach((el) => io.observe(el));

    // touch screens can't hover the footer mark, so light it up when it scrolls in
    const mark = $("[data-footer-mark]");
    new IntersectionObserver(([en]) => mark.classList.toggle("is-lit", en.isIntersecting && !finePointer),
      { threshold: 0.6 }).observe(mark);
  } else {
    reveals.forEach(onReveal);
  }

  /* ---------- tees: flip, tilt, spotlight ---------- */
  $$("[data-tee]").forEach((tee) => {
    const media = tee.closest(".product__media");
    const side = $("[data-tee-side]", tee);
    tee.addEventListener("click", () => {
      const flipped = tee.classList.toggle("is-flipped");
      tee.setAttribute("aria-pressed", String(flipped));
      side.textContent = flipped ? "Back" : "Front";
    });
    if (!finePointer || reduced) return;
    tee.addEventListener("pointermove", (e) => {
      const r = tee.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width;
      const py = (e.clientY - r.top) / r.height;
      tee.style.setProperty("--rx", `${(0.5 - py) * 14}deg`);
      tee.style.setProperty("--ry", `${(px - 0.5) * 18}deg`);
      media.style.setProperty("--mx", `${px * 100}%`);
      media.style.setProperty("--my", `${py * 100}%`);
    });
    tee.addEventListener("pointerleave", () => {
      tee.style.setProperty("--rx", "0deg");
      tee.style.setProperty("--ry", "0deg");
    });
  });

  /* ---------- magnetic buttons ---------- */
  if (finePointer && !reduced) {
    $$("[data-magnetic]").forEach((el) => {
      el.addEventListener("pointermove", (e) => {
        const r = el.getBoundingClientRect();
        const x = e.clientX - (r.left + r.width / 2);
        const y = e.clientY - (r.top + r.height / 2);
        el.style.transform = `translate(${x * 0.18}px, ${y * 0.3}px)`;
      });
      el.addEventListener("pointerleave", () => { el.style.transform = ""; });
    });
  }

  /* ---------- hero letters jump when touched ---------- */
  const bump = (c) => {
    if (reduced || !root.classList.contains("is-loaded") || c.classList.contains("is-bump")) return;
    c.style.setProperty("--bump-r", `${(Math.random() - 0.5) * 24}deg`);
    c.classList.add("is-bump");
    c.addEventListener("animationend", () => c.classList.remove("is-bump"), { once: true });
  };
  $(".hero__title").addEventListener("pointerover", (e) => {
    const c = e.target.closest(".char");
    if (c) bump(c);
  });

  /* ---------- the star (easter egg) ---------- */
  const star = $("[data-star]");
  let starClicks = 0;
  let starPop = 0;
  star.addEventListener("click", (e) => {
    starClicks++;
    starPop = 0.14;
    if (starClicks >= C.quota) {
      const r = star.getBoundingClientRect();
      burst(r.left + r.width / 2, r.top + r.height / 2, 70);
      toast(`${C.quota}/${C.quota} — that's the whole rule. Now order one.`);
      starClicks = 0;
    } else {
      toast(`★ ${pad(starClicks)} / ${pad(C.quota)}`);
      burst(e.clientX, e.clientY, 6);
    }
  });

  /* ---------- custom cursor ---------- */
  const cursor = $("[data-cursor]");
  const cursorLabel = $("[data-cursor-label]");
  const mouse = { x: innerWidth / 2, y: innerHeight / 2, cx: innerWidth / 2, cy: innerHeight / 2, nx: 0, ny: 0 };
  if (finePointer && !reduced) {
    root.classList.add("has-cursor");
    addEventListener("pointermove", (e) => {
      mouse.x = e.clientX;
      mouse.y = e.clientY;
      mouse.nx = e.clientX / innerWidth - 0.5;
      mouse.ny = e.clientY / innerHeight - 0.5;
      cursor.classList.add("is-visible");
    }, { passive: true });
    document.addEventListener("pointerleave", () => cursor.classList.remove("is-visible"));
    document.addEventListener("pointerover", (e) => {
      const t = e.target;
      const labelled = t.closest("[data-cursor-text]");
      const link = t.closest("a, button, label, select, input, textarea, tbody tr");
      cursor.classList.toggle("is-text", !!labelled);
      cursor.classList.toggle("is-link", !labelled && !!link);
      cursorLabel.textContent = labelled ? labelled.dataset.cursorText : "";
      cursor.classList.toggle("on-red", !!t.closest(".order, .product__media, .marquee:not(.marquee--reverse)"));
    });
  } else {
    cursor.remove();
  }

  /* ---------- marquees ---------- */
  const marquees = $$("[data-marquee]").map((m) => {
    const track = $("[data-marquee-track]", m);
    const gap = parseFloat(getComputedStyle(track).columnGap) || 0;
    const unit = track.scrollWidth + gap;
    const copies = Math.max(2, Math.ceil((innerWidth * 1.5) / unit) + 1);
    const original = Array.from(track.children);
    for (let i = 1; i < copies; i++) original.forEach((n) => track.append(n.cloneNode(true)));
    return { track, unit, gap, copies, x: 0, v: 0, dir: Number(m.dataset.dir || 1) };
  });
  // web fonts change the text width, so re-measure once they're in
  const measureMarquees = () => marquees.forEach((mq) => {
    mq.gap = parseFloat(getComputedStyle(mq.track).columnGap) || 0;
    mq.unit = (mq.track.scrollWidth + mq.gap) / mq.copies;
  });
  if (document.fonts) document.fonts.ready.then(measureMarquees);
  addEventListener("resize", measureMarquees);

  /* ---------- main loop: scroll-linked motion ---------- */
  const topbar = $("[data-topbar]");
  const scrollbar = $("[data-scrollbar]");
  const badge = $(".badge__ring");
  let lastY = scrollY;
  let vel = 0;
  let scrollDir = 1;
  let badgeAngle = 0;
  let badgeSpin = 0;
  let lastSkew = "";
  const names = $$(".product__name");
  let starX = 0;
  let starY = 0;

  function frame() {
    const y = scrollY;
    const dy = y - lastY;
    lastY = y;
    vel = lerp(vel, dy, 0.12);
    if (Math.abs(dy) > 0.5) scrollDir = dy > 0 ? 1 : -1;

    const max = root.scrollHeight - innerHeight;
    scrollbar.style.transform = `scaleX(${max > 0 ? y / max : 0})`;

    if (y > 240 && dy > 3) topbar.classList.add("is-hidden");
    else if (dy < -3 || y < 120) topbar.classList.remove("is-hidden");

    if (!reduced) {
      // only the product names use the skew, so set it there rather than on :root (cheaper restyle)
      const skew = `${clamp(vel * -0.15, -5, 5).toFixed(1)}deg`;
      if (skew !== lastSkew) { names.forEach((n) => n.style.setProperty("--skew", skew)); lastSkew = skew; }

      const speed = 0.7 + Math.min(Math.abs(vel) * 0.35, 14);
      marquees.forEach((mq) => {
        // ease toward the target speed so a change of scroll direction doesn't snap
        mq.v = lerp(mq.v, speed * mq.dir * scrollDir, 0.06);
        mq.x -= mq.v;
        if (mq.x <= -mq.unit) mq.x += mq.unit;
        if (mq.x > 0) mq.x -= mq.unit;
        mq.track.style.transform = `translate3d(${mq.x.toFixed(2)}px,0,0)`;
      });

      if (y < innerHeight * 1.3) {
        starX = lerp(starX, mouse.nx * -40, 0.06);
        starY = lerp(starY, mouse.ny * -30, 0.06);
        starPop = lerp(starPop, 0, 0.12);
        star.style.transform = `translate3d(${starX.toFixed(1)}px, ${(starY + y * 0.3).toFixed(1)}px, 0) scale(${(1 + starPop).toFixed(3)})`;
        badgeSpin = lerp(badgeSpin, (0.18 + Math.min(Math.abs(vel) * 0.5, 12)) * scrollDir, 0.06);
        badgeAngle += badgeSpin;
        badge.style.transform = `rotate(${badgeAngle.toFixed(2)}deg)`;
      }

      if (cursor.isConnected) {
        mouse.cx = lerp(mouse.cx, mouse.x, 0.22);
        mouse.cy = lerp(mouse.cy, mouse.y, 0.22);
        cursor.style.transform = `translate3d(${mouse.cx.toFixed(1)}px, ${mouse.cy.toFixed(1)}px, 0)`;
      }
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
