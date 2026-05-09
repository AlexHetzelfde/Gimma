// ════════════════════════════════════════
// CONSTANTEN
// ════════════════════════════════════════
const LS_KEY          = 'wikileer_api_key';
const LS_SR           = 'wikileer_sr';
const LS_LAST_SESSION = 'wikileer_last_session';
const LS_LAYOUT       = 'wikileer_layout';
const LS_CATS         = 'wikileer_categories';
const MAX_TEKST       = 40000;

const INTERVALS = [1, 2, 4, 7, 14, 30];

// ════════════════════════════════════════
// INDEXEDDB LAAG
// ════════════════════════════════════════
const DB_NAAM   = 'wikileer_db';
const DB_VERSIE = 1;
const STORE_KV  = 'kv';
let db = null;
const _memFallback = {};

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAAM, DB_VERSIE);
    req.onupgradeneeded = e => {
      e.target.result.createObjectStore(STORE_KV);
    };
    req.onsuccess = e => resolve(e.target.result);
    req.onerror   = () => reject(req.error);
  });
}

function dbGet(sleutel) {
  if (!db) return Promise.resolve(_memFallback[sleutel] ?? null);
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(STORE_KV, 'readonly');
    const req = tx.objectStore(STORE_KV).get(sleutel);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror   = () => reject(req.error);
  });
}

function dbSet(sleutel, waarde) {
  if (!db) { _memFallback[sleutel] = waarde; return Promise.resolve(); }
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(STORE_KV, 'readwrite');
    const req = tx.objectStore(STORE_KV).put(waarde, sleutel);
    req.onsuccess = () => resolve();
    req.onerror   = () => reject(req.error);
  });
}

function dbDelete(sleutel) {
  if (!db) { delete _memFallback[sleutel]; return Promise.resolve(); }
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(STORE_KV, 'readwrite');
    const req = tx.objectStore(STORE_KV).delete(sleutel);
    req.onsuccess = () => resolve();
    req.onerror   = () => reject(req.error);
  });
}

function dbGetAllKeys() {
  if (!db) return Promise.resolve(Object.keys(_memFallback));
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(STORE_KV, 'readonly');
    const req = tx.objectStore(STORE_KV).getAllKeys();
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

async function migreerVanLocalStorage() {
  const alGedaan = await dbGet('_migratie_gedaan');
  if (alGedaan) return;

  const statischeSleutels = [LS_KEY, LS_SR, LS_LAST_SESSION, LS_CATS];
  const prefixen          = ['wikileer_les_', 'wikileer_prog_'];

  const teVerhuizen = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (!k) continue;
    if (statischeSleutels.includes(k) || prefixen.some(p => k.startsWith(p))) {
      teVerhuizen.push(k);
    }
  }

  for (const k of teVerhuizen) {
    const waarde = localStorage.getItem(k);
    if (waarde !== null) {
      try {
        await dbSet(k, waarde);
        localStorage.removeItem(k);
      } catch (e) {
        console.warn('Migratie mislukt voor', k, e);
      }
    }
  }

  await dbSet('_migratie_gedaan', '1');
}

// ════════════════════════════════════════
// OPSLAG HELPERS
// ════════════════════════════════════════

async function haalKey() {
  return (await dbGet(LS_KEY)) || '';
}

async function slaKeyOp(k) {
  await dbSet(LS_KEY, k.trim());
}

async function haalGecachedeLes() {
  try {
    const raw = await dbGet(vandaagSleutel());
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    console.warn('Fout bij laden gecachede les:', e);
    return null;
  }
}

async function slaLesOp(lesObj) {
  try {
    const sleutels = await dbGetAllKeys();
    for (const k of sleutels) {
      if (typeof k === 'string' && k.startsWith('wikileer_les_') && k !== vandaagSleutel()) {
        await dbDelete(k);
      }
    }
    await dbSet(vandaagSleutel(), JSON.stringify(lesObj));
  } catch (e) {
    console.warn('Fout bij opslaan les:', e);
  }
}

async function haalSRData() {
  try {
    const raw = await dbGet(LS_SR);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    console.warn('Fout bij laden SR data:', e);
    return [];
  }
}

async function slaSRDataOp(data) {
  try {
    await dbSet(LS_SR, JSON.stringify(data));
  } catch (e) {
    console.warn('Fout bij opslaan SR data:', e);
  }
}

function vandaagProgSleutel() {
  return 'wikileer_prog_' + new Date().toISOString().slice(0, 10);
}

async function haalVoortgang() {
  try {
    const raw = await dbGet(vandaagProgSleutel());
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    console.warn('Fout bij laden voortgang:', e);
    return null;
  }
}

async function slaVoortgangOp(obj) {
  try {
    await dbSet(vandaagProgSleutel(), JSON.stringify(obj));
  } catch (e) {
    console.warn('Fout bij opslaan voortgang:', e);
  }
}

async function verwijderVoortgang() {
  try {
    await dbDelete(vandaagProgSleutel());
  } catch (e) {
    console.warn('Fout bij verwijderen voortgang:', e);
  }
}

async function verwijderLesUitSR(artikelTitelStr) {
  const basis = artikelTitelStr.toLowerCase().replace(/[^a-z0-9]/g, '_').slice(0, 40);
  const sr    = (await haalSRData()).filter(item => !item.id.startsWith(basis));
  await slaSRDataOp(sr);
}

async function haalCategorieën() {
  try {
    const raw = await dbGet(LS_CATS);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    console.warn('Fout bij laden categorieën:', e);
    return [];
  }
}

async function slaCategoriënOp(cats) {
  try {
    await dbSet(LS_CATS, JSON.stringify(cats));
  } catch (e) {
    console.warn('Fout bij opslaan categorieën:', e);
  }
}

async function registreerCategorie(naam, kleur) {
  if (!naam || !kleur) return;
  const cats = await haalCategorieën();
  if (!cats.find(c => c.naam === naam)) {
    cats.push({ naam, kleur });
    await slaCategoriënOp(cats);
  }
}

// ════════════════════════════════════════
// CATEGORIE & KLEUR SYSTEEM
// ════════════════════════════════════════

function hexNaarRgb(hex) {
  const clean = (hex || '').replace('#', '');
  if (!/^[0-9a-fA-F]{6}$/.test(clean)) return '237, 91, 54';
  return [
    parseInt(clean.slice(0, 2), 16),
    parseInt(clean.slice(2, 4), 16),
    parseInt(clean.slice(4, 6), 16)
  ].join(', ');
}

function pasCategorieKleurToe(kleur) {
  if (!kleur || !/^#[0-9a-fA-F]{6}$/i.test(kleur)) kleur = '#ed5b36';
  document.documentElement.style.setProperty('--les-kleur', kleur);
  document.documentElement.style.setProperty('--les-kleur-rgb', hexNaarRgb(kleur));
  const dot = document.getElementById('datum-mobiel-dot');
  if (dot) dot.style.background = kleur;
}

let huidigeCategorieKleur = '#ed5b36';
let huidigeCategorieNaam  = '';

// ════════════════════════════════════════
// LAYOUT TOGGLE
// ════════════════════════════════════════
function setLayout(modus) {
  localStorage.setItem(LS_LAYOUT, modus);
  document.body.classList.toggle('layout-telefoon', modus === 'telefoon');
  document.getElementById('knop-desktop').classList.toggle('actief', modus === 'desktop');
  document.getElementById('knop-telefoon').classList.toggle('actief', modus === 'telefoon');
}

function herstelLayout() {
  const opgeslagen = localStorage.getItem(LS_LAYOUT) || 'desktop';
  setLayout(opgeslagen);
}

// ════════════════════════════════════════
// TOAST
// ════════════════════════════════════════
let toastTimer = null;
let pendingSR = [];            // items die aan het eind van de les nog herhaald moeten worden
let smartActive = false;       // vlag voor smart session loop

function toonToast(tekst, duur = 2500) {
  const el = document.getElementById('toast');
  el.textContent = tekst;
  el.classList.add('zichtbaar');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('zichtbaar'), duur);
}

// ════════════════════════════════════════
// STATS MODAL
// ════════════════════════════════════════
function toonStatsModal() {
  document.getElementById('stats-modal').classList.add('zichtbaar');
  renderStats();
}

function sluitStatsModal() {
  document.getElementById('stats-modal').classList.remove('zichtbaar');
}

async function renderStats() {
  const el = document.getElementById('stats-inhoud');
  const sr = await haalSRData();

  if (!sr || sr.length === 0) {
    el.innerHTML = `<div class="stats-leeg">🌱 Nog geen data — maak je eerste les om je voortgang bij te houden.</div>`;
    return;
  }

  const totaal = sr.length;
  const nieuw = sr.filter(i => (i.strength ?? 20) < 35).length;
  const lerend = sr.filter(i => (i.strength ?? 20) >= 35 && (i.strength ?? 20) < 70).length;
  const beheerst = sr.filter(i => (i.strength ?? 20) >= 70).length;
  const gemStr = Math.round(sr.reduce((s, i) => s + (i.strength ?? 20), 0) / totaal);
  const uniekeLessen = new Set(sr.map(i => i.id.replace(/_[^_]+_[^_]+$/, ''))).size;

  const vandaag = Date.now();
  const morgen = new Date(); morgen.setDate(morgen.getDate() + 1); morgen.setHours(23,59,59,999);
  const teHerhalen = sr.filter(i => i.next_due && i.next_due <= vandaag).length;
  const morgenDue = sr.filter(i => i.next_due && i.next_due > vandaag && i.next_due <= morgen.getTime()).length;

  // Komende 7 dagen (exclusief vandaag)
  const komendeDagen = [];
  for (let i = 1; i <= 7; i++) {
    const dagStart = new Date(); dagStart.setDate(dagStart.getDate() + i); dagStart.setHours(0,0,0,0);
    const dagEind = new Date(dagStart); dagEind.setHours(23,59,59,999);
    const count = sr.filter(i => i.next_due && i.next_due >= dagStart.getTime() && i.next_due <= dagEind.getTime()).length;
    komendeDagen.push({ dag: dagStart.toLocaleDateString('nl-NL', { weekday:'short', day:'numeric' }), count });
  }

  // Weekhistorie (laatste 7 dagen)
  const dagNamen = ['zo','ma','di','wo','do','vr','za'];
  const weekData = [];
  for (let d = 6; d >= 0; d--) {
    const dagStart = new Date(); dagStart.setDate(dagStart.getDate() - d); dagStart.setHours(0,0,0,0);
    const dagEind = new Date(dagStart); dagEind.setHours(23,59,59,999);
    const count = sr.filter(i => i.last_seen && i.last_seen >= dagStart.getTime() && i.last_seen <= dagEind.getTime()).length;
    weekData.push({ label: dagNamen[dagStart.getDay()], count, isVandaag: d === 0 });
  }
  const maxWeek = Math.max(...weekData.map(d => d.count), 1);

  // Categorieën verbeterd
  const catMap = {};
  for (const item of sr) {
    const naam = item.categorieNaam || 'Overig';
    const kleur = item.categorieKleur || '#e68a2e';
    if (!catMap[naam]) catMap[naam] = { kleur, items: [], totalStrength: 0, count: 0 };
    catMap[naam].items.push(item.strength ?? 20);
    catMap[naam].totalStrength += (item.strength ?? 20);
    catMap[naam].count++;
  }
  const catLijst = Object.entries(catMap).map(([naam, { kleur, totalStrength, count }]) => ({
    naam, kleur, aantal: count, gemStr: Math.round(totalStrength / count)
  })).sort((a,b) => b.aantal - a.aantal);

  // HTML bouwen
  const nPct = totaal ? Math.round((nieuw/totaal)*100) : 0;
  const lPct = totaal ? Math.round((lerend/totaal)*100) : 0;
  const bPct = totaal ? Math.round((beheerst/totaal)*100) : 0;

  const weekHtml = weekData.map(dag => `
    <div class="stats-week-dag">
      <div class="stats-week-balk-wrap">
        <div class="stats-week-balk ${dag.count > 0 ? 'heeft-data' : ''} ${dag.isVandaag ? 'vandaag-balk' : ''}" style="height:${Math.max(6, Math.round((dag.count/maxWeek)*100))}%"></div>
      </div>
      <div class="stats-week-label ${dag.isVandaag ? 'vandaag-label' : ''}">${dag.label}</div>
    </div>
  `).join('');

  const komendeHtml = komendeDagen.map(d => `
    <div style="text-align:center; font-size:0.7rem; min-width: 32px;">
      <div style="font-weight:600; margin-bottom:2px;">${d.dag}</div>
      <div style="background:var(--les-kleur); border-radius:10px; padding:2px 0; color:#000; font-weight:bold;">${d.count}</div>
    </div>
  `).join('');

  el.innerHTML = `
    <div class="stats-hero">
      <div class="stats-hero-item accent-tegel"><div class="stats-hero-getal">${totaal}</div><div class="stats-hero-label">Vragen geleerd</div></div>
      <div class="stats-hero-item"><div class="stats-hero-getal">${beheerst}</div><div class="stats-hero-label">Beheerst</div></div>
      <div class="stats-hero-item"><div class="stats-hero-getal">${gemStr}%</div><div class="stats-hero-label">Gem. sterkte</div></div>
      <div class="stats-hero-item"><div class="stats-hero-getal">${uniekeLessen}</div><div class="stats-hero-label">Lessen gevolgd</div></div>
    </div>
    <div class="stats-due-balk" style="background:rgba(230,138,46,0.07); border-color:rgba(230,138,46,0.2);">
      <div class="stats-due-tekst">${teHerhalen > 0 ? `🔁 ${teHerhalen} te herhalen vandaag` : (morgenDue > 0 ? `✓ Alles gedaan — morgen ${morgenDue} vragen` : `✓ Geen herhalingen gepland`)}</div>
      <div class="stats-due-getal">${teHerhalen > 0 ? teHerhalen : '✓'}</div>
    </div>
    <div class="stats-sectie-kop">Komende herhalingen (7 dagen)</div>
    <div style="display:flex; gap:0.5rem; justify-content:space-around; margin-bottom:1rem;">${komendeHtml}</div>
    <div class="stats-sectie-kop">Sterkte verdeling</div>
    <div class="stats-verdeling"><div class="stats-verdeling-balk" style="width:${nPct}%;background:var(--fout)"></div><div class="stats-verdeling-balk" style="width:${lPct}%;background:var(--accent)"></div><div class="stats-verdeling-balk" style="width:${bPct}%;background:var(--goed)"></div></div>
    <div class="stats-legenda">
      <span class="stats-legenda-item"><span class="stats-legenda-dot" style="background:var(--fout)"></span>Nieuw (${nieuw})</span>
      <span class="stats-legenda-item"><span class="stats-legenda-dot" style="background:var(--accent)"></span>Aan het leren (${lerend})</span>
      <span class="stats-legenda-item"><span class="stats-legenda-dot" style="background:var(--goed)"></span>Beheerst (${beheerst})</span>
    </div>
    <div class="stats-sectie-kop">Activiteit (7 dagen)</div>
    <div class="stats-week-wrap">${weekHtml}</div>
    <div class="stats-sectie-kop">Categorieën</div>
    <div>${catLijst.map(c => `
      <div class="stats-cat-rij">
        <div class="stats-cat-dot" style="background:${c.kleur}"></div>
        <div class="stats-cat-naam">${c.naam}</div>
        <div class="stats-cat-balk-wrap"><div class="stats-cat-balk" style="width:${c.gemStr}%;background:${sterktekleur(c.gemStr)}"></div></div>
        <div class="stats-cat-getal">${c.gemStr}%</div>
        <div class="stats-cat-getal" style="min-width:36px;text-align:right">${c.aantal} ✦</div>
      </div>
    `).join('')}</div>
  `;
}

// ════════════════════════════════════════
// DATUM / TIJD HELPERS
// ════════════════════════════════════════
function vandaagSleutel() {
  return 'wikileer_les_' + new Date().toISOString().slice(0, 10);
}

function getTomorrow() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function getEndOfDay() {
  const d = new Date();
  d.setHours(23, 59, 59, 999);
  return d.getTime();
}

// ════════════════════════════════════════
// SR ALGORITME
// ════════════════════════════════════════
function getMaxStep(strength) {
  if (strength < 20) return 0;
  if (strength < 40) return 1;
  if (strength < 60) return 2;
  if (strength < 75) return 3;
  if (strength < 90) return 4;
  return 5;
}

async function lastSessionToday() {
  const val = await dbGet(LS_LAST_SESSION);
  return val === new Date().toISOString().slice(0, 10);
}

async function markSessionDone() {
  try {
    await dbSet(LS_LAST_SESSION, new Date().toISOString().slice(0, 10));
  } catch (e) {
    console.warn('Fout bij markeren sessie:', e);
  }
}

async function getDueItems() {
  const sr      = await haalSRData();
  const vandaag = await lastSessionToday();
  const threshold = vandaag ? Date.now() : getEndOfDay();
  return sr
    .filter(item => item.next_due && item.next_due <= threshold)
    .sort((a, b) => {
      const sA = a.strength ?? 20;
      const sB = b.strength ?? 20;
      if (sA !== sB) return sA - sB;
      return (a.next_due ?? 0) - (b.next_due ?? 0);
    });
}

async function registreerAntwoord({ id, vraag, type, antwoordData, goed }) {
  const sr  = await haalSRData();
  const idx = sr.findIndex(v => v.id === id);
  const now    = Date.now();
  const morgen = getTomorrow();

  if (idx === -1) {
    const basisStrength = 20;
    let strength      = goed ? Math.min(100, basisStrength + 10) : Math.max(0, Math.floor(basisStrength * 0.5));
    let interval_step = 0;
    let next_due      = morgen;

    if (goed) {
      interval_step = Math.min(1, getMaxStep(strength));
      next_due      = now + INTERVALS[interval_step] * 24 * 60 * 60 * 1000;
    }

    sr.push({
      id, vraag, type,
      ...antwoordData,
      categorieKleur: huidigeCategorieKleur,
      categorieNaam:  huidigeCategorieNaam,
      strength, interval_step, next_due,
      streak:    goed ? 1 : 0,
      last_seen: now
    });

  } else {
    const item = sr[idx];
    Object.assign(item, antwoordData);
    item.last_seen = now;

    if (!item.categorieKleur && huidigeCategorieKleur) {
      item.categorieKleur = huidigeCategorieKleur;
      item.categorieNaam  = huidigeCategorieNaam;
    }

    if (goed) {
      item.streak        = (item.streak || 0) + 1;
      item.strength      = Math.min(100, (item.strength || 20) + 10);
      const maxStap      = getMaxStep(item.strength);
      item.interval_step = Math.min((item.interval_step || 0) + 1, maxStap);
      item.next_due      = now + INTERVALS[item.interval_step] * 24 * 60 * 60 * 1000;
    } else {
      item.streak        = 0;
      item.strength      = Math.max(0, Math.floor((item.strength || 20) * 0.5));
      item.interval_step = 0;
      item.next_due      = morgen;
    }
  }

  await slaSRDataOp(sr);
}

function maakVraagId(artikelTitel, sectieIndex, vraagIndex) {
  const basis = artikelTitel.toLowerCase().replace(/[^a-z0-9]/g, '_').slice(0, 40);
  return `${basis}_s${sectieIndex}_v${vraagIndex}`;
}

function sterktekleur(strength) {
  if (strength < 35) return 'var(--fout)';
  if (strength < 65) return 'var(--accent)';
  return 'var(--goed)';
}

// ════════════════════════════════════════
// DATUM IN HEADER + MOBILE DATUMBALK
// ════════════════════════════════════════
const datumTekst = new Date().toLocaleDateString('nl-NL', {
  weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
});

document.getElementById('header-datum').textContent = datumTekst;

const datumMobielEl = document.getElementById('datum-mobiel-tekst');
if (datumMobielEl) {
  datumMobielEl.textContent = datumTekst;
}

// ════════════════════════════════════════
// LOGO KLIKKEN — terug naar home
// ════════════════════════════════════════
function logoKlikken() {
  const inLes   = document.getElementById('les-scherm').classList.contains('zichtbaar');
  const inKlaar = document.getElementById('klaar-scherm').classList.contains('zichtbaar');
  if (inLes || inKlaar) {
    toonTerugNaarHomeModal();
  }
}

function toonTerugNaarHomeModal() {
  document.getElementById('terug-home-modal').classList.add('zichtbaar');
}

function sluitTerugNaarHomeModal() {
  document.getElementById('terug-home-modal').classList.remove('zichtbaar');
}

async function bevestigTerugNaarHome() {
  sluitTerugNaarHomeModal();

  document.getElementById('les-scherm').classList.remove('zichtbaar');
  document.getElementById('klaar-scherm').classList.remove('zichtbaar');
  document.getElementById('shields-balk').style.display = 'none';
  document.getElementById('les-voortgang').classList.remove('zichtbaar');
  document.getElementById('les-voortgang').classList.remove('vervaag');
  document.getElementById('les-voortgang-balk').style.width = '0%';

  lesData      = null;
  inVraagModus = false;

  await toonHomescreen();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ════════════════════════════════════════
// INIT
// ════════════════════════════════════════
async function init() {
  const key = await haalKey();
  if (!key) {
    document.getElementById('key-scherm').classList.add('zichtbaar');
  } else {
    await toonHomescreen();
  }
}

// ════════════════════════════════════════
// HOMESCREEN
// ════════════════════════════════════════
async function toonHomescreen() {
  document.getElementById('key-scherm').classList.remove('zichtbaar');
  document.getElementById('key-knop-header').style.display = 'flex';
  document.getElementById('homescreen').classList.add('zichtbaar');

  const cache     = await haalGecachedeLes();
  const voortgang = await haalVoortgang();
  const dueItems  = await getDueItems();

  // Categorie‑chip
  const chip = document.getElementById('categorie-chip');
  if (cache && cache.categorieKleur) {
    huidigeCategorieKleur = cache.categorieKleur;
    huidigeCategorieNaam  = cache.categorie || '';
    pasCategorieKleurToe(cache.categorieKleur);
    document.getElementById('categorie-dot').style.background = cache.categorieKleur;
    document.getElementById('categorie-naam-tekst').textContent = cache.categorie || '';
    chip.style.display = '';
  } else {
    chip.style.display = 'none';
  }

  // Bepaal statussen
  const lesVoltooid = voortgang && voortgang.voltooid;
  const heeftCache = !!cache;
  const heeftDue = dueItems.length > 0;

  // Knoppen wrapper zichtbaar
  document.getElementById('home-knoppen-wrap').style.display = 'flex';

  // ── SMART SESSION ──
  const smartBtn = document.getElementById('knop-smart');
  const smartSub = document.getElementById('smart-sub');
  if (!heeftDue && (lesVoltooid || !heeftCache)) {
    // Niks te doen
    smartBtn.disabled = true;
    smartBtn.setAttribute('data-tip', 'Alles is al gedaan vandaag');
    smartSub.textContent = 'Je bent helemaal bij! 🎉';
  } else {
    smartBtn.disabled = false;
    smartBtn.removeAttribute('data-tip');
    const delen = [];
    if (heeftDue) delen.push(`${dueItems.length} herhaling${dueItems.length>1?'en':''}`);
    if (!lesVoltooid) delen.push('les van vandaag');
    smartSub.textContent = delen.join(' + ');
  }

  // ── VAULT PRACTICE ──
  const vaultBtn = document.getElementById('knop-vault');
  const vaultSub = document.getElementById('vault-sub');
  if (!heeftDue) {
    vaultBtn.disabled = true;
    vaultBtn.setAttribute('data-tip', 'Alles bij! Geen herhalingen nodig');
    vaultSub.textContent = 'Je kluis is leeg';
  } else {
    vaultBtn.disabled = false;
    vaultBtn.removeAttribute('data-tip');
    vaultSub.textContent = `${dueItems.length} vraag${dueItems.length>1?'en':''} klaar voor herhaling`;
  }

  // ── LES VAN DE DAG ──
  const lesBtn = document.getElementById('knop-les-nieuw');
  const lesSub = document.getElementById('les-sub');
  if (lesVoltooid) {
    lesBtn.disabled = false;
    lesBtn.onclick = toonAlGemaaktModal;
    lesSub.textContent = 'Al voltooid — bekijk/opnieuw';
  } else if (!heeftCache) {
    lesBtn.disabled = false;
    lesBtn.onclick = startLesVanVandaag;
    lesSub.textContent = 'Nieuwe les genereren';
  } else if (voortgang && !voortgang.voltooid) {
    const sectieTekst = `sectie ${voortgang.sectieIndex + 1}${voortgang.inVragen ? `, vraag ${(voortgang.vraagIndex || 0) + 1}` : ''}`;
    lesBtn.disabled = false;
    lesBtn.onclick = startLesVanVandaag;
    lesSub.textContent = `Hervatten bij ${sectieTekst}`;
  } else {
    lesBtn.disabled = false;
    lesBtn.onclick = startLesVanVandaag;
    lesSub.textContent = 'Les staat klaar';
  }

  // Oude elementen verbergen (fallback)
  document.getElementById('knop-les').style.display = 'none';
  document.getElementById('cache-melding').style.display = 'none';

  await renderCategorieOverzicht();
}

// ═══ SMART SESSION ═══
async function startSmartSession() {
  const dueItems = await getDueItems();
  const voortgang = await haalVoortgang();
  const lesVoltooid = voortgang && voortgang.voltooid;
  
  if (dueItems.length > 0) {
    smartActive = true;
    toonSRReview(dueItems);
  } else if (!lesVoltooid) {
    await maakLes();
  }
}

// ═══ VAULT PRACTICE ═══
async function startVaultPractice() {
  const dueItems = await getDueItems();
  if (dueItems.length > 0) {
    smartActive = false;
    toonSRReview(dueItems);
  }
}

// ═══ LES VAN DE DAG starten met SR aan het eind ═══
async function startLesVanVandaag() {
  const dueItems = await getDueItems();
  pendingSR = dueItems.length > 0 ? dueItems : [];
  await maakLes();
}

// ════════════════════════════════════════
// CATEGORIE OVERZICHT (homescreen)
// ════════════════════════════════════════
async function renderCategorieOverzicht() {
  const cats = await haalCategorieën();
  const el   = document.getElementById('categorie-overzicht');
  if (!el) return;
  if (!cats || cats.length === 0) { el.style.display = 'none'; return; }
  el.innerHTML = cats.map(c =>
    `<span class="cat-chip" style="border-color:rgba(${hexNaarRgb(c.kleur)},0.4);color:${c.kleur}">
      <span class="cat-chip-dot" style="background:${c.kleur}"></span>${c.naam}
    </span>`
  ).join('');
  el.style.display = 'flex';
}

// ════════════════════════════════════════
// CATEGORIE BADGE (reader header)
// ════════════════════════════════════════
function updateReaderCatBadge() {
  const el = document.getElementById('reader-cat-badge');
  if (!el) return;
  if (huidigeCategorieNaam) {
    el.textContent = '● ' + huidigeCategorieNaam;
    el.style.color = huidigeCategorieKleur || 'var(--muted)';
    el.style.display = '';
  } else {
    el.style.display = 'none';
  }
}

// ════════════════════════════════════════
// SR REVIEW — rondes totdat alles goed is
// ════════════════════════════════════════
function toonSRReview(dueItems) {
  const wrap = document.getElementById('sr-review-wrap');
  wrap.style.display = 'block';

  let rondeNummer = 1;
  let rondeWachtrij = [...dueItems];
  let rondeResultaten = [];

  const inhoud = document.getElementById('sr-vragen-inhoud');
  inhoud.innerHTML = '';

  function updateSubTitel(huidigeIndex) {
    const rondeLabel = rondeNummer > 1 ? ` · ronde ${rondeNummer}` : '';
    document.getElementById('sr-review-sub').textContent =
      `Vraag ${huidigeIndex + 1} van ${rondeWachtrij.length}${rondeLabel}`;
  }

  function startRonde() {
    rondeResultaten = new Array(rondeWachtrij.length).fill(null);
    toonSRVraag(0);
  }

  function toonSREinde() {
    inhoud.innerHTML = '';
    const fouteItems = rondeWachtrij.filter((_, i) => rondeResultaten[i] && !rondeResultaten[i].goed);

    if (fouteItems.length > 0) {
      rondeWachtrij = fouteItems;
      rondeNummer++;
      document.getElementById('sr-review-sub').textContent =
        `${fouteItems.length} vraag${fouteItems.length !== 1 ? 'en' : ''} nog fout · ronde ${rondeNummer}`;

      const melding = document.createElement('div');
      melding.style.cssText = 'text-align:center;padding:2rem 1rem 1.5rem;';
      melding.innerHTML = `
        <div style="font-size:2rem;margin-bottom:0.65rem;line-height:1">🔁</div>
        <div style="font-family:'Lora',serif;font-size:1.05rem;font-weight:600;color:var(--text);margin-bottom:0.4rem;">
          Nog niet helemaal goed
        </div>
        <div style="font-size:0.87rem;color:var(--muted);line-height:1.6;max-width:320px;margin:0 auto 1.5rem;">
          ${fouteItems.length} vraag${fouteItems.length !== 1 ? 'en' : ''} 
          ${fouteItems.length !== 1 ? 'komen' : 'komt'} terug.
          Je kan pas door als alles goed is.
        </div>
      `;
      inhoud.appendChild(melding);
      const knopOpnieuw = document.createElement('button');
      knopOpnieuw.className = 'knop-primair';
      knopOpnieuw.style.cssText = 'width:100%;';
      knopOpnieuw.textContent = `Opnieuw oefenen (${fouteItems.length}) →`;
      knopOpnieuw.addEventListener('click', () => {
        inhoud.innerHTML = '';
        startRonde();
      });
      inhoud.appendChild(knopOpnieuw);
      window.scrollTo({ top: wrap.offsetTop - 40, behavior: 'smooth' });
    } else {
      document.getElementById('sr-review-sub').textContent = 'Alles goed! 🎉';
      const scoreEl = document.getElementById('sr-score-tekst');
      if (rondeNummer === 1) {
        scoreEl.innerHTML = `<strong>Alles in één ronde goed!</strong> Knap gedaan. 🎉`;
      } else {
        scoreEl.innerHTML = `<strong>Alles onthouden!</strong> Na ${rondeNummer} rondes alles goed. 💪`;
      }
      const klaarBalk = document.getElementById('sr-klaar-balk');
      klaarBalk.style.display = 'flex';
      window.scrollTo({ top: wrap.offsetTop - 40, behavior: 'smooth' });
    }
  }

  function toonSRVraag(index) {
    if (index >= rondeWachtrij.length) {
      toonSREinde();
      return;
    }

    updateSubTitel(index);
    inhoud.innerHTML = '';
    window.scrollTo({ top: wrap.offsetTop - 40, behavior: 'smooth' });

    const item = rondeWachtrij[index];
    const itemKleur = item.categorieKleur || '#ed5b36';
    const itemRgb = hexNaarRgb(itemKleur);
    const vraagType = item.type || 'flashcard';

    const blok = document.createElement('div');
    blok.className = 'vraag-blok';
    blok.style.background = `rgba(${itemRgb}, 0.08)`;
    blok.style.border = `1px solid rgba(${itemRgb}, 0.25)`;
    blok.style.borderRadius = '8px';
    blok.style.padding = '1.1rem 1.2rem';
    blok.style.marginBottom = '0';

    const strength = item.strength ?? 20;
    const kleur = sterktekleur(strength);
    const catTagHtml = item.categorieNaam
      ? `<span class="sr-cat-tag" style="background:rgba(${itemRgb},0.15);color:${itemKleur}">● ${item.categorieNaam}</span>`
      : '';

    const sterkteMeter = `
      <div class="sr-sterkte-balk-wrap">
        <span class="sr-sterkte-label">Sterkte</span>
        <div class="sr-sterkte-balk">
          <div class="sr-sterkte-vulling" style="width:${strength}%; background:${kleur}"></div>
        </div>
        <span class="sr-sterkte-label">${strength}%</span>
        ${catTagHtml}
      </div>`;

    function maakVolgendeKnop() {
      const knopWrap = document.createElement('div');
      knopWrap.style.marginTop = '1rem';
      const isLaatste = index === rondeWachtrij.length - 1;
      const knop = document.createElement('button');
      knop.className = 'knop-primair';
      knop.style.width = '100%';
      knop.textContent = isLaatste ? 'Bekijk resultaat →' : 'Volgende →';
      knop.addEventListener('click', () => toonSRVraag(index + 1));
      knopWrap.appendChild(knop);
      blok.appendChild(knopWrap);
    }

    function verwerkAntwoord(goed, antwoordData) {
      rondeResultaten[index] = { goed };
      const voorheen = [huidigeCategorieKleur, huidigeCategorieNaam];
      huidigeCategorieKleur = itemKleur;
      huidigeCategorieNaam = item.categorieNaam || '';
      registreerAntwoord({
        id: item.id,
        vraag: item.vraag,
        type: vraagType,
        antwoordData: antwoordData,
        goed
      });
      [huidigeCategorieKleur, huidigeCategorieNaam] = voorheen;
      setTimeout(() => maakVolgendeKnop(), 400);
    }

    // ─────────────────────────────────────────
    // MULTIPLE CHOICE UI
    // ─────────────────────────────────────────
    if (vraagType === 'multiplechoice') {
      const opties = item.opties || [];
      const correcteIndex = item.correcteIndex;

      // shuffle opties
      let optiesMetIndex = opties.map((opt, idx) => ({ opt, idx }));
      for (let i = optiesMetIndex.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [optiesMetIndex[i], optiesMetIndex[j]] = [optiesMetIndex[j], optiesMetIndex[i]];
      }

      blok.innerHTML = `
        ${sterkteMeter}
        <div class="vraag-tekst" style="color:var(--text); margin-bottom:1rem;">${item.vraag}</div>
        <div class="opties-grid" id="sr-mc-opties-${index}"></div>
      `;

      const optiesContainer = blok.querySelector(`#sr-mc-opties-${index}`);
      let beantwoord = false;

      optiesMetIndex.forEach(({ opt, idx }) => {
        const knop = document.createElement('button');
        knop.className = 'optie-knop';
        knop.textContent = opt;
        knop.addEventListener('click', () => {
          if (beantwoord) return;
          beantwoord = true;
          const gekozenIndex = idx;
          const goed = (gekozenIndex === correcteIndex);
          // disable alle opties
          optiesContainer.querySelectorAll('.optie-knop').forEach(b => b.disabled = true);
          if (goed) {
            knop.classList.add('goed');
          } else {
            knop.classList.add('fout');
            const correcteKnop = Array.from(optiesContainer.querySelectorAll('.optie-knop')).find(
              (b, i) => optiesMetIndex[i].idx === correcteIndex
            );
            if (correcteKnop) correcteKnop.classList.add('gemist');
          }
          verwerkAntwoord(goed, {
            vraag: item.vraag,
            opties: opties,
            correcteIndex: correcteIndex,
            gekozenIndex: gekozenIndex
          });
        });
        optiesContainer.appendChild(knop);
      });
      inhoud.appendChild(blok);
    }
    // ─────────────────────────────────────────
    // FLASHCARD UI (open vraag)
    // ─────────────────────────────────────────
    else {
      const antwoord = item.antwoord || item.goed || '';
      blok.innerHTML = `
        ${sterkteMeter}
        <div class="vraag-tekst" style="color:var(--text)">${item.vraag}</div>
        <div class="flashcard-onthul-wrap" id="sr-onthul-${index}">
          <button class="knop-onthul">Tik om het antwoord te zien ↓</button>
        </div>
        <div class="flashcard-antwoord-wrap" id="sr-antwoord-${index}" style="display:none">
          <div class="flashcard-antwoord sr-flashcard-antwoord">${antwoord}</div>
          <div class="flashcard-goed-fout">
            <button class="knop-flashcard-fout" id="sr-fout-${index}">✗ Fout</button>
            <button class="knop-flashcard-goed" id="sr-goed-${index}">✓ Goed</button>
          </div>
        </div>
      `;
      let beantwoord = false;
      blok.querySelector('.knop-onthul').addEventListener('click', () => {
        document.getElementById(`sr-onthul-${index}`).style.display = 'none';
        document.getElementById(`sr-antwoord-${index}`).style.display = 'block';
      });
      blok.querySelector(`#sr-goed-${index}`).addEventListener('click', () => {
        if (beantwoord) return;
        beantwoord = true;
        blok.querySelector(`#sr-goed-${index}`).classList.add('actief-goed');
        blok.querySelector(`#sr-fout-${index}`).disabled = true;
        verwerkAntwoord(true, { antwoord: antwoord });
      });
      blok.querySelector(`#sr-fout-${index}`).addEventListener('click', () => {
        if (beantwoord) return;
        beantwoord = true;
        blok.querySelector(`#sr-fout-${index}`).classList.add('actief-fout');
        blok.querySelector(`#sr-goed-${index}`).disabled = true;
        verwerkAntwoord(false, { antwoord: antwoord });
      });
      inhoud.appendChild(blok);
    }
  }

  startRonde();
}

async function afrondSRReview() {
  await markSessionDone();
  document.getElementById('sr-review-wrap').style.display = 'none';

  // Als we in een smart session zitten, start dan de les
  if (smartActive) {
    smartActive = false;
    const lesVoltooid = (await haalVoortgang())?.voltooid;
    if (!lesVoltooid) {
      await maakLes();
      return;
    }
    // anders terug naar home
    await toonHomescreen();
    window.scrollTo({ top: 0, behavior: 'smooth' });
    return;
  }

  // Normale vault practice of einde-les SR: terug naar home
  await toonHomescreen();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ════════════════════════════════════════
// KEY BEHEER
// ════════════════════════════════════════
async function slaKeyOpEnStart() {
  const invoer = document.getElementById('key-invoer-setup').value.trim();
  const fout   = document.getElementById('key-fout-setup');
  if (!invoer.startsWith('AIza') || invoer.length < 20) {
    fout.textContent = 'Vul een geldige Gemini API key in (begint met AIza...)';
    return;
  }
  fout.textContent = '';
  await slaKeyOp(invoer);
  await toonHomescreen();
}

function toonKeyModal() {
  document.getElementById('key-invoer-modal').value = '';
  document.getElementById('key-fout-modal').textContent = '';
  document.getElementById('key-modal').classList.add('zichtbaar');
  setTimeout(() => document.getElementById('key-invoer-modal').focus(), 50);
}

function sluitKeyModal() {
  document.getElementById('key-modal').classList.remove('zichtbaar');
}

async function slaKeyOpViaModal() {
  const invoer = document.getElementById('key-invoer-modal').value.trim();
  const fout   = document.getElementById('key-fout-modal');
  if (!invoer.startsWith('AIza') || invoer.length < 20) {
    fout.textContent = 'Vul een geldige Gemini API key in (begint met AIza...)';
    return;
  }
  await slaKeyOp(invoer);
  sluitKeyModal();
  toonToast('✓ API key opgeslagen');
}

// ════════════════════════════════════════
// AL GEMAAKT MODAL
// ════════════════════════════════════════
function toonAlGemaaktModal() {
  document.getElementById('algemaakt-modal').classList.add('zichtbaar');
}

function sluitAlGemaaktModal() {
  document.getElementById('algemaakt-modal').classList.remove('zichtbaar');
}

async function herbeginLes() {
  sluitAlGemaaktModal();
  const cache = await haalGecachedeLes();
  if (cache) await verwijderLesUitSR(cache.titel);
  await verwijderVoortgang();
  await maakLes();
}

// ════════════════════════════════════════
// STATUS / LAADBALK
// ════════════════════════════════════════
let schijnInterval = null;

function setStatus(tekst, voortgang, shimmer = false) {
  document.getElementById('status-wrap').classList.add('zichtbaar');
  document.getElementById('status-tekst').textContent = tekst;
  document.getElementById('laadbalk').style.width = voortgang + '%';
  document.getElementById('laadbalk-shimmer').style.display = shimmer ? 'block' : 'none';
}

function startSchijnVoortgang(van, tot) {
  let huidige = van;
  schijnInterval = setInterval(() => {
    huidige = Math.min(huidige + 0.6, tot);
    document.getElementById('laadbalk').style.width = huidige + '%';
  }, 600);
}

function stopSchijnVoortgang() {
  if (schijnInterval) { clearInterval(schijnInterval); schijnInterval = null; }
  document.getElementById('laadbalk-shimmer').style.display = 'none';
}

function verbergStatus() {
  stopSchijnVoortgang();
  document.getElementById('status-wrap').classList.remove('zichtbaar');
}

function toonFout(bericht) {
  document.getElementById('fout-wrap').innerHTML =
    `<div class="fout-melding">⚠️ ${bericht}</div>`;
  document.getElementById('knop-les').disabled = false;
}

// ════════════════════════════════════════
// WIKIPEDIA — ARTIKEL OPHALEN (English)
// ════════════════════════════════════════
async function haalUitgelichtArtikel() {
  try {
    const res = await fetch('https://en.wikipedia.org/w/api.php?action=parse&page=Main_Page&prop=text&format=json&origin=*');
    if (!res.ok) throw new Error('Main Page niet bereikbaar');
    const data = await res.json();
    const doc  = new DOMParser().parseFromString(data.parse.text['*'], 'text/html');

    let titel = null;
    const uitgelichtDiv = doc.querySelector('#mp-tfa');
    if (uitgelichtDiv) {
      const link = uitgelichtDiv.querySelector('a[href^="/wiki/"]:not([href*=":"])');
      if (link) titel = decodeURIComponent(link.getAttribute('href').replace('/wiki/', '').replace(/_/g, ' '));
    }

    if (!titel) {
      for (const link of doc.querySelectorAll('a[href^="/wiki/"]:not([href*=":"])')) {
        const t = decodeURIComponent(link.getAttribute('href').replace('/wiki/', '').replace(/_/g, ' '));
        if (t && t !== 'Main Page' && link.textContent.length > 3) { titel = t; break; }
      }
    }

    if (titel) return titel;
  } catch (e) {
    console.warn('Main Page-scraping mislukt, val terug op willekeurig artikel:', e);
  }

  const fallbackRes = await fetch(
    'https://en.wikipedia.org/w/api.php?action=query&list=random&rnnamespace=0&rnlimit=1&format=json&origin=*'
  );
  if (!fallbackRes.ok) throw new Error('Kon geen Wikipedia-artikel ophalen');
  const fallbackData = await fallbackRes.json();
  const titel = fallbackData?.query?.random?.[0]?.title;
  if (!titel) throw new Error('Wikipedia gaf geen artikeltitel terug');
  return titel;
}

async function haalVolledigeTekst(titel) {
  const url = `https://en.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(titel)}&prop=extracts&explaintext=true&format=json&origin=*`;
  const res  = await fetch(url);
  if (!res.ok) throw new Error('Kon het artikel niet ophalen');
  const data = await res.json();
  const page = Object.values(data.query.pages)[0];
  if (!page || page.missing) throw new Error(`Artikel "${titel}" niet gevonden`);
  return { titel: page.title, tekst: page.extract };
}

// ════════════════════════════════════════
// WIKIPEDIA — AFBEELDINGEN OPHALEN (English)
// ════════════════════════════════════════
async function haalAfbeeldingen(titel) {
  try {
    const res = await fetch(
      `https://en.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(titel)}&prop=images&imlimit=30&format=json&origin=*`
    );
    if (!res.ok) return [];
    const data = await res.json();
    const page = Object.values(data.query.pages)[0];
    if (!page || !page.images) return [];

    const bestandsnamen = page.images
      .map(img => img.title)
      .filter(t => {
        const l = t.toLowerCase();
        return (l.endsWith('.jpg') || l.endsWith('.jpeg') || l.endsWith('.png')) &&
          !l.includes('icon') && !l.includes('logo') && !l.includes('flag') &&
          !l.includes('commons') && !l.includes('wikimedia') && !l.includes('edit-') &&
          !l.includes('button') && !l.includes('arrow') && !l.includes('question') &&
          !l.includes('stub') && !l.includes('portal') && !l.includes('disambig');
      })
      .slice(0, 12);

    if (bestandsnamen.length === 0) return [];

    const titelsParam = bestandsnamen.join('|');
    const infoRes = await fetch(
      `https://en.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(titelsParam)}&prop=imageinfo&iiprop=url|size|extmetadata&iiurlwidth=720&format=json&origin=*`
    );
    if (!infoRes.ok) return [];
    const infoData = await infoRes.json();

    const resultaat = [];
    for (const p of Object.values(infoData.query.pages)) {
      if (!p.imageinfo?.[0]) continue;
      const info = p.imageinfo[0];

      if ((info.width || 0) < 250 || (info.height || 0) < 180) continue;

      const meta = info.extmetadata || {};
      const beschrijving = (
        meta.ImageDescription?.value?.replace(/<[^>]*>/g, '').trim() ||
        meta.ObjectName?.value ||
        p.title.replace('File:', '').replace(/_/g, ' ').replace(/\.[^.]+$/, '')
      ).slice(0, 400);

      resultaat.push({
        naam: p.title.replace('File:', ''),
        url:  info.thumburl || info.url,
        beschrijving,
        breedte: info.width,
        hoogte:  info.height
      });
    }

    return resultaat;
  } catch (e) {
    console.warn('Afbeeldingen ophalen mislukt:', e);
    return [];
  }
}

// ════════════════════════════════════════
// GEMINI — TWEE CALLS
// ════════════════════════════════════════

async function geminiCall(key, prompt) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${key}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.7 }
    })
  });

  if (!res.ok) {
    const fout = await res.json().catch(() => ({}));
    const msg  = fout?.error?.message || '';
    if (res.status === 400 && msg.toLowerCase().includes('api key'))
      throw new Error('Ongeldige API key. Klik op ⚙ in de header om hem te wijzigen.');
    if (res.status === 429)
      throw new Error('Gemini dagelijks limiet bereikt. Probeer morgen opnieuw.');
    throw new Error(msg || `Gemini API fout (${res.status})`);
  }

  const data = await res.json();
  const ruwe = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!ruwe) throw new Error('Gemini gaf geen antwoord terug');

  let schoon = ruwe.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
  const eersteAccolade  = schoon.indexOf('{');
  const laatsteAccolade = schoon.lastIndexOf('}');
  if (eersteAccolade !== -1 && laatsteAccolade !== -1)
    schoon = schoon.slice(eersteAccolade, laatsteAccolade + 1);

  try {
    return JSON.parse(schoon);
  } catch {
    const afgekort = !ruwe.trimEnd().endsWith('}');
    if (afgekort)
      throw new Error('Gemini-antwoord werd afgekapt. Probeer het opnieuw — bij een lang artikel kan dit soms voorkomen.');
    throw new Error('Kon JSON niet verwerken. Eerste 300 tekens: ' + ruwe.slice(0, 300));
  }
}

async function verwerkTekstMetGemini(titel, tekst) {
  const key  = await haalKey();
  const cats = await haalCategorieën();

  let afbeeldingen = [];
  try {
    afbeeldingen = await haalAfbeeldingen(titel);
  } catch (e) {
    console.warn('Afbeeldingen ophalen mislukt, ga door zonder:', e);
  }

  const ingekorte = tekst.length > MAX_TEKST
    ? tekst.slice(0, MAX_TEKST) + '\n\n[tekst ingekort vanwege lengte]'
    : tekst;

  const catsTekst = cats.length > 0
    ? `Bestaande categorieën (gebruik er één als die goed past, met exact dezelfde naam en kleur):\n${JSON.stringify(cats.map(c => ({ naam: c.naam, kleur: c.kleur })), null, 2)}`
    : 'Er zijn nog geen bestaande categorieën — maak een nieuwe aan.';

  const bestaandeKleuren = cats.map(c => c.kleur).join(', ') || 'geen';

  const afbeeldingenTekst = afbeeldingen.length > 0
    ? `BESCHIKBARE AFBEELDINGEN UIT DIT ARTIKEL:\n${afbeeldingen.map(a => `• "${a.naam}": ${a.beschrijving}`).join('\n')}\n\nAFBEELDING REGELS:\n- Voeg per sectie MAXIMAAL ÉÉN afbeelding toe\n- ALLEEN als de sectietekst een visueel concept uitlegt waarbij een foto begripsvorming significant verbetert\n- Denk aan: architectonische onderdelen, anatomie, geografische structuren, historische objecten, technische schema's, biologische soorten, kunstwerken, kaarten\n- NIET gebruiken voor: portretten, algemene sfeerbeelden, niet-visuele concepten (politiek, filosofie, etc.)\n- De waarde van "afbeelding" moet EXACT een bestandsnaam uit de lijst hierboven zijn\n- Als geen afbeelding passend is: gebruik null`
    : 'Er zijn geen geschikte afbeeldingen beschikbaar voor dit artikel. Gebruik altijd null voor het afbeelding-veld.';

  const prompt = `Je bent een professionele schrijver die Engelstalige Wikipedia-artikelen omzet naar heldere, boeiende Nederlandstalige lessen.

Je krijgt het Engelstalige Wikipedia-artikel: "${titel}"

TAAL: De brontekst is in het Engels. Schrijf ALLE output — sectietitels, sectieteksten, tijdlijnen — uitsluitend in correct, vloeiend Nederlands. Vertaal en herschrijf de inhoud; kopieer nooit Engelse zinnen letterlijk over.

JOUW TAAK:
1. Bepaal hoeveel secties nodig zijn (minimaal 3, maximaal 6) op basis van de lengte en complexiteit van het artikel
2. Schrijf elke sectietekst in goed, helder Nederlands — alsof je een enthousiaste maar heldere journalist bent
3. Schrijf echte alinea's, geen droge opsommingen of bullet points
4. Voeg een tijdlijn toe ALLEEN als het artikel duidelijke historische data/gebeurtenissen bevat. Laat het tijdlijn-veld anders volledig weg.
5. Bepaal de categorie en bijbehorende kleur (zie regels hieronder)
6. Kies per sectie eventueel een afbeelding (zie afbeeldingsregels hieronder)

CATEGORIE & KLEUR:
${catsTekst}

Regels voor nieuwe categorieën:
- Korte Nederlandse naam, maximaal 20 tekens
- Voorbeelden: "Biologie", "Middeleeuwse geschiedenis", "Sterrenkunde", "Filosofie", "Architectuur", "Technologie", "Geografie", "Kunst & cultuur"
- Kleur moet goed leesbaar zijn op donkere achtergrond (#0f0f0f)
- Niet te donker (perceived lightness > 50%), niet bruin/zwart/wit
- Duidelijk anders dan bestaande kleuren: ${bestaandeKleuren}
- Goede kleurvoorbeelden: #7cb9e8, #e07b6a, #82d4b0, #c9a0dc, #f4c56a, #6fbad4, #e8926a

${afbeeldingenTekst}

GEEF JE ANTWOORD UITSLUITEND ALS GELDIGE JSON — geen uitleg, geen markdown, geen backticks.

{
  "categorie": "Naam van de categorie",
  "categorieKleur": "#hexkleur",
  "secties": [
    {
      "titel": "Titel van de sectie",
      "tekst": "De herschreven leesbare tekst in het Nederlands. Gebruik \\n\\n tussen alinea's.",
      "afbeelding": "Exacte_bestandsnaam.jpg",
      "tijdlijn": [{"jaar": "1850", "gebeurtenis": "Wat er gebeurde"}]
    }
  ]
}

ARTIKEL TEKST (Engels):
${ingekorte}`;

  const resultaat = await geminiCall(key, prompt);

  if (resultaat.secties && afbeeldingen.length > 0) {
    for (const sectie of resultaat.secties) {
      if (sectie.afbeelding && sectie.afbeelding !== 'null') {
        const naamGemini = sectie.afbeelding.toLowerCase().replace(/\.[^.]+$/, '');
        const match = afbeeldingen.find(a => {
          const aNaam = a.naam.toLowerCase().replace(/\.[^.]+$/, '');
          return aNaam === naamGemini ||
                 aNaam.includes(naamGemini) ||
                 naamGemini.includes(aNaam);
        });
        if (match) {
          sectie.afbeeldingUrl = match.url;
        } else {
          sectie.afbeelding    = null;
          sectie.afbeeldingUrl = null;
        }
      } else {
        sectie.afbeelding    = null;
        sectie.afbeeldingUrl = null;
      }
    }
  }

  return resultaat;
}

// ════════════════════════════════════════
// GEMINI — FLASHCARD VRAGEN GENEREREN
// ════════════════════════════════════════
async function maakVragenMetGemini(titel, secties) {
  const key = await haalKey();

  const sectiesVoorVragen = secties.map((s, i) => ({
    sectie: i + 1,
    titel:  s.titel,
    tekst:  s.tekst
  }));

  const prompt = `Je bent een professionele toetsenmaker. Hieronder staat een herschreven Nederlandstalige les over "${titel}", verdeeld in secties. Maak per sectie 2 à 3 vragen. Elke vraag is willekeurig OF een multiple choice vraag (met 4 opties, 1 juist) OF een flashcard vraag (open vraag met antwoord). Je kiest zelf per vraag welk type het beste past. Zorg voor een afwisseling.

TAAL: Alle vragen en antwoorden in het Nederlands.

MULTIPLE CHOICE REGELS:
- Precies 4 opties, waarvan 1 correct.
- De drie andere opties zijn aannemelijk fout.
- Voeg "opties": ["optie1","optie2","optie3","optie4"] en "correcteIndex" (0..3) toe.

FLASHCARD REGELS:
- Gebruik type "flashcard"
- Vraag en antwoord zoals vroeger (antwoord is een korte zin).

GEEF JE ANTWOORD UITSLUITEND ALS JSON — geen uitleg, geen markdown.
Gebruik voor elke vraag dit formaat:

{
  "secties": [
    {
      "vragen": [
        {
          "type": "multiplechoice",
          "vraag": "Wat was de belangrijkste oorzaak?",
          "opties": ["optie A", "optie B", "optie C", "optie D"],
          "correcteIndex": 0
        },
        {
          "type": "flashcard",
          "vraag": "Wat is de hoofdstad van Frankrijk?",
          "antwoord": "Parijs"
        }
      ]
    }
  ]
}

LES INHOUD:
${JSON.stringify(sectiesVoorVragen, null, 2)}`;

  return await geminiCall(key, prompt);
}

async function verwerkMetGemini(titel, tekst) {
  const tekstResultaat = await verwerkTekstMetGemini(titel, tekst);

  if (!tekstResultaat.secties || tekstResultaat.secties.length === 0) {
    throw new Error('Gemini kon het artikel niet in secties opdelen. Probeer het opnieuw.');
  }

  if (tekstResultaat.categorie && tekstResultaat.categorieKleur) {
    await registreerCategorie(tekstResultaat.categorie, tekstResultaat.categorieKleur);
  }

  await new Promise(r => setTimeout(r, 500));

  const vragenResultaat = await maakVragenMetGemini(titel, tekstResultaat.secties);

  if (!vragenResultaat.secties || vragenResultaat.secties.length === 0) {
    throw new Error('Gemini kon geen vragen genereren. Probeer het opnieuw.');
  }

  const secties = tekstResultaat.secties.map((sectie, i) => ({
    ...sectie,
    vragen: vragenResultaat.secties[i]?.vragen || []
  }));

  return {
    categorie:      tekstResultaat.categorie,
    categorieKleur: tekstResultaat.categorieKleur,
    secties
  };
}

// ════════════════════════════════════════
// HOOFDFUNCTIE — LES MAKEN
// ════════════════════════════════════════
let lesData      = null;
let artikelTitel = '';

async function maakLes() {
  document.getElementById('knop-les').disabled = true;
  document.getElementById('fout-wrap').innerHTML = '';

  const cache = await haalGecachedeLes();
  if (cache) {
    lesData      = { secties: cache.secties };
    artikelTitel = cache.titel;

    huidigeCategorieKleur = cache.categorieKleur || '#c8a96e';
    huidigeCategorieNaam  = cache.categorie || '';
    pasCategorieKleurToe(huidigeCategorieKleur);

    await startLes();
    return;
  }

  try {
    setStatus('Wikipedia hoofdpagina ophalen...', 10);
    const naam = await haalUitgelichtArtikel();

    setStatus(`"${naam}" ophalen...`, 22);
    const { titel, tekst } = await haalVolledigeTekst(naam);
    artikelTitel = titel;

    setStatus('Artikel en afbeeldingen verwerken...', 35, true);
    startSchijnVoortgang(35, 62);
    lesData = await verwerkMetGemini(titel, tekst);

    stopSchijnVoortgang();

    huidigeCategorieKleur = lesData.categorieKleur || '#c8a96e';
    huidigeCategorieNaam  = lesData.categorie || '';
    pasCategorieKleurToe(huidigeCategorieKleur);

    setStatus('Les klaar!', 100);

    await slaLesOp({
      titel:          artikelTitel,
      secties:        lesData.secties,
      categorie:      lesData.categorie,
      categorieKleur: lesData.categorieKleur
    });

    setTimeout(async () => {
      verbergStatus();
      await startLes();
    }, 400);

  } catch (err) {
    stopSchijnVoortgang();
    verbergStatus();
    toonFout(err.message);
  }
}

// ════════════════════════════════════════
// LES FLOW — GLOBALE STAAT
// ════════════════════════════════════════
let huidigeSectie    = 0;
let huidigeVraag     = 0;
let inVraagModus     = false;
let sessieAntwoorden = [];
let vraagResultaten  = {};

function setLeesKaart(zichtbaar) {
  document.getElementById('lees-kaart').style.display = zichtbaar ? 'block' : 'none';
}

function renderShields() {
  const balk = document.getElementById('shields-balk');
  balk.innerHTML = '';

  if (!lesData) return;

  lesData.secties.forEach((sectie, si) => {
    if (si > 0) {
      const sep = document.createElement('div');
      sep.className = 'shield-sep';
      balk.appendChild(sep);
    }
    sectie.vragen.forEach((_, vi) => {
      const id  = maakVraagId(artikelTitel, si, vi);
      const el  = document.createElement('div');
      el.className = 'shield-item';
      el.title = `Sectie ${si + 1}, vraag ${vi + 1}`;

      const res = vraagResultaten[id];
      if (res === 'goed') {
        el.classList.add('goed');
      } else if (res === 'fout') {
        el.classList.add('fout');
      } else if (inVraagModus && si === huidigeSectie && vi === huidigeVraag) {
        el.classList.add('huidig');
      }

      balk.appendChild(el);
    });
  });
}

function updateVoortgangsbalk() {
  const pct = Math.round((huidigeSectie / lesData.secties.length) * 100);
  document.getElementById('les-voortgang-balk').style.width = pct + '%';
}

function vulSectieInhoud(si) {
  const sectie  = lesData.secties[si];
  const tekstEl = document.getElementById('sectie-tekst');
  tekstEl.innerHTML = '';

  if (sectie.afbeelding && sectie.afbeeldingUrl) {
    const imgWrap = document.createElement('div');
    imgWrap.className = 'sectie-afbeelding';
    const caption = sectie.afbeelding
      .replace(/\.[^.]+$/, '')
      .replace(/_/g, ' ');
    imgWrap.innerHTML = `
      <img
        src="${sectie.afbeeldingUrl}"
        alt="${caption}"
        loading="lazy"
        onerror="this.closest('.sectie-afbeelding').style.display='none'"
      />
      <div class="sectie-afbeelding-caption">${caption}</div>
    `;
    tekstEl.appendChild(imgWrap);
  }

  sectie.tekst.split(/\n\n+/).filter(a => a.trim()).forEach(a => {
    const p = document.createElement('p');
    p.textContent = a.trim();
    tekstEl.appendChild(p);
  });

  const tijdlijnInhoud = document.getElementById('tijdlijn-inhoud');
  tijdlijnInhoud.innerHTML = sectie.tijdlijn && sectie.tijdlijn.length > 0
    ? sectie.tijdlijn.map(t =>
        `<div class="tijdlijn-rij">
          <span class="tijdlijn-jaar">${t.jaar}</span>
          <span>${t.gebeurtenis}</span>
        </div>`).join('')
    : '';
}

async function startLes() {
  document.getElementById('homescreen').classList.remove('zichtbaar');
  pasCategorieKleurToe(huidigeCategorieKleur);

  const voortgangBalk = document.getElementById('les-voortgang');
  voortgangBalk.classList.remove('vervaag');
  voortgangBalk.classList.add('zichtbaar');
  document.getElementById('les-scherm').classList.add('zichtbaar');
  document.getElementById('shields-balk').style.display = 'flex';

  sessieAntwoorden = [];
  inVraagModus     = false;

  const opgeslagen = await haalVoortgang();

  if (opgeslagen && !opgeslagen.voltooid && opgeslagen.sectieIndex != null) {
    vraagResultaten = opgeslagen.vraagResultaten || {};
    huidigeSectie = opgeslagen.sectieIndex;
    vulSectieInhoud(huidigeSectie);

    if (opgeslagen.inVragen && opgeslagen.vraagIndex != null) {
      toonVraag(opgeslagen.vraagIndex);
    } else {
      toonSectie(huidigeSectie);
    }
  } else {
    vraagResultaten = {};
    huidigeSectie = 0;
    toonSectie(0);
  }
}

function toonSectie(index) {
  huidigeSectie = index;
  huidigeVraag  = 0;
  inVraagModus  = false;

  updateVoortgangsbalk();
  window.scrollTo({ top: 0, behavior: 'smooth' });

  slaVoortgangOp({
    sectieIndex: index,
    inVragen:    false,
    voltooid:    false,
    titel:       artikelTitel,
    vraagResultaten: vraagResultaten
  });

  const sectie = lesData.secties[index];
  const totaal = lesData.secties.length;

  document.getElementById('sectie-label-tekst').textContent  = artikelTitel;
  document.getElementById('sectie-titel').textContent        = sectie.titel;
  document.getElementById('sectie-nummer-tekst').textContent = `Pagina ${index + 1} van ${totaal}`;

  const dot = document.getElementById('sectie-label-dot');
  if (huidigeCategorieKleur) {
    dot.style.background = huidigeCategorieKleur;
    dot.style.display    = 'inline-block';
  } else {
    dot.style.display = 'none';
  }

  updateReaderCatBadge();
  vulSectieInhoud(index);

  setLeesKaart(true);
  document.getElementById('sectie-tekst').style.display = 'block';

  const tijdlijnWrap = document.getElementById('tijdlijn-wrap');
  tijdlijnWrap.style.display = (sectie.tijdlijn && sectie.tijdlijn.length > 0) ? 'block' : 'none';

  document.getElementById('knop-gelezen-wrap').style.display      = 'block';
  document.getElementById('vragen-sectie').style.display           = 'none';
  document.getElementById('terug-naar-vraag-balk').style.display   = 'none';
  document.getElementById('knop-volgende').disabled                = true;

  renderShields();
}

function toonVraag(vi) {
  huidigeVraag = vi;
  inVraagModus = true;

  updateVoortgangsbalk();

  const sectie      = lesData.secties[huidigeSectie];
  const vraag       = sectie.vragen[vi];
  const vraagId     = maakVraagId(artikelTitel, huidigeSectie, vi);
  const aantalInSec = sectie.vragen.length;
  const isLaatste   = vi === aantalInSec - 1;
  const isLaatsteSec = huidigeSectie === lesData.secties.length - 1;

  slaVoortgangOp({
    sectieIndex: huidigeSectie,
    vraagIndex:  vi,
    inVragen:    true,
    voltooid:    false,
    titel:       artikelTitel,
    vraagResultaten: vraagResultaten
  });

  document.getElementById('sectie-label-tekst').textContent  = artikelTitel;
  document.getElementById('sectie-titel').textContent        = sectie.titel;
  document.getElementById('sectie-nummer-tekst').textContent = `Vraag ${vi + 1} van ${aantalInSec}`;

  updateReaderCatBadge();

  setLeesKaart(false);
  document.getElementById('terug-naar-vraag-balk').style.display  = 'none';
  document.getElementById('vragen-sectie').style.display          = 'block';

  // 'Weet niet' knop zichtbaar
  const weetNietBtn = document.getElementById('knop-weetniets');
  if (weetNietBtn) weetNietBtn.style.display = 'inline-flex';
  const kijkOpBtn = document.getElementById('knop-kijkop');
  if (kijkOpBtn) kijkOpBtn.style.display = 'inline-flex';

  const knopVolgende = document.getElementById('knop-volgende');
  knopVolgende.disabled = true;
  if (isLaatste && isLaatsteSec) {
    knopVolgende.textContent = 'Afronden →';
  } else if (isLaatste) {
    knopVolgende.textContent = `Volgende sectie →`;
  } else {
    knopVolgende.textContent = 'Volgende →';
  }
  knopVolgende.onclick = () => {
    if (isLaatste) {
      volgendeSectie();
    } else {
      toonVraag(vi + 1);
    }
  };

  const inhoud = document.getElementById('vragen-inhoud');
  inhoud.innerHTML = '';

  // --- Bepaal type vraag ---
  const vraagType = vraag.type || 'flashcard';

  if (vraagType === 'multiplechoice') {
    // --- Meerkeuze UI ---
    const opties = vraag.opties || [];
    const correcteIndex = vraag.correcteIndex;
    let optiesMetIndex = opties.map((opt, idx) => ({ opt, idx }));
    for (let i = optiesMetIndex.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [optiesMetIndex[i], optiesMetIndex[j]] = [optiesMetIndex[j], optiesMetIndex[i]];
    }

    const blok = document.createElement('div');
    blok.className = 'vraag-blok';
    let beantwoord = false;
    let gekozenIndex = -1;

    function onAntwoord(goed) {
      if (beantwoord) return;
      beantwoord = true;
      vraagResultaten[vraagId] = goed ? 'goed' : 'fout';
      sessieAntwoorden.push({ sectieIndex: huidigeSectie, vraagIndex: vi, id: vraagId, goed });
      registreerAntwoord({
        id: vraagId, vraag: vraag.vraag, type: 'multiplechoice',
        antwoordData: { vraag: vraag.vraag, opties, correcteIndex, gekozenIndex }, goed
      });
      if (weetNietBtn) weetNietBtn.style.display = 'none';
      if (kijkOpBtn) kijkOpBtn.style.display = 'none';
      knopVolgende.disabled = false;
      slaVoortgangOp({ sectieIndex: huidigeSectie, vraagIndex: vi, inVragen: true, voltooid: false, titel: artikelTitel, vraagResultaten });
      renderShields();
    }

    const vraagDiv = document.createElement('div');
    vraagDiv.className = 'vraag-tekst';
    vraagDiv.textContent = vraag.vraag;
    blok.appendChild(vraagDiv);

    const optiesDiv = document.createElement('div');
    optiesDiv.className = 'opties-grid';
    optiesDiv.style.cssText = 'display:flex;flex-direction:column;gap:0.65rem;margin-top:1rem';
    optiesMetIndex.forEach(({ opt, idx }) => {
      const knop = document.createElement('button');
      knop.className = 'optie-knop';
      knop.textContent = opt;
      knop.addEventListener('click', () => {
        if (beantwoord) return;
        gekozenIndex = idx;
        const goed = (gekozenIndex === correcteIndex);
        optiesDiv.querySelectorAll('.optie-knop').forEach(b => b.disabled = true);
        if (goed) knop.classList.add('goed');
        else {
          knop.classList.add('fout');
          const correcteKnop = Array.from(optiesDiv.querySelectorAll('.optie-knop')).find((b, i) => optiesMetIndex[i].idx === correcteIndex);
          if (correcteKnop) correcteKnop.classList.add('gemist');
        }
        onAntwoord(goed);
      });
      optiesDiv.appendChild(knop);
    });
    blok.appendChild(optiesDiv);
    inhoud.appendChild(blok);
  } else {
    // --- FLASHCARD UI (open vraag) ---
    const antwoord = vraag.antwoord || '';
    const blok = document.createElement('div');
    blok.className = 'vraag-blok';
    let beantwoord = false;

    blok.innerHTML = `
      <div class="vraag-tekst">${vraag.vraag}</div>
      <div class="flashcard-onthul-wrap" id="fc-onthul-wrap-${vi}">
        <button class="knop-onthul">Tik om het antwoord te zien ↓</button>
      </div>
      <div class="flashcard-antwoord-wrap" id="fc-antwoord-wrap-${vi}" style="display:none">
        <div class="flashcard-antwoord">${antwoord}</div>
        <div class="flashcard-goed-fout">
          <button class="knop-flashcard-fout" id="fc-fout-${vi}">✗ Fout</button>
          <button class="knop-flashcard-goed" id="fc-goed-${vi}">✓ Goed</button>
        </div>
      </div>
    `;

    function onFlashcardAntwoord(goed) {
      if (beantwoord) return;
      beantwoord = true;
      vraagResultaten[vraagId] = goed ? 'goed' : 'fout';
      sessieAntwoorden.push({ sectieIndex: huidigeSectie, vraagIndex: vi, id: vraagId, goed });
      registreerAntwoord({
        id: vraagId, vraag: vraag.vraag, type: 'flashcard',
        antwoordData: { antwoord }, goed
      });
      if (weetNietBtn) weetNietBtn.style.display = 'none';
      if (kijkOpBtn) kijkOpBtn.style.display = 'none';
      knopVolgende.disabled = false;
      slaVoortgangOp({ sectieIndex: huidigeSectie, vraagIndex: vi, inVragen: true, voltooid: false, titel: artikelTitel, vraagResultaten });
      renderShields();
    }

    blok.querySelector('.knop-onthul').onclick = () => {
      document.getElementById(`fc-onthul-wrap-${vi}`).style.display = 'none';
      document.getElementById(`fc-antwoord-wrap-${vi}`).style.display = 'block';
      if (kijkOpBtn) kijkOpBtn.style.display = 'none';
    };
    blok.querySelector(`#fc-goed-${vi}`).onclick = () => {
      if (beantwoord) return;
      blok.querySelector(`#fc-goed-${vi}`).classList.add('actief-goed');
      blok.querySelector(`#fc-fout-${vi}`).disabled = true;
      onFlashcardAntwoord(true);
    };
    blok.querySelector(`#fc-fout-${vi}`).onclick = () => {
      if (beantwoord) return;
      blok.querySelector(`#fc-fout-${vi}`).classList.add('actief-fout');
      blok.querySelector(`#fc-goed-${vi}`).disabled = true;
      onFlashcardAntwoord(false);
    };
    inhoud.appendChild(blok);
  }

  renderShields();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function markeerHuidigeVraagFout() {
  if (!inVraagModus) return;
  const sectie = lesData.secties[huidigeSectie];
  const vraag = sectie.vragen[huidigeVraag];
  const vraagId = maakVraagId(artikelTitel, huidigeSectie, huidigeVraag);

  // Bepaal antwoordData op basis van type
  let antwoordData = {};
  if (vraag.type === 'multiplechoice') {
    antwoordData = {
      vraag: vraag.vraag,
      opties: vraag.opties,
      correcteIndex: vraag.correcteIndex,
      gekozenIndex: -1
    };
  } else {
    antwoordData = { antwoord: vraag.antwoord || '' };
  }

  vraagResultaten[vraagId] = 'fout';
  sessieAntwoorden.push({ sectieIndex: huidigeSectie, vraagIndex: huidigeVraag, id: vraagId, goed: false });
  registreerAntwoord({
    id: vraagId,
    vraag: vraag.vraag,
    type: vraag.type || 'flashcard',
    antwoordData,
    goed: false
  });

  // UI feedback: toon het juiste antwoord
  const inhoud = document.getElementById('vragen-inhoud');
  const blok = inhoud.querySelector('.vraag-blok');
  if (blok) {
    if (vraag.type === 'multiplechoice') {
      const optieKnoppen = blok.querySelectorAll('.optie-knop');
      optieKnoppen.forEach(btn => btn.disabled = true);
      const correcteOptie = Array.from(optieKnoppen).find((btn, idx) => {
        const optieTekst = btn.textContent;
        return optieTekst === vraag.opties[vraag.correcteIndex];
      });
      if (correcteOptie) correcteOptie.classList.add('gemist');
      const feedback = document.createElement('div');
      feedback.className = 'feedback fout';
      feedback.textContent = `Weet niet – juiste antwoord: ${vraag.opties[vraag.correcteIndex]}`;
      blok.appendChild(feedback);
    } else {
      // Flashcard: toon antwoord als dat nog niet gebeurd is
      const antwoordWrap = blok.querySelector('.flashcard-antwoord-wrap');
      if (antwoordWrap && antwoordWrap.style.display !== 'block') {
        blok.querySelector('.flashcard-onthul-wrap').style.display = 'none';
        antwoordWrap.style.display = 'block';
      }
      const feedback = document.createElement('div');
      feedback.className = 'feedback fout';
      feedback.textContent = `Weet niet – het juiste antwoord is: ${vraag.antwoord || '?'}`;
      blok.appendChild(feedback);
    }
  }

  document.getElementById('knop-weetniets').style.display = 'none';
  document.getElementById('knop-kijkop').style.display = 'none';
  document.getElementById('knop-volgende').disabled = false;

  slaVoortgangOp({
    sectieIndex: huidigeSectie,
    vraagIndex: huidigeVraag,
    inVragen: true,
    voltooid: false,
    titel: artikelTitel,
    vraagResultaten
  });
  renderShields();
}

function toonTekstLookup() {
  inVraagModus = false;

  const sectie = lesData.secties[huidigeSectie];

  document.getElementById('sectie-titel').textContent        = sectie.titel;
  document.getElementById('sectie-nummer-tekst').textContent = 'Kijk op in de tekst';

  updateReaderCatBadge();

  setLeesKaart(true);
  document.getElementById('sectie-tekst').style.display = 'block';

  const tijdlijnWrap = document.getElementById('tijdlijn-wrap');
  tijdlijnWrap.style.display = (sectie.tijdlijn && sectie.tijdlijn.length > 0) ? 'block' : 'none';

  document.getElementById('vragen-sectie').style.display         = 'none';
  document.getElementById('terug-naar-vraag-balk').style.display = 'block';

  renderShields();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function terugNaarVraag() {
  inVraagModus = true;

  const sectie = lesData.secties[huidigeSectie];
  const aantalInSec = sectie.vragen.length;

  document.getElementById('sectie-label-tekst').textContent  = artikelTitel;
  document.getElementById('sectie-titel').textContent        = sectie.titel;
  document.getElementById('sectie-nummer-tekst').textContent = `Vraag ${huidigeVraag + 1} van ${aantalInSec}`;

  updateReaderCatBadge();

  setLeesKaart(false);
  document.getElementById('terug-naar-vraag-balk').style.display  = 'none';
  document.getElementById('vragen-sectie').style.display          = 'block';

  renderShields();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ── Volgende sectie ──
function volgendeSectie() {
  huidigeSectie++;
  inVraagModus = false;
  if (huidigeSectie >= lesData.secties.length) {
    startHerhaling();
  } else {
    toonSectie(huidigeSectie);
  }
}

// ════════════════════════════════════════
// HERHALING (FLASHCARD) — FIX: antwoord voor MC-vragen
// ════════════════════════════════════════
let herhalingsWachtrij = [];

function startHerhaling() {
  herhalingsWachtrij = sessieAntwoorden
    .filter(a => !a.goed)
    .map(a => ({
      id:        a.id,
      vraagData: lesData.secties[a.sectieIndex].vragen[a.vraagIndex]
    }));

  if (herhalingsWachtrij.length === 0) {
    toonKlaarScherm();
  } else {
    toonHerhalingsRonde();
  }
}

function toonHerhalingsRonde() {
  window.scrollTo({ top: 0, behavior: 'smooth' });
  inVraagModus = false;

  document.getElementById('sectie-label-tekst').textContent  = artikelTitel;
  document.getElementById('sectie-titel').textContent        = 'Nog niet helemaal...';
  document.getElementById('sectie-nummer-tekst').textContent =
    `${herhalingsWachtrij.length} vraag${herhalingsWachtrij.length !== 1 ? 'en' : ''} opnieuw`;

  updateReaderCatBadge();

  setLeesKaart(true);
  const tekstEl = document.getElementById('sectie-tekst');
  tekstEl.innerHTML = '';
  const uitleg = document.createElement('p');
  uitleg.style.color = 'rgba(232,227,219,0.65)';
  uitleg.textContent = 'De vragen die je net fout had komen hieronder terug. Ga door totdat alles goed is.';
  tekstEl.appendChild(uitleg);
  tekstEl.style.display = 'block';

  document.getElementById('tijdlijn-wrap').style.display          = 'none';
  document.getElementById('knop-gelezen-wrap').style.display       = 'none';
  document.getElementById('terug-naar-vraag-balk').style.display   = 'none';
  document.getElementById('vragen-sectie').style.display           = 'block';
  document.getElementById('knop-weetniets').style.display          = 'none';
  document.getElementById('knop-kijkop').style.display             = 'none';

  const knopVolgende       = document.getElementById('knop-volgende');
  knopVolgende.disabled    = true;
  knopVolgende.textContent = 'Volgende →';
  knopVolgende.onclick     = null;

  const inhoud = document.getElementById('vragen-inhoud');
  inhoud.innerHTML = '';

  const rondeResultaten = herhalingsWachtrij.map(() => ({ beantwoord: false, goed: false }));

  function checkAllesHerhaling() {
    if (!rondeResultaten.every(r => r.beantwoord)) return;

    const nogFout = herhalingsWachtrij.filter((_, i) => !rondeResultaten[i].goed);

    if (nogFout.length === 0) {
      knopVolgende.disabled    = false;
      knopVolgende.textContent = 'Alles goed! →';
      knopVolgende.onclick     = toonKlaarScherm;
    } else {
      knopVolgende.disabled    = false;
      knopVolgende.textContent = `Nog ${nogFout.length} fout — nog een ronde →`;
      knopVolgende.onclick     = () => {
        herhalingsWachtrij = nogFout;
        toonHerhalingsRonde();
      };
    }
  }

  herhalingsWachtrij.forEach((item, hi) => {
    const vraag   = item.vraagData;
    // ═══ FIX: juiste antwoordtekst afhankelijk van vraagtype ═══
    let antwoord;
    if (vraag.type === 'multiplechoice') {
      antwoord = vraag.opties?.[vraag.correcteIndex] ?? '';
    } else {
      antwoord = vraag.antwoord || vraag.goed || '';
    }

    const blok = document.createElement('div');
    blok.className = 'vraag-blok';

    blok.innerHTML = `
      <div class="vraag-tekst">${hi + 1}. ${vraag.vraag}</div>
      <div class="flashcard-onthul-wrap" id="h-onthul-${hi}">
        <button class="knop-onthul">Tik om het antwoord te zien ↓</button>
      </div>
      <div class="flashcard-antwoord-wrap" id="h-antwoord-${hi}" style="display:none">
        <div class="flashcard-antwoord">${antwoord}</div>
        <div class="flashcard-goed-fout">
          <button class="knop-flashcard-fout" id="h-fout-${hi}">✗ Fout</button>
          <button class="knop-flashcard-goed" id="h-goed-${hi}">✓ Goed</button>
        </div>
      </div>
    `;

    blok.querySelector('.knop-onthul').addEventListener('click', () => {
      document.getElementById(`h-onthul-${hi}`).style.display = 'none';
      document.getElementById(`h-antwoord-${hi}`).style.display = 'block';
    });

    blok.querySelector(`#h-goed-${hi}`).addEventListener('click', () => {
      if (rondeResultaten[hi].beantwoord) return;
      blok.querySelector(`#h-goed-${hi}`).classList.add('actief-goed');
      blok.querySelector(`#h-fout-${hi}`).disabled = true;
      rondeResultaten[hi] = { beantwoord: true, goed: true };

      const vraagData = item.vraagData;
      registreerAntwoord({
        id: item.id,
        vraag: vraagData.vraag,
        type: vraagData.type || 'flashcard',
        antwoordData: vraagData.type === 'multiplechoice' 
          ? { vraag: vraagData.vraag, opties: vraagData.opties, correcteIndex: vraagData.correcteIndex, gekozenIndex: vraagData.correcteIndex }
          : { antwoord: vraagData.antwoord },
        goed: true
      });

      checkAllesHerhaling();
    });

    blok.querySelector(`#h-fout-${hi}`).addEventListener('click', () => {
      if (rondeResultaten[hi].beantwoord) return;
      blok.querySelector(`#h-fout-${hi}`).classList.add('actief-fout');
      blok.querySelector(`#h-goed-${hi}`).disabled = true;
      rondeResultaten[hi] = { beantwoord: true, goed: false };

      const vraagData = item.vraagData;
      registreerAntwoord({
        id: item.id,
        vraag: vraagData.vraag,
        type: vraagData.type || 'flashcard',
        antwoordData: vraagData.type === 'multiplechoice'
          ? { vraag: vraagData.vraag, opties: vraagData.opties, correcteIndex: vraagData.correcteIndex, gekozenIndex: -1 }
          : { antwoord: vraagData.antwoord },
        goed: false
      });

      checkAllesHerhaling();
    });

    inhoud.appendChild(blok);
  });
}

function toonKlaarScherm() {
  if (pendingSR && pendingSR.length > 0) {
    const items = pendingSR;
    pendingSR = [];
    smartActive = false;
    // Tijdelijk afrondSRReview overschrijven zodat na SR het klaarscherm komt
    const origAfrond = afrondSRReview;
    afrondSRReview = async () => {
      afrondSRReview = origAfrond; // herstel
      toonKlaarSchermFinal();      // nu echt klaar
    };
    toonSRReview(items);
    return;
  }
  toonKlaarSchermFinal();
}

function toonKlaarSchermFinal() {
  document.getElementById('les-scherm').classList.remove('zichtbaar');
  document.getElementById('shields-balk').style.display = 'none';

  const balk = document.getElementById('les-voortgang-balk');
  balk.style.width = '100%';
  setTimeout(() => {
    document.getElementById('les-voortgang').classList.add('vervaag');
  }, 600);

  const totaal = sessieAntwoorden.length;
  const goed   = sessieAntwoorden.filter(a => a.goed).length;
  const pct    = totaal > 0 ? Math.round((goed / totaal) * 100) : 0;

  const catBadge = huidigeCategorieNaam
    ? `<br/><span style="font-size:0.82rem;color:var(--muted)">● ${huidigeCategorieNaam}</span>`
    : '';

  document.getElementById('klaar-stats').innerHTML =
    `Je beantwoordde <strong>${goed} van de ${totaal} vragen</strong> goed (${pct}%).${catBadge}<br/>
    De vragen komen de komende dagen terug via spaced repetition.`;

  document.getElementById('klaar-scherm').classList.add('zichtbaar');
  window.scrollTo({ top: 0, behavior: 'smooth' });

  slaVoortgangOp({ sectieIndex: lesData.secties.length - 1, voltooid: true, titel: artikelTitel });
  markSessionDone();
}



// ════════════════════════════════════════
// START — async bootstrap
// ════════════════════════════════════════
(async () => {
  try {
    db = await openDB();
    await migreerVanLocalStorage();
  } catch (e) {
    console.warn('IndexedDB niet beschikbaar, gebruik in-memory opslag:', e);
    db = null;
  }
  herstelLayout();
  await init();
})();
