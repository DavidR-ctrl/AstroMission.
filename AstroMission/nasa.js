// ============================================================
// NASA live data for AstroMission
//   DONKI      -> real space weather (flares, CMEs, storms, particle events)
//   OSDR       -> real space-biology studies (Open Science Data Repository)
//   Mars Trek  -> real Mars terrain (MOLA shaded-relief map tiles)
// Every loader fails softly: if NASA is unreachable the game keeps
// working with its simulated events.
// ============================================================
const NASA = (() => {
  const KEY = NASA_CONFIG.API_KEY, TIMEOUT = NASA_CONFIG.TIMEOUT_MS, TTL = NASA_CONFIG.CACHE_MINUTES * 60000;
  const DAY_MS = 86400000;
  const DONKI_YEARS = 2;
  const DONKI_MAX_RANGE_DAYS = 60;
  const ymd = date => date.toISOString().slice(0, 10);          // UTC date, YYYY-MM-DD
  const addDays = (date, n) => new Date(date.getTime() + n * DAY_MS);
  const clamp01 = v => Math.max(0, Math.min(1, v));

  const store = {
    loadedAt: 0,
    donki: { status: "loading", byDate: {}, count: 0, error: "" },
    osdr: { status: "loading", lists: { plant: [], radiation: [], muscle: [] }, count: 0 }
  };

  async function fetchJSON(url) {
    const ctrl = new AbortController(), timer = setTimeout(() => ctrl.abort(), TIMEOUT);
    try {
      const res = await fetch(url, { signal: ctrl.signal });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error("HTTP " + res.status + (body?.error?.message ? ": " + body.error.message : ""));
      }
      return await res.json();
    } catch (error) {
      if (error.name === "AbortError") throw new Error("Request timed out after " + TIMEOUT + " ms.");
      throw error;
    } finally { clearTimeout(timer); }
  }

  // Tiny sessionStorage cache of already-normalized data (spares the key's rate limit).
  async function cached(key, loader) {
    try { const c = JSON.parse(sessionStorage.getItem(key) || "null"); if (c && Date.now() - c.t < TTL) return c.v; } catch (e) {}
    const v = await loader();
    try { sessionStorage.setItem(key, JSON.stringify({ t: Date.now(), v })); } catch (e) {}
    return v;
  }

  // ---------- DONKI (space weather) ----------
  const donkiURL = (type, start, end) => `https://ccmc.gsfc.nasa.gov/DONKI-API/get/${type}?startDate=${start}&endDate=${end}`;
  function donkiDateRanges(start, end) {
    const ranges = [];
    for (let cursor = new Date(start); cursor <= end;) {
      const maxEnd = addDays(cursor, DONKI_MAX_RANGE_DAYS - 1);
      const rangeEnd = maxEnd < end ? maxEnd : end;
      ranges.push({ start: ymd(cursor), end: ymd(rangeEnd) });
      cursor = addDays(rangeEnd, 1);
    }
    return ranges;
  }

  // Turns the raw DONKI JSON into one small, uniform shape: {type, id, date, sev, ...}
  function normalizeDonki(type, items) {
    const list = Array.isArray(items) ? items : [];
    return list.map(e => {
      if (type === "FLR") {
        const cls = String(e.classType || "C?"), n = parseFloat(cls.slice(1)) || 1, letter = cls[0].toUpperCase();
        return { type, id: e.flrID, date: String(e.peakTime || e.beginTime || "").slice(0, 10), cls, region: e.activeRegionNum || "",
          sev: letter === "X" ? (n >= 5 ? 2.5 : 2) : letter === "M" ? 1 : 0.5, link: e.link };
      }
      if (type === "CME") {
        const analyses = e.cmeAnalyses || [], best = analyses.find(a => a.isMostAccurate) || analyses[0] || {}, speed = Number(best.speed) || 0;
        return { type, id: e.activityID, date: String(e.startTime || "").slice(0, 10), speed, sev: speed >= 1500 ? 2 : speed >= 800 ? 1 : 0.5, link: e.link };
      }
      if (type === "GST") {
        const kp = Math.max(0, ...(e.allKpIndex || []).map(k => Number(k.kpIndex) || 0));
        return { type, id: e.gstID, date: String(e.startTime || "").slice(0, 10), kp, sev: kp >= 7 ? 2 : kp >= 5 ? 1 : 0.5, link: e.link };
      }
      return { type: "SEP", id: e.sepID, date: String(e.eventTime || "").slice(0, 10), sev: 1.5, link: e.link };
    }).filter(e => /^\d{4}-\d{2}-\d{2}$/.test(e.date));
  }

  async function loadSpaceWeather() {
    const end = new Date(), start = new Date(end);
    start.setUTCFullYear(end.getUTCFullYear() - DONKI_YEARS);
    const s = ymd(start), e = ymd(end);
    try {
      const events = await cached(`astro:donki:v3:${s}:${e}`, async () => {
        const types = ["FLR", "CME", "GST", "SEP"];
        const collected = [];
        for (const range of donkiDateRanges(start, end)) {
          const results = await Promise.allSettled(types.map(type => fetchJSON(donkiURL(type, range.start, range.end))));
          const failedIndex = results.findIndex(result => result.status === "rejected");
          if (failedIndex !== -1) {
            const reason = results[failedIndex].reason;
            throw new Error(types[failedIndex] + " " + range.start + "–" + range.end + ": " + (reason.message || String(reason)));
          }
          collected.push(...results.flatMap((result, index) => normalizeDonki(types[index], result.value)));
        }
        return collected;
      });
      const byDate = {};
      events.forEach(ev => (byDate[ev.date] = byDate[ev.date] || []).push(ev));
      Object.assign(store.donki, { status: "ok", byDate, count: events.length, error: "" });
    } catch (error) {
      const message = error.message || String(error);
      console.error("NASA DONKI archive request failed:", message);
      Object.assign(store.donki, { status: "offline", byDate: {}, count: 0, error: message });
    }
  }

  // ---------- OSDR (space biology studies) ----------
  const OSDR_TOPICS = { plant: "plant", radiation: "radiation", muscle: "muscle" };

  // The search API returns Elasticsearch-style hits; accept a few shapes to be safe.
  function parseOsdr(json) {
    const hits = (json && json.hits && json.hits.hits) || (json && json.hits) || (json && json.results) || [];
    return (Array.isArray(hits) ? hits : []).map(h => {
      const s = h._source || h, organism = s.organism || s.Organism || "";
      return { id: String(s.Accession || s["Study Identifier"] || s.accession || s.identifier || ""),
        title: String(s["Study Title"] || s.title || s.name || "").trim(),
        platform: String(s["Experiment Platform"] || ""), program: String(s["Flight Program"] || ""),
        organism: String(Array.isArray(organism) ? organism.join(", ") : organism) };
    }).filter(x => x.title);
  }

  async function osdrSearch(term) {
    const base = `https://osdr.nasa.gov/osdr/data/search?term=${encodeURIComponent(term)}&from=0&size=12&type=cgene`;
    // First try newest studies first; if that sort is rejected, retry without it.
    for (const url of [base + "&sort=Study%20Public%20Release%20Date&order=DESC", base]) {
      try { const list = parseOsdr(await fetchJSON(url)); if (list.length) return list; } catch (e) {}
    }
    return [];
  }

  async function loadOsdr() {
    try {
      const lists = await cached(`astro:osdr:${ymd(new Date())}`, async () => {
        const out = {}, entries = Object.entries(OSDR_TOPICS);
        await Promise.all(entries.map(async ([key, term]) => { out[key] = await osdrSearch(term); }));
        if (entries.every(([key]) => !out[key].length)) throw new Error("OSDR empty");
        return out;
      });
      const count = Object.values(lists).reduce((t, l) => t + l.length, 0);
      Object.assign(store.osdr, { status: "ok", lists, count });
    } catch (err) { Object.assign(store.osdr, { status: "offline", count: 0 }); }
  }

  // ---------- MARS TREK (terrain) ----------
  // Candidate colony sites. elevM / elevIndex / roughness are approximate MOLA values used
  // ONLY as a fallback when the live Mars Trek tile cannot be read.
  // elevIndex: 0 = deepest basin, 1 = highest ground.
  const MARS_SITES = [
    { id: "jezero", name: "Jezero Crater", lat: 18.38, lon: 77.58, elevM: -2600, elevIndex: 0.30, roughness: 0.45 },
    { id: "gale", name: "Gale Crater", lat: -5.4, lon: 137.8, elevM: -4400, elevIndex: 0.22, roughness: 0.55 },
    { id: "hellas", name: "Hellas Planitia", lat: -42.4, lon: 70.5, elevM: -7000, elevIndex: 0.05, roughness: 0.15 },
    { id: "utopia", name: "Utopia Planitia", lat: 46.0, lon: 118.0, elevM: -4200, elevIndex: 0.25, roughness: 0.12 },
    { id: "melas", name: "Valles Marineris (Melas Chasma)", lat: -9.8, lon: -75.6, elevM: -4000, elevIndex: 0.25, roughness: 0.85 },
    { id: "olympus", name: "Olympus Mons flank", lat: 18.65, lon: -133.8, elevM: 6000, elevIndex: 0.85, roughness: 0.6 }
  ];
  const pickMarsSite = () => MARS_SITES[Math.floor(Math.random() * MARS_SITES.length)];

  // Reads a square window of RGBA pixels from the MOLA color-shaded-relief map and returns
  //   roughness: contrast of the hill-shading (0 smooth ... 1 rugged)
  //   elevIndex: relative height from the map's color ramp (blue = low ... red = high), or null if the window is gray
  function analyzeTile(rgba) {
    let n = 0, sum = 0, sum2 = 0, hueN = 0, idxSum = 0;
    for (let i = 0; i < rgba.length; i += 4) {
      const r = rgba[i], g = rgba[i + 1], b = rgba[i + 2], max = Math.max(r, g, b), min = Math.min(r, g, b), lum = .299 * r + .587 * g + .114 * b;
      n++; sum += lum; sum2 += lum * lum;
      if (max > 40 && (max - min) / max > .2) {
        const d = max - min;
        let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
        h = (h * 60 + 360) % 360;
        idxSum += clamp01(1 - h / 300); hueN++;
      }
    }
    const mean = sum / n, std = Math.sqrt(Math.max(0, sum2 / n - mean * mean));
    return { roughness: clamp01((std - 6) / 30), elevIndex: hueN > n * .2 ? idxSum / hueN : null };
  }

  function loadImage(url) {
    return new Promise((resolve, reject) => {
      const img = new Image(), timer = setTimeout(() => reject(new Error("tile timeout")), TIMEOUT);
      img.crossOrigin = "anonymous";   // needed to read pixels; if the server refuses, we fall back
      img.onload = () => { clearTimeout(timer); resolve(img); };
      img.onerror = () => { clearTimeout(timer); reject(new Error("tile error")); };
      img.src = url;
    });
  }

  async function readTrekTile(site) {
    const layer = "Mars_MGS_MOLA_ClrShade_merge_global_463m", z = 6, cols = 2 ** (z + 1), rows = 2 ** z;   // global equirectangular grid: 2x1 tiles at zoom 0
    const fx = (site.lon + 180) / 360 * cols, fy = (90 - site.lat) / 180 * rows, col = Math.floor(fx), row = Math.floor(fy);
    const urls = [
      `https://api.nasa.gov/mars-wmts/catalog/${layer}/1.0.0/default/default028mm/${z}/${row}/${col}.jpg?api_key=${encodeURIComponent(KEY)}`,
      `https://trek.nasa.gov/tiles/Mars/EQ/${layer}/1.0.0/default/default028mm/${z}/${row}/${col}.jpg`
    ];
    let lastError;
    for (const url of urls) {
      try {
        const img = await loadImage(url), canvas = document.createElement("canvas");
        canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        ctx.drawImage(img, 0, 0);
        const w = 31, cx = Math.floor((fx - col) * canvas.width), cy = Math.floor((fy - row) * canvas.height);
        const x0 = Math.max(0, Math.min(canvas.width - w, cx - 15)), y0 = Math.max(0, Math.min(canvas.height - w, cy - 15));
        return analyzeTile(ctx.getImageData(x0, y0, w, w).data);   // throws if the canvas is "tainted" (no CORS)
      } catch (e) { lastError = e; }
    }
    throw lastError;
  }

  const classify = idx => idx < .4 ? "low" : idx > .7 ? "high" : "mid";

  async function loadMarsTerrain(site) {
    const terrain = { ...site, source: "static" };
    try {
      const read = await readTrekTile(site);
      terrain.roughness = read.roughness;
      if (read.elevIndex != null) terrain.elevIndex = read.elevIndex;
      terrain.source = "trek";
    } catch (e) { /* keep the approximate values */ }
    terrain.elevClass = classify(terrain.elevIndex);
    terrain.rugged = terrain.roughness > .5;
    return terrain;
  }

  // ---------- public API ----------
  const api = {
    store, ymd, addDays, DONKI_YEARS, MARS_SITES, pickMarsSite, loadMarsTerrain, analyzeTile, parseOsdr, normalizeDonki, ready: Promise.resolve(),
    stale: () => Date.now() - store.loadedAt > TTL,
    prefetch() {
      store.loadedAt = Date.now(); store.donki.status = "loading"; store.osdr.status = "loading";
      api.ready = Promise.allSettled([loadSpaceWeather(), loadOsdr()]);
      return api.ready;
    }
  };
  return api;
})();
