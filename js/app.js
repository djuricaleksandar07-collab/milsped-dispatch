/* app.js - entry point za Dispatch Calculator */
(async function () {
  "use strict";

  const overlay = document.getElementById("loading-overlay");
  const overlayText = document.getElementById("loading-text");
  function setText(s) { if (overlayText) overlayText.textContent = s; }
  function hideOverlay() { if (overlay) overlay.classList.add("hide"); }

  async function fetchJson(url, tries) {
    // Retry na prolazne mrezne greske (npr. za vreme GitHub Pages deploy-a),
    // da jedan neuspeh ne obori ceo app sa "Failed to fetch".
    tries = tries || 3;
    let lastErr;
    for (let i = 0; i < tries; i++) {
      try {
        const res = await fetch(url, { cache: "no-store" });
        if (!res.ok) throw new Error("Failed to load " + url + ": " + res.status);
        return await res.json();
      } catch (e) {
        lastErr = e;
        if (i < tries - 1) await new Promise(function (r) { setTimeout(r, 400 * (i + 1)); });
      }
    }
    throw lastErr;
  }

  try {
    // PRISTUP 1: ako je bundle.js učitan (script tag), koristi window.__BUNDLE__
    // — radi i pri otvaranju preko file:// protokola (bez HTTP servera/Pythona).
    // PRISTUP 2: fallback na fetch() — radi kada se učitava preko HTTP servera.
    // Bundle.js se učitava ASINHRONO — sačekaj da završi (ili padne) pre nego
    // što odlučiš bundle vs fetch. Bez ovoga app.js krene prerano, ne vidi
    // window.__BUNDLE__ i nepotrebno ide na fetch() (uzrok "Failed to fetch").
    if (window.__BUNDLE_READY__ && typeof window.__BUNDLE_READY__.then === "function") {
      setText("Loading bundled data...");
      try { await window.__BUNDLE_READY__; } catch (e) { /* pusti fallback */ }
    }
    const B = window.__BUNDLE__;
    let lanesWrap, zips, pilots, fuelPrices;

    // Lane/fleet aggregates now come from the LOAD-LEVEL pipeline (calc_data.json,
    // built by build_masterbase.py + build_app_data.py). This also powers the
    // per-load "N trips" breakdown (data/calc_detail.json, lazy-loaded on click).
    setText("Loading load-level lane data...");
    lanesWrap = window.__CALC__ || await fetchJson("data/calc_data.json");
    window._calcData = lanesWrap;

    // ZIP centroids, Pilot stations and fuel prices still come from the bundle
    // (or fetch fallback) — unchanged.
    if (B) {
      zips        = B.zip_centroids;
      pilots      = B.pilot_stations;
      fuelPrices  = B.fuel_prices;
    } else {
      setText("Loading ZIP database (~42k zips)...");
      zips = await fetchJson("data/zip_centroids.json");

      setText("Loading Pilot stations...");
      pilots = await fetchJson("data/pilot_stations.json");

      setText("Loading current fuel prices...");
      try {
        fuelPrices = await fetchJson("data/fuel_prices.json");
      } catch (e) {
        console.warn("fuel_prices.json unavailable", e);
        fuelPrices = null;
      }
    }

    const pilotsNorm = {};
    for (const [k, v] of Object.entries(pilots)) {
      if (typeof v.lat === "number" && typeof v.lon === "number") pilotsNorm[k] = v;
    }

    // Default period is controlled from the HTML: whichever .period-toggle button
    // has class "on" wins (fallback: metadata default_period, then "90").
    const onBtn = document.querySelector(".period-toggle button.on");
    const htmlDefault = onBtn ? onBtn.getAttribute("data-period") : null;
    const defaultPeriod = htmlDefault || (lanesWrap.metadata && lanesWrap.metadata.default_period) || "90";
    const period = lanesWrap.fleet[defaultPeriod] ? defaultPeriod : "all";
    const fleet = lanesWrap.fleet[period];
    const lanes = lanesWrap.lanes[period];
    window._currentPeriod = period;
    window._lanesWrap = lanesWrap;

    CalcCore.configure({ fleet: fleet, lanes: lanes, defaultMpg: 6.32, insurancePm: 0.105 });
    ZipDistance.load(zips, pilotsNorm);

    if (fuelPrices && window.FuelRecommender) {
      const loadInfo = FuelRecommender.load(fuelPrices);
      window._fuelSnapshotDate = loadInfo.latest_date;
      const badge = document.getElementById("period-badge");
      if (badge) {
        badge.textContent = loadInfo.latest_date ? "Fuel: " + loadInfo.latest_date : "Bez fuel snapshot-a";
      }
    } else {
      const badge = document.getElementById("period-badge");
      if (badge) badge.textContent = "Bez fuel snapshot-a";
    }

    CalcUI.init();
    CalcUI.addCalc();
    CalcUI.addCalc();
    CalcUI.addCalc();

    setText("Ready.");
    setTimeout(hideOverlay, 200);

    // Background-preload per-load detail so ZIP/city-level recommendations (from
    // the first pickup) and the load breakdown are ready when the dispatcher types.
    if (window.LoadBreakdown && LoadBreakdown._preload) {
      LoadBreakdown._preload()
        .then(function () { if (window.CalcUI && CalcUI.render) CalcUI.render(); })
        .catch(function () {});
    }

    document.querySelectorAll(".period-toggle button").forEach(function (btn) {
      const p = btn.getAttribute("data-period");
      btn.classList.toggle("on", p === period);
      btn.addEventListener("click", function () {
        if (!lanesWrap.lanes[p]) {
          showStubToast("Period \"" + p + "\" not available.");
          return;
        }
        document.querySelectorAll(".period-toggle button").forEach(function (b) { b.classList.remove("on"); });
        btn.classList.add("on");
        window._currentPeriod = p;
        CalcCore.configure({ fleet: lanesWrap.fleet[p], lanes: lanesWrap.lanes[p] });
        updatePeriodInfo();
        CalcUI.render();
      });
    });

    function updatePeriodInfo() {
      const info = document.getElementById("period-info");
      if (!info) return;
      const p = window._currentPeriod;
      const fl = lanesWrap.fleet[p];
      const meta = lanesWrap.metadata || {};
      const refDate = meta.reference_date || "-";
      const nTrips = fl ? fl.n_trips || 0 : 0;
      info.textContent = "ref " + refDate + " * " + nTrips.toLocaleString() + " trips * fleet CM/mi $" + (fl ? fl.cm_pm.toFixed(4) : "-");
    }
    updatePeriodInfo();

    const printBtn = document.getElementById("btn-print");
    if (printBtn) printBtn.addEventListener("click", function () { CalcUI.printAll(); });
    const exportBtn = document.getElementById("btn-export-log");
    if (exportBtn) exportBtn.addEventListener("click", function () { PrintTrace.exportLog(); });
    const clearBtn = document.getElementById("btn-clear-log");
    if (clearBtn) clearBtn.addEventListener("click", function () {
      if (PrintTrace.clearLog()) { CalcUI.render(); showStubToast("Trace log cleared."); }
    });

    const dispInput = document.getElementById("dispatcher-name");
    if (dispInput) {
      dispInput.value = localStorage.getItem("dispatcher_name") || "";
      dispInput.addEventListener("change", function (e) {
        localStorage.setItem("dispatcher_name", e.target.value);
      });
    }

    const truckInput = document.getElementById("truck-number");
    if (truckInput) {
      truckInput.value = localStorage.getItem("truck_number") || "";
      truckInput.addEventListener("change", function (e) {
        localStorage.setItem("truck_number", e.target.value);
      });
    }

  } catch (err) {
    setText("Error: " + err.message);
    console.error(err);
  }

  function showStubToast(msg) {
    let t = document.getElementById("toast");
    if (!t) { t = document.createElement("div"); t.id = "toast"; t.className = "toast"; document.body.appendChild(t); }
    t.className = "toast show"; t.textContent = msg;
    clearTimeout(t._timer);
    t._timer = setTimeout(function () { t.className = "toast"; }, 2600);
  }
})();
