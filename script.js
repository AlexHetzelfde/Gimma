// ════════════════════════════════════════
// CONSTANTEN
// ════════════════════════════════════════
const LS_KEY          = 'wikileer_api_key';
const LS_SR           = 'wikileer_sr';
const LS_LAST_SESSION = 'wikileer_last_session';
const LS_LAYOUT       = 'wikileer_layout';
const LS_CATS         = 'wikileer_categories';
const MAX_TEKST       = 6000;

const INTERVALS = [1, 2, 4, 7, 14, 30];

// ════════════════════════════════════════
// INDEXEDDB LAAG
// ════════════════════════════════════════
const DB_NAAM   = 'wikileer_db';
const DB_VERSIE = 1;
const STORE_KV  = 'kv';
let db = null;

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
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(STORE_KV, 'readonly');
    const req = tx.objectStore(STORE_KV).get(sleutel);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror   = () => reject(req.error);
  });
}

function dbSet(sleutel, waarde) {
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(STORE_KV, 'readwrite');
    const req = tx.objectStore(STORE_KV).put(waarde, sleutel);
    req.onsuccess = () => resolve();
    req.onerror   = () => reject(req.error);
  });
}

function dbDelete(sleutel) {
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(STORE_KV, 'readwrite');
    const req = tx.objectStore(STORE_KV).delete(sleutel);
    req.onsuccess = () => resolve();
    req.onerror   = () => reject(req.error);
  });
}

function dbGetAllKeys() {
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
      await dbSet(k, waarde);
      localStorage.removeItem(k);
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
  } catch { return null; }
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
  } catch {}
}

async function haalSRData() {
  try {
    const raw = await dbGet(LS_SR);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

async function slaSRDataOp(data) {
  try { await dbSet(LS_SR, JSON.stringify(data)); } catch {}
}

function vandaagProgSleutel() {
  return 'wikileer_prog_' + new Date().toISOString().slice(0, 10);
}

async function haalVoortgang() {
  try {
    const raw = await dbGet(vandaagProgSleutel());
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

async function slaVoortgangOp(obj) {
  try { await dbSet(vandaagProgSleutel(), JSON.stringify(obj)); } catch {}
}

async function verwijderVoortgang() {
  try { await dbDelete(vandaagProgSleutel()); } catch {}
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
  } catch { return []; }
}

async function slaCategoriënOp(cats) {
  try { await dbSet(LS_CATS, JSON.stringify(cats)); } catch {}
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
  if (!/^[0-9a-fA-F]{6}$/.test(clean)) return '200, 169, 110';
  return [
    parseInt(clean.slice(0, 2), 16),
    parseInt(clean.slice(2, 4), 16),
    parseInt(clean.slice(4, 6), 16)
  ].join(', ');
}

function pasCategorieKleurToe(kleur) {
  if (!kleur || !/^#[0-9a-fA-F]{6}$/i.test(kleur)) kleur = '#c8a96e';
  document.documentElement.style.setProperty('--les-kleur', kleur);
  document.documentElement.style.setProperty('--les-kleur-rgb', hexNaarRgb(kleur));
}

let huidigeCategorieKleur = '#c8a96e';
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

function toonToast(tekst, duur = 2500) {
  const el = document.getElementById('toast');
  el.textContent = tekst;
  el.classList.add('zichtbaar');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('zichtbaar'), duur);
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
  try { await dbSet(LS_LAST_SESSION, new Date().toISOString().slice(0, 10)); } catch {}
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
// DATUM IN HEADER
// ════════════════════════════════════════
document.getElementById('header-datum').textContent =
  new Date().toLocaleDateString('nl-NL', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
  });

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
  const knopLes   = document.getElementById('knop-les');
  const melding   = document.getElementById('cache-melding');
  const chip      = document.getElementById('categorie-chip');

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

  if (!cache) {
    knopLes.textContent   = 'Maak les van vandaag';
    knopLes.onclick       = maakLes;
    knopLes.style.display = '';
  } else if (voortgang && voortgang.voltooid) {
    knopLes.innerHTML     = 'Les van vandaag al gemaakt <span class="hervatten-badge">✓ voltooid</span>';
    knopLes.onclick       = toonAlGemaaktModal;
    knopLes.style.display = '';
    melding.textContent   = `✓ Klaar met "${cache.titel}"`;
    melding.style.display = 'block';
  } else if (voortgang && !voortgang.voltooid) {
    const sectieTekst     = `sectie ${voortgang.sectieIndex + 1}${voortgang.inVragen ? `, vraag ${(voortgang.vraagIndex || 0) + 1}` : ''}`;
    knopLes.innerHTML     = `Les hervatten <span class="hervatten-badge">bij ${sectieTekst}</span>`;
    knopLes.onclick       = maakLes;
    knopLes.style.display = '';
    melding.textContent   = `Bezig met "${cache.titel}"`;
    melding.style.display = 'block';
  } else {
    knopLes.textContent   = `Les van vandaag hervatten`;
    knopLes.onclick       = maakLes;
    knopLes.style.display = '';
    melding.textContent   = `✓ Les van vandaag staat klaar — "${cache.titel}"`;
    melding.style.display = 'block';
  }

  const dueItems = await getDueItems();
  if (dueItems.length > 0) {
    toonSRReview(dueItems);
    knopLes.style.display = 'none';
    melding.style.display = 'none';
    chip.style.display    = 'none';
  }
}

// ════════════════════════════════════════
// SR REVIEW
// ════════════════════════════════════════
function toonSRReview(dueItems) {
  const wrap = document.getElementById('sr-review-wrap');
  wrap.style.display = 'block';

  document.getElementById('sr-review-sub').textContent =
    `${dueItems.length} vraag${dueItems.length !== 1 ? 'en' : ''} te herhalen`;

  const inhoud = document.getElementById('sr-vragen-inhoud');
  inhoud.innerHTML = '';

  const state = dueItems.map(() => ({ beantwoord: false, goed: false }));

  function checkAllesSR() {
    if (!state.every(s => s.beantwoord)) return;

    const goedAantal = state.filter(s => s.goed).length;
    const pct        = Math.round((goedAantal / dueItems.length) * 100);
    const scoreEl    = document.getElementById('sr-score-tekst');
    scoreEl.innerHTML =
      `<strong>${goedAantal} van ${dueItems.length}</strong> goed (${pct}%)` +
      (goedAantal < dueItems.length
        ? ` — foute vragen komen morgen terug`
        : ` — alles onthouden! 🎉`);

    document.getElementById('sr-klaar-balk').style.display = 'flex';
    window.scrollTo({ top: document.getElementById('sr-klaar-balk').offsetTop - 40, behavior: 'smooth' });
  }

  dueItems.forEach((item, hi) => {
    const blok = document.createElement('div');
    blok.className = 'vraag-blok';

    const itemKleur = item.categorieKleur || '#c8a96e';
    const itemRgb   = hexNaarRgb(itemKleur);
    blok.style.background   = `rgba(${itemRgb}, 0.05)`;
    blok.style.border       = `1px solid rgba(${itemRgb}, 0.18)`;
    blok.style.borderRadius = '8px';
    blok.style.padding      = '1.1rem 1.2rem';
    blok.style.marginBottom = '1.5rem';

    const strength  = item.strength ?? 20;
    const kleur     = sterktekleur(strength);
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

    if (item.type === 'meerkeuze') {
      blok.innerHTML = `
        ${sterkteMeter}
        <div class="vraag-tekst" style="color:var(--text)">${hi + 1}. ${item.vraag}</div>
        <div class="opties-grid" id="sr-opties-${hi}">
          ${item.opties.map((opt, oi) =>
            `<button class="optie-knop" data-oi="${oi}">${opt}</button>`
          ).join('')}
        </div>
        <div class="feedback" id="sr-feedback-${hi}"></div>
      `;
      blok.querySelectorAll('.optie-knop').forEach(knop => {
        knop.addEventListener('click', function () {
          if (state[hi].beantwoord) return;
          const gekozen = item.opties[parseInt(this.dataset.oi)];
          const goed    = gekozen === item.goed;

          blok.querySelectorAll('.optie-knop').forEach(k => {
            k.disabled = true;
            if (k.textContent === item.goed) k.classList.add('gemist');
          });
          this.classList.remove('gemist');
          this.classList.add(goed ? 'goed' : 'fout');

          const fb = document.getElementById(`sr-feedback-${hi}`);
          fb.textContent = goed ? '✓ Correct!' : `✗ Het juiste antwoord is: ${item.goed}`;
          fb.className   = `feedback ${goed ? 'goed' : 'fout'}`;
          fb.style.color = goed ? 'var(--goed)' : 'var(--fout)';

          const voorheen = [huidigeCategorieKleur, huidigeCategorieNaam];
          huidigeCategorieKleur = itemKleur;
          huidigeCategorieNaam  = item.categorieNaam || '';
          registreerAntwoord({
            id: item.id, vraag: item.vraag, type: 'meerkeuze',
            antwoordData: { opties: item.opties, goed: item.goed }, goed
          });
          [huidigeCategorieKleur, huidigeCategorieNaam] = voorheen;

          state[hi] = { beantwoord: true, goed };
          checkAllesSR();
        });
      });

    } else {
      blok.innerHTML = `
        ${sterkteMeter}
        <div class="vraag-tekst" style="color:var(--text)">${hi + 1}. ${item.vraag}</div>
        <div class="open-invoer-wrap">
          <input type="text" class="open-invoer" id="sr-open-${hi}" placeholder="Jouw antwoord..."/>
          <button class="open-invoer-knop" id="sr-knop-${hi}">Controleer</button>
        </div>
        <div class="feedback" id="sr-feedback-${hi}"></div>
      `;
      const invoerEl = blok.querySelector(`#sr-open-${hi}`);
      const knopEl   = blok.querySelector(`#sr-knop-${hi}`);

      invoerEl.addEventListener('focus', () => { invoerEl.style.borderColor = itemKleur; });
      invoerEl.addEventListener('blur',  () => { if (!state[hi].beantwoord) invoerEl.style.borderColor = ''; });

      const controleer = () => {
        if (state[hi].beantwoord) return;
        const invoer = invoerEl.value.trim();
        if (!invoer) return;

        const goed = isGoedAntwoord(invoer, item.antwoord);
        invoerEl.disabled = true;
        invoerEl.classList.add(goed ? 'goed' : 'fout');
        knopEl.disabled = true;

        const fb = document.getElementById(`sr-feedback-${hi}`);
        fb.textContent = goed ? '✓ Correct!' : `✗ Het antwoord was: ${item.antwoord}`;
        fb.className   = `feedback ${goed ? 'goed' : 'fout'}`;
        fb.style.color = goed ? 'var(--goed)' : 'var(--fout)';

        const voorheen = [huidigeCategorieKleur, huidigeCategorieNaam];
        huidigeCategorieKleur = itemKleur;
        huidigeCategorieNaam  = item.categorieNaam || '';
        registreerAntwoord({
          id: item.id, vraag: item.vraag, type: 'open',
          antwoordData: { antwoord: item.antwoord }, goed
        });
        [huidigeCategorieKleur, huidigeCategorieNaam] = voorheen;

        state[hi] = { beantwoord: true, goed };
        checkAllesSR();
      };

      invoerEl.addEventListener('keydown', e => { if (e.key === 'Enter') controleer(); });
      knopEl.addEventListener('click', controleer);
    }

    inhoud.appendChild(blok);
  });
}

async function afrondSRReview() {
  await markSessionDone();
  document.getElementById('sr-review-wrap').style.display = 'none';

  const cache     = await haalGecachedeLes();
  const voortgang = await haalVoortgang();
  const knopLes   = document.getElementById('knop-les');
  const melding   = document.getElementById('cache-melding');
  const chip      = document.getElementById('categorie-chip');

  if (cache && cache.categorieKleur) {
    pasCategorieKleurToe(cache.categorieKleur);
    document.getElementById('categorie-dot').style.background = cache.categorieKleur;
    document.getElementById('categorie-naam-tekst').textContent = cache.categorie || '';
    chip.style.display = '';
  }

  if (!cache) {
    knopLes.textContent = 'Maak les van vandaag';
    knopLes.onclick     = maakLes;
  } else if (voortgang && voortgang.voltooid) {
    knopLes.innerHTML   = 'Les van vandaag al gemaakt <span class="hervatten-badge">✓ voltooid</span>';
    knopLes.onclick     = toonAlGemaaktModal;
    melding.textContent = `✓ Klaar met "${cache.titel}"`;
    melding.style.display = 'block';
  } else if (voortgang && !voortgang.voltooid) {
    const sectieTekst   = `sectie ${voortgang.sectieIndex + 1}${voortgang.inVragen ? `, vraag ${(voortgang.vraagIndex || 0) + 1}` : ''}`;
    knopLes.innerHTML   = `Les hervatten <span class="hervatten-badge">bij ${sectieTekst}</span>`;
    knopLes.onclick     = maakLes;
    melding.textContent = `Bezig met "${cache.titel}"`;
    melding.style.display = 'block';
  } else {
    knopLes.textContent = 'Les van vandaag hervatten';
    knopLes.onclick     = maakLes;
    melding.textContent = `✓ Les van vandaag staat klaar — "${cache.titel}"`;
    melding.style.display = 'block';
  }

  knopLes.style.display = '';
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
    huidige = Math.min(huidige + 0.8, tot);
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
// WIKIPEDIA
// ════════════════════════════════════════
async function haalUitgelichtArtikel() {
  const res = await fetch('https://nl.wikipedia.org/w/api.php?action=parse&page=Hoofdpagina&prop=text&format=json&origin=*');
  if (!res.ok) throw new Error('Kon Wikipedia hoofdpagina niet ophalen');
  const data = await res.json();
  const doc  = new DOMParser().parseFromString(data.parse.text['*'], 'text/html');

  let titel = null;
  const uitgelichtDiv = doc.querySelector('#mp-uitgelicht');
  if (uitgelichtDiv) {
    const link = uitgelichtDiv.querySelector('a[href^="/wiki/"]:not([href*=":"])');
    if (link) titel = decodeURIComponent(link.getAttribute('href').replace('/wiki/', '').replace(/_/g, ' '));
  }

  if (!titel) {
    for (const link of doc.querySelectorAll('a[href^="/wiki/"]:not([href*=":"])')) {
      const t = decodeURIComponent(link.getAttribute('href').replace('/wiki/', '').replace(/_/g, ' '));
      if (t && t !== 'Hoofdpagina' && link.textContent.length > 3) { titel = t; break; }
    }
  }

  if (!titel) throw new Error('Kon het uitgelichte artikel niet vinden');
  return titel;
}

async function haalVolledigeTekst(titel) {
  const url = `https://nl.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(titel)}&prop=extracts&explaintext=true&format=json&origin=*`;
  const res  = await fetch(url);
  if (!res.ok) throw new Error('Kon het artikel niet ophalen');
  const data = await res.json();
  const page = Object.values(data.query.pages)[0];
  if (!page || page.missing) throw new Error(`Artikel "${titel}" niet gevonden`);
  return { titel: page.title, tekst: page.extract };
}

// ════════════════════════════════════════
// GEMINI
// ════════════════════════════════════════
async function verwerkMetGemini(titel, tekst) {
  const key  = await haalKey();
  const cats = await haalCategorieën();
  const url  = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${key}`;

  const ingekorte = tekst.length > MAX_TEKST
    ? tekst.slice(0, MAX_TEKST) + '\n\n[tekst ingekort]'
    : tekst;

  const catsTekst = cats.length > 0
    ? `Bestaande categorieën (gebruik er één als die goed past):\n${JSON.stringify(cats.map(c => ({ naam: c.naam, kleur: c.kleur })), null, 2)}`
    : 'Er zijn nog geen bestaande categorieën — maak een nieuwe aan.';

  const bestaandeKleuren = cats.map(c => c.kleur).join(', ') || 'geen';

  const prompt = `Je bent een professionele schrijver en leraar die Wikipedia-artikelen omzet naar heldere, boeiende lessen.

Je krijgt het Wikipedia-artikel: "${titel}"

JOUW TAAK:
1. Verwerk dit artikel tot een hapbare les in goed, helder Nederlands
2. Bepaal zelf hoeveel secties nodig zijn (minimaal 3, maximaal 6) op basis van lengte en complexiteit
3. Als het artikel uitgebreid linkt naar andere belangrijke concepten, mag dat concept een eigen sectie krijgen
4. Schrijf elke sectietekst alsof je een enthousiaste maar heldere journalist bent — geen droge opsommingen, echte alinea's
5. Voeg een tijdlijn toe ALS het artikel duidelijke historische gebeurtenissen bevat (anders laat je het tijdlijn-veld weg)
6. Maak per sectie 2-3 vragen: een mix van meerkeuze en open vragen

VRAGENREGELS:
- Meerkeuze: altijd exact 4 opties, precies 1 goed antwoord. De waarde van "goed" moet exact overeenkomen met één van de opties
- Open vragen: verwacht antwoord is kort (1-5 woorden), niet hoofdlettergevoelig. Als het antwoord een getal is, schrijf het als cijfer (bv. "2", niet "twee")
- Vragen mogen gerust moeilijk zijn: toets verbanden, oorzaken, gevolgen en betekenis, niet alleen losse feiten of triviale details
- Meerkeuze-afleidopties moeten plausibel zijn, niet makkelijk te raden door eliminatie
- Minstens de helft van de vragen per sectie moet gaan over waarom iets zo is, waardoor iets gebeurde, wat het gevolg was, of wat het verband is tussen twee concepten

FASE 0 — CATEGORIE & KLEUR (doe dit nadat je de secties hebt bepaald):
Kijk naar de volledige les en bepaal de dominante subcategorie (kort, Nederlands, max 20 tekens).
Voorbeelden: "Biologie", "Middeleeuwse geschiedenis", "Sterrenkunde", "Filosofie", "Architectuur", "Hedendaagse politiek", "Technologie", "Geografie", "Kunst & cultuur".

${catsTekst}

Regels voor categorieën:
- Past een bestaande categorie goed? → Gebruik exact dezelfde naam en kleur.
- Geen passende categorie? → Maak een nieuwe aan. Kies een leesbare hex-kleur die:
  • Goed leesbaar is op een donkere achtergrond (#0f0f0f)
  • Niet te donker is (perceived lightness > 50%)
  • Niet bruin, zwart of wit is
  • Duidelijk anders is dan de bestaande kleuren: ${bestaandeKleuren}
  Goede voorbeelden: #7cb9e8, #e07b6a, #82d4b0, #c9a0dc, #f4c56a, #6fbad4, #e8926a

GEEF JE ANTWOORD UITSLUITEND ALS GELDIGE JSON — geen uitleg, geen markdown, geen backticks.

JSON STRUCTUUR:
{
  "categorie": "Naam van de categorie",
  "categorieKleur": "#hexkleur",
  "secties": [
    {
      "titel": "Titel van de sectie",
      "tekst": "De herschreven leesbare tekst. Gebruik \\n\\n tussen alinea's.",
      "tijdlijn": [{"jaar": "1850", "gebeurtenis": "Wat er gebeurde"}],
      "vragen": [
        {
          "type": "meerkeuze",
          "vraag": "De vraag?",
          "opties": ["Optie A", "Optie B", "Optie C", "Optie D"],
          "goed": "Optie A"
        },
        {
          "type": "open",
          "vraag": "De vraag?",
          "antwoord": "kort antwoord"
        }
      ]
    }
  ]
}

ARTIKEL TEKST:
${ingekorte}`;

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

  let lesObj;
  try {
    lesObj = JSON.parse(schoon);
  } catch {
    const afgekort = !ruwe.trimEnd().endsWith('}');
    if (afgekort)
      throw new Error('Gemini-antwoord werd afgekapt. Probeer het opnieuw — bij een lang artikel kan dit soms voorkomen.');
    throw new Error('Kon JSON niet verwerken. Eerste 300 tekens: ' + ruwe.slice(0, 300));
  }

  if (lesObj.categorie && lesObj.categorieKleur) {
    await registreerCategorie(lesObj.categorie, lesObj.categorieKleur);
  }

  return lesObj;
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

    setStatus(`"${naam}" ophalen...`, 30);
    const { titel, tekst } = await haalVolledigeTekst(naam);
    artikelTitel = titel;

    setStatus('Gemini verwerkt het artikel en bepaalt de categorie...', 45, true);
    startSchijnVoortgang(45, 88);
    lesData = await verwerkMetGemini(titel, tekst);

    stopSchijnVoortgang();
    setStatus('Les klaar!', 100);

    huidigeCategorieKleur = lesData.categorieKleur || '#c8a96e';
    huidigeCategorieNaam  = lesData.categorie || '';
    pasCategorieKleurToe(huidigeCategorieKleur);

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
let huidigeVraag     = 0;       // vraagindex binnen huidige sectie
let inVraagModus     = false;   // true = vraag zichtbaar, false = tekst zichtbaar
let sessieAntwoorden = [];
let vraagResultaten  = {};      // vraagId → 'goed' | 'fout'

// ── Shields balk renderen ──
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

// ── Vult sectietekst en tijdlijn in (zonder weergave te wisselen) ──
function vulSectieInhoud(si) {
  const sectie = lesData.secties[si];

  const tekstEl = document.getElementById('sectie-tekst');
  tekstEl.innerHTML = '';
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

  // Shields balk activeren
  document.getElementById('shields-balk').style.display = 'flex';

  sessieAntwoorden = [];
  vraagResultaten  = {};
  inVraagModus     = false;

  const opgeslagen = await haalVoortgang();

  if (opgeslagen && !opgeslagen.voltooid && opgeslagen.sectieIndex != null) {
    huidigeSectie = opgeslagen.sectieIndex;
    vulSectieInhoud(huidigeSectie); // pre-vul voor kijk-op
    if (opgeslagen.inVragen && opgeslagen.vraagIndex != null) {
      toonVraag(opgeslagen.vraagIndex);
    } else {
      toonSectie(huidigeSectie);
    }
  } else {
    huidigeSectie = 0;
    toonSectie(0);
  }
}

// ── Tekst-leesmodus ──
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
    titel:       artikelTitel
  });

  const sectie = lesData.secties[index];
  const totaal = lesData.secties.length;

  // Header
  document.getElementById('sectie-label-tekst').textContent  = artikelTitel;
  document.getElementById('sectie-titel').textContent        = sectie.titel;
  document.getElementById('sectie-nummer-tekst').textContent = `Pagina ${index + 1} van ${totaal}`;

  const dot = document.getElementById('sectie-label-dot');
  if (huidigeCategorieKleur) dot.style.background = huidigeCategorieKleur;

  // Inhoud
  vulSectieInhoud(index);

  // Weergave
  document.getElementById('sectie-tekst').style.display       = 'block';
  const tijdlijnWrap = document.getElementById('tijdlijn-wrap');
  tijdlijnWrap.style.display = (sectie.tijdlijn && sectie.tijdlijn.length > 0) ? 'block' : 'none';

  document.getElementById('knop-gelezen-wrap').style.display  = 'block';
  document.getElementById('vragen-sectie').style.display      = 'none';
  document.getElementById('terug-naar-vraag-balk').style.display = 'none';
  document.getElementById('knop-volgende').disabled           = true;

  renderShields();
}

// ── Eén-vraag-per-scherm modus ──
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

  // Save progress
  slaVoortgangOp({
    sectieIndex: huidigeSectie,
    vraagIndex:  vi,
    inVragen:    true,
    voltooid:    false,
    titel:       artikelTitel
  });

  // Header
  document.getElementById('sectie-label-tekst').textContent  = artikelTitel;
  document.getElementById('sectie-titel').textContent        = sectie.titel;
  document.getElementById('sectie-nummer-tekst').textContent = `Vraag ${vi + 1} van ${aantalInSec}`;

  // Tekst verbergen, vraag tonen
  document.getElementById('sectie-tekst').style.display          = 'none';
  document.getElementById('tijdlijn-wrap').style.display          = 'none';
  document.getElementById('knop-gelezen-wrap').style.display      = 'none';
  document.getElementById('terug-naar-vraag-balk').style.display  = 'none';
  document.getElementById('vragen-sectie').style.display          = 'block';

  // Hulpknoppen tonen
  document.getElementById('knop-weetniets').style.display = 'inline-flex';
  document.getElementById('knop-kijkop').style.display   = 'inline-flex';

  // Volgende knop
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

  // Vraag renderen
  const inhoud = document.getElementById('vragen-inhoud');
  inhoud.innerHTML = '';

  const blok = document.createElement('div');
  blok.className = 'vraag-blok';

  let beantwoord = false;

  function onAntwoord(goed) {
    if (beantwoord) return;
    beantwoord = true;

    vraagResultaten[vraagId] = goed ? 'goed' : 'fout';
    sessieAntwoorden.push({
      sectieIndex: huidigeSectie,
      vraagIndex:  vi,
      id:          vraagId,
      goed
    });
    registreerAntwoord({
      id:          vraagId,
      vraag:       vraag.vraag,
      type:        vraag.type,
      antwoordData: vraag.type === 'meerkeuze'
        ? { opties: vraag.opties, goed: vraag.goed }
        : { antwoord: vraag.antwoord },
      goed
    });

    // Hulpknoppen verbergen, volgende inschakelen
    document.getElementById('knop-weetniets').style.display = 'none';
    document.getElementById('knop-kijkop').style.display   = 'none';
    knopVolgende.disabled = false;

    renderShields();

    // Scroll lichtjes naar beneden zodat feedback zichtbaar is
    setTimeout(() => {
      const fb = blok.querySelector('.feedback');
      if (fb) fb.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 120);
  }

  if (vraag.type === 'meerkeuze') {
    blok.innerHTML = `
      <div class="vraag-tekst">${vraag.vraag}</div>
      <div class="opties-grid" id="opties-0">
        ${vraag.opties.map((opt, oi) =>
          `<button class="optie-knop" data-oi="${oi}">${opt}</button>`
        ).join('')}
      </div>
      <div class="feedback" id="feedback-0"></div>
    `;
    blok.querySelectorAll('.optie-knop').forEach(knop => {
      knop.addEventListener('click', function () {
        if (beantwoord) return;
        const gekozen = vraag.opties[parseInt(this.dataset.oi)];
        const goed    = gekozen === vraag.goed;

        blok.querySelectorAll('.optie-knop').forEach(k => {
          k.disabled = true;
          if (k.textContent === vraag.goed) k.classList.add('gemist');
        });
        this.classList.remove('gemist');
        this.classList.add(goed ? 'goed' : 'fout');

        const fb = document.getElementById('feedback-0');
        fb.textContent = goed ? '✓ Correct!' : `✗ Het juiste antwoord is: ${vraag.goed}`;
        fb.className   = `feedback ${goed ? 'goed' : 'fout'}`;

        onAntwoord(goed);
      });
    });

  } else {
    blok.innerHTML = `
      <div class="vraag-tekst">${vraag.vraag}</div>
      <div class="open-invoer-wrap">
        <input type="text" class="open-invoer" id="open-invoer-0" placeholder="Jouw antwoord..."/>
        <button class="open-invoer-knop" id="open-knop-0">Controleer</button>
      </div>
      <div class="feedback" id="feedback-0"></div>
    `;
    const invoerEl = blok.querySelector('#open-invoer-0');
    const knopEl   = blok.querySelector('#open-knop-0');

    const controleer = () => {
      if (beantwoord) return;
      const invoer = invoerEl.value.trim();
      if (!invoer) return;

      const goed = isGoedAntwoord(invoer, vraag.antwoord);
      invoerEl.disabled = true;
      invoerEl.classList.add(goed ? 'goed' : 'fout');
      knopEl.disabled = true;

      const fb = document.getElementById('feedback-0');
      fb.textContent = goed ? '✓ Correct!' : `✗ Het antwoord was: ${vraag.antwoord}`;
      fb.className   = `feedback ${goed ? 'goed' : 'fout'}`;

      onAntwoord(goed);
    };

    invoerEl.addEventListener('keydown', e => { if (e.key === 'Enter') controleer(); });
    knopEl.addEventListener('click', controleer);
    setTimeout(() => invoerEl.focus(), 80);
  }

  inhoud.appendChild(blok);
  renderShields();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ── "Kijk op in tekst" — terug naar de tekst ──
function toonTekstLookup() {
  inVraagModus = false;

  const sectie = lesData.secties[huidigeSectie];

  // Header bijwerken
  document.getElementById('sectie-nummer-tekst').textContent = sectie.titel;
  document.getElementById('sectie-titel').textContent        = 'Kijk op in de tekst';

  // Tekst tonen
  document.getElementById('sectie-tekst').style.display = 'block';
  const tijdlijnWrap = document.getElementById('tijdlijn-wrap');
  tijdlijnWrap.style.display = (sectie.tijdlijn && sectie.tijdlijn.length > 0) ? 'block' : 'none';

  // Vraag verbergen, terugknop tonen
  document.getElementById('vragen-sectie').style.display         = 'none';
  document.getElementById('terug-naar-vraag-balk').style.display = 'block';

  renderShields();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ── Terug naar de vraag ──
function terugNaarVraag() {
  inVraagModus = true;

  const sectie = lesData.secties[huidigeSectie];
  const aantalInSec = sectie.vragen.length;

  // Header herstellen
  document.getElementById('sectie-label-tekst').textContent  = artikelTitel;
  document.getElementById('sectie-titel').textContent        = sectie.titel;
  document.getElementById('sectie-nummer-tekst').textContent = `Vraag ${huidigeVraag + 1} van ${aantalInSec}`;

  document.getElementById('sectie-tekst').style.display          = 'none';
  document.getElementById('tijdlijn-wrap').style.display          = 'none';
  document.getElementById('terug-naar-vraag-balk').style.display  = 'none';
  document.getElementById('vragen-sectie').style.display          = 'block';

  renderShields();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ── "Weet niet" — huidige vraag als fout markeren ──
function markeerHuidigeVraagFout() {
  const sectie  = lesData.secties[huidigeSectie];
  const vraag   = sectie.vragen[huidigeVraag];
  const vraagId = maakVraagId(artikelTitel, huidigeSectie, huidigeVraag);

  if (vraag.type === 'meerkeuze') {
    const opties = document.querySelectorAll('#opties-0 .optie-knop');
    opties.forEach(k => {
      k.disabled = true;
      if (k.textContent === vraag.goed) k.classList.add('goed');
    });
    const fb = document.getElementById('feedback-0');
    if (fb) {
      fb.textContent = `✗ Het juiste antwoord is: ${vraag.goed}`;
      fb.className   = 'feedback fout';
    }
  } else {
    const invoerEl = document.getElementById('open-invoer-0');
    const knopEl   = document.getElementById('open-knop-0');
    if (invoerEl) { invoerEl.disabled = true; invoerEl.classList.add('fout'); }
    if (knopEl) knopEl.disabled = true;
    const fb = document.getElementById('feedback-0');
    if (fb) {
      fb.textContent = `✗ Het antwoord was: ${vraag.antwoord}`;
      fb.className   = 'feedback fout';
    }
  }

  vraagResultaten[vraagId] = 'fout';
  sessieAntwoorden.push({
    sectieIndex: huidigeSectie,
    vraagIndex:  huidigeVraag,
    id:          vraagId,
    goed:        false
  });
  registreerAntwoord({
    id:          vraagId,
    vraag:       vraag.vraag,
    type:        vraag.type,
    antwoordData: vraag.type === 'meerkeuze'
      ? { opties: vraag.opties, goed: vraag.goed }
      : { antwoord: vraag.antwoord },
    goed: false
  });

  document.getElementById('knop-weetniets').style.display = 'none';
  document.getElementById('knop-kijkop').style.display   = 'none';
  document.getElementById('knop-volgende').disabled       = false;

  renderShields();
}

// ── Fuzzy matching ──
function levenshtein(a, b) {
  const m = a.length, n = b.length;
  const d = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => i === 0 ? j : j === 0 ? i : 0)
  );
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      d[i][j] = a[i-1] === b[j-1] ? d[i-1][j-1]
        : 1 + Math.min(d[i-1][j], d[i][j-1], d[i-1][j-1]);
  return d[m][n];
}

const GETALLEN = {
  'nul':0,'een':1,'twee':2,'drie':3,'vier':4,'vijf':5,
  'zes':6,'zeven':7,'acht':8,'negen':9,'tien':10,'elf':11,
  'twaalf':12,'dertien':13,'veertien':14,'vijftien':15,'zestien':16,
  'zeventien':17,'achttien':18,'negentien':19,'twintig':20,
  'dertig':30,'veertig':40,'vijftig':50,'zestig':60,
  'zeventig':70,'tachtig':80,'negentig':90,'honderd':100
};

function normaliseerGetal(s) {
  const t = s.toLowerCase().trim();
  return t in GETALLEN ? String(GETALLEN[t]) : t;
}

function isGoedAntwoord(invoer, verwacht) {
  const a = normaliseerGetal(invoer);
  const b = normaliseerGetal(verwacht);
  if (a === b) return true;
  const maxFout = b.length <= 4 ? 1 : 2;
  return levenshtein(a, b) <= maxFout;
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
// HERHALING
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

  const tekstEl = document.getElementById('sectie-tekst');
  tekstEl.innerHTML = '';
  const uitleg = document.createElement('p');
  uitleg.style.color = 'var(--muted)';
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
    const vraag = item.vraagData;
    const blok  = document.createElement('div');
    blok.className = 'vraag-blok';

    if (vraag.type === 'meerkeuze') {
      blok.innerHTML = `
        <div class="vraag-tekst">${hi + 1}. ${vraag.vraag}</div>
        <div class="opties-grid" id="h-opties-${hi}">
          ${vraag.opties.map((opt, oi) =>
            `<button class="optie-knop" data-oi="${oi}">${opt}</button>`
          ).join('')}
        </div>
        <div class="feedback" id="h-feedback-${hi}"></div>
      `;
      blok.querySelectorAll('.optie-knop').forEach(knop => {
        knop.addEventListener('click', function () {
          if (rondeResultaten[hi].beantwoord) return;
          const gekozen = vraag.opties[parseInt(this.dataset.oi)];
          const goed    = gekozen === vraag.goed;

          blok.querySelectorAll('.optie-knop').forEach(k => {
            k.disabled = true;
            if (k.textContent === vraag.goed) k.classList.add('gemist');
          });
          this.classList.remove('gemist');
          this.classList.add(goed ? 'goed' : 'fout');

          const fb = document.getElementById(`h-feedback-${hi}`);
          fb.textContent = goed ? '✓ Correct!' : `✗ Het juiste antwoord is: ${vraag.goed}`;
          fb.className   = `feedback ${goed ? 'goed' : 'fout'}`;

          rondeResultaten[hi] = { beantwoord: true, goed };
          checkAllesHerhaling();
        });
      });
    } else {
      blok.innerHTML = `
        <div class="vraag-tekst">${hi + 1}. ${vraag.vraag}</div>
        <div class="open-invoer-wrap">
          <input type="text" class="open-invoer" id="h-open-invoer-${hi}" placeholder="Jouw antwoord..."/>
          <button class="open-invoer-knop" id="h-open-knop-${hi}">Controleer</button>
        </div>
        <div class="feedback" id="h-feedback-${hi}"></div>
      `;
      const invoerEl = blok.querySelector(`#h-open-invoer-${hi}`);
      const knopEl   = blok.querySelector(`#h-open-knop-${hi}`);

      const controleer = () => {
        if (rondeResultaten[hi].beantwoord) return;
        const invoer = invoerEl.value.trim();
        if (!invoer) return;

        const goed = isGoedAntwoord(invoer, vraag.antwoord);
        invoerEl.disabled = true;
        invoerEl.classList.add(goed ? 'goed' : 'fout');
        knopEl.disabled = true;

        const fb = document.getElementById(`h-feedback-${hi}`);
        fb.textContent = goed ? '✓ Correct!' : `✗ Het antwoord was: ${vraag.antwoord}`;
        fb.className   = `feedback ${goed ? 'goed' : 'fout'}`;

        rondeResultaten[hi] = { beantwoord: true, goed };
        checkAllesHerhaling();
      };

      invoerEl.addEventListener('keydown', e => { if (e.key === 'Enter') controleer(); });
      knopEl.addEventListener('click', controleer);
    }

    inhoud.appendChild(blok);
  });
}

// ── Klaar scherm ──
function toonKlaarScherm() {
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
// START  — async bootstrap
// ════════════════════════════════════════
(async () => {
  try {
    db = await openDB();
    await migreerVanLocalStorage();
  } catch (e) {
    console.warn('IndexedDB niet beschikbaar:', e);
    db = null;
    const _mem = {};
    window.dbGet        = k     => Promise.resolve(_mem[k] ?? null);
    window.dbSet        = (k,v) => { _mem[k] = v; return Promise.resolve(); };
    window.dbDelete     = k     => { delete _mem[k]; return Promise.resolve(); };
    window.dbGetAllKeys = ()    => Promise.resolve(Object.keys(_mem));
  }
  herstelLayout();
  await init();
})();
