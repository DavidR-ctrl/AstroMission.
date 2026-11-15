const $ = s => document.querySelector(s);
const clamp = (value, min = 0, max = 120) => Math.max(min, Math.min(max, value));
const DAYS = 30;
const esc = value => String(value == null ? "" : value).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// ---------- GAME DATA ----------
const SITES = {
  moon: { name: "Moon", description: "Base at the south pole: water ice lies in craters, but a long night (about 14 Earth days) leaves the panels with almost no light.",
    sunlight: day => (day >= 10 && day <= 16) ? 0.2 : 1,
    hint: day => day < 10 ? "Lunar night is approaching (days 10–16): charge the batteries." : (day <= 16 ? "LUNAR NIGHT: the panels produce almost no power." : "Sunrise: full sunlight.") },
  mars: { name: "Mars", description: "Crater colony: sunlight is weaker than on the Moon, and dust storms darken the panels.",
    sunlight: day => (day >= 9 && day <= 17) ? 0.35 : 0.75,
    hint: day => day < 9 ? "A dust storm is expected (days 9–17)." : (day <= 17 ? "DUST STORM: low solar power." : "The storm has passed: sunlight at 75%.") }
};

const TASKS = [
  { id: "power", name: "Solar power", description: "Orient and clean panels (+power)" },
  { id: "lifeSupport", name: "Life support", description: "Produces oxygen and water (uses power)" },
  { id: "greenhouse", name: "Greenhouse", description: "Produces food (uses power)" },
  { id: "science", name: "Science and exploration", description: "Earns points; uses power and health" },
  { id: "rest", name: "Rest and health", description: "Restores the crew's health" }
];

const EVENTS = [
  { id: "solarFlare", weight: 2, title: "Alert: solar flare", question: "A monitor detects a storm of particles from the Sun. What do you do?",
    fact: "Without a thick atmosphere or a global magnetic field, radiation reaches the surface directly. Shielded shelters (even when covered with regolith) reduce exposure.",
    options: [{ label: "Take shelter in the shielded module (2 crew members unavailable today)", effect: { lostCrew: 2, health: -2 } },
      { label: "Keep working to save time", effect: { health: -25, science: 5 } }] },
  { id: "micrometeorite", weight: 2, title: "Alert: micrometeorite", question: "An impact punctures a habitat panel, and you hear a hissing sound.",
    fact: "Without an atmosphere to slow them down, even tiny grains travel at enormous speeds. Habitats use protective layers and are inspected after every impact.",
    options: [{ label: "Seal the leak now (1 crew member unavailable tomorrow)", effect: { lostCrew: 1, oxygen: -5 } },
      { label: "Ignore it; there are other priorities", effect: { oxygen: -22 } }] },
  { id: "dust", weight: 2, title: "Warning: dust on the panels", question: "Dust has settled on the panels and reduced their output.",
    fact: "The surface dust is very fine and abrasive, and static electricity makes it cling. Cleaning is essential maintenance for any base.",
    options: [{ label: "Clean them (1 crew member unavailable tomorrow)", effect: { lostCrew: 1 } },
      { label: "Leave them as they are", effect: { power: -25 } }] },
  { id: "greenhouseFailure", weight: 2, title: "Warning: greenhouse failure", question: "The irrigation pump for the crops has broken.",
    fact: "There are no spare-parts shops at a remote base: replacement parts must be planned for, and food supplies carefully measured.",
    options: [{ label: "Repair it now (1 crew member unavailable tomorrow)", effect: { lostCrew: 1, food: -3 } },
      { label: "Ration the food and carry on", effect: { food: -18, health: -5 } }] },
  { id: "waterIce", weight: 1, title: "Opportunity: water ice nearby", question: "Sensors indicate ice just beneath the surface, a short distance away.",
    fact: "Using local resources (ISRU) reduces what must be brought from Earth: water can be used for drinking, breathing (O₂), and fuel.",
    options: [{ label: "Explore the area (1 crew member unavailable tomorrow)", effect: { lostCrew: 1, water: 25, science: 10 } },
      { label: "Ignore it", effect: {} }] },
  { id: "communicationDelay", weight: 1, site: "mars", title: "Warning: communication delay", question: "You ask Earth for instructions, but the reply may take up to 20 minutes.",
    fact: "The distance to Mars delays signals by many minutes: crews must be able to make decisions independently.",
    options: [{ label: "Wait for a reply (1 crew member unavailable tomorrow)", effect: { lostCrew: 1 } },
      { label: "Make the decision yourself", effect: { power: -10, science: 4 } }] }
];


// ---------- NASA-DRIVEN EVENTS (DONKI + OSDR + Mars Trek) ----------
const terrain = () => (state && state.siteId === "mars" && state.nasa) ? state.nasa.terrain : null;
// Mars: a thicker atmosphere (low ground) shields a little more; thin air on high ground shields less.
const radiationFactor = () => { const t = terrain(); return !t ? 1 : t.elevClass === "low" ? 0.75 : t.elevClass === "high" ? 1.3 : 1; };
const radiationHealthLoss = sev => Math.round((14 + 10 * sev) * radiationFactor());
const radiationNote = () => { const t = terrain(); return !t ? "" : t.elevClass === "low" ? " At this low elevation the thicker air shields a little." : t.elevClass === "high" ? " At this high elevation the thin air shields less." : ""; };

function donkiEvent(ev) {
  const when = ev.date, source = { label: "NASA DONKI · " + ev.type + " · " + when, link: ev.link };
  if (ev.type === "FLR") {
    const cls = esc(ev.cls);
    return { id: "donkiFlare", title: "Alert: " + cls + "-class solar flare", source,
      question: "NASA DONKI recorded a " + cls + " flare on " + when + (ev.region ? " (active region " + esc(ev.region) + ")" : "") + ". Radiation is rising on the surface. What do you do?",
      fact: "Real data: " + cls + " flare on " + when + ". Flares are ranked C < M < X, and each letter is 10 times stronger. Without a thick atmosphere or a global magnetic field, radiation reaches the surface directly." + radiationNote(),
      options: [{ label: "Take shelter in the shielded module (2 crew members unavailable today)", effect: { lostCrew: 2, health: -2 } },
        { label: "Keep working to save time", effect: { health: -radiationHealthLoss(ev.sev), science: 5 } }] };
  }
  if (ev.type === "SEP") {
    return { id: "donkiSep", title: "Alert: solar energetic particle event", source,
      question: "NASA DONKI reported a burst of fast solar particles on " + when + ". Dose rates on the surface are climbing. What do you do?",
      fact: "Real data: solar energetic particle event on " + when + ". These protons are the main radiation danger for crews outside Earth's magnetic field." + radiationNote(),
      options: [{ label: "Shelter in the shielded module (2 crew members unavailable today)", effect: { lostCrew: 2, health: -3 } },
        { label: "Keep working outside", effect: { health: -radiationHealthLoss(ev.sev), science: 5 } }] };
  }
  if (ev.type === "CME") {
    const speed = ev.speed ? " (" + Math.round(ev.speed) + " km/s)" : "";
    return { id: "donkiCme", title: "Alert: coronal mass ejection" + speed, source,
      question: "NASA DONKI tracked a coronal mass ejection on " + when + speed + ". A cloud of charged particles may disturb electronics and raise radiation.",
      fact: "Real data: coronal mass ejection on " + when + ". The Sun throws billions of tons of plasma into space; fast ones can overload power systems and electronics." + radiationNote(),
      options: [{ label: "Power down non-essential systems and shelter (1 crew member unavailable today)", effect: { lostCrew: 1, power: -5, health: -2 } },
        { label: "Keep everything running", effect: { power: -Math.round(10 + 10 * ev.sev), health: -Math.round(6 * ev.sev * radiationFactor()) } }] };
  }
  return { id: "donkiGst", title: "Warning: geomagnetic storm (Kp " + ev.kp + ")", source,
    question: "NASA DONKI logged a geomagnetic storm on " + when + " (Kp " + ev.kp + "). The Sun-Earth radio link is degraded, and Mission Control is hard to reach.",
    fact: "Real data: geomagnetic storm on " + when + ". Solar activity that shakes Earth's magnetic field also disturbs radio links with the crew.",
    options: [{ label: "Hold contact with Earth and run local checks (1 crew member unavailable tomorrow)", effect: { lostCrew: 1 } },
      { label: "Press on using your own judgment", effect: { power: -8, science: 4 } }] };
}

function randomDonkiEvent(mission) {
  const byDate = NASA.store.donki.byDate;
  const dates = Object.keys(byDate).filter(date => byDate[date]?.length);
  const unusedDates = dates.filter(date => !mission.nasa.usedDonkiDates.includes(date));
  const choices = unusedDates.length ? unusedDates : dates;
  if (!choices.length) return null;
  const date = choices[Math.floor(Math.random() * choices.length)];
  mission.nasa.usedDonkiDates.push(date);
  const events = byDate[date];
  return events[Math.floor(Math.random() * events.length)];
}

// Mars terrain (from Mars Trek) changes how likely and how costly some events are.
function terrainAdjust(event) {
  const t = terrain(); if (!t) return event;
  let weight = event.weight, result = event;
  if (event.id === "dust") weight *= t.elevClass === "low" ? 1.8 : t.elevClass === "high" ? 0.6 : 1;                // dust settles in basins
  if (event.id === "micrometeorite") weight *= t.elevClass === "high" ? 1.5 : t.elevClass === "low" ? 0.8 : 1;     // thin air at altitude burns up fewer
  if (event.id === "waterIce" && t.rugged) result = { ...event, question: event.question + " The ground around it is steep and rocky.",
    options: event.options.map((o, i) => i === 0 ? { ...o, label: "Explore the rough terrain (2 crew members unavailable tomorrow)", effect: { ...o.effect, lostCrew: 2 } } : o) };
  return { ...result, weight };
}

function terrainEvents() {
  const t = terrain(); if (!t) return [];
  return [{ id: "rockfall", weight: 0.5 + 3 * t.roughness, title: "Warning: rockfall near the habitat", source: { label: "NASA Mars Trek · " + t.name, link: "https://trek.nasa.gov/" },
    question: "Loose rocks tumble down the slope above the base and land close to the habitat.",
    fact: "Steep and rough ground is a real hazard: landing and base sites are chosen on gentle terrain using orbital elevation maps, like the MOLA data behind Mars Trek.",
    options: [{ label: "Secure the slope and clear the rocks (1 crew member unavailable tomorrow)", effect: { lostCrew: 1 } },
      { label: "Ignore it and keep the schedule", effect: { power: -12, oxygen: -8 } }] }];
}

// OSDR studies become research opportunities, linked to a real study from the repository.
function osdrEvents() {
  const o = NASA.store.osdr; if (o.status !== "ok") return [];
  const pick = list => list[Math.floor(Math.random() * list.length)];
  const make = (id, title, intro, fact, list, doIt, skip) => {
    if (!list.length) return null;
    const s = pick(list), name = s.title.length > 110 ? s.title.slice(0, 107) + "…" : s.title;
    return { id, weight: 1.2, title, source: { label: "NASA OSDR · " + (s.id || "study"), link: /^OSD-\d+$/.test(s.id) ? "https://osdr.nasa.gov/bio/repo/data/studies/" + s.id : null },
      question: intro + " Study: “" + esc(name) + "”.", fact: fact + " (Real study: " + esc(s.id || name) + ".)", options: [doIt, skip] };
  };
  return [
    make("osdrPlant", "Research: plants in space", "A botanist proposes repeating a plant-growth protocol from NASA's space biology archive in your greenhouse.",
      "NASA's Open Science Data Repository shares space-flight experiments so crews and scientists can reuse them.", o.lists.plant,
      { label: "Run it in the greenhouse (1 crew member unavailable tomorrow)", effect: { lostCrew: 1, science: 10, food: 6 } }, { label: "Not now", effect: {} }),
    make("osdrRadiation", "Research: radiation and health", "The medical officer wants to apply findings on radiation effects from NASA's space biology archive.",
      "Space radiation and microgravity change the body's cells; OSDR studies help design protection for crews.", o.lists.radiation,
      { label: "Apply the protocol to the crew (1 crew member unavailable tomorrow)", effect: { lostCrew: 1, health: 6, science: 6 } }, { label: "Skip it", effect: {} }),
    make("osdrMuscle", "Research: muscle and bone loss", "The crew doctor suggests an exercise routine based on a muscle and bone study from NASA's archive.",
      "Without gravity's full pull, muscles and bones weaken; exercise countermeasures are studied on the ISS and stored in OSDR.", o.lists.muscle,
      { label: "Add the routine (1 crew member unavailable tomorrow)", effect: { lostCrew: 1, health: 8, science: 4 } }, { label: "Skip it", effect: {} })
  ].filter(Boolean);
}

function chooseWeightedEvent(pool) {
  let roll = Math.random() * pool.reduce((total, event) => total + event.weight, 0);
  return pool.find(event => (roll -= event.weight) <= 0) || pool[0];
}

async function chooseDailyEvent() {
  const mission = state;
  await NASA.ready;
  const historicalEvent = randomDonkiEvent(mission);
  if (historicalEvent) {
    mission.nasa.donkiEvents.push({ type: historicalEvent.type, date: historicalEvent.date, link: historicalEvent.link });
    mission.log.unshift("NASA DONKI archive: " + historicalEvent.type + " event from " + historicalEvent.date + ".");
    return donkiEvent(historicalEvent);
  }

  const donkiLive = NASA.store.donki.status === "ok";   // with real flares available, the simulated flare is retired
  const pool = EVENTS.filter(e => (!e.site || e.site === mission.siteId) && !(donkiLive && e.id === "solarFlare")).map(terrainAdjust).concat(terrainEvents(), osdrEvents());
  const quietWeight = pool.reduce((total, event) => total + event.weight, 0) * 1.2;
  pool.push({ id: "none", weight: quietWeight, title: "Quiet day", question: "Nothing unusual happens today.", source: null, options: [] });
  const selected = chooseWeightedEvent(pool);
  return selected.id === "none" ? null : selected;
}

function startNasaFeeds() {
  const current = state;
  if (NASA.stale()) NASA.prefetch();
  NASA.ready.then(() => {
    if (state !== current) return;
    const d = NASA.store.donki;
    current.log.unshift(d.status === "ok" ? "NASA DONKI archive loaded: " + d.count + " events from the last " + NASA.DONKI_YEARS + " years." : "NASA DONKI is offline (" + esc(d.error || "unknown error") + "); using simulated events.");
    renderApp();
  });
  if (current.siteId === "mars") NASA.loadMarsTerrain(NASA.pickMarsSite()).then(t => {
    if (state !== current) return;
    current.nasa.terrain = t;
    current.log.unshift("Mars Trek: landing site " + t.name + ", " + t.elevClass + " elevation, " + (t.rugged ? "rugged" : "gentle") + " terrain" + (t.source === "trek" ? "." : " (offline estimate)."));
    renderApp();
  });
}

const feedStatus = s => s === "ok" ? "live" : s === "loading" ? "connecting…" : "offline";
const nasaStatusLine = () => "NASA feeds · DONKI: " + feedStatus(NASA.store.donki.status) + (NASA.store.donki.status === "ok" ? " · " + NASA.store.donki.count + " events / " + NASA.DONKI_YEARS + " years" : "") + " · OSDR: " + feedStatus(NASA.store.osdr.status) + " · Mars Trek: on Mars missions";
const terrainHint = t => (t.elevClass === "low" ? "Low basin: more dust on the panels, slightly better radiation shielding." : t.elevClass === "high" ? "High ground: thin air shields less from radiation and stops fewer micrometeorites." : "Mid elevation: altitude has no strong effect.") + (t.rugged ? " Rugged slopes: rockfall risk, and exploring takes more crew." : " Gentle slopes: low rockfall risk.");

function renderApiIndicator(name, label, tone) {
  return `<div class="api-indicator"><span>${esc(name)}</span><b class="api-state api-state--${tone}">${esc(label)}</b></div>`;
}

function renderNasaPanel() {
  const { donki, osdr } = NASA.store, t = state.nasa.terrain;
  const marsLabel = state.siteId !== "mars" ? "used on Mars missions"
    : !t ? "scanning…"
      : t.source === "trek" ? `${t.name} · live`
        : `${t.name} · estimate`;
  const marsTone = state.siteId !== "mars" ? "idle" : !t ? "pending" : t.source === "trek" ? "live" : "offline";
  return `<section class="panel api-panel"><span class="lbl">NASA data · DONKI archive (${NASA.DONKI_YEARS} years)</span>
    <div class="api-grid">
      ${renderApiIndicator("NASA DONKI · space weather", feedStatus(donki.status) + (donki.status === "ok" ? " · " + donki.count + " events" : ""), donki.status === "ok" ? "live" : donki.status === "loading" ? "pending" : "offline")}
      ${renderApiIndicator("NASA OSDR · space biology", feedStatus(osdr.status) + (osdr.status === "ok" ? " · " + osdr.count + " studies" : ""), osdr.status === "ok" ? "live" : osdr.status === "loading" ? "pending" : "offline")}
      ${renderApiIndicator("NASA Mars Trek · MOLA", marsLabel, marsTone)}
    </div>
    <p class="mut api-note">Each day selects one real event from a randomly chosen date in the DONKI archive.</p>
    ${donki.error ? `<p class="api-state--offline api-note">DONKI error: ${esc(donki.error)}</p>` : ""}
    ${state.siteId === "mars" && t ? `<p class="mut">${terrainHint(t)}</p>` : ""}
  </section>`;
}


// ---------- SOUND (Web Audio, no audio files) ----------
let audioContext = null, mute = false;
function beep(f, d = 0.15, type = "square", t0 = 0, vol = 0.05) {
  if (mute) return;
  try {
    audioContext = audioContext || new (window.AudioContext || window.webkitAudioContext)();
    const o = audioContext.createOscillator(), g = audioContext.createGain(), t = audioContext.currentTime + t0;
    o.type = type; o.frequency.value = f;
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
    o.connect(g); g.connect(audioContext.destination); o.start(t); o.stop(t + d);
  } catch (e) {}
}

const sfx = {
  tick: () => beep(520, 0.08, "triangle"),
  alarm: () => { for (let i = 0; i < 4; i++) beep(i % 2 ? 660 : 880, 0.18, "square", i * 0.2); },
  win: () => [392, 523, 659, 784].forEach((f, i) => beep(f, 0.25, "triangle", i * 0.15)),
  lose: () => [330, 262, 196, 147].forEach((f, i) => beep(f, 0.3, "sawtooth", i * 0.22))
};

function toggleSound() { mute = !mute; if (!mute) sfx.tick(); renderApp(); }


// ---------- HORIZON (generated SVG) ----------
function horizon(siteId, sunlight) {
  const moon = siteId === "moon", ground = moon ? "#6e6b62" : "#8a4a2b", far = moon ? "#4d4b45" : "#613320";
  const stars = Array.from({ length: 26 }, (_, i) => `<circle cx="${(i * 97 + 31) % 800}" cy="${(i * 53 + 7) % 50}" r="${i % 5 ? 0.8 : 1.4}" fill="#e9e4d4" opacity="${moon || sunlight > 0.5 ? 0.7 : 0.25}"/>`).join("");
  const craters = [[120, 80, 34], [330, 86, 22], [560, 78, 40], [720, 85, 18]].map(c => `<ellipse cx="${c[0]}" cy="${c[1]}" rx="${c[2]}" ry="${c[2] / 5}" fill="#0000002e"/>`).join("");
  const sun = sunlight > 0.3 || moon && sunlight > 0.15 ? `<circle cx="${640 - sunlight * 60}" cy="${58 - sunlight * 18}" r="${moon ? 9 : 6}" fill="#ffd36b" opacity="${Math.min(1, sunlight + 0.15)}"/>` : "";
  const dust = !moon && sunlight < 0.5 ? `<rect width="800" height="96" fill="#b5651d" opacity=".45"/>` : "";
  const dark = moon && sunlight < 0.5 ? `<rect width="800" height="96" fill="#000" opacity=".4"/>` : "";
  return `<svg class="hz" viewBox="0 0 800 96" preserveAspectRatio="xMidYMid slice" role="img" aria-label="${moon ? "Moon" : "Mars"} horizon">
  <rect width="800" height="96" fill="${moon ? "#05060a" : "#2a1710"}"/>${stars}${sun}
  <path d="M0 66 L90 54 L190 64 L300 50 L420 62 L540 52 L680 64 L800 56 V96 H0Z" fill="${far}"/>
  <path d="M0 78 Q200 68 400 76 T800 72 V96 H0Z" fill="${ground}"/>${craters}
  <g fill="#e9e4d4"><path d="M468 76 a16 14 0 0 1 32 0Z"/><rect x="500" y="68" width="22" height="8"/><rect x="458" y="75" width="70" height="2" fill="#ffb000"/><rect x="530" y="58" width="1.5" height="18"/><circle cx="531" cy="57" r="2.5" fill="#ff5a36"/></g>
  ${dust}${dark}</svg>`;
}


// ---------- STATE ----------
let state = null, pendingEvent = null, eventSelectionPending = false;
const availableCrew = () => Math.max(0, state.crew - state.lostCrew);
const assignedCrew = () => Object.values(state.assignments).reduce((total, count) => total + count, 0);

function fitAssignments() { while (assignedCrew() > availableCrew()) for (const task of ["rest", "science", "greenhouse", "lifeSupport", "power"]) if (state.assignments[task] > 0 && assignedCrew() > availableCrew()) state.assignments[task]--; }

function startMission(siteId) {
  state = { siteId, day: 1, oxygen: 100, water: 100, food: 100, power: 100, health: 100, science: 0, crew: 4, lostCrew: 0,
    assignments: { power: 1, lifeSupport: 1, greenhouse: 1, science: 1, rest: 0 },
    history: { power: 0, lifeSupport: 0, greenhouse: 0, science: 0, rest: 0 },
    log: ["Arrival on " + SITES[siteId].name + ": 4 astronauts, 30-day mission."], gameOver: null, complete: false, nasa: { terrain: null, usedDonkiDates: [], donkiEvents: [] } };
  pendingEvent = null; eventSelectionPending = false; renderApp(); startNasaFeeds();
}

function changeAssignment(taskId, delta) { if (delta > 0 && assignedCrew() >= availableCrew()) return; if (delta < 0 && state.assignments[taskId] <= 0) return; state.assignments[taskId] += delta; renderApp(); }


// ---------- DAILY LOGIC ----------
function endDay() {
  if (eventSelectionPending) return;
  const site = SITES[state.siteId], sunlight = site.sunlight(state.day), assignments = state.assignments;
  for (const taskId in assignments) state.history[taskId] += assignments[taskId];
  const efficiency = state.power > 5 ? 1 : 0.3; // During a blackout, life support and the greenhouse nearly stop.
  const generatedPower = (6 + 10 * assignments.power) * sunlight;
  const usedPower = 10 + 3 * assignments.lifeSupport + 2 * assignments.greenhouse + 4 * assignments.science;
  state.power = clamp(state.power + generatedPower - usedPower);
  state.oxygen = clamp(state.oxygen + 6 * assignments.lifeSupport * efficiency - 6);
  state.water = clamp(state.water + 5 * assignments.lifeSupport * efficiency - 5);
  state.food = clamp(state.food + 4 * assignments.greenhouse * efficiency - 5);
  if (efficiency === 1) state.science += 6 * assignments.science;
  let healthChange = 7 * assignments.rest - 1 - 2 * assignments.science;
  if (state.water <= 0) healthChange -= 15;
  if (state.food <= 0) healthChange -= 10;
  state.health = clamp(state.health + healthChange, 0, 100);
  state.log.unshift("Day " + state.day + ": power " + (generatedPower - usedPower >= 0 ? "+" : "") + Math.round(generatedPower - usedPower) + (efficiency < 1 ? " BLACKOUT!" : "") + ", O₂ " + formatDelta(6 * assignments.lifeSupport * efficiency - 6) + ", water " + formatDelta(5 * assignments.lifeSupport * efficiency - 5) + ", food " + formatDelta(4 * assignments.greenhouse * efficiency - 5) + ".");
  state.lostCrew = 0; state.day++;
  if (checkMissionEnd()) { sfx.lose(); return renderApp(); }
  if (state.day > DAYS) { state.complete = true; sfx.win(); return renderApp(); }
  sfx.tick();
  if (state.day >= 2) {
    const current = state;
    eventSelectionPending = true;
    renderApp();
    chooseDailyEvent().then(event => {
      if (state !== current) return;
      eventSelectionPending = false;
      pendingEvent = event;
      if (pendingEvent) sfx.alarm();
      renderApp();
    }).catch(error => {
      if (state !== current) return;
      eventSelectionPending = false;
      current.log.unshift("Event selection failed; no event was added.");
      console.error("Event selection failed:", error);
      renderApp();
    });
    return;
  }
  renderApp();
}

const formatDelta = value => (value >= 0 ? "+" : "") + Math.round(value);
function checkMissionEnd() {
  if (state.oxygen <= 0) state.gameOver = "You ran out of oxygen. Life support must be functioning to survive away from Earth.";
  else if (state.health <= 0) state.gameOver = "The crew's health reached zero: too much work, too little rest, or not enough water and food.";
  return !!state.gameOver;
}

function chooseEventOption(optionIndex) {
  const option = pendingEvent.options[optionIndex], effects = option.effect;
  for (const resource of ["oxygen", "water", "food", "power", "health"]) {
    if (effects[resource]) state[resource] = clamp(state[resource] + effects[resource], 0, resource === "health" ? 100 : 120);
  }
  if (effects.science) state.science += effects.science;
  if (effects.lostCrew) state.lostCrew += effects.lostCrew;
  state.log.unshift(pendingEvent.title + ": " + option.label.replace(/ \(.*\)/, "") + ". " + pendingEvent.fact);
  pendingEvent = null; fitAssignments(); checkMissionEnd(); renderApp();
}


// ---------- USER INTERFACE ----------
function renderResourceBar(label, value, max = 120, text) {
  const color = value / max < 0.25 ? "var(--bad)" : value / max < 0.5 ? "var(--warn)" : "var(--ok)";
  return `<div><div class="row"><span>${label}</span><b>${text || Math.round(value)}</b></div><div class="bar"><i style="width:${Math.min(100, value / max * 100)}%;background:${color}"></i></div></div>`;
}

const renderCrewSquares = (count, total) => Array.from({ length: total }, (_, i) => `<span class="sq ${i < count ? "on" : ""}"></span>`).join("");
function renderApp() {
  const app = $("#app");
  app.classList.toggle("mission-active", Boolean(state && !state.gameOver && !state.complete));
  if (!state) {
    const jezero = NASA.MARS_SITES.find(site => site.id === "jezero");
    app.innerHTML = `<main class="destination-picker">
      <header class="destination-header">
        <p class="destination-kicker">AstroMission · surface exploration</p>
        <h1>Choose your destination</h1>
        <p class="destination-subtitle">Two worlds. One crew. Thirty days to survive.</p>
      </header>
      <div class="destination-grid">
        ${Object.entries(SITES).map(([siteId, site], index) => `<button class="destination-card destination-card--${siteId}" onclick="startMission('${siteId}')">
          <span class="destination-index">Destination 0${index + 1} · ${siteId === "moon" ? "natural satellite" : "terrestrial planet"}</span>
          <span class="destination-name">${site.name}</span>
          <span class="destination-description">${esc(site.description)}</span>
          <span class="destination-source">${siteId === "moon" ? "NASA Apollo 11 · lunar surface" : `NASA Mars Trek · MOLA · ${esc(jezero.name)} · ${jezero.lat}° N / ${jezero.lon}° E`}</span>
          <span class="destination-action">Start mission <span aria-hidden="true">↗</span></span>
        </button>`).join("")}
      </div>
      <footer class="destination-footer">${nasaStatusLine()}</footer>
    </main>`;
    return;
  }

  if (state.gameOver || state.complete) return renderReport();
  const site = SITES[state.siteId], sunlight = site.sunlight(state.day), crewAvailable = availableCrew();
  app.innerHTML = `
  <div class="top"><h1>${site.name} · day ${state.day}/${DAYS}</h1><div class="tools"><span class="tag">DONKI archive · ${NASA.DONKI_YEARS} years</span><span class="tag">Sunlight ${Math.round(sunlight * 100)}%</span><button class="snd" onclick="toggleSound()">Sound ${mute ? "off" : "on"}</button></div></div>
  ${horizon(state.siteId, sunlight)}
  <p class="mut">${site.hint(state.day)}</p>
  <div class="mission-columns">
    <section class="panel mission-systems"><span class="lbl">Systems · life support</span><div class="grid">
      ${renderResourceBar("Oxygen", state.oxygen)}${renderResourceBar("Water", state.water)}${renderResourceBar("Food", state.food)}${renderResourceBar("Power", state.power)}${renderResourceBar("Health", state.health, 100)}
      <div><div class="row"><span>Science</span><b>${state.science} pts</b></div><div style="margin-top:7px">${renderCrewSquares(crewAvailable, state.crew)}</div><div class="mut">crew available ${crewAvailable}/${state.crew}</div></div>
    </div></section>
    <section class="panel mission-crew"><span class="lbl">Crew assignments · ${assignedCrew()}/${crewAvailable}</span>
      ${TASKS.map(task => `<div class="task"><div><div class="n">${task.name}</div><div class="mut">${task.description}</div></div><div class="ctr"><button onclick="changeAssignment('${task.id}',-1)" ${state.assignments[task.id] <= 0 ? "disabled" : ""}>−</button><b>${state.assignments[task.id]}</b><button onclick="changeAssignment('${task.id}',1)" ${assignedCrew() >= crewAvailable ? "disabled" : ""}>+</button></div></div>`).join("")}
    </section>
  </div>
  <button class="big" onclick="endDay()" ${eventSelectionPending ? "disabled" : ""}>${eventSelectionPending ? "Selecting a historical NASA event…" : "End day " + state.day}</button>
  ${renderNasaPanel()}
  <div class="panel" style="margin-top:16px"><span class="lbl">Log</span><div class="log">${state.log.slice(0, 12).map(entry => `<p>${entry}</p>`).join("")}</div></div>
  ${pendingEvent ? `<div class="modal"><div class="panel"><h2>${pendingEvent.title}</h2>${(() => {
    const sources = pendingEvent.source ? [pendingEvent.source] : [];
    return sources.length ? `<p class="mut event-sources">${sources.map((source, index) => {
      const label = source.title || source.label || "official source";
      const link = source.url || source.link;
      return `${index ? " · " : ""}${esc(label)}${link ? ` <a href="${esc(link)}" target="_blank" rel="noopener">source ${index + 1}</a>` : ""}`;
    }).join("")}</p>` : "";
  })()}<p>${pendingEvent.question}</p>${pendingEvent.options.map((option, index) => `<button onclick="chooseEventOption(${index})">${option.label}</button>`).join("")}</div></div>` : ""}`;
}

function renderReport() {
  const missionWon = state.complete, totalAssignments = Object.values(state.history).reduce((total, count) => total + count, 0) || 1;
  const score = state.science + Math.round(state.health / 2) + Math.round((state.oxygen + state.water + state.food + state.power) / 8);
  const grade = !missionWon ? "—" : score >= 200 ? "S" : score >= 150 ? "A" : score >= 100 ? "B" : "C";
  const donkiEvents = state.nasa.donkiEvents;
  $("#app").innerHTML = `<main class="end-screen ${missionWon ? "end-screen--victory" : "end-screen--gameover"}">
  <section class="end-hero">
    <p class="end-eyebrow">${missionWon ? "Mission complete" : "Mission failed · day " + (state.day - 1)}</p>
    <h1>${missionWon ? "Victory" : "Game Over"}</h1>
    <p>${missionWon ? "The crew survived all 30 days and completed the mission." : esc(state.gameOver)}</p>
    <span class="tag">${missionWon ? "Grade " + grade : "Mission lost"}</span>
  </section>
  <section class="panel end-panel"><span class="lbl">Mission summary</span>
    <p>${missionWon ? "Your crew made it home safely." : esc(state.gameOver)}</p>
    <div class="end-metrics">
      <div><span>Days survived</span><b>${missionWon ? DAYS : Math.max(0, state.day - 1)} / ${DAYS}</b></div>
      <div><span>Science</span><b>${state.science} pts</b></div>
      <div><span>Final health</span><b>${Math.round(state.health)}%</b></div>
      <div><span>Final score</span><b>${missionWon ? score : "—"}</b></div>
    </div>
  </section>
  <section class="panel end-panel"><span class="lbl">NASA DONKI sources</span>
    <p class="mut">Dates and source links for the DONKI events used during this mission.</p>
    ${donkiEvents.length ? `<ul class="donki-source-list">${donkiEvents.map(event => `<li>
      <span><b>Event date:</b> ${esc(event.date)} <span class="donki-event-type">${esc(event.type)}</span></span>
      ${event.link ? `<a href="${esc(event.link)}" target="_blank" rel="noopener">Open NASA DONKI record</a>` : `<span class="mut">Source link unavailable</span>`}
    </li>`).join("")}</ul>` : `<p class="mut">No NASA DONKI events were used during this mission.</p>`}
  </section>
  <section class="panel end-panel"><span class="lbl">Crew time allocation</span><div class="grid">
    ${TASKS.map(task => renderResourceBar(task.name, state.history[task.id] / totalAssignments * 100, 100, state.history[task.id] + " crew-days")).join("")}</div>
    <p class="mut" style="margin-top:12px">Power, air, water, food, and health depend on one another. Running out of a critical resource can end the mission.</p>
  </section>
  <button class="big end-restart" onclick="state=null;renderApp()">Play again</button>
  </main>`;
}
NASA.prefetch().then(renderApp);
renderApp();
