/* =======================================================================
   calc-core.js — kalkulaciona jezgra (bez DOM-a)
   =======================================================================

   Data model (Faza 2):
     calc = { id, legs: [leg] }
     leg = {
       id,
       pu_zip, pu_city, pu_state,      // pickup ZIP + derived city/state
       del_zip, del_city, del_state,   // delivery ZIP + derived city/state
       miles_loaded,                   // user-controlled
       miles_empty,                    // user-controlled (default 0)
       // miles_total = miles_loaded + miles_empty (derived)
       rpm,                            // $/mile (over loaded mi)
       gross,                          // total revenue ($) = rpm * miles_loaded
       fuel,                           // $/mi (over total mi)
       dpm,                            // driver $/mi (over total mi)
       tolls,                          // $/mi (over total mi)
       mpg,
       last_edited: "rpm"|"gross"      // za bidirectional binding
     }

   Lane lookup koristi state-to-state (pu_state + " - " + del_state).
   Distance se izračunava preko ZipDistance.miles(pu_zip, del_zip).
   ======================================================================= */

(function (global) {
  "use strict";

  // ────────────────────────────────────────────────────────────────────
  // Konfiguracija — popunjava se preko CalcCore.configure({...}) iz app.js
  // ────────────────────────────────────────────────────────────────────
  let FLEET = null;       // flota-wide proseci
  let LANES = null;       // { "AL - GA": {...}, ... }
  let DEFAULT_MPG = 6.0;
  let INSURANCE_PM = 0.105; // fiksno
  let MILES_PER_DAY = 400;  // za CM/day extrapolaciju (jedan vozac)

  function configure(opts) {
    if (opts.fleet) FLEET = opts.fleet;
    if (opts.lanes) LANES = opts.lanes;
    if (opts.defaultMpg != null) DEFAULT_MPG = opts.defaultMpg;
    if (opts.insurancePm != null) INSURANCE_PM = opts.insurancePm;
    if (opts.milesPerDay != null) MILES_PER_DAY = opts.milesPerDay;
  }

  function getLane(puState, delState) {
    if (!LANES || !puState || !delState) return null;
    return LANES[puState + " - " + delState] || null;
  }

  function getFleet() { return FLEET; }
  function getMPG() { return DEFAULT_MPG; }
  function getInsurance() { return INSURANCE_PM; }

  // ────────────────────────────────────────────────────────────────────
  // Helpers
  // ────────────────────────────────────────────────────────────────────
  function median(arr) {
    if (!arr.length) return 0;
    const s = [...arr].sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }

  function totalMiles(leg) {
    return (Number(leg.miles_loaded) || 0) + (Number(leg.miles_empty) || 0);
  }

  function emptyPct(leg) {
    const tot = totalMiles(leg);
    if (tot <= 0) return 0;
    return (leg.miles_empty || 0) / tot;
  }

  // ────────────────────────────────────────────────────────────────────
  // Leg factory
  // ────────────────────────────────────────────────────────────────────
  function newLeg(calcId, legIdx, prevDelZip, prevDelCity, prevDelState) {
    const id = calcId * 1000 + legIdx + 1;
    const fl = FLEET || {};
    return {
      id,
      pu_zip:   prevDelZip   || "",
      pu_city:  prevDelCity  || "",
      pu_state: prevDelState || "",
      del_zip: "", del_city: "", del_state: "",
      miles_loaded: fl.avg_mi || 500,
      miles_empty:  0,
      rpm:    fl.rpm     || 2.4,
      gross:  (fl.rpm || 2.4) * (fl.avg_mi || 500),
      fuel:   fl.fuel_pm || 0.55,
      dpm:    fl.drv_pm  || 0.70,
      tolls:  fl.tolls_pm || 0.05,
      mpg:    DEFAULT_MPG,
      last_edited: "rpm",
    };
  }

  /* When PU/DEL ZIPs are known, fill defaults from lane history
     and recompute miles from ZIP-to-ZIP distance.
     Fuel se primenjuje iz najjeftinije Pilot pumpe u koridoru ako postoji,
     u suprotnom iz lane history.
     NAPOMENA: lane.rpm iz aggregate_lanes.py je per total miles
     (gross/SUM(miles_total)), pa ga ovde koristimo tako kako jeste. */
  function fillLegFromHist(leg, distanceMi) {
    const h = getLane(leg.pu_state, leg.del_state);
    if (h) {
      leg.rpm   = h.rpm;           // per total miles
      leg.fuel  = h.fuel_pm;       // initial fallback, can be overridden by fuel rec
      leg.dpm   = h.drv_pm;
      leg.tolls = h.tolls_pm;
    }
    if (distanceMi != null && distanceMi > 0) {
      leg.miles_loaded = +distanceMi.toFixed(0);
    }
    // Auto-apply: prosek 3 najjeftinijih Pilot pumpi u koridoru
    // (realnija procena fuel troška vs. samo najjeftinija - dispečer ne stigne uvek)
    if (typeof globalThis.FuelRecommender !== "undefined" && globalThis.FuelRecommender.recommendForLeg) {
      try {
        const rec = globalThis.FuelRecommender.recommendForLeg(leg.pu_zip, leg.del_zip, {
          topN: 3, mpg: leg.mpg || DEFAULT_MPG,
        });
        if (rec && rec.top3AvgPrice && rec.top3AvgPrice > 0) {
          leg.fuel = rec.top3AvgPrice / (leg.mpg || DEFAULT_MPG);
          leg.fuel_source = "live_top3_avg";
          leg.fuel_avg_price = rec.top3AvgPrice;
          // Sačuvaj broj stanica koje su učestvovale u proseku (za debug/trace)
          leg.fuel_top3_count = Math.min(3, (rec.stations || []).length);
        }
      } catch (e) {
        // FuelRecommender nije ucitan ili ZIP nije validan - pada na lane.fuel_pm
      }
    }
    // sync gross from rpm (RPM × total miles)
    leg.gross = leg.rpm * totalMiles(leg);
    leg.last_edited = "rpm";
  }

  // ────────────────────────────────────────────────────────────────────
  // Bidirectional Gross ↔ RPM (RPM je per TOTAL miles)
  //   gross = rpm × total_miles
  //   rpm   = gross / total_miles
  //
  // Informativno: rpmLoaded = gross / miles_loaded
  // (koliko zaista zarađujemo po loaded mi; ovo se prikazuje "ispod" u UI-ju)
  // ────────────────────────────────────────────────────────────────────
  function syncFromRpm(leg) {
    leg.gross = leg.rpm * totalMiles(leg);
    leg.last_edited = "rpm";
  }
  function syncFromGross(leg) {
    const tm = totalMiles(leg);
    if (tm > 0) {
      leg.rpm = leg.gross / tm;
    }
    leg.last_edited = "gross";
  }
  function syncOnMilesChange(leg) {
    const tm = totalMiles(leg);
    if (leg.last_edited === "gross" && tm > 0) {
      leg.rpm = leg.gross / tm;
    } else {
      leg.gross = leg.rpm * tm;
    }
  }

  /** RPM po loaded miles (informativno, "ispod") */
  function rpmLoaded(leg) {
    const ml = Number(leg.miles_loaded) || 0;
    if (ml <= 0) return null;
    return (leg.gross || 0) / ml;
  }

  // ────────────────────────────────────────────────────────────────────
  // Per-leg P&L
  //
  // Revenue is earned over LOADED miles (rpm × loaded).
  // Variable costs (fuel, driver, tolls, fix) accrue over TOTAL miles
  //   because the truck and driver are running for the empty portion too.
  // ────────────────────────────────────────────────────────────────────
  function calcLeg(leg) {
    const h = getLane(leg.pu_state, leg.del_state);

    // Fixed costs (auto, not user-controlled) — per mile
    const ifta  = h ? h.ifta_pm  : (FLEET ? FLEET.ifta_pm  : 0.007);
    const ins   = INSURANCE_PM;
    const rm    = h ? h.rm_pm    : (FLEET ? FLEET.rm_pm    : 0.20);
    const other = h ? h.other_pm : (FLEET ? FLEET.other_pm : 0.02);
    const fix_ex = ifta + ins + rm + other;
    const tolls  = Number(leg.tolls) || 0;
    const fix    = fix_ex + tolls;

    const milesL = Number(leg.miles_loaded) || 0;
    const milesT = milesL + (Number(leg.miles_empty) || 0);
    const milesTotalSafe = Math.max(milesT, 0.0001);

    // RPM je sad per total miles → revenue = rpm × total
    // (gross je već takav: gross = rpm × total_miles)
    const revenue = leg.gross != null ? leg.gross : (leg.rpm * milesT);
    const varCostTotal = (leg.dpm + leg.fuel + tolls + fix_ex) * milesT;
    const cm_pt = revenue - varCostTotal;
    const cm_pm = cm_pt / milesTotalSafe;
    const cm_pct = revenue > 0 ? cm_pt / revenue : 0;
    const effRpm = revenue / milesTotalSafe;          // = leg.rpm (per total)
    const rpmLoaded = milesL > 0 ? revenue / milesL : null;

    // Historical baseline (lane.rpm je per total)
    let cm_pm_hist = null, cm_pt_hist = null, cm_pct_hist = null;
    if (h) {
      const fix_pm_adj = h.fix_pm - h.ins_pm + INSURANCE_PM;
      cm_pm_hist = h.rpm - h.drv_pm - h.fuel_pm - fix_pm_adj;
      cm_pt_hist = cm_pm_hist * h.avg_mi;
      cm_pct_hist = h.rpm > 0 ? cm_pm_hist / h.rpm : null;
    }

    return {
      fix, fix_ex, ifta, ins, rm, tolls, other, h,
      revenue, varCostTotal, miles_total: milesT, miles_loaded: milesL,
      cm_pm, cm_pt, cm_pct, effRpm, rpmLoaded,
      cm_pm_hist, cm_pt_hist, cm_pct_hist,
    };
  }

  // ────────────────────────────────────────────────────────────────────
  // Whole calc aggregation
  // ────────────────────────────────────────────────────────────────────
  function calcTotal(c) {
    const legR = c.legs.map(l => ({ l, r: calcLeg(l) }));
    const sumTotalMi  = legR.reduce((a, x) => a + x.r.miles_total, 0) || 1;
    const sumLoadedMi = legR.reduce((a, x) => a + x.r.miles_loaded, 0);
    const sumRev      = legR.reduce((a, x) => a + x.r.revenue, 0);
    const sumCmPt     = legR.reduce((a, x) => a + x.r.cm_pt, 0);
    const sumVarCost  = legR.reduce((a, x) => a + x.r.varCostTotal, 0);

    const cm_pm  = sumCmPt / sumTotalMi;
    const cm_pct = sumRev > 0 ? sumCmPt / sumRev : 0;
    const effRpm = sumRev / sumTotalMi;
    const emptyMi = sumTotalMi - sumLoadedMi;
    const emptyPctTotal = sumTotalMi > 0 ? emptyMi / sumTotalMi : 0;
    // CM/day: extrapolacija pretpostavkom da vozac voziti 400 mi/dan
    // (proizvoljna kalibracija - moze se menjati preko CalcCore.configure({ milesPerDay: ... }))
    const cm_per_day = cm_pm * MILES_PER_DAY;

    // Historical (only if every leg has lane history)
    let cm_pm_hist = null, cm_pt_hist = null, cm_pct_hist = null, effRpm_hist = null;
    if (legR.every(x => x.r.cm_pm_hist != null)) {
      const sumHistMi = legR.reduce((a, x) => a + (x.r.h.avg_mi || 0), 0) || 1;
      const sumHistCm = legR.reduce((a, x) => a + (x.r.cm_pt_hist || 0), 0);
      const sumHistRv = legR.reduce((a, x) => a + (x.r.h.rpm * x.r.h.avg_mi), 0);
      cm_pm_hist = sumHistCm / sumHistMi;
      cm_pt_hist = sumHistCm;
      effRpm_hist = sumHistRv / sumHistMi;
      cm_pct_hist = sumHistRv > 0 ? sumHistCm / sumHistRv : null;
    }

    // Medians across legs
    const medRpm   = median(c.legs.map(l => l.rpm));
    const medFuel  = median(c.legs.map(l => l.fuel));
    const medDpm   = median(c.legs.map(l => l.dpm));
    const medTolls = median(c.legs.map(l => l.tolls));
    const medMilesL = median(c.legs.map(l => l.miles_loaded));
    const medCmPm  = median(legR.map(x => x.r.cm_pm));

    return {
      legR,
      totalMiles: sumTotalMi,
      loadedMiles: sumLoadedMi,
      emptyMiles: emptyMi,
      emptyPct: emptyPctTotal,
      totalRevenue: sumRev,
      totalGross: sumRev,
      totalCmPt: sumCmPt,
      totalVarCost: sumVarCost,
      cm_pm, cm_pt: sumCmPt, cm_pct, effRpm, cm_per_day,
      milesPerDay: MILES_PER_DAY,
      cm_pm_hist, cm_pt_hist, cm_pct_hist, effRpm_hist,
      cm_per_day_hist: cm_pm_hist != null ? cm_pm_hist * MILES_PER_DAY : null,
      medRpm, medFuel, medDpm, medTolls, medMilesL, medCmPm,
    };
  }

  function metricVal(tot, metric) {
    return metric === "cm_pt"  ? tot.cm_pt
         : metric === "cm_pct" ? tot.cm_pct
         : metric === "cm_day" ? tot.cm_per_day
         : tot.cm_pm;
  }

  // ────────────────────────────────────────────────────────────────────
  // Reset to historical defaults (or fleet if no history)
  // ────────────────────────────────────────────────────────────────────
  function resetLeg(leg) {
    const h = getLane(leg.pu_state, leg.del_state);
    const fl = FLEET || {};
    if (h) {
      leg.rpm = h.rpm;
      leg.fuel = h.fuel_pm;
      leg.dpm = h.drv_pm;
      leg.tolls = h.tolls_pm;
      leg.mpg = DEFAULT_MPG;
    } else {
      leg.rpm = fl.rpm || 2.4;
      leg.fuel = fl.fuel_pm || 0.55;
      leg.dpm = fl.drv_pm || 0.70;
      leg.tolls = fl.tolls_pm || 0.05;
      leg.mpg = DEFAULT_MPG;
    }
    syncFromRpm(leg);
  }

  // ────────────────────────────────────────────────────────────────────
  // Public API
  // ────────────────────────────────────────────────────────────────────
  global.CalcCore = {
    configure,
    getLane, getFleet, getMPG, getInsurance,
    newLeg, fillLegFromHist, resetLeg,
    syncFromRpm, syncFromGross, syncOnMilesChange, rpmLoaded,
    totalMiles, emptyPct,
    calcLeg, calcTotal,
    metricVal, median,
  };

})(typeof window !== "undefined" ? window : globalThis);
