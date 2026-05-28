/* calc-ui-card.js — Render kalkulacije, ZIP autocomplete, slajderi, Gross/RPM */
(function (global) {
  "use strict";

  const I = global._CalcUI_internals;
  if (!I) { console.error("calc-ui-card.js requires calc-ui.js loaded first"); return; }

  const fm = I.helpers.fm, f3 = I.helpers.f3, f4 = I.helpers.f4;
  const fmi = I.helpers.fmi, fPct = I.helpers.fPct, showToast = I.helpers.showToast;

  function zipInput(cId, lId, side, value) {
    const sug = document.getElementById("zip-sug-" + cId + "-" + lId + "-" + side);
    if (!sug) return;
    const v = String(value || "").trim();
    if (v.length < 2) { sug.classList.remove("show"); sug.innerHTML = ""; return; }
    const results = ZipDistance.search(v, 8);
    if (!results.length) { sug.classList.remove("show"); sug.innerHTML = ""; return; }
    sug.innerHTML = results.map(function (r, i) {
      const cityEsc = r.city.replace(/'/g, "&#39;");
      return '<div class="zip-sug-item' + (i === 0 ? " kbsel" : "") + '"' +
        " onclick=\"CalcUI.selectZip(" + cId + "," + lId + ",'" + side + "','" + r.zip + "','" + cityEsc + "','" + r.state + "')\">" +
        '<span class="zip-sug-zip">' + r.zip + '</span>' +
        '<span class="zip-sug-city">' + r.city + '</span>' +
        '<span class="zip-sug-st">' + r.state + '</span>' +
        '</div>';
    }).join("");
    sug.classList.add("show");
    I.setActiveAutocomplete({ cId: cId, lId: lId, side: side });
  }

  function selectZip(cId, lId, side, zip, city, state) {
    const c = I.getCalcs().find(function (x) { return x.id === cId; }); if (!c) return;
    const l = c.legs.find(function (x) { return x.id === lId; }); if (!l) return;
    if (side === "pu") {
      l.pu_zip = zip; l.pu_city = city; l.pu_state = state;
    } else {
      l.del_zip = zip; l.del_city = city; l.del_state = state;
      const idx = c.legs.indexOf(l);
      if (idx < c.legs.length - 1) {
        c.legs[idx + 1].pu_zip = zip;
        c.legs[idx + 1].pu_city = city;
        c.legs[idx + 1].pu_state = state;
      }
    }
    if (l.pu_zip && l.del_zip) {
      const dist = ZipDistance.miles(l.pu_zip, l.del_zip);
      CalcCore.fillLegFromHist(l, dist);
    }
    closeAutocomplete();
    render();
  }

  function closeAutocomplete() {
    const a = I.getActiveAutocomplete();
    if (!a) return;
    const sug = document.getElementById("zip-sug-" + a.cId + "-" + a.lId + "-" + a.side);
    if (sug) { sug.classList.remove("show"); sug.innerHTML = ""; }
    I.setActiveAutocomplete(null);
  }

  document.addEventListener("click", function (e) {
    if (e.target.closest(".zip-input-wrap")) return;
    closeAutocomplete();
  });

  function zipKey(cId, lId, side, e) {
    const sug = document.getElementById("zip-sug-" + cId + "-" + lId + "-" + side);
    if (!sug || !sug.classList.contains("show")) return;
    const items = Array.from(sug.querySelectorAll(".zip-sug-item"));
    if (!items.length) return;
    let idx = items.findIndex(function (x) { return x.classList.contains("kbsel"); });
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (idx < items.length - 1) idx++;
      items.forEach(function (x) { x.classList.remove("kbsel"); });
      items[idx].classList.add("kbsel"); items[idx].scrollIntoView({ block: "nearest" });
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (idx > 0) idx--;
      items.forEach(function (x) { x.classList.remove("kbsel"); });
      items[idx].classList.add("kbsel"); items[idx].scrollIntoView({ block: "nearest" });
    } else if (e.key === "Enter") {
      e.preventDefault();
      items[idx >= 0 ? idx : 0].click();
    } else if (e.key === "Escape") {
      closeAutocomplete();
    }
  }

  function onLegMiles(cId, lId, kind, val) {
    const c = I.getCalcs().find(function (x) { return x.id === cId; }); if (!c) return;
    const l = c.legs.find(function (x) { return x.id === lId; }); if (!l) return;
    const n = Math.max(0, parseFloat(val) || 0);
    if (kind === "loaded") l.miles_loaded = n;
    else if (kind === "empty") l.miles_empty = n;
    CalcCore.syncOnMilesChange(l);
    render();
  }
  function onLegRpm(cId, lId, val) {
    const c = I.getCalcs().find(function (x) { return x.id === cId; }); if (!c) return;
    const l = c.legs.find(function (x) { return x.id === lId; }); if (!l) return;
    l.rpm = parseFloat(val) || 0;
    CalcCore.syncFromRpm(l);
    render();
  }
  function onLegGross(cId, lId, val) {
    const c = I.getCalcs().find(function (x) { return x.id === cId; }); if (!c) return;
    const l = c.legs.find(function (x) { return x.id === lId; }); if (!l) return;
    l.gross = parseFloat(val) || 0;
    CalcCore.syncFromGross(l);
    render();
  }
  function onLegField(cId, lId, field, val) {
    const c = I.getCalcs().find(function (x) { return x.id === cId; }); if (!c) return;
    const l = c.legs.find(function (x) { return x.id === lId; }); if (!l) return;
    l[field] = parseFloat(val) || 0;
    render();
  }
  function onLegGal(cId, lId, val) {
    const c = I.getCalcs().find(function (x) { return x.id === cId; }); if (!c) return;
    const l = c.legs.find(function (x) { return x.id === lId; }); if (!l) return;
    const gal = parseFloat(val) || 0;
    l.fuel = gal / l.mpg;
    render();
  }
  function onLegMpg(cId, lId, val) {
    const c = I.getCalcs().find(function (x) { return x.id === cId; }); if (!c) return;
    const l = c.legs.find(function (x) { return x.id === lId; }); if (!l) return;
    l.mpg = parseFloat(val) || CalcCore.getMPG();
    const galEl = document.getElementById("ni-gal-" + cId + "-" + lId);
    if (galEl) l.fuel = (parseFloat(galEl.value) || 0) / l.mpg;
    render();
  }

  function renderFuelRec(cId, l) {
    if (!global.FuelRecommender || !FuelRecommender.getLatestDate()) return "";
    if (!l.pu_zip || !l.del_zip) return "";
    const rec = FuelRecommender.recommendForLeg(l.pu_zip, l.del_zip, { topN: 3, mpg: l.mpg });
    const snap = FuelRecommender.getLatestDate();
    if (!rec || !rec.stations || !rec.stations.length) {
      return '<div class="fuel-rec"><div class="fuel-rec-hdr">' +
        '<span class="fuel-rec-title">Pilot fuel stops in corridor</span>' +
        '<span class="fuel-rec-meta">' + snap + '</span></div>' +
        '<div class="fuel-rec-empty">No Pilot stations within &plusmn;50mi of route.</div></div>';
    }
    const items = rec.stations.map(function (s, i) {
      return '<div class="fuel-rec-item' + (i === 0 ? " best" : "") + '">' +
        '<span class="fuel-rec-site">#' + s.site + '</span>' +
        '<span class="fuel-rec-loc">' + (s.city || "-") + ', ' + (s.state || "-") + '</span>' +
        '<span class="fuel-rec-price">$' + s.your_price.toFixed(4) + '</span>' +
        '<span class="fuel-rec-detail">' + s.detour_mi + 'mi &middot; ' + s.position_pct + '%</span>' +
        '</div>';
    }).join("");
    const avgTxt = (rec.top3AvgPrice != null) ? '$' + rec.top3AvgPrice.toFixed(4) + '/gal' : "n/a";
    return '<div class="fuel-rec"><div class="fuel-rec-hdr">' +
      '<span class="fuel-rec-title">Pilot fuel stops in corridor (' + rec.total_in_corridor + ')</span>' +
      '<span class="fuel-rec-meta">Snapshot: ' + snap + ' &middot; avg of top 3 applied: ' + avgTxt + '</span></div>' +
      '<div class="fuel-rec-list">' + items + '</div></div>';
  }

  function applyFuelRec(cId, lId, pricePerGal) {
    const c = I.getCalcs().find(function (x) { return x.id === cId; }); if (!c) return;
    const l = c.legs.find(function (x) { return x.id === lId; }); if (!l) return;
    l.fuel = pricePerGal / l.mpg;
    showToast("Fuel set to: $" + pricePerGal.toFixed(4) + "/gal → $" + l.fuel.toFixed(4) + "/mi", "success");
    render();
  }

  function renderLaneRec(c) {
    if (!global.LaneRecommender) return "";
    const lastLeg = c.legs[c.legs.length - 1];
    if (!lastLeg || !lastLeg.del_state) return "";
    const lanesWrap = global._lanesWrap;
    if (!lanesWrap) return "";
    const period = global._currentPeriod || "90";
    const lanesObj = lanesWrap.lanes[period];
    const fleet = lanesWrap.fleet[period];
    if (!lanesObj) return "";
    const sortBy = I.state.metric || "cm_pt";  // sortira po izabranoj metrici (CM/turi default)
    const recs = LaneRecommender.recommendNext(lastLeg.del_state, {
      lanesObj: lanesObj, fleet: fleet, topN: 3, minTrips: 3, sortBy: sortBy,
    });
    const metricLbl = sortBy === "cm_pt" ? "CM/turi" : sortBy === "cm_pct" ? "CM%" : "CM/mi";
    if (!recs.length) {
      return '<div class="lane-rec"><div class="lane-rec-hdr">' +
        '<span class="lane-rec-title">Top 3 next legs from ' + lastLeg.del_state + '</span>' +
        '<span class="lane-rec-meta">period ' + period + ' · sort: ' + metricLbl + '</span></div>' +
        '<div class="lane-rec-empty">Not enough history for ' + lastLeg.del_state + ' in selected period.</div></div>';
    }
    const items = recs.map(function (r, i) {
      // Glavna brojka (po sortBy), sekundarna ispod
      let primary, secondary;
      if (sortBy === "cm_pt") {
        primary = '$' + Math.round(r.expected_cm).toLocaleString() + '/load';
        secondary = '$' + r.cm_pm_adj.toFixed(3) + '/mi · ' + (r.cm_pct * 100).toFixed(1) + '%';
      } else if (sortBy === "cm_pct") {
        primary = (r.cm_pct * 100).toFixed(2) + '%';
        secondary = '$' + r.cm_pm_adj.toFixed(3) + '/mi · $' + Math.round(r.expected_cm).toLocaleString() + '/load';
      } else {
        primary = '$' + r.cm_pm_adj.toFixed(4) + '/mi';
        secondary = '$' + Math.round(r.expected_cm).toLocaleString() + '/load · ' + (r.cm_pct * 100).toFixed(1) + '%';
      }
      return '<div class="lane-rec-item' + (i === 0 ? " best" : "") + '">' +
        '<span class="lane-rec-pair">' + r.pu + ' &rarr; ' + r.del + '</span>' +
        '<span class="lane-rec-metrics">' +
        '<span class="top">' + primary + '</span>' +
        '<span class="bot">' + secondary + '</span>' +
        '<span class="bot" style="color:var(--mu2)">RPM $' + r.rpm.toFixed(3) + ' · avg ' + Math.round(r.avg_mi) + ' mi</span>' +
        '</span>' +
        '<span class="lane-rec-trips">' + r.n_trips + ' trips</span>' +
        '<button class="lane-rec-add-btn" onclick="CalcUI.addLegFromRec(' + c.id + ",'" + r.del + "'" + ')">+ Add</button>' +
        '</div>';
    }).join("");
    return '<div class="lane-rec"><div class="lane-rec-hdr">' +
      '<span class="lane-rec-title">Top 3 next legs from ' + lastLeg.del_state + '</span>' +
      '<span class="lane-rec-meta">period ' + period + ' · sort: ' + metricLbl + '</span></div>' +
      '<div class="lane-rec-list">' + items + '</div></div>';
  }

  function addLegFromRec(cId, delState) {
    const c = I.getCalcs().find(function (x) { return x.id === cId; }); if (!c) return;
    const last = c.legs[c.legs.length - 1];
    const newLeg = CalcCore.newLeg(cId, c.legs.length, last.del_zip, last.del_city, last.del_state);
    newLeg.del_state = delState;
    newLeg.del_city = "";
    newLeg.del_zip = "";
    CalcCore.fillLegFromHist(newLeg);
    c.legs.push(newLeg);
    showToast("Added leg: " + last.del_state + " → " + delState, "success");
    render();
  }

  function rendCard(c, rankMap) {
    const tot = CalcCore.calcTotal(c);
    const rank = rankMap[c.id] || 0;
    const col = I.RKCOLORS[rank % I.RKCOLORS.length];
    const win = rank === 0 && I.getCalcs().length > 1;
    const lose = rank === I.getCalcs().length - 1 && I.getCalcs().length > 2;

    const legBlocks = c.legs.map(function (l, li) {
      const lr = tot.legR[li].r;
      const h = lr.h;
      const hasH = h != null;
      const galVal = (l.fuel * l.mpg).toFixed(2);
      const cmColor = lr.cm_pm >= 0 ? "var(--gd)" : "var(--rd)";
      const dCmPm = lr.cm_pm_hist != null ? lr.cm_pm - lr.cm_pm_hist : null;
      const dCls = dCmPm == null ? "" : dCmPm > 0.0005 ? "dp" : dCmPm < -0.0005 ? "dn" : "dz";
      const legBelow = (l.pu_state && l.del_state) && lr.cm_pm < 0.850;

      const puDisplay = l.pu_zip
        ? '<div class="zip-display"><div class="zip-display-zip">' + l.pu_zip + ' <span style="color:var(--tld)">' + l.pu_state + '</span></div><div class="zip-display-city">' + l.pu_city + '</div></div>'
        : "";
      const delDisplay = l.del_zip
        ? '<div class="zip-display"><div class="zip-display-zip">' + l.del_zip + ' <span style="color:var(--tld)">' + l.del_state + '</span></div><div class="zip-display-city">' + l.del_city + '</div></div>'
        : "";
      const zipDist = (l.pu_zip && l.del_zip) ? ZipDistance.miles(l.pu_zip, l.del_zip) : null;
      const zipDistHint = zipDist != null ? (fmi(zipDist) + " mi (ZIP)") : "-";
      const activeRpm = (l.last_edited || "rpm") === "rpm";
      const activeGross = !activeRpm;

      const puInput = puDisplay || ('<input class="zip-input" id="zip-inp-' + c.id + '-' + l.id + '-pu" placeholder="PU ZIP / city / ST"' +
        ' oninput="CalcUI.zipInput(' + c.id + ',' + l.id + ",'pu',this.value)\"" +
        ' onkeydown="CalcUI.zipKey(' + c.id + ',' + l.id + ",'pu',event)\"" +
        ' onfocus="CalcUI.zipInput(' + c.id + ',' + l.id + ",'pu',this.value)\">");
      const delInput = delDisplay || ('<input class="zip-input" id="zip-inp-' + c.id + '-' + l.id + '-del" placeholder="DEL ZIP / city / ST"' +
        ' oninput="CalcUI.zipInput(' + c.id + ',' + l.id + ",'del',this.value)\"" +
        ' onkeydown="CalcUI.zipKey(' + c.id + ',' + l.id + ",'del',event)\"" +
        ' onfocus="CalcUI.zipInput(' + c.id + ',' + l.id + ",'del',this.value)\">");
      const puClear = puDisplay ? '<button class="leg-remove" style="position:absolute;top:0;right:0;padding:2px 6px" onclick="CalcUI.clearZip(' + c.id + ',' + l.id + ",'pu')\" title=\"Promeni\">&#8635;</button>" : "";
      const delClear = delDisplay ? '<button class="leg-remove" style="position:absolute;top:0;right:0;padding:2px 6px" onclick="CalcUI.clearZip(' + c.id + ',' + l.id + ",'del')\" title=\"Promeni\">&#8635;</button>" : "";

      const histBadge = hasH
        ? '<span class="leg-hist-badge">' + l.pu_state + '&rarr;' + l.del_state + ': &#10003;</span>'
        : '<span class="leg-no-hist">enter ZIP codes</span>';
      const remBtn = c.legs.length > 1 ? '<button class="leg-remove" onclick="CalcUI.removeLeg(' + c.id + ',' + l.id + ')">&times;</button>' : "";

      const legBelowDot = legBelow ? '<span class="leg-below-dot"></span>' : "";

      return '<div class="leg-block' + (legBelow ? " leg-below" : "") + '">' +
        '<div class="leg-block-hdr">' +
        '<span class="leg-num">Leg ' + (li + 1) + legBelowDot + '</span>' +
        '<div style="display:flex;align-items:center;gap:6px">' + histBadge + remBtn + '</div>' +
        '</div>' +

        '<div class="leg-route">' +
        '<div class="zip-input-wrap">' + puInput + '<div class="zip-suggestions" id="zip-sug-' + c.id + '-' + l.id + '-pu"></div>' + puClear + '</div>' +
        '<span class="leg-arr">&rarr;</span>' +
        '<div class="zip-input-wrap">' + delInput + '<div class="zip-suggestions" id="zip-sug-' + c.id + '-' + l.id + '-del"></div>' + delClear + '</div>' +
        '</div>' +

        '<div class="leg-inputs">' +
        // MILES SPLIT
        '<div class="li-field">' +
        '<div class="li-label">Miles · Loaded / Empty / Total</div>' +
        '<div class="miles-split">' +
        '<div class="miles-split-row">' +
        '<span class="ms-lbl">Load</span>' +
        '<input type="range" class="ms-range" min="0" max="3000" step="5" value="' + Math.min(l.miles_loaded, 3000) + '"' +
        ' oninput="CalcUI.onLegMiles(' + c.id + ',' + l.id + ",'loaded',this.value);document.getElementById('mi-load-" + c.id + '-' + l.id + "').value=Math.round(this.value)\">" +
        '<input type="number" class="ms-num" id="mi-load-' + c.id + '-' + l.id + '" value="' + Math.round(l.miles_loaded) + '" step="5"' +
        ' onchange="CalcUI.onLegMiles(' + c.id + ',' + l.id + ",'loaded',this.value)\">" +
        '<span class="ms-zip-hint">' + zipDistHint + '</span>' +
        '</div>' +
        '<div class="miles-split-row">' +
        '<span class="ms-lbl">Empty</span>' +
        '<input type="range" class="ms-range empty" min="0" max="1000" step="5" value="' + Math.min(l.miles_empty, 1000) + '"' +
        ' oninput="CalcUI.onLegMiles(' + c.id + ',' + l.id + ",'empty',this.value);document.getElementById('mi-emp-" + c.id + '-' + l.id + "').value=Math.round(this.value)\">" +
        '<input type="number" class="ms-num" id="mi-emp-' + c.id + '-' + l.id + '" value="' + Math.round(l.miles_empty) + '" step="5"' +
        ' onchange="CalcUI.onLegMiles(' + c.id + ',' + l.id + ",'empty',this.value)\">" +
        '</div>' +
        '<div class="miles-split-row total">' +
        '<span class="ms-lbl total">Total</span>' +
        '<div style="flex:1;font-size:9px;color:var(--mu2);text-align:left;padding-left:4px">read-only · loaded + empty</div>' +
        '<input type="number" class="ms-num readonly" value="' + Math.round(lr.miles_total) + '" readonly>' +
        '</div>' +
        '</div></div>' +

        // RPM + GROSS
        '<div class="li-field">' +
        '<div class="li-label">Revenue <span style="color:var(--mu2);font-weight:400">(RPM × total = Gross)</span></div>' +
        '<div class="rpm-gross">' +
        '<div class="rg-cell' + (activeRpm ? " active" : "") + '">' +
        '<div class="rg-lbl">RPM <span class="active-dot"></span><span>$/total mi</span></div>' +
        '<input type="number" class="rg-input" value="' + (+l.rpm).toFixed(3) + '" step="0.01"' +
        ' onchange="CalcUI.onLegRpm(' + c.id + ',' + l.id + ',this.value)">' +
        '</div>' +
        '<div class="rg-cell' + (activeGross ? " active" : "") + '">' +
        '<div class="rg-lbl">Gross <span class="active-dot"></span><span>$ ukupno</span></div>' +
        '<input type="number" class="rg-input" value="' + (+l.gross).toFixed(0) + '" step="10"' +
        ' onchange="CalcUI.onLegGross(' + c.id + ',' + l.id + ',this.value)">' +
        '</div>' +
        '</div>' +
        '<input type="range" min="1" max="5" step="0.01" value="' + l.rpm + '" style="width:100%;margin-top:6px"' +
        ' oninput="CalcUI.onLegRpm(' + c.id + ',' + l.id + ',this.value)">' +
        '<div class="li-hist" style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap">' +
        '<span>Per loaded: <b style="color:var(--tld)">' + (lr.rpmLoaded != null ? '$' + lr.rpmLoaded.toFixed(3) : 'n/a') + '</b></span>' +
        '<span>Hist RPM: <b>' + (hasH ? '$' + f3(h.rpm) : 'n/a') + '</b></span>' +
        '</div>' +
        '</div>' +

        // GORIVO
        '<div class="li-field">' +
        '<div class="li-label">Fuel $/gal</div>' +
        '<div class="li-row">' +
        '<input type="range" min="2" max="7" step="0.05" value="' + galVal + '"' +
        ' oninput="CalcUI.onLegGal(' + c.id + ',' + l.id + ",this.value);document.getElementById('ni-gal-" + c.id + '-' + l.id + "').value=parseFloat(this.value).toFixed(2)\">" +
        '<input type="number" class="ni" id="ni-gal-' + c.id + '-' + l.id + '" value="' + galVal + '" step="0.05"' +
        ' onchange="CalcUI.onLegGal(' + c.id + ',' + l.id + ',this.value)">' +
        '</div>' +
        '<div class="fuel-sub">' +
        '&rarr; <b style="font-family:DM Mono,monospace;color:var(--tld)">$' + l.fuel.toFixed(4) + '/mi</b>' +
        '&nbsp;MPG:<input type="number" value="' + l.mpg.toFixed(1) + '" step="0.1" min="3" max="15"' +
        ' onchange="CalcUI.onLegMpg(' + c.id + ',' + l.id + ',this.value)">' +
        '<span style="color:var(--mu2)">Hist: <b style="color:var(--tld)">' + (hasH ? '$' + f4(h.fuel_pm) : ' n/a') + '</b></span>' +
        '</div></div>' +

        // VOZAC
        '<div class="li-field">' +
        '<div class="li-label">Driver $/mi</div>' +
        '<div class="li-row">' +
        '<input type="range" min="0.10" max="2.00" step="0.01" value="' + l.dpm + '"' +
        ' oninput="CalcUI.onLegField(' + c.id + ',' + l.id + ",'dpm',this.value);document.getElementById('ni-dpm-" + c.id + '-' + l.id + "').value=parseFloat(this.value).toFixed(3)\">" +
        '<input type="number" class="ni" id="ni-dpm-' + c.id + '-' + l.id + '" value="' + (+l.dpm).toFixed(3) + '" step="0.01"' +
        ' onchange="CalcUI.onLegField(' + c.id + ',' + l.id + ",'dpm',this.value)\">" +
        '</div>' +
        '<div class="li-hist">Hist: <b>' + (hasH ? '$' + f3(h.drv_pm) : 'n/a') + '</b></div>' +
        '</div>' +

        // PUTARINE
        '<div class="li-field">' +
        '<div class="li-label">Tolls $/mi</div>' +
        '<div class="li-row">' +
        '<input type="range" min="0" max="0.50" step="0.001" value="' + l.tolls + '"' +
        ' oninput="CalcUI.onLegField(' + c.id + ',' + l.id + ",'tolls',this.value);document.getElementById('ni-tolls-" + c.id + '-' + l.id + "').value=parseFloat(this.value).toFixed(4)\">" +
        '<input type="number" class="ni" id="ni-tolls-' + c.id + '-' + l.id + '" value="' + (+l.tolls).toFixed(4) + '" step="0.001"' +
        ' onchange="CalcUI.onLegField(' + c.id + ',' + l.id + ",'tolls',this.value)\">" +
        '</div>' +
        '<div class="li-hist">Hist: <b>' + (hasH ? '$' + f4(h.tolls_pm) : 'n/a') + '</b></div>' +
        '</div>' +
        '</div>' +  // /leg-inputs

        renderFuelRec(c.id, l) +

        // LEG RESULT
        '<div class="leg-result">' +
        '<div class="lr-box"><div class="lr-lbl">CM/mi</div><div class="lr-val" style="color:' + cmColor + '">$' + f4(lr.cm_pm) + '</div></div>' +
        '<div class="lr-box"><div class="lr-lbl">CM/turi</div><div class="lr-val" style="color:' + cmColor + '">$' + fm(lr.cm_pt) + '</div><div class="lr-fix">' + fmi(lr.miles_total) + ' mi</div></div>' +
        '<div class="lr-box"><div class="lr-lbl">CM%</div><div class="lr-val" style="color:' + cmColor + '">' + fPct(lr.cm_pct) + '</div>' +
        (dCmPm != null
          ? '<div class="lr-fix ' + dCls + '">' + (dCmPm >= 0 ? '+' : '') + '$' + f4(dCmPm) + ' vs hist.</div>'
          : '<div class="lr-fix">&nbsp;</div>') +
        '</div>' +
        '</div>' +
        '</div>';  // /leg-block
    }).join("");

    const dCmPt = tot.cm_pt_hist != null ? tot.totalCmPt - tot.cm_pt_hist : null;
    const dCmPm = tot.cm_pm_hist != null ? tot.cm_pm - tot.cm_pm_hist : null;
    const dCls2 = function (v) { return v == null ? "td-eq" : v > 0.0005 ? "td-up" : v < -0.0005 ? "td-dn" : "td-eq"; };
    const hasData = c.legs.some(function (l) { return l.pu_state && l.del_state; });
    const below = hasData && tot.cm_pm < 0.850;

    const totalsHtml = '<div class="totals-block">' +
      '<div class="totals-title">Total (loaded + empty)</div>' +
      '<div class="totals-grid">' +
      '<div class="tbox highlight">' +
      '<div class="tbox-lbl">CM / mile</div>' +
      '<div class="tbox-val">$' + f4(tot.cm_pm) + '</div>' +
      '<div class="tbox-sub" style="color:rgba(255,255,255,.4)">Hist: ' + (tot.cm_pm_hist != null ? '$' + f4(tot.cm_pm_hist) : 'n/a') + '</div>' +
      (dCmPm != null ? '<div class="tbox-delta ' + dCls2(dCmPm) + '">' + (dCmPm >= 0 ? '+' : '') + '$' + f4(dCmPm) + '</div>' : '') +
      '</div>' +
      '<div class="tbox highlight">' +
      '<div class="tbox-lbl">CM / load</div>' +
      '<div class="tbox-val">$' + fm(tot.totalCmPt) + '</div>' +
      '<div class="tbox-sub" style="color:rgba(255,255,255,.4)">Hist: ' + (tot.cm_pt_hist != null ? '$' + fm(tot.cm_pt_hist) : 'n/a') + '</div>' +
      (dCmPt != null ? '<div class="tbox-delta ' + dCls2(dCmPt) + '">' + (dCmPt >= 0 ? '+' : '') + '$' + fm(dCmPt) + '</div>' : '') +
      '</div>' +
      '<div class="tbox highlight">' +
      '<div class="tbox-lbl">CM / day</div>' +
      '<div class="tbox-val">$' + fm(tot.cm_per_day || 0) + '</div>' +
      '<div class="tbox-sub" style="color:rgba(255,255,255,.4)">@ ' + (tot.milesPerDay || 400) + ' mi/day</div>' +
      '</div>' +
      '<div class="tbox">' +
      '<div class="tbox-lbl">Gross / load</div>' +
      '<div class="tbox-val">$' + fm(tot.totalRevenue) + '</div>' +
      '<div class="tbox-sub" style="color:rgba(255,255,255,.4)">eff RPM: $' + f4(tot.effRpm) + '</div>' +
      '</div>' +
      '<div class="tbox">' +
      '<div class="tbox-lbl">Total miles</div>' +
      '<div class="tbox-val">' + fmi(tot.totalMiles) + '</div>' +
      '<div class="tbox-sub" style="color:rgba(255,255,255,.4)">' + fmi(tot.emptyMiles) + ' empty &middot; ' + fPct(tot.emptyPct) + '</div>' +
      '</div>' +
      '</div></div>';

    const belowBadge = below ? '<span style="font-size:10px;color:#c07070;font-family:DM Mono,monospace;opacity:.9">CM/mi &lt; $0.85</span>' : '';
    const closeBtn = I.getCalcs().length > 1 ? '<button class="cc-close" onclick="CalcUI.removeCalc(' + c.id + ')">&times;</button>' : '';

    // Dispatcher comment textarea (per-load)
    const commentVal = (c.comment || "").replace(/"/g, "&quot;");
    const commentBlock = '<div class="comment-block">' +
      '<div class="comment-label">Dispatcher comment <span style="color:var(--mu2);font-weight:400">(included in print)</span></div>' +
      '<textarea class="comment-input" placeholder="Notes about this load (broker, instructions, delays, customer info...)"' +
      ' oninput="CalcUI.onCommentChange(' + c.id + ',this.value)">' + commentVal + '</textarea>' +
      '</div>';

    // Dispatcher selected radio (only one load can be selected as "to dispatch")
    const isSelected = !!c.selected;
    const selectedRadio = '<label class="dispatch-radio" title="Mark this load as the one to dispatch (appears in print)">' +
      '<input type="radio" name="dispatch-selected" ' + (isSelected ? 'checked' : '') +
      ' onchange="CalcUI.onSelectedToggle(' + c.id + ')">' +
      '<span class="dispatch-radio-lbl">' + (isSelected ? '&#10003; Dispatched' : 'Mark as dispatched') + '</span>' +
      '</label>';

    return '<div class="calc-card' + (below ? ' below' : win ? ' winner' : lose ? ' loser' : '') + (isSelected ? ' selected' : '') + '" id="cc-' + c.id + '" data-id="' + c.id + '">' +
      '<div class="cc-hdr">' +
      '<span class="cc-title" style="color:' + col + '">Load ' + c.id + '</span>' +
      '<div style="display:flex;align-items:center;gap:8px">' + selectedRadio + belowBadge + closeBtn + '</div>' +
      '</div>' +
      '<div class="cc-body">' +
      legBlocks +
      '<button class="add-leg-btn" onclick="CalcUI.addLeg(' + c.id + ')">+ Add leg</button>' +
      totalsHtml +
      commentBlock +
      renderLaneRec(c) +
      '<button class="reset-btn" onclick="CalcUI.resetCalc(' + c.id + ')">&#8634; Reset to history</button>' +
      '</div></div>';
  }

  // Actions
  function addCalc() {
    I.state.idCtr = (I.state.idCtr || 0) + 1;
    I.setIdCtr(I.state.idCtr);
    const id = I.state.idCtr;
    I.getCalcs().push({ id: id, legs: [CalcCore.newLeg(id, 0)], comment: "", selected: false });
    render();
  }

  function onCommentChange(cId, val) {
    const c = I.getCalcs().find(function (x) { return x.id === cId; }); if (!c) return;
    c.comment = String(val || "");
    // Update trace count without full render (preserves focus on textarea)
    const tc = document.getElementById("trace-count");
    if (tc && global.PrintTrace) tc.innerHTML = "Trace: <b>" + PrintTrace.getCount() + "</b>";
  }

  function onSelectedToggle(cId) {
    // Radio behavior: only one load selected at a time.
    // Clicking the same load again deselects (toggle off).
    const arr = I.getCalcs();
    const target = arr.find(function (x) { return x.id === cId; });
    if (!target) return;
    const wasSelected = !!target.selected;
    arr.forEach(function (c) { c.selected = false; });
    if (!wasSelected) target.selected = true;
    render();
  }
  function removeCalc(id) {
    const arr = I.getCalcs();
    if (arr.length <= 1) return;
    I.setCalcs(arr.filter(function (c) { return c.id !== id; }));
    render();
  }
  function addLeg(cId) {
    const c = I.getCalcs().find(function (x) { return x.id === cId; }); if (!c) return;
    const prev = c.legs[c.legs.length - 1];
    c.legs.push(CalcCore.newLeg(cId, c.legs.length, prev.del_zip, prev.del_city, prev.del_state));
    render();
  }
  function removeLeg(cId, lId) {
    const c = I.getCalcs().find(function (x) { return x.id === cId; }); if (!c || c.legs.length <= 1) return;
    c.legs = c.legs.filter(function (l) { return l.id !== lId; });
    render();
  }
  function clearZip(cId, lId, side) {
    const c = I.getCalcs().find(function (x) { return x.id === cId; }); if (!c) return;
    const l = c.legs.find(function (x) { return x.id === lId; }); if (!l) return;
    if (side === "pu") { l.pu_zip = ""; l.pu_city = ""; l.pu_state = ""; }
    else { l.del_zip = ""; l.del_city = ""; l.del_state = ""; }
    render();
  }
  function resetCalc(cId) {
    const c = I.getCalcs().find(function (x) { return x.id === cId; }); if (!c) return;
    c.legs.forEach(function (l) {
      CalcCore.resetLeg(l);
      if (l.pu_zip && l.del_zip) {
        const d = ZipDistance.miles(l.pu_zip, l.del_zip);
        if (d != null) { l.miles_loaded = +d.toFixed(0); CalcCore.syncFromRpm(l); }
      }
    });
    render();
  }
  function setMetric(m) {
    I.setMetric(m);
    I.state.metric = m;
    ["cm_pm", "cm_pt", "cm_pct", "cm_day"].forEach(function (k) {
      const btn = document.getElementById("rb-" + k);
      if (btn) btn.className = k === m ? "on" : "";
    });
    render();
  }

  function render() {
    I.renderers.rendFleet();
    const rankMap = I.renderers.rendRank();
    I.renderers.drawMap();
    const grid = document.getElementById("calc-grid");
    if (!grid) return;
    const addBtn = grid.querySelector(".add-calc-btn");
    grid.querySelectorAll(".calc-card").forEach(function (el) { el.remove(); });
    I.getCalcs().forEach(function (c) {
      const tmp = document.createElement("div");
      tmp.innerHTML = rendCard(c, rankMap);
      grid.insertBefore(tmp.firstElementChild, addBtn);
    });
    const tc = document.getElementById("trace-count");
    if (tc && global.PrintTrace) tc.innerHTML = "Trace: <b>" + PrintTrace.getCount() + "</b>";
  }

  function printAll() {
    const arr = I.getCalcs();
    if (!arr.length) { showToast("No loads to print", "error"); return; }
    const valid = arr.filter(function (c) { return c.legs.some(function (l) { return l.pu_state && l.del_state; }); });
    if (!valid.length) { showToast("No load has PU/DEL ZIPs filled in", "error"); return; }
    const dispatcher = (localStorage.getItem("dispatcher_name") || "").trim();
    if (!dispatcher) {
      if (!confirm("Dispatcher name is empty. File will be saved as 'anonymous_*.html'. Continue?")) return;
    }
    const totals = arr.map(function (c) { return CalcCore.calcTotal(c); });
    const result = PrintTrace.recordAndPrint(arr, totals, {
      dispatcher: dispatcher,
      period_days: global._currentPeriod || "all",
      fuel_snapshot_date: global._fuelSnapshotDate || null,
    });
    if (result && result.filename) {
      showToast("Saved: " + result.filename + " (" + result.addedCount + " loads)", "success");
    } else {
      showToast("Recorded in trace log.", "success");
    }
    render();
  }

  global.CalcUI = {
    render: render, addCalc: addCalc, removeCalc: removeCalc, addLeg: addLeg, removeLeg: removeLeg, resetCalc: resetCalc, setMetric: setMetric,
    zipInput: zipInput, selectZip: selectZip, zipKey: zipKey, clearZip: clearZip,
    onLegMiles: onLegMiles, onLegRpm: onLegRpm, onLegGross: onLegGross, onLegField: onLegField, onLegGal: onLegGal, onLegMpg: onLegMpg,
    applyFuelRec: applyFuelRec, addLegFromRec: addLegFromRec,
    onCommentChange: onCommentChange,
    onSelectedToggle: onSelectedToggle,
    printAll: printAll,
    init: function () { I.tooltip.initTooltip(); },
  };

})(typeof window !== "undefined" ? window : globalThis);
