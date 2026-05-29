/* =======================================================================
   fuel-recommender.js — Pilot pump recommendations + live price injection
   =======================================================================
   Zavisi od: ZipDistance (corridor), CalcCore (MPG)

   API:
     FuelRecommender.load(fuelPricesJson)
        → ucitaj fuel_prices.json + napravi index po site#

     FuelRecommender.getLatestDate()
        → "2026-04-21"

     FuelRecommender.getAvgFuelPm(state?, mpg?)
        → izracunaj prosecnu $/mi za state (ili overall) — koristi se kao
          live default umesto istorijskog lane.fuel_pm

     FuelRecommender.recommendForLeg(puZip, delZip, opts)
        → {
            stations: [ {site, city, state, yourPrice, detour_mi, ...} ],   // top N
            avgCorridorPrice: 4.32,
            cheapest: {...},
            cheapest_savings_per_gal: 0.34,   // razlika u odnosu na avg
            estimated_fuel_pm: 0.68,           // cheapest / MPG (za leg.fuel)
            estimated_gal_per_leg: 150,        // pretpostavka tank fill
            est_savings_dollars: 51            // gal × savings per gal
          }
   ======================================================================= */

(function (global) {
  "use strict";

  let DATA = null;
  let STATIONS_BY_SITE = null;  // {site_str: {city, state, yourPrice, retail, savings, cost}}

  function load(json) {
    DATA = json || null;
    STATIONS_BY_SITE = (json && json.stations) || {};
    return {
      latest_date: DATA ? DATA.latest_date : null,
      n_stations: Object.keys(STATIONS_BY_SITE).length,
    };
  }

  function getLatestDate() { return DATA ? DATA.latest_date : null; }
  function getAllStations() { return STATIONS_BY_SITE; }
  function getData() { return DATA; }

  /* Average $/gal across all loaded stations (or filtered by state). */
  function avgPricePerGal(state) {
    if (!STATIONS_BY_SITE) return null;
    const prices = [];
    for (const s of Object.values(STATIONS_BY_SITE)) {
      if (state && s.state !== state) continue;
      if (typeof s.yourPrice === "number") prices.push(s.yourPrice);
    }
    if (!prices.length) return null;
    return prices.reduce((a, b) => a + b, 0) / prices.length;
  }

  /* Convert $/gal to $/mi given MPG. */
  function pricePerMi(pricePerGal, mpg) {
    mpg = mpg || (global.CalcCore ? CalcCore.getMPG() : 6.0);
    if (!pricePerGal || !mpg) return null;
    return pricePerGal / mpg;
  }

  /* Live default $/mi for a leg (preferiraj state, padaj na overall). */
  function getAvgFuelPm(state, mpg) {
    const p = avgPricePerGal(state) || avgPricePerGal();
    if (p == null) return null;
    return pricePerMi(p, mpg);
  }

  /* Prosek svih Pilot pumpi u koridoru pickup→delivery.
     opts: { maxOffsetMi: 25, mpg: 6.0 }
     Vraća: { total_in_corridor, avgCorridorPrice, estimated_fuel_pm }
  */
  function recommendForLeg(puZip, delZip, opts) {
    opts = opts || {};
    const maxOff = opts.maxOffsetMi || 25;
    const mpg = opts.mpg || (global.CalcCore ? CalcCore.getMPG() : 6.0);

    if (!global.ZipDistance) return null;
    const stations = ZipDistance.stationsInCorridor(puZip, delZip, maxOff, STATIONS_BY_SITE);
    if (!stations.length) return { total_in_corridor: 0, avgCorridorPrice: null };

    const withPrice = stations.filter(s => s.your_price != null);
    if (!withPrice.length) return { total_in_corridor: 0, avgCorridorPrice: null };

    // Prosek SVIH pumpi u koridoru ±25mi — realna procena fuel troška jer
    // dispečer ne kontrolise gde tačno sipa, koristi prosek koridora.
    const avgCorridor = withPrice.reduce((a, b) => a + b.your_price, 0) / withPrice.length;
    const estFuelPm = avgCorridor / mpg;

    return {
      total_in_corridor: withPrice.length,
      avgCorridorPrice: +avgCorridor.toFixed(4),
      estimated_fuel_pm: +estFuelPm.toFixed(4),
    };
  }

  global.FuelRecommender = {
    load, getLatestDate, getAllStations, getData,
    avgPricePerGal, pricePerMi, getAvgFuelPm,
    recommendForLeg,
  };

})(typeof window !== "undefined" ? window : globalThis);
