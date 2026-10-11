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
  const sleevesOf = (key) => C.products[key].sleeves || [];
  const sleeveOf = (key, name) => sleevesOf(key).find((o) => o.name === name);
  const sleeveExtra = (key, name) => (sleeveOf(key, name) || {}).extra || 0;
  const hasExtras = (key) => bigSizesOf(key).length > 0 || sleevesOf(key).some((o) => o.extra > 0);
  const choiceMeta = (key) => {
    const p = C.products[key];
    return (hasExtras(key) ? "from " : "") + money(p.price) + (isClosed(key) ? " · closed" : "");
  };

  const goalOf = (key) => C.products[key].goal ?? C.quota;
  const countOf = (key) => Math.max(0, Number(key in liveCounts ? liveCounts[key] : C.counts[key]) || 0);
  // Shown in the bars; replaced by live numbers from the sheet when they arrive.
  const liveCounts = {};

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
    const sleeveNotes = sleevesOf(key).filter((o) => o.extra > 0).map((o) => `${o.name} ${plus(o.extra)}`);
    f("priceNote").textContent = [baseLabel, ...big.map((s) => `${s} ${plus(surchargeOf(key, s))}`), ...sleeveNotes].filter(Boolean).join(" · ");
    f("priceNote").hidden = !hasExtras(key);
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

    // progress (segments are built once so later count updates can animate)
    const goal = goalOf(key);
    f("goal").textContent = pad(goal);
    const bar = f("bar");
    bar.style.setProperty("--n", goal);
    bar.setAttribute("aria-valuemax", goal);
    bar.innerHTML = Array.from({ length: goal }, (_, i) => `<span style="--i:${i}"></span>`).join("");
    renderProgress(key);

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
      const item = selectProduct(key);
      item.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
      setTimeout(() => {
        const first = $("input[data-size]:not(:disabled)", item) || $("#o-name");
        first.focus({ preventScroll: true });
      }, 700);
    });
  });

  function renderProgress(key) {
    const sec = $(`[data-product="${key}"]`);
    if (!sec) return;
    const f = (name) => $(`[data-field="${name}"]`, sec);
    const goal = goalOf(key);
    const ordered = countOf(key);
    const left = goal - ordered;

    const count = f("ordered");
    const shown = parseInt(count.textContent, 10) || 0;
    count.dataset.countTo = ordered;
    // already on screen: roll the number from what's shown to the new value
    if (sec.querySelector(".product__info.is-in") && shown !== ordered) countUp(count, shown);
    else count.textContent = pad(ordered);

    const bar = f("bar");
    bar.setAttribute("aria-valuenow", Math.min(ordered, goal));
    bar.setAttribute("aria-label", `${ordered} of ${goal} ordered`);
    Array.from(bar.children).forEach((seg, i) => {
      seg.classList.toggle("is-filled", i < ordered);
      seg.classList.toggle("is-next", i === ordered);
    });
    f("remaining").textContent = left > 0
      ? `${left} more to lock this batch in.`
      : "Quota hit — this batch is happening.";
    sec.classList.toggle("is-locked", left <= 0);
  }

  // Confirmed orders are counted by the Apps Script (doGet ?action=counts).
  async function loadLiveCounts() {
    const url = C.form.endpoint;
    if (!url || !/^https:\/\//.test(url)) return;
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 8000);
      const res = await fetch(url + (url.includes("?") ? "&" : "?") + "action=counts", { signal: ctrl.signal });
      clearTimeout(timer);
      const data = await res.json();
      if (!data.ok || !data.counts) return;
      keys.forEach((key) => {
        const n = data.counts[C.products[key].name];
        liveCounts[key] = typeof n === "number" ? n : 0;
        renderProgress(key);
      });
      renderHeroStatus();
    } catch {
      // network/script problem: keep the fallback numbers from config.js
    }
  }

  function setupFitViz(sec, chart) {
    const rows = $$("tbody tr", sec);
    const shape = $("[data-fitviz]", sec);
    const label = $("[data-fitviz-label]", sec);
    const cols = chart.columns;
    const maxW = Math.max(...chart.rows.map((r) => r[1]));
    const maxL = Math.max(...chart.rows.map((r) => r[2]));
    const m = chart.rows.findIndex((r) => r[0] === "M");
    let selected = m >= 0 ? m : Math.min(1, chart.rows.length - 1);

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
    closeInForm(key);
    renderHeroStatus();
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
  loadLiveCounts();

  /* ---------------------------------------------------------------
     Order form — a small basket: one card per tee, one payment
     --------------------------------------------------------------- */
  const form = $("#order-form");
  const itemsEl = $("[data-items]", form);
  const addBtn = $("[data-add-item]", form);
  const totalEl = $("[data-total]", form);
  const proofInput = $("#o-proof");
  const drop = $("[data-drop]", form);
  const done = $("[data-done]");
  const MAX_ITEMS = 6;
  let itemSeq = 0;

  // payment block
  const pay = C.payment;
  $("[data-pay-note]", form).textContent = pay.note || "";
  const qrImg = $("[data-qris]", form);
  const qrDl = $("[data-qris-download]", form);
  if (pay.qrisImage) {
    qrImg.src = pay.qrisImage;
    const dl = pay.qrisDownload || pay.qrisImage;
    qrDl.href = dl;
    qrDl.setAttribute("download", "KMSR-QRIS" + (dl.match(/\.\w+$/) || [".png"])[0]);
  } else {
    qrImg.closest("figure").hidden = true;
    qrDl.hidden = true;
  }
  $("[data-qris-merchant]", form).textContent = pay.merchantName || "";

  function itemHTML(id) {
    const choices = keys.map((key) => {
      const p = C.products[key];
      return `<label class="choice">
        <input type="radio" name="product-${id}" value="${esc(p.name)}" data-key="${key}" required${isClosed(key) ? " disabled" : ""}>
        <span class="choice__body">
          <img class="choice__thumb" src="${esc(p.images.front)}" alt="">
          <span class="choice__text">
            <span class="choice__name">${esc(p.shortName)}</span>
            <span class="choice__meta">${esc(choiceMeta(key))}</span>
          </span>
        </span>
      </label>`;
    }).join("");
    return `
      <div class="item__head">
        <span class="item__title">Tee <span data-item-n>1</span></span>
        <span class="item__sub" data-item-sub></span>
        <button type="button" class="item__remove" data-remove aria-label="Remove this tee">Remove ✕</button>
      </div>
      <fieldset class="field">
        <legend>Type</legend>
        <div class="choices">${choices}</div>
      </fieldset>
      <fieldset class="field" data-size-field>
        <legend>Size</legend>
        <div class="chips" data-size-choices></div>
      </fieldset>
      <fieldset class="field" data-sleeve-field hidden>
        <legend>Sleeve</legend>
        <div class="chips chips--wide" data-sleeve-choices></div>
      </fieldset>
      <div class="field">
        <label for="qty-${id}">Quantity</label>
        <div class="stepper">
          <button type="button" data-step="-1" aria-label="Decrease quantity">−</button>
          <input id="qty-${id}" data-qty type="number" min="1" max="10" value="1" inputmode="numeric" required>
          <button type="button" data-step="1" aria-label="Increase quantity">+</button>
        </div>
      </div>`;
  }

  const itemList = () => $$(".item", itemsEl);
  const itemKey = (el) => $("input[data-key]:checked", el)?.dataset.key;

  function clampQty(input) {
    const n = parseInt(input.value, 10);
    return Number.isNaN(n) ? Number(input.min) : clamp(n, Number(input.min), Number(input.max));
  }

  function itemData(el) {
    const key = itemKey(el);
    const size = $("input[data-size]:checked", el)?.value;
    const sleeve = key ? sleeveOf(key, $("input[data-sleeve]:checked", el)?.value) : undefined;
    const qty = clampQty($("[data-qty]", el));
    const unit = key ? priceOf(key, size) + (sleeve ? sleeve.extra : 0) : 0;
    return { el, key, size, sleeve, qty, unit, total: unit * qty };
  }

  function addItem(key) {
    const id = ++itemSeq;
    const el = document.createElement("div");
    el.className = "item";
    el.dataset.item = id;
    el.innerHTML = itemHTML(id);
    itemsEl.append(el);
    if (key) {
      const r = $(`input[data-key="${key}"]`, el);
      if (r && !r.disabled) r.checked = true;
    }
    renderItem(el);
    refreshItems();
    if (itemList().length > 1 && !reduced && el.animate) {
      el.animate([{ opacity: 0, transform: "translateY(18px)" }, { opacity: 1, transform: "none" }],
        { duration: 450, easing: "cubic-bezier(.2,.7,.2,1)" });
    }
    return el;
  }

  function renderItem(el) {
    const id = el.dataset.item;
    const key = itemKey(el);
    const shownKey = key || keys[0];

    // sizes (before a type is picked, show the first product's sizes as a hint)
    const sizes = C.products[shownKey].sizes || [];
    const sizeBox = $("[data-size-choices]", el);
    const sig = shownKey + ":" + sizes.join("|");
    if (sizeBox.dataset.sig !== sig) {
      const prev = $("input[data-size]:checked", el)?.value;
      sizeBox.innerHTML = sizes.map((s, i) => {
        const extra = surchargeOf(shownKey, s);
        return `<label class="chip"><input type="radio" name="size-${id}" data-size value="${esc(s)}" required${s === prev ? " checked" : ""}><span style="--i:${i}">${esc(s)}${extra ? `<small>${plus(extra)}</small>` : ""}</span></label>`;
      }).join("");
      if (sizeBox.dataset.sig && !reduced) {
        sizeBox.classList.remove("is-in");
        void sizeBox.offsetWidth;
        sizeBox.classList.add("is-in");
      }
      sizeBox.dataset.sig = sig;
    }
    const sizeField = $("[data-size-field]", el);
    sizeField.hidden = sizes.length === 0;
    sizeField.disabled = sizes.length === 0;

    // sleeves (only products that define them)
    const sleeves = key ? sleevesOf(key) : [];
    const sleeveBox = $("[data-sleeve-choices]", el);
    const sleeveSig = key ? key + ":" + sleeves.map((o) => o.name).join("|") : "";
    if (sleeveBox.dataset.sig !== sleeveSig) {
      const prev = $("input[data-sleeve]:checked", el)?.value;
      sleeveBox.innerHTML = sleeves.map((o, i) => {
        const on = prev ? o.name === prev : i === 0;
        return `<label class="chip"><input type="radio" name="sleeve-${id}" data-sleeve value="${esc(o.name)}" required${on ? " checked" : ""}><span style="--i:${i}">${esc(o.name)}${o.extra ? `<small>${plus(o.extra)}</small>` : ""}</span></label>`;
      }).join("");
      sleeveBox.dataset.sig = sleeveSig;
    }
    const sleeveField = $("[data-sleeve-field]", el);
    sleeveField.hidden = sleeves.length === 0;
    sleeveField.disabled = sleeves.length === 0;

    const d = itemData(el);
    $("[data-item-sub]", el).textContent = d.key ? money(d.total) : "";
  }

  let lastTotal = "";
  function refreshItems() {
    const list = itemList();
    list.forEach((el, i) => {
      $("[data-item-n]", el).textContent = i + 1;
      $("[data-remove]", el).hidden = list.length === 1;
    });
    addBtn.disabled = list.length >= MAX_ITEMS;

    const data = list.map(itemData).filter((d) => d.key);
    const total = data.length ? money(data.reduce((sum, d) => sum + d.total, 0)) : "Pick a tee";
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
    addBtn.hidden = allClosed;
    if (allClosed) setStatus($("[data-status]", form), "Pre-orders are closed for this batch.", false);
  }

  // From a product's "Pre-order" button: reuse a card with that tee or an empty card, else add one.
  function selectProduct(key) {
    const list = itemList();
    let el = list.find((i) => itemKey(i) === key) || list.find((i) => !itemKey(i));
    if (!el) {
      if (list.length < MAX_ITEMS) return addItem(key);
      el = list[list.length - 1];
    }
    const r = $(`input[data-key="${key}"]`, el);
    if (r && !r.disabled) r.checked = true;
    renderItem(el);
    refreshItems();
    return el;
  }

  // closing a product (deadline passed) — called from setClosed()
  function closeInForm(key) {
    $$(`input[data-key="${key}"]`, form).forEach((r) => {
      r.disabled = true;
      r.checked = false;
      $(".choice__meta", r.closest(".choice")).textContent = choiceMeta(key);
    });
    itemList().forEach(renderItem);
    refreshItems();
  }

  form.addEventListener("click", (e) => {
    const step = e.target.closest("[data-step]");
    if (step) {
      const input = $("[data-qty]", step.closest(".item"));
      input.value = clamp(clampQty(input) + Number(step.dataset.step), Number(input.min), Number(input.max));
      renderItem(step.closest(".item"));
      refreshItems();
      return;
    }
    const remove = e.target.closest("[data-remove]");
    if (remove) {
      const el = remove.closest(".item");
      const finish = () => {
        el.remove();
        refreshItems();
        $("input[data-key]:not(:disabled)", itemList()[0])?.focus({ preventScroll: true });
      };
      // remove on a timer rather than onfinish, which never fires in a background tab
      if (!reduced && el.animate) {
        el.animate([{ opacity: 1 }, { opacity: 0, transform: "translateX(-24px)" }], { duration: 260, easing: "ease-in", fill: "forwards" });
        setTimeout(finish, 260);
      } else finish();
    }
  });
  addBtn.addEventListener("click", () => {
    const el = addItem();
    $("input[data-key]:not(:disabled)", el)?.focus({ preventScroll: true });
    el.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "nearest" });
  });
  form.addEventListener("change", (e) => {
    const item = e.target.closest(".item");
    if (item) { renderItem(item); refreshItems(); }
    e.target.classList.remove("is-invalid");
  });
  form.addEventListener("input", (e) => {
    e.target.classList.remove("is-invalid");
    if (e.target.matches("[data-qty]")) { renderItem(e.target.closest(".item")); refreshItems(); }
  });
  form.addEventListener("focusout", (e) => {
    if (e.target.matches("[data-qty]")) { e.target.value = clampQty(e.target); renderItem(e.target.closest(".item")); refreshItems(); }
  });

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

  addItem();

  // the sheet's Size column is short, so long sleeve goes in as e.g. "M (Long)"
  const sizeLabel = (d) => {
    const size = d.size || "One size";
    return d.sleeve && d.sleeve.tag ? `${size} (${d.sleeve.tag})` : size;
  };
  const itemLine = (d) =>
    `${C.products[d.key].name} · ${d.size || "One size"}${d.sleeve && d.sleeve.extra ? " · " + d.sleeve.name : ""} × ${d.qty}`;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const status = $("[data-status]", form);
    const btn = $('[type="submit"]', form);
    const items = itemList().map(itemData);

    const noType = items.find((d) => !d.key);
    if (noType) return fail(status, "Pick a type for each tee (or remove the extra one).", $("input[data-key]:not(:disabled)", noType.el));
    const closed = items.find((d) => isClosed(d.key));
    if (closed) return fail(status, `${C.products[closed.key].name} is closed — remove it to continue.`, $("[data-remove]", closed.el));

    const fields = $$("input, textarea", form).filter((el) => !el.disabled && el.type !== "hidden");
    const invalid = fields.find((el) => !el.checkValidity());
    if (invalid) {
      fields.forEach((el) => el.classList.toggle("is-invalid", !el.checkValidity()));
      drop.classList.toggle("is-invalid", !proofInput.checkValidity());
      const msg = invalid.matches("[data-size]") ? "Pick a size for each tee."
        : invalid === proofInput ? "Upload your payment screenshot."
        : invalid.name === "whatsapp" ? "Check your WhatsApp number."
        : "Fill in the highlighted fields.";
      return fail(status, msg, invalid);
    }

    const fd = new FormData(form);
    const orderTotal = items.reduce((sum, d) => sum + d.total, 0);
    const lines = items.map((d) => ({
      product: C.products[d.key].name,
      size: sizeLabel(d),
      sleeve: d.sleeve ? d.sleeve.name : "",
      quantity: d.qty,
      unit_price: money(d.unit),
      total: money(d.total),
    }));
    // Retrying the same order keeps its order ref, so the script won't save it twice
    // if the first attempt actually went through.
    const signature = JSON.stringify([lines, fd.get("name"), fd.get("whatsapp")]);
    if (!retry || retry.signature !== signature) retry = { signature, ref: makeRef() };
    const ref = retry.ref;

    const progress = sendProgress();
    btn.disabled = true;
    btn.hidden = true;
    setStatus(status, "", false);
    progress.start();
    try {
      const proof = await fileToPayload(proofInput.files[0]);
      progress.uploading(proof ? proof.data.length : 0);
      await send({
        form_type: "order",
        _gotcha: fd.get("_gotcha") || "",
        order_ref: ref,
        items: lines,
        order_total: money(orderTotal),
        // single-tee orders also go in the old flat format, so an older script version still works
        ...(lines.length === 1 ? lines[0] : {}),
        name: String(fd.get("name")).trim(),
        whatsapp: String(fd.get("whatsapp")).trim(),
        notes: String(fd.get("notes") || "").trim(),
        payment_proof: proof,
      }, { onVerify: () => progress.verifying() });
      retry = null;
      await progress.finish();
      showDone(ref, items, orderTotal);
    } catch (err) {
      progress.stop();
      setStatus(status, err.message, true);
    } finally {
      btn.disabled = false;
      btn.hidden = false;
    }
  });

  let retry = null;

  // Progress panel while an order is sent. Browsers can't report upload progress to
  // Google cross-origin, so the bar moves on an estimate from the file size; it only
  // reaches 100% once the script has replied that the order is saved.
  function sendProgress() {
    const box = $("[data-sending]", form);
    const fill = $("[data-sending-bar]", box);
    const pct = $("[data-sending-pct]", box);
    const label = $("[data-sending-label]", box);
    const steps = $$("[data-sending-step]", box);
    const TICK = 50;
    let shown = 0;
    let target = 0;
    let creep = null;
    let timer = null;
    let nextStage = null;

    const stage = (i, text) => {
      steps.forEach((li, j) => {
        li.classList.toggle("is-done", j < i);
        li.classList.toggle("is-active", j === i);
      });
      label.textContent = text;
    };
    // ease toward `cap` (never quite reaching it), getting ~95% of the way in `ms`
    const creepTo = (cap, ms) => { creep = { cap, rate: 1 - Math.pow(0.05, TICK / Math.max(ms, 300)) }; };
    const tickFn = () => {
      if (creep) target += (creep.cap - target) * creep.rate;
      shown += (target - shown) * 0.25;
      if (Math.abs(target - shown) < 0.1) shown = target;
      fill.style.transform = `scaleX(${(shown / 100).toFixed(4)})`;
      pct.textContent = Math.floor(shown) + "%";
    };
    const clear = () => { clearInterval(timer); clearTimeout(nextStage); creep = null; };

    return {
      start() {
        clear();
        shown = target = 0;
        box.classList.remove("is-done");
        box.hidden = false;
        stage(0, "Preparing your screenshot…");
        creepTo(14, 700);
        tickFn();
        timer = setInterval(tickFn, TICK);
        box.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "nearest" });
      },
      uploading(bytes) {
        target = Math.max(target, 15);
        stage(1, "Uploading to Google Drive…");
        const ms = 700 + bytes / 250; // assume ~250 KB/s on a phone connection
        creepTo(62, ms);
        nextStage = setTimeout(() => { stage(2, "Saving your order to the sheet…"); creepTo(95, 5000); }, ms);
      },
      verifying() {
        clearTimeout(nextStage);
        stage(2, "Double-checking the sheet…");
        creepTo(97, 9000);
      },
      async finish() {
        clearTimeout(nextStage);
        creep = null;
        target = 100;
        stage(steps.length, "Saved ✓");
        box.classList.add("is-done");
        await wait(reduced ? 100 : 450);
        shown = 100;
        tickFn();
        await wait(reduced ? 100 : 450);
        clear();
        box.hidden = true;
      },
      stop() {
        clear();
        box.hidden = true;
      },
    };
  }

  function fail(status, msg, focusEl) {
    setStatus(status, msg, true);
    if (focusEl) {
      focusEl.focus({ preventScroll: true });
      (focusEl.closest(".field") || focusEl).scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "center" });
    }
  }

  function showDone(ref, items, total) {
    $("[data-done-summary]").innerHTML =
      `${esc(ref)} · ${esc(money(total))}` + items.map((d) => `<br>${esc(itemLine(d))}`).join("");
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
    itemsEl.innerHTML = "";
    lastTotal = "";
    const first = addItem();
    done.hidden = true;
    form.hidden = false;
    $("input[data-key]:not(:disabled)", first)?.focus();
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
  async function send(payload, { onVerify } = {}) {
    const url = C.form.endpoint;
    if (!url || !/^https:\/\//.test(url)) {
      if (isLocal) {
        console.info("[KMSR] No endpoint set — demo submit (local only):", payload);
        await wait(900);
        return;
      }
      throw new Error("Ordering isn't connected yet. Please check back soon.");
    }
    let res = null;
    let data = null;
    try {
      // a plain string body is sent as text/plain, which avoids a CORS preflight
      res = await fetch(url, { method: "POST", body: JSON.stringify(payload) });
      data = await res.json();
    } catch { /* no readable reply */ }
    if (data && data.ok) return;
    if (data && data.error) throw new Error(data.error); // the script answered with a real problem

    // Apps Script saves first, then sends the browser to a second Google page for the reply.
    // That page is sometimes slow or fails even though the order is already in the sheet,
    // so ask the script directly before telling the buyer it failed.
    if (payload.order_ref) {
      if (onVerify) onVerify();
      if (await orderSaved(url, payload.order_ref)) return;
    }
    throw new Error(res
      ? "Something went wrong. Please try again in a moment."
      : "Couldn't reach the server. Check your connection and try again.");
  }

  async function orderSaved(url, ref) {
    for (const delay of [1500, 3000, 6000]) {
      await wait(delay);
      try {
        const r = await fetch(`${url}?action=check&ref=${encodeURIComponent(ref)}`);
        const d = await r.json();
        if (d.ok && typeof d.found === "boolean") return d.found;
      } catch { /* try again */ }
    }
    return false;
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
  function countUp(el, from = 0) {
    const to = Number(el.dataset.countTo) || 0;
    if (to === from) { el.textContent = pad(to); return; }
    const start = performance.now();
    const dur = 1200;
    const run = (el._countRun = (el._countRun || 0) + 1); // a newer count-up cancels this one
    const step = (now) => {
      if (run !== el._countRun) return;
      const t = clamp((now - start) / dur, 0, 1);
      el.textContent = pad(Math.round(from + (1 - Math.pow(1 - t, 3)) * (to - from)));
      if (t < 1) requestAnimationFrame(step);
    };
    el.textContent = pad(from);
    requestAnimationFrame(step);
  }

  const onReveal = (el) => {
    el.classList.add("is-in");
    $$("[data-count-to]", el).forEach((c) => countUp(c));
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
