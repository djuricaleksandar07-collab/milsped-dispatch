/* print-trace.js — Print + auto-save (dispatcher_YYYY-MM-DD_HHMM) + JSON trace log */
(function (global) {
  "use strict";
  const STORAGE_KEY = "dispatch_calc_trace_log";
  const VERSION = "1.0";

  function _read() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return { version: VERSION, entries: [] };
      const parsed = JSON.parse(raw);
      if (!parsed.entries) return { version: VERSION, entries: [] };
      return parsed;
    } catch (e) { return { version: VERSION, entries: [] }; }
  }

  function _write(data) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); return true; }
    catch (e) { return false; }
  }

  function getLog() { return _read().entries; }
  function getCount() { return getLog().length; }

  function clearLog() {
    const n = getCount();
    if (n === 0) return false;
    if (!confirm("Obrisati " + n + " zapis(a) iz trace log-a? Akcija je nepovratna ako se prethodno ne export-uju.")) return false;
    _write({ version: VERSION, entries: [] });
    return true;
  }

  // Sanitizuj string za filename (uklanja slashes, special chars)
  function _sanitize(s) {
    return String(s || "anonimno").replace(/[^a-zA-Z0-9_-]/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "");
  }

  // Format YYYY-MM-DD_HHmm (lokalno vreme)
  function _stamp() {
    const d = new Date();
    const pad = n => String(n).padStart(2, "0");
    return d.getFullYear() + "-" + pad(d.getMonth()+1) + "-" + pad(d.getDate()) + "_" + pad(d.getHours()) + pad(d.getMinutes());
  }

  function recordSnapshot(calcs, totals, metadata) {
    const data = _read();
    const ts = new Date().toISOString();
    const added = [];
    calcs.forEach(function (c, idx) {
      if (!c.legs.some(function (l) { return l.pu_zip && l.del_zip; })) return;
      const tot = totals[idx];
      const lanes = c.legs.filter(function (l) { return l.pu_state && l.del_state; })
        .map(function (l) { return l.pu_state + "-" + l.del_state; }).join("|");
      const zips = c.legs.filter(function (l) { return l.pu_zip && l.del_zip; })
        .map(function (l) { return l.pu_zip + ">" + l.del_zip; }).join("|");
      const entry = {
        printed_at: ts,
        calc_id: c.id,
        dispatcher: metadata.dispatcher || "",
        comment: (c.comment || "").trim(),
        period_days: metadata.period_days || null,
        fuel_snapshot_date: metadata.fuel_snapshot_date || null,
        leg_count: c.legs.length,
        lanes: lanes, zips: zips,
        total_miles: +tot.totalMiles.toFixed(0),
        loaded_miles: +tot.loadedMiles.toFixed(0),
        empty_miles: +tot.emptyMiles.toFixed(0),
        empty_pct: +(tot.emptyPct * 100).toFixed(1),
        total_revenue: +tot.totalRevenue.toFixed(2),
        total_cm: +tot.totalCmPt.toFixed(2),
        cm_per_mi: +tot.cm_pm.toFixed(4),
        cm_per_day: +(tot.cm_per_day || 0).toFixed(2),
        cm_pct: +(tot.cm_pct * 100).toFixed(2),
        effective_rpm: +tot.effRpm.toFixed(4),
        cm_per_mi_hist: tot.cm_pm_hist != null ? +tot.cm_pm_hist.toFixed(4) : null,
        legs: c.legs.map(function (l) {
          return {
            pu_zip: l.pu_zip, pu_state: l.pu_state, pu_city: l.pu_city,
            del_zip: l.del_zip, del_state: l.del_state, del_city: l.del_city,
            loaded_mi: l.miles_loaded, empty_mi: l.miles_empty,
            rpm: +(+l.rpm).toFixed(4), gross: +(+l.gross).toFixed(2),
            fuel_pm: +(+l.fuel).toFixed(4), dpm: +(+l.dpm).toFixed(4),
            tolls_pm: +(+l.tolls).toFixed(4), mpg: l.mpg,
          };
        }),
      };
      data.entries.push(entry);
      added.push(entry);
    });
    _write(data);
    return added;
  }

  function _download(filename, content, mime) {
    const blob = new Blob([content], { type: mime || "application/octet-stream" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  // Standalone HTML report sa svim podacima za odštampanu turu
  function _buildReportHtml(entries, metadata) {
    const dispatcher = metadata.dispatcher || "anonimno";
    const ts = new Date().toLocaleString("sr-RS");
    const period = metadata.period_days || "all";
    const fuelDate = metadata.fuel_snapshot_date || "—";

    const calcRows = entries.map(function (e, i) {
      const legRows = e.legs.map(function (l, li) {
        return "<tr><td>" + (li+1) + "</td>" +
          "<td><b>" + (l.pu_zip||"-") + "</b> " + (l.pu_city||"") + ", " + (l.pu_state||"") + "</td>" +
          "<td><b>" + (l.del_zip||"-") + "</b> " + (l.del_city||"") + ", " + (l.del_state||"") + "</td>" +
          "<td>" + l.loaded_mi.toLocaleString() + "</td>" +
          "<td>" + l.empty_mi.toLocaleString() + "</td>" +
          "<td>$" + l.rpm.toFixed(3) + "</td>" +
          "<td>$" + l.gross.toLocaleString() + "</td>" +
          "<td>$" + l.fuel_pm.toFixed(4) + "</td>" +
          "<td>$" + l.dpm.toFixed(3) + "</td>" +
          "<td>$" + l.tolls_pm.toFixed(4) + "</td></tr>";
      }).join("");
      const cmColor = e.cm_per_mi >= 0 ? "#1a8a60" : "#b83535";
      const cmDay = e.cm_per_day || 0;
      const commentEsc = (e.comment || "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/\n/g,"<br>");
      const commentRow = e.comment ? "<div class='comment-row'><b>Comment:</b> " + commentEsc + "</div>" : "";
      return "<div class='calc-section'>" +
        "<div class='calc-title'>Load #" + e.calc_id + " &nbsp;·&nbsp; " + e.lanes + "</div>" +
        "<table class='leg-table'>" +
        "<thead><tr><th>#</th><th>PU</th><th>DEL</th><th>Load mi</th><th>Empty mi</th><th>RPM</th><th>Gross</th><th>Fuel/mi</th><th>Driver/mi</th><th>Tolls/mi</th></tr></thead>" +
        "<tbody>" + legRows + "</tbody></table>" +
        "<div class='calc-totals'>" +
        "<div><span>CM/mi:</span> <b style='color:" + cmColor + "'>$" + e.cm_per_mi.toFixed(4) + "</b></div>" +
        "<div><span>CM/load:</span> <b style='color:" + cmColor + "'>$" + e.total_cm.toLocaleString() + "</b></div>" +
        "<div><span>CM/day (@400mi):</span> <b style='color:" + cmColor + "'>$" + Math.round(cmDay).toLocaleString() + "</b></div>" +
        "<div><span>CM%:</span> <b style='color:" + cmColor + "'>" + e.cm_pct.toFixed(2) + "%</b></div>" +
        "<div><span>Gross/load:</span> <b>$" + e.total_revenue.toLocaleString() + "</b></div>" +
        "<div><span>Total miles:</span> <b>" + e.total_miles.toLocaleString() + "</b> (" + e.empty_pct.toFixed(1) + "% empty)</div>" +
        "<div><span>Eff RPM:</span> <b>$" + e.effective_rpm.toFixed(3) + "</b></div>" +
        (e.cm_per_mi_hist != null ? "<div><span>Hist CM/mi:</span> <b>$" + e.cm_per_mi_hist.toFixed(4) + "</b> &nbsp;<span style='color:" + (e.cm_per_mi >= e.cm_per_mi_hist ? "#1a8a60" : "#b83535") + "'>" + (e.cm_per_mi >= e.cm_per_mi_hist ? "▲" : "▼") + " $" + Math.abs(e.cm_per_mi - e.cm_per_mi_hist).toFixed(4) + "</span></div>" : "") +
        "</div>" +
        commentRow +
        "</div>";
    }).join("");

    return "<!DOCTYPE html><html lang='sr'><head><meta charset='UTF-8'>" +
      "<title>Dispatch Print — " + dispatcher + " — " + ts + "</title>" +
      "<style>" +
      "body{font-family:'Segoe UI',Arial,sans-serif;font-size:12px;color:#08203c;margin:24px;background:#fff}" +
      ".hdr{border-bottom:2px solid #08203c;padding-bottom:10px;margin-bottom:18px;display:flex;justify-content:space-between;align-items:flex-end}" +
      ".hdr h1{font-size:20px;margin:0;font-weight:600}" +
      ".hdr .meta{text-align:right;font-size:11px;color:#5a6e85;line-height:1.6}" +
      ".hdr .meta b{color:#08203c}" +
      ".calc-section{margin-bottom:18px;padding-bottom:14px;border-bottom:1px solid #dce1ea;page-break-inside:avoid}" +
      ".calc-title{font-size:14px;font-weight:600;color:#08203c;margin-bottom:8px;background:#eef1f5;padding:6px 10px;border-radius:5px}" +
      ".leg-table{width:100%;border-collapse:collapse;font-size:11px;margin-bottom:8px}" +
      ".leg-table th,.leg-table td{padding:5px 8px;border:1px solid #dce1ea;text-align:left}" +
      ".leg-table th{background:#eef1f5;font-weight:600;font-size:10px;text-transform:uppercase;color:#5a6e85}" +
      ".calc-totals{display:grid;grid-template-columns:repeat(4,1fr);gap:6px 14px;font-size:11px}" +
      ".calc-totals span{color:#5a6e85}" +
      ".comment-row{margin-top:10px;padding:8px 12px;background:#f4f8ff;border-left:3px solid #3b5bdb;border-radius:4px;font-size:11px;line-height:1.5}" +
      ".comment-row b{color:#3b5bdb}" +
      ".footer{margin-top:24px;padding-top:10px;border-top:1px solid #dce1ea;font-size:10px;color:#5a6e85;display:flex;justify-content:space-between}" +
      "@media print{body{margin:12px}.calc-section{page-break-inside:avoid}}" +
      "</style></head><body>" +
      "<div class='hdr'><div><h1>Dispatch Calculator — Print Report</h1>" +
      "<div style='font-size:11px;color:#5a6e85;margin-top:4px'>Milsped LLC · CD drivers</div></div>" +
      "<div class='meta'><div><b>Dispatcher:</b> " + dispatcher + "</div>" +
      "<div><b>Date:</b> " + ts + "</div>" +
      "<div><b>Period:</b> " + period + " · <b>Fuel:</b> " + fuelDate + "</div>" +
      "<div>Loads: " + entries.length + "</div></div></div>" +
      calcRows +
      "<div class='footer'><div>Dispatch Calculator v2 · Milsped LLC</div>" +
      "<div>print: " + ts + "</div></div>" +
      "</body></html>";
  }

  // Snimi HTML report u Downloads sa imenom: dispatcher_YYYY-MM-DD_HHmm.html
  function _saveReport(entries, metadata) {
    const html = _buildReportHtml(entries, metadata);
    const filename = _sanitize(metadata.dispatcher || "anonimno") + "_" + _stamp() + ".html";
    _download(filename, html, "text/html");
    return filename;
  }

  // Main action: snimi u trace, snimi HTML report u Downloads, pa otvori print dialog
  function recordAndPrint(calcs, totals, metadata) {
    metadata = metadata || {};
    const added = recordSnapshot(calcs, totals, metadata);
    if (!added.length) return { count: 0, filename: null };
    const filename = _saveReport(added, metadata);
    const h1 = document.querySelector("h1");
    if (h1) h1.setAttribute("data-print-time", new Date().toLocaleString("sr-RS"));
    setTimeout(function () { window.print(); }, 200);
    return { count: getCount(), filename: filename, addedCount: added.length };
  }

  function exportLog() {
    const data = _read();
    const now = new Date().toISOString().slice(0, 10);
    _download("dispatch_trace_log_" + now + ".json", JSON.stringify(data, null, 2), "application/json");
  }

  function exportLogCsv() {
    const entries = _read().entries;
    if (!entries.length) { alert("Trace log je prazan."); return; }
    const cols = ["printed_at","calc_id","dispatcher","period_days","lanes","zips","leg_count","loaded_miles","empty_miles","total_miles","empty_pct","total_revenue","total_cm","cm_per_mi","cm_per_day","cm_pct","effective_rpm","cm_per_mi_hist","comment"];
    const esc = function (v) {
      if (v == null) return "";
      const s = String(v);
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const rows = [cols.join(",")];
    entries.forEach(function (e) { rows.push(cols.map(function (c) { return esc(e[c]); }).join(",")); });
    const now = new Date().toISOString().slice(0, 10);
    _download("dispatch_trace_log_" + now + ".csv", rows.join("\n"), "text/csv");
  }

  global.PrintTrace = {
    recordSnapshot: function (c, t, m) { return recordSnapshot(c, t, m).length; },
    recordAndPrint: recordAndPrint,
    getLog: getLog, getCount: getCount, clearLog: clearLog,
    exportLog: exportLog, exportLogCsv: exportLogCsv,
  };
})(typeof window !== "undefined" ? window : globalThis);
