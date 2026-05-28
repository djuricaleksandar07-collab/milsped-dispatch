/* =======================================================================
   lane-recommender.js — Top 3 sledeća lega po profitabilnosti
   =======================================================================
   Zavisi od: CalcCore.getLane (preko lanes.json za izabrani period)

   API:
     LaneRecommender.recommendNext(fromState, opts)
        opts: { lanesObj, fleet, topN=3, minTrips=3, sortBy='cm_pm' }
        → [ {lane, pu, del, cm_pm, rpm, avg_mi, n_trips, score, expected_cm}, ... ]

     LaneRecommender.recommendForPair(puState, delState, lanesObj)
        → vraca lane data za tu pair (ili null)

     LaneRecommender.bestLanesOverall(lanesObj, fleet, opts)
        → top N najboljih lane-ova preko cele baze (bez fromState constraint)

   Score formula (default sortBy='cm_pm'):
     primarna metrika je cm_pm
     ali za male uzorke (n_trips < 5) smanjujemo poverenje
     (Bayesian shrinkage prema fleet proseku)

   Expected CM per trip = cm_pm × avg_mi.
   ======================================================================= */

(function (global) {
  "use strict";

  /** Bayesian shrinkage of lane CM/mi prema fleet proseku za male uzorke.
   *  Vraca posterior estimate.
   */
  function _adjustedCmPm(lane, fleetCmPm, prior = 10) {
    const n = lane.n_trips || 0;
    const obs = lane.cm_pm;
    if (n >= 20) return obs;
    const w_obs = n / (n + prior);
    return obs * w_obs + fleetCmPm * (1 - w_obs);
  }

  function recommendNext(fromState, opts) {
    opts = opts || {};
    const lanes = opts.lanesObj || (global.CalcCore && CalcCore._lanes);
    if (!lanes) return [];
    const fleet = opts.fleet || (global.CalcCore && CalcCore.getFleet()) || {};
    const fleetCmPm = fleet.cm_pm || 0.8;
    const topN = opts.topN || 3;
    const minTrips = opts.minTrips || 3;
    const sortBy = opts.sortBy || "cm_pm";

    const candidates = [];
    for (const [key, lane] of Object.entries(lanes)) {
      if (lane.pu !== fromState) continue;
      if (lane.n_trips < minTrips) continue;
      const adjCm = _adjustedCmPm(lane, fleetCmPm);
      const expCm = adjCm * (lane.avg_mi || 0);
      const cm_pct = lane.rpm > 0 ? adjCm / lane.rpm : 0;
      candidates.push({
        lane: key,
        pu: lane.pu,
        del: lane.del,
        cm_pm: lane.cm_pm,
        cm_pm_adj: adjCm,
        cm_pt: expCm,
        cm_pct: cm_pct,
        rpm: lane.rpm,
        avg_mi: lane.avg_mi,
        n_trips: lane.n_trips,
        expected_cm: expCm,
      });
    }
    // Sort by chosen metric (poklapa metric toggle u UI-ju)
    if (sortBy === "cm_pt") {
      candidates.sort((a, b) => b.expected_cm - a.expected_cm);
    } else if (sortBy === "cm_pct") {
      candidates.sort((a, b) => b.cm_pct - a.cm_pct);
    } else if (sortBy === "rpm") {
      candidates.sort((a, b) => b.rpm - a.rpm);
    } else {
      // 'cm_pm' default
      candidates.sort((a, b) => b.cm_pm_adj - a.cm_pm_adj);
    }
    return candidates.slice(0, topN);
  }

  function bestLanesOverall(lanesObj, fleet, opts) {
    opts = opts || {};
    const fleetCmPm = (fleet && fleet.cm_pm) || 0.8;
    const minTrips = opts.minTrips || 5;
    const topN = opts.topN || 10;
    const arr = [];
    for (const [k, l] of Object.entries(lanesObj || {})) {
      if (l.n_trips < minTrips) continue;
      const adjCm = _adjustedCmPm(l, fleetCmPm);
      arr.push({
        lane: k, pu: l.pu, del: l.del,
        cm_pm: l.cm_pm, cm_pm_adj: adjCm,
        rpm: l.rpm, avg_mi: l.avg_mi, n_trips: l.n_trips,
        expected_cm: adjCm * l.avg_mi,
      });
    }
    arr.sort((a, b) => b.cm_pm_adj - a.cm_pm_adj);
    return arr.slice(0, topN);
  }

  function recommendForPair(puState, delState, lanesObj) {
    if (!lanesObj || !puState || !delState) return null;
    return lanesObj[puState + " - " + delState] || null;
  }

  global.LaneRecommender = {
    recommendNext,
    recommendForPair,
    bestLanesOverall,
    _adjustedCmPm,
  };

})(typeof window !== "undefined" ? window : globalThis);
