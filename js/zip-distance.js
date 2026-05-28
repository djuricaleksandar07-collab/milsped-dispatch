/* =======================================================================
   zip-distance.js — ZIP-to-ZIP distance & corridor utilities (Faza 1)
   =======================================================================
   Public API:
     ZipDistance.load(zipCentroidsObj, pilotStationsObj)
     ZipDistance.coords(zip5)                → {lat,lon,city,state} | null
     ZipDistance.miles(zipA, zipB)           → road miles (haversine × 1.18)
     ZipDistance.airMiles(zipA, zipB)        → great-circle miles
     ZipDistance.search(query, max=10)       → autocomplete results
     ZipDistance.stationsInCorridor(a,b,off,fuelLookup) → Pilot in corridor
   ======================================================================= */
(function (global) {
  "use strict";
  const ROAD_FACTOR = 1.18;
  const EARTH_R_MI = 3958.8;

  let ZIPS = null, STATIONS = null, SEARCH_INDEX = null;

  function toRad(d) { return d * Math.PI / 180; }

  function haversine(lat1, lon1, lat2, lon2) {
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat / 2) ** 2 +
              Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
              Math.sin(dLon / 2) ** 2;
    return 2 * EARTH_R_MI * Math.asin(Math.sqrt(a));
  }

  function corridorOffset(latA, lonA, latB, lonB, latP, lonP) {
    const midLat = (latA + latB) / 2;
    const kx = Math.cos(toRad(midLat)) * 69.172;
    const ky = 69.172;
    const Ax = lonA * kx, Ay = latA * ky;
    const Bx = lonB * kx, By = latB * ky;
    const Px = lonP * kx, Py = latP * ky;
    const ABx = Bx - Ax, ABy = By - Ay;
    const ABlen2 = ABx * ABx + ABy * ABy;
    if (ABlen2 < 1e-6) {
      return { detour_mi: Math.hypot(Px - Ax, Py - Ay), t: 0 };
    }
    const t = ((Px - Ax) * ABx + (Py - Ay) * ABy) / ABlen2;
    const tClamped = Math.max(0, Math.min(1, t));
    const closestX = Ax + tClamped * ABx;
    const closestY = Ay + tClamped * ABy;
    return {
      detour_mi: Math.hypot(Px - closestX, Py - closestY),
      t: tClamped,
    };
  }

  function load(zipCentroids, pilotStations) {
    ZIPS = zipCentroids || {};
    STATIONS = pilotStations || {};
    SEARCH_INDEX = Object.entries(ZIPS).map(function (e) {
      var zip = e[0], v = e[1];
      return {
        zip: zip,
        city: v.city || "",
        state: v.state || "",
        lat: v.lat,
        lon: v.lon,
        key: zip + " " + (v.city || "").toLowerCase() + " " + (v.state || "").toLowerCase(),
      };
    });
    return { zips: SEARCH_INDEX.length, stations: Object.keys(STATIONS).length };
  }

  function coords(zip5) {
    if (!ZIPS) return null;
    const z = String(zip5).padStart(5, "0");
    return ZIPS[z] ? Object.assign({}, ZIPS[z], { zip: z }) : null;
  }

  function airMiles(zipA, zipB) {
    const a = coords(zipA), b = coords(zipB);
    if (!a || !b) return null;
    return haversine(a.lat, a.lon, b.lat, b.lon);
  }

  function miles(zipA, zipB) {
    const air = airMiles(zipA, zipB);
    return air == null ? null : air * ROAD_FACTOR;
  }

  const STATE_CODES = new Set(["AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT","VA","WA","WV","WI","WY","DC","PR","VI"]);

  function search(query, maxResults) {
    if (!SEARCH_INDEX) return [];
    maxResults = maxResults || 10;
    const q = String(query || "").trim().toLowerCase();
    if (q.length < 2) return [];
    const qUpper = q.toUpperCase();
    const isStateCode = q.length === 2 && STATE_CODES.has(qUpper);
    const isZipNumeric = /^\d{1,5}$/.test(q);
    const parts = q.split(/\s+/);
    const last = parts[parts.length - 1];
    const isCityState = parts.length >= 2 && last.length === 2 && STATE_CODES.has(last.toUpperCase());
    const stateMatch = [], exact = [], zipPrefix = [], cityPrefix = [], cityStateMatch = [], substr = [];
    for (let i = 0; i < SEARCH_INDEX.length; i++) {
      const r = SEARCH_INDEX[i];
      const cityLc = r.city.toLowerCase();
      if (isCityState) {
        const cityPart = parts.slice(0, -1).join(" ");
        if (r.state.toLowerCase() === last && cityLc.startsWith(cityPart)) {
          cityStateMatch.push(r);
          if (cityStateMatch.length >= maxResults * 2) break;
          continue;
        }
      }
      if (isStateCode) {
        if (r.state.toLowerCase() === q) {
          stateMatch.push(r);
          if (stateMatch.length >= maxResults * 2) break;
        }
        continue;
      }
      if (isZipNumeric) {
        if (r.zip === q) exact.push(r);
        else if (r.zip.startsWith(q)) zipPrefix.push(r);
        continue;
      }
      if (cityLc.startsWith(q)) cityPrefix.push(r);
      else if (r.key.indexOf(q) !== -1) substr.push(r);
      if (exact.length + zipPrefix.length + cityPrefix.length + substr.length >= maxResults * 4) break;
    }
    return [].concat(cityStateMatch, stateMatch, exact, zipPrefix, cityPrefix, substr).slice(0, maxResults);
  }

  function stationsInCorridor(zipA, zipB, maxOffsetMi, fuelLookupBySite) {
    if (!STATIONS) return [];
    maxOffsetMi = maxOffsetMi || 50;
    const a = coords(zipA), b = coords(zipB);
    if (!a || !b) return [];
    const out = [];
    for (const entry of Object.entries(STATIONS)) {
      const site = entry[0], st = entry[1];
      if (typeof st.lat !== "number" || typeof st.lon !== "number") continue;
      const r = corridorOffset(a.lat, a.lon, b.lat, b.lon, st.lat, st.lon);
      if (r.detour_mi > maxOffsetMi) continue;
      const fuel = fuelLookupBySite ? fuelLookupBySite[site] : null;
      out.push({
        site: Number(site),
        lat: st.lat,
        lon: st.lon,
        detour_mi: +r.detour_mi.toFixed(1),
        position_pct: +(r.t * 100).toFixed(1),
        city: (fuel && fuel.city) || "",
        state: (fuel && fuel.state) || "",
        your_price: fuel ? fuel.yourPrice : null,
        retail: fuel ? fuel.retail : null,
        savings: fuel ? fuel.savings : null,
      });
    }
    return out.sort(function (x, y) {
      if (x.your_price != null && y.your_price != null) return x.your_price - y.your_price;
      if (x.your_price != null) return -1;
      if (y.your_price != null) return 1;
      return x.detour_mi - y.detour_mi;
    });
  }

  global.ZipDistance = {
    load: load,
    coords: coords,
    miles: miles,
    airMiles: airMiles,
    search: search,
    stationsInCorridor: stationsInCorridor,
    ROAD_FACTOR: ROAD_FACTOR,
    _haversine: haversine,
    _corridorOffset: corridorOffset,
  };
})(typeof window !== "undefined" ? window : globalThis);
