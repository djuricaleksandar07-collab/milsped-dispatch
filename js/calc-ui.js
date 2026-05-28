/* =======================================================================
   calc-ui.js — DOM rendering za Dispatch Calculator
   =======================================================================
   Zahteva: CalcCore, ZipDistance, PrintTrace (globalno učitani pre ovog fajla)
   ======================================================================= */

(function (global) {
  "use strict";

  // ── State ──────────────────────────────────────────────────────────
  let calcs = [];
  let idCtr = 0;
  let metric = "cm_day";
  let hlMap = null;
  let activeAutocomplete = null;  // koji input je trenutno otvoren

  const RKCOLORS = ['#1a8a60','#3b5bdb','#e65100','#7c3aed','#0891b2','#b83535','#d97706','#059669'];
  const ALL_ST = ["AL","AR","AZ","CA","CO","CT","DE","FL","GA","IA","ID","IL","IN","KS","KY","LA","MA","MD","ME","MI","MN","MO","MS","NC","ND","NE","NH","NJ","NM","NV","NY","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VA","VT","WA","WI","WV","WY"];
  // State centroidi (SVG koordinate) — za prikaz na mapi
  const SC = {"AL":[553,390],"AZ":[203,436],"AR":[566,392],"CA":[116,373],"CO":[301,338],"CT":[825,181],"DE":[796,224],"FL":[688,484],"GA":[692,408],"ID":[209,203],"IL":[530,291],"IN":[563,268],"IA":[477,248],"KS":[408,325],"KY":[612,314],"LA":[534,450],"ME":[860,130],"MD":[769,236],"MA":[847,169],"MI":[573,215],"MN":[466,176],"MS":[554,415],"MO":[502,315],"MT":[248,171],"NE":[410,273],"NH":[835,153],"NJ":[796,213],"NM":[255,390],"NV":[158,307],"NY":[756,175],"NC":[688,318],"ND":[389,146],"OH":[609,264],"OK":[442,365],"OR":[134,218],"PA":[735,211],"RI":[832,177],"SC":[680,367],"SD":[389,206],"TN":[613,358],"TX":[393,451],"UT":[212,341],"VT":[812,147],"VA":[714,282],"WA":[148,147],"WV":[668,269],"WI":[517,209],"WY":[278,228]};

  // ── Helpers ────────────────────────────────────────────────────────
  const fm  = n => Math.round(n).toLocaleString("en-US");
  const f3  = n => (+n).toFixed(3);
  const f4  = n => (+n).toFixed(4);
  const fmi = n => Math.round(n).toLocaleString();
  const fPct = n => (n * 100).toFixed(2) + "%";
  const na  = '<span style="color:var(--mu2)">n/a</span>';

  function gradColor(t) {
    t = Math.max(0, Math.min(1, t));
    if (t < 0.5) { const f = t * 2; return `rgb(${Math.round(180 + f * (85 - 180))},${Math.round(200 + f * (197 - 200))},${Math.round(210 + f * (176 - 210))})`; }
    const f = (t - 0.5) * 2;
    return `rgb(${Math.round(85 + f * (8 - 85))},${Math.round(197 + f * (32 - 197))},${Math.round(176 + f * (60 - 176))})`;
  }

  function metricFmt(tot) {
    if (metric === "cm_pt")  return "$" + fm(tot.cm_pt);
    if (metric === "cm_pct") return fPct(tot.cm_pct);
    if (metric === "cm_day") return "$" + fm(tot.cm_per_day || 0);
    return "$" + f4(tot.cm_pm);
  }
  function metricLbl() {
    return metric === "cm_pt"  ? "CM/load"
         : metric === "cm_pct" ? "CM%"
         : metric === "cm_day" ? "CM/day"
         : "CM/mi";
  }

  function showToast(msg, kind) {
    let t = document.getElementById("toast");
    if (!t) {
      t = document.createElement("div");
      t.id = "toast";
      t.className = "toast";
      document.body.appendChild(t);
    }
    t.className = "toast" + (kind ? " " + kind : "") + " show";
    t.textContent = msg;
    clearTimeout(t._timer);
    t._timer = setTimeout(() => { t.className = "toast" + (kind ? " " + kind : ""); }, 2400);
  }

  // ── Tooltip ────────────────────────────────────────────────────────
  let TT;
  function initTooltip() {
    TT = document.createElement("div");
    TT.style.cssText = "position:fixed;pointer-events:none;z-index:9999;display:none;background:#08203c;color:#fff;border-radius:10px;padding:11px 14px;min-width:190px;max-width:260px;box-shadow:0 8px 28px rgba(8,32,60,.3);font-family:DM Sans,sans-serif;font-size:13px";
    document.body.appendChild(TT);
    document.addEventListener("mousemove", e => { if (TT.style.display === "block") ttP(e.clientX, e.clientY); });
    document.addEventListener("scroll", ttH, true);
  }
  function ttS(cx, cy, rows, title) {
    TT.innerHTML = `<div style="font-weight:600;margin-bottom:6px">${title}</div>` + rows.map(([k, v]) => `<div style="display:flex;justify-content:space-between;gap:12px;font-size:11px;color:rgba(255,255,255,.55);margin-top:3px"><span>${k}</span><span style="font-family:'DM Mono',monospace;color:#fff;font-weight:500">${v}</span></div>`).join("");
    TT.style.display = "block";
    ttP(cx, cy);
  }
  function ttP(cx, cy) {
    const w = TT.offsetWidth || 200, h = TT.offsetHeight || 120;
    let x = cx + 16, y = cy + 16;
    if (x + w > window.innerWidth - 8) x = cx - w - 8;
    if (y + h > window.innerHeight - 8) y = cy - h - 8;
    TT.style.left = x + "px"; TT.style.top = y + "px";
  }
  function ttH() { TT.style.display = "none"; }

  // ── Fleet bar ──────────────────────────────────────────────────────
  function rendFleet() {
    const FL = CalcCore.getFleet();
    if (!FL) return;
    const MPG = CalcCore.getMPG();
    const items = [
      ["RPM", "$" + f3(FL.rpm)], null,
      ["Fuel/mi", "$" + f4(FL.fuel_pm)],
      ["~$/gal", "$" + (FL.fuel_pm * MPG).toFixed(2)], null,
      ["Driver/mi", "$" + f3(FL.drv_pm)], null,
      ["IFTA/mi", "$" + f4(FL.ifta_pm)],
      ["Insurance/mi", "$" + CalcCore.getInsurance().toFixed(4)],
      ["R&M/mi", "$" + f4(FL.rm_pm)],
      ["Tolls/mi", "$" + f4(FL.tolls_pm)],
      ["Other var./mi", "$" + f4(FL.other_pm)], null,
      ["Fixed/mi", "$" + f4(FL.fix_pm)], null,
      ["CM/mi", '<span style="color:var(--gd);font-weight:700">$' + f4(FL.cm_pm) + "</span>"],
      ["Avg miles", fmi(FL.avg_mi) + " mi"],
    ];
    const row = document.getElementById("fleet-row");
    if (!row) return;
    row.innerHTML = items.map(it => it === null
      ? '<div class="fi-sep"></div>'
      : `<div class="fi"><div class="fi-lbl">${it[0]}</div><div class="fi-val">${it[1]}</div></div>`
    ).join("");
  }

  // ── Ranking strip ──────────────────────────────────────────────────
  function rendRank() {
    const tots = calcs.map(c => ({ c, t: CalcCore.calcTotal(c) }));
    tots.sort((a, b) => CalcCore.metricVal(b.t, metric) - CalcCore.metricVal(a.t, metric));
    const maxV = Math.max(0.0001, ...tots.map(x => CalcCore.metricVal(x.t, metric)));
    const rankMap = {};
    tots.forEach((x, i) => rankMap[x.c.id] = i);

    const strip = document.getElementById("rank-strip");
    if (!strip) return rankMap;
    strip.innerHTML = tots.map(({ c, t }, rank) => {
      const col = RKCOLORS[rank % RKCOLORS.length];
      const pct = Math.max(0, CalcCore.metricVal(t, metric) / maxV * 100);
      const rkC = rank === 0 ? "rk1" : rank === 1 ? "rk2" : rank === 2 ? "rk3" : "rkn";
      const rkL = rank === 0 ? "#1 ★" : `#${rank + 1}`;
      const route = c.legs.filter(l => l.pu_state && l.del_state).map(l => `${l.pu_state}→${l.del_state}`).join(" · ") || "—";
      const win = rank === 0 && calcs.length > 1;
      const lose = rank === calcs.length - 1 && calcs.length > 2;
      const hasData = c.legs.some(l => l.pu_state && l.del_state);
      const below = hasData && t.cm_pm < 0.850;
      return `<div class="rank-card${below ? " below" : win ? " winner" : lose ? " loser" : ""}">
        <div class="rc-id" style="color:${below ? "var(--rd)" : col}">Load ${c.id}${below ? " ⚠" : ""}</div>
        <div class="rc-route">${route}</div>
        <div class="rc-main" style="color:${CalcCore.metricVal(t, metric) >= 0 ? "var(--gd)" : "var(--rd)"}">${metricFmt(t)}</div>
        <div class="rc-sub">${metricLbl()} · <span style="color:var(--nv)">$${fm(t.totalCmPt)}/load · $${fm(t.cm_per_day||0)}/day</span> · $${f4(t.cm_pm)}/mi · ${fPct(t.emptyPct)} empty</div>
        <div><span class="rc-rank ${rkC}">${rkL}</span>${below ? '<span class="threshold-line">ispod praga $0.850/mi</span>' : ""}</div>
        <div class="rc-bar-bg"><div class="rc-bar" style="width:${pct.toFixed(1)}%;background:${col}"></div></div>
      </div>`;
    }).join("");

    return rankMap;
  }

  // ── Map (state-level, kao i pre) ───────────────────────────────────
  function drawMap() {
    const svg = document.getElementById("calc-map");
    if (!svg) return;
    svg.innerHTML = "";
    const ns = "http://www.w3.org/2000/svg";

    for (let i = 0; i < 5; i++) {
      const l = document.createElementNS(ns, "line");
      l.setAttribute("x1", "0"); l.setAttribute("y1", String(60 + i * 90));
      l.setAttribute("x2", "960"); l.setAttribute("y2", String(60 + i * 90));
      l.setAttribute("stroke", "#e2e8f0"); l.setAttribute("stroke-width", "1"); svg.appendChild(l);
    }
    for (const [st, c] of Object.entries(SC)) {
      const d = document.createElementNS(ns, "circle");
      d.setAttribute("cx", c[0]); d.setAttribute("cy", c[1]); d.setAttribute("r", "2");
      d.setAttribute("fill", "#c8d8e8"); svg.appendChild(d);
      const t = document.createElementNS(ns, "text");
      t.setAttribute("x", c[0]); t.setAttribute("y", c[1] + 9);
      t.setAttribute("text-anchor", "middle"); t.setAttribute("font-size", "7");
      t.setAttribute("fill", "#aabfcc"); t.setAttribute("pointer-events", "none");
      t.setAttribute("font-family", "DM Mono,monospace"); t.textContent = st;
      svg.appendChild(t);
    }
    const defs = document.createElementNS(ns, "defs");
    const mk = document.createElementNS(ns, "marker");
    mk.setAttribute("id", "marr"); mk.setAttribute("viewBox", "0 0 10 10");
    mk.setAttribute("refX", "8"); mk.setAttribute("refY", "5");
    mk.setAttribute("markerWidth", "4"); mk.setAttribute("markerHeight", "4");
    mk.setAttribute("orient", "auto-start-reverse");
    const ap = document.createElementNS(ns, "path"); ap.setAttribute("d", "M2 1L8 5L2 9");
    ap.setAttribute("fill", "none"); ap.setAttribute("stroke", "context-stroke");
    ap.setAttribute("stroke-width", "2"); ap.setAttribute("stroke-linecap", "round");
    mk.appendChild(ap); defs.appendChild(mk); svg.appendChild(defs);

    const tots = calcs.map(c => ({ c, t: CalcCore.calcTotal(c) }));
    if (!tots.length) return;
    const maxV = Math.max(0.0001, ...tots.map(x => CalcCore.metricVal(x.t, metric)));
    const maxMi = Math.max(1, ...tots.map(x => x.t.totalMiles));

    tots.forEach((xt) => {
      const { c, t } = xt;
      const legs = c.legs.filter(l => l.pu_state && l.del_state && SC[l.pu_state] && SC[l.del_state]);
      if (!legs.length) return;
      const tv = Math.max(0, CalcCore.metricVal(t, metric) / maxV);
      const col = gradColor(tv);
      const sw = 1 + (t.totalMiles / maxMi) * 5;
      const isHL = hlMap === c.id;
      const op = hlMap != null ? (isHL ? 1 : 0.07) : 0.5 + 0.4 * tv;

      legs.forEach((l, li) => {
        const s = SC[l.pu_state], d = SC[l.del_state];
        if (!s || !d) return;
        const cx = (s[0] + d[0]) / 2 + (s[1] - d[1]) * 0.15;
        const cy = (s[1] + d[1]) / 2 + (d[0] - s[0]) * 0.15;
        const tt = 0.86;
        const ex = (1 - tt) ** 2 * s[0] + 2 * (1 - tt) * tt * cx + tt ** 2 * d[0];
        const ey = (1 - tt) ** 2 * s[1] + 2 * (1 - tt) * tt * cy + tt ** 2 * d[1];

        const path = document.createElementNS(ns, "path");
        path.setAttribute("d", `M${s[0]},${s[1]} Q${cx},${cy} ${ex},${ey}`);
        path.setAttribute("fill", "none"); path.setAttribute("stroke", col);
        path.setAttribute("stroke-width", isHL ? sw * 1.6 : sw);
        path.setAttribute("opacity", op);
        if (li === legs.length - 1) path.setAttribute("marker-end", "url(#marr)");
        path.setAttribute("stroke-linecap", "round"); path.setAttribute("pointer-events", "none");
        svg.appendChild(path);

        const hit = document.createElementNS(ns, "path");
        hit.setAttribute("d", `M${s[0]},${s[1]} Q${cx},${cy} ${ex},${ey}`);
        hit.setAttribute("fill", "none"); hit.setAttribute("stroke", "transparent");
        hit.setAttribute("stroke-width", Math.max(sw * 2, 14)); hit.style.cursor = "pointer";
        hit.addEventListener("mouseenter", e => {
          hlMap = c.id;
          const route = c.legs.filter(x => x.pu_state && x.del_state).map(x => `${x.pu_state}→${x.del_state}`).join(" · ");
          ttS(e.clientX, e.clientY, [
            ["CM/mi", "$" + f4(t.cm_pm)],
            ["CM/load", "$" + fm(t.totalCmPt)],
            ["CM/day", "$" + fm(t.cm_per_day || 0)],
            ["CM%", fPct(t.cm_pct)],
            ["Loaded mi", fmi(t.loadedMiles)],
            ["Empty mi", fmi(t.emptyMiles) + " (" + fPct(t.emptyPct) + ")"],
            ["Legova", String(c.legs.length)],
          ], `Load ${c.id}: ${route || "—"}`);
          drawMap();
        });
        hit.addEventListener("mouseleave", () => { hlMap = null; ttH(); drawMap(); });
        svg.appendChild(hit);
      });

      const seen = new Set();
      legs.forEach((l, li) => {
        [[l.pu_state, li === 0], [l.del_state, li === legs.length - 1]].forEach(([st, isEnd]) => {
          if (!SC[st] || seen.has(st)) return; seen.add(st);
          const pos = SC[st]; const r2 = isEnd ? 8 : 5;
          const ci = document.createElementNS(ns, "circle");
          ci.setAttribute("cx", pos[0]); ci.setAttribute("cy", pos[1]); ci.setAttribute("r", r2);
          ci.setAttribute("fill", col); ci.setAttribute("stroke", "#fff"); ci.setAttribute("stroke-width", "1.5");
          ci.setAttribute("opacity", isHL ? "1" : String(Math.min(1, op + 0.3))); svg.appendChild(ci);
          const tx = document.createElementNS(ns, "text");
          tx.setAttribute("x", pos[0]); tx.setAttribute("y", pos[1]);
          tx.setAttribute("text-anchor", "middle"); tx.setAttribute("dominant-baseline", "central");
          tx.setAttribute("font-family", "DM Mono,monospace"); tx.setAttribute("font-size", "7.5");
          tx.setAttribute("font-weight", "700"); tx.setAttribute("fill", "#fff");
          tx.setAttribute("pointer-events", "none"); tx.textContent = st;
          svg.appendChild(tx);
        });
      });
    });
  }

  // ── expose internals to next file (calc-ui-2.js) ──────────────────
  const _state = { idCtr: 0, metric: "cm_day", hlMap: null, activeAutocomplete: null };
  global._CalcUI_internals = {
    state: _state,
    setIdCtr(v) { idCtr = v; _state.idCtr = v; },
    setMetric(v) { metric = v; _state.metric = v; },
    setActiveAutocomplete(v) { activeAutocomplete = v; _state.activeAutocomplete = v; },
    getActiveAutocomplete() { return activeAutocomplete; },
    getCalcs() { return calcs; },
    setCalcs(v) { calcs = v; },
    helpers: { fm, f3, f4, fmi, fPct, na, gradColor, metricFmt, metricLbl, showToast },
    tooltip: { initTooltip, ttS, ttH, ttP },
    renderers: { rendFleet, rendRank, drawMap },
    RKCOLORS, SC,
  };

})(typeof window !== "undefined" ? window : globalThis);
