/* breakdown.js — load-level drill-down for the "N trips" figure on the
   next-leg recommendations. Lazy-loads data/calc_detail.json on first use,
   filters the selected lane's loads to the active period, and shows a modal
   with the actual loads (broker, team, driver, truck, route, miles, CM). */
(function (global) {
  "use strict";

  var DAYS = { "30": 30, "60": 60, "90": 90, "180": 180, "365": 365, "all": -1 };
  var _data = null;      // {detail_cols, reference_date, detail:{lane:[rows]}}
  var _loading = null;   // promise guard

  function loadDetail() {
    if (_data) return Promise.resolve(_data);
    if (global.__CALC_DETAIL__) { _data = global.__CALC_DETAIL__; return Promise.resolve(_data); }
    if (_loading) return _loading;
    // Prefer <script> injection (works over file:// too); fall back to fetch().
    _loading = new Promise(function (resolve, reject) {
      var s = document.createElement("script");
      s.src = "data/calc_detail.js";
      s.onload = function () {
        if (global.__CALC_DETAIL__) { _data = global.__CALC_DETAIL__; resolve(_data); }
        else reject(new Error("calc_detail.js loaded but empty"));
      };
      s.onerror = function () {
        fetch("data/calc_detail.json", { cache: "no-store" })
          .then(function (r) { if (!r.ok) throw new Error("calc_detail.json " + r.status); return r.json(); })
          .then(function (j) { _data = j; global.__CALC_DETAIL__ = j; resolve(j); })
          .catch(reject);
      };
      document.head.appendChild(s);
    });
    return _loading;
  }

  function fmt$(n) { return "$" + Math.round(n).toLocaleString(); }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }

  function cutoffDate(refISO, days) {
    var d = new Date(refISO + "T00:00:00");
    d.setDate(d.getDate() - days);
    return d;
  }

  function show(laneKey) {
    var period = global._currentPeriod || "90";
    openModal(laneKey, period, '<div class="lb-loading">Loading loads…</div>');
    loadDetail().then(function (data) {
      var cols = data.detail_cols;                 // [date,truck,driver,team,broker,oCity,oState,dCity,dState,miles,gross,cm]
      var rows = (data.detail[laneKey] || []).slice();
      var days = DAYS[period];
      if (days > 0) {
        var cut = cutoffDate(data.reference_date, days);
        rows = rows.filter(function (r) { return new Date(r[0] + "T00:00:00") >= cut; });
      }
      rows.sort(function (a, b) { return (b[14] || 0) - (a[14] || 0); }); // by CM desc
      renderTable(laneKey, period, rows, cols, data.reference_date);
    }).catch(function (e) {
      setBody('<div class="lb-loading" style="color:#f2695f">Ne mogu da učitam detalje: ' + esc(e.message) + '</div>');
    });
  }

  function renderTable(laneKey, period, rows, cols, ref) {
    if (!rows.length) {
      setBody('<div class="lb-loading">Nema loadova za ' + esc(laneKey) + ' u periodu ' + esc(period) + '.</div>');
      return;
    }
    var tGross = 0, tCM = 0, tMi = 0, tPay = 0, tFuel = 0, tOther = 0, brokers = {};
    rows.forEach(function (r) {
      tGross += r[10] || 0; tPay += r[11] || 0; tFuel += r[12] || 0; tOther += r[13] || 0;
      tCM += r[14] || 0; tMi += r[9] || 0;
      brokers[r[4]] = (brokers[r[4]] || 0) + 1;
    });
    var pm = function (v) { return "$" + (tMi ? v / tMi : 0).toFixed(3); };
    var topBrokers = Object.keys(brokers).sort(function (a, b) { return brokers[b] - brokers[a]; }).slice(0, 3)
      .map(function (b) { return esc(b) + " (" + brokers[b] + ")"; }).join(" · ");

    var head = '<div class="lb-sum">' +
      '<span><b>' + rows.length + '</b> loads</span>' +
      '<span>Revenue <b>' + fmt$(tGross) + '</b></span>' +
      '<span>RPM <b>' + pm(tGross) + '</b></span>' +
      '<span>Driver <b>' + pm(tPay) + '</b>/mi</span>' +
      '<span>Fuel <b>' + pm(tFuel) + '</b>/mi</span>' +
      '<span>Other <b>' + pm(tOther) + '</b>/mi</span>' +
      '<span>CM <b class="' + (tCM >= 0 ? "lb-pos" : "lb-neg") + '">' + fmt$(tCM) + '</b></span>' +
      '<span>CM/mi <b class="' + (tCM >= 0 ? "lb-pos" : "lb-neg") + '">' + pm(tCM) + '</b></span>' +
      '</div><div class="lb-brokers">Top brokers: ' + (topBrokers || "-") + '</div>';

    var th = '<tr><th>Date</th><th>Broker / Customer</th><th>Team</th><th>Driver</th><th>Truck</th>' +
             '<th>Route</th><th class="r">Miles</th><th class="r">Gross</th><th class="r">RPM</th>' +
             '<th class="r">Driver/mi</th><th class="r">Fuel/mi</th><th class="r">Other/mi</th>' +
             '<th class="r">CM</th><th class="r">CM/mi</th></tr>';
    var body = rows.map(function (r) {
      var mi = r[9] || 0, cm = r[14] || 0;
      var pmr = function (v) { return "$" + (mi ? v / mi : 0).toFixed(3); };
      var cls = cm >= 0 ? "lb-pos" : "lb-neg";
      return '<tr>' +
        '<td>' + esc(r[0]) + '</td>' +
        '<td>' + esc(r[4]) + '</td>' +
        '<td>' + esc(r[3]) + '</td>' +
        '<td>' + esc(r[2]) + '</td>' +
        '<td>' + esc(r[1]) + '</td>' +
        '<td class="lb-route">' + esc(r[5]) + ", " + esc(r[6]) + " &rarr; " + esc(r[7]) + ", " + esc(r[8]) + '</td>' +
        '<td class="r">' + Math.round(mi).toLocaleString() + '</td>' +
        '<td class="r">' + fmt$(r[10] || 0) + '</td>' +
        '<td class="r">' + pmr(r[10] || 0) + '</td>' +
        '<td class="r">' + pmr(r[11] || 0) + '</td>' +
        '<td class="r">' + pmr(r[12] || 0) + '</td>' +
        '<td class="r">' + pmr(r[13] || 0) + '</td>' +
        '<td class="r ' + cls + '">' + fmt$(cm) + '</td>' +
        '<td class="r ' + cls + '">' + pmr(cm) + '</td>' +
        '</tr>';
    }).join("");
    setBody(head + '<div class="lb-tblwrap"><table class="lb-tbl"><thead>' + th + '</thead><tbody>' + body + '</tbody></table></div>');
  }

  /* ---- modal shell ---- */
  function ensureModal() {
    var m = document.getElementById("lb-modal");
    if (m) return m;
    injectCss();
    m = document.createElement("div");
    m.id = "lb-modal"; m.className = "lb-overlay"; m.style.display = "none";
    m.innerHTML =
      '<div class="lb-box">' +
        '<div class="lb-hd"><span id="lb-title"></span>' +
        '<button class="lb-x" onclick="LoadBreakdown.close()">✕</button></div>' +
        '<div class="lb-body" id="lb-body"></div>' +
      '</div>';
    m.addEventListener("click", function (e) { if (e.target === m) close(); });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape") close(); });
    document.body.appendChild(m);
    return m;
  }
  function openModal(lane, period, bodyHtml) {
    var m = ensureModal();
    document.getElementById("lb-title").innerHTML = "Loads · <b>" + esc(lane) + "</b> · period " + esc(period);
    document.getElementById("lb-body").innerHTML = bodyHtml;
    m.style.display = "flex";
  }
  function setBody(html) { var b = document.getElementById("lb-body"); if (b) b.innerHTML = html; }
  function close() { var m = document.getElementById("lb-modal"); if (m) m.style.display = "none"; }

  function injectCss() {
    if (document.getElementById("lb-css")) return;
    var s = document.createElement("style"); s.id = "lb-css";
    s.textContent =
      ".lb-overlay{position:fixed;inset:0;background:rgba(6,12,22,.62);z-index:100000;display:flex;align-items:center;justify-content:center;padding:24px}" +
      ".lb-box{background:#fff;color:#12233c;border-radius:12px;max-width:1080px;width:100%;max-height:88vh;display:flex;flex-direction:column;box-shadow:0 20px 70px rgba(0,0,0,.4);font-family:'DM Sans',system-ui,sans-serif}" +
      ".lb-hd{display:flex;align-items:center;justify-content:space-between;padding:14px 18px;border-bottom:1px solid #e6ecf3;font-size:15px}" +
      ".lb-x{border:none;background:#eef2f7;border-radius:8px;width:30px;height:30px;cursor:pointer;font-size:14px;color:#5a6e85}" +
      ".lb-x:hover{background:#e0e6ee}" +
      ".lb-body{overflow:auto;padding:14px 18px}" +
      ".lb-loading{padding:40px;text-align:center;color:#5a6e85}" +
      ".lb-sum{display:flex;gap:22px;flex-wrap:wrap;font-size:13px;color:#5a6e85;margin-bottom:6px}" +
      ".lb-sum b{color:#12233c;font-family:'DM Mono',monospace}" +
      ".lb-brokers{font-size:12px;color:#5a6e85;margin-bottom:12px}" +
      ".lb-tblwrap{max-height:60vh;overflow:auto;border:1px solid #e6ecf3;border-radius:8px}" +
      ".lb-tbl{width:100%;border-collapse:collapse;font-size:12px}" +
      ".lb-tbl th,.lb-tbl td{padding:6px 9px;border-bottom:1px solid #eef2f7;text-align:left;white-space:nowrap}" +
      ".lb-tbl th{position:sticky;top:0;background:#f5f8fb;color:#5a6e85;font-weight:600}" +
      ".lb-tbl td.r,.lb-tbl th.r{text-align:right;font-family:'DM Mono',monospace}" +
      ".lb-tbl tbody tr:hover{background:#f7fafc}" +
      ".lb-route{color:#5a6e85}" +
      ".lb-pos{color:#1a8a60}.lb-neg{color:#d64535}";
    document.head.appendChild(s);
  }

  // Breakdown for a specific ORIGIN CITY -> destination state (zip/city-level rec).
  function showFrom(city, state, dest) {
    var period = global._currentPeriod || "90";
    var st = String(state).toUpperCase();
    var laneKey = st + " - " + dest;
    var label = city + ", " + st + "  →  " + dest;
    openModal(label, period, '<div class="lb-loading">Loading loads…</div>');
    loadDetail().then(function (data) {
      var ci = {}; (data.detail_cols || []).forEach(function (c, i) { ci[c] = i; });
      var rows = (data.detail[laneKey] || []).filter(function (r) {
        return String(r[ci.oState]).toUpperCase() === st &&
               String(r[ci.oCity]).toLowerCase() === String(city).toLowerCase();
      });
      var days = DAYS[period];
      if (days > 0) {
        var cut = cutoffDate(data.reference_date, days);
        rows = rows.filter(function (r) { return new Date(r[ci.date] + "T00:00:00") >= cut; });
      }
      rows.sort(function (a, b) { return (b[ci.cm] || 0) - (a[ci.cm] || 0); });
      renderTable(label, period, rows, data.detail_cols, data.reference_date);
    }).catch(function (e) {
      setBody('<div class="lb-loading" style="color:#f2695f">Ne mogu da učitam detalje: ' + esc(e.message) + '</div>');
    });
  }

  global.LoadBreakdown = { show: show, showFrom: showFrom, close: close, _preload: loadDetail };
})(typeof window !== "undefined" ? window : this);
