/* =========================================================
   CHIMIE PISCINE - Application logic
   Calculs transposés depuis le fichier Excel d'origine
   ========================================================= */

const APP_VERSION = '1.22.6';

const STORAGE_KEYS = {
  measurements: 'cp_measurements_v1',
  reminders: 'cp_reminders_v1',
  lastInputs: 'cp_last_inputs_v1',
  bassins: 'cp_bassins_v1',
  activeBassin: 'cp_active_bassin_id',
  optionalFields: 'cp_optional_fields_v1'
};

// Champs avancés activables/désactivables depuis Paramètres
const DEFAULT_OPTIONAL_FIELDS = {sel: true, th: true, phosphate: true, brome: true};
function getOptionalFields(){
  return Object.assign({}, DEFAULT_OPTIONAL_FIELDS, loadJSON(STORAGE_KEYS.optionalFields, {}));
}
function setOptionalField(key, enabled){
  const cur = getOptionalFields();
  cur[key] = !!enabled;
  saveJSON(STORAGE_KEYS.optionalFields, cur);
  applyOptionalFieldsVisibility();
}
function applyOptionalFieldsVisibility(){
  const cfg = getOptionalFields();
  document.querySelectorAll('[data-optional-field]').forEach(el => {
    const key = el.dataset.optionalField;
    el.style.display = cfg[key] === false ? 'none' : '';
  });
}

// Sel/Brome auto-masqués selon le mode de désinfection. TH/phosphates inchangés.
// L'utilisateur peut tout réactiver depuis Paramètres → Champs avancés (override manuel).
const MODE_FIELD_DEFAULTS = {
  chlore: {sel: false, brome: false},
  brome:  {sel: false, brome: true},
  sel:    {sel: true,  brome: false}
};
// Flag : l'utilisateur a-t-il touché les champs avancés manuellement depuis le dernier changement de mode ?
// Si oui, on respecte ses choix au chargement. Sinon, on suit le mode automatiquement.
const OPT_MANUAL_KEY = 'cp_optional_fields_manual_v1';
function applyModeFieldDefaults(mode, opts){
  opts = opts || {};
  const cfg = MODE_FIELD_DEFAULTS[mode] || MODE_FIELD_DEFAULTS.chlore;
  setOptionalField('sel', cfg.sel);
  setOptionalField('brome', cfg.brome);
  const s = $('optField_sel'); if(s) s.checked = cfg.sel;
  const b = $('optField_brome'); if(b) b.checked = cfg.brome;
  // Bloc de saisie "Chlore" (Fcl/Tcl) masqué en mode brome : le brome remplace
  // le chlore comme désinfectant. Réaffiché pour chlore et sel (électrolyse).
  const chloreBlock = $('chloreInputBlock');
  if(chloreBlock) chloreBlock.style.display = (mode === 'brome') ? 'none' : '';
  // Un changement de mode (pas un load auto) réinitialise le flag manuel
  if(!opts.silent) localStorage.removeItem(OPT_MANUAL_KEY);
}
function markOptionalFieldsManual(){
  try{ localStorage.setItem(OPT_MANUAL_KEY, '1'); }catch(e){}
}
function getCurrentMode(){
  const m = $('modeDesinf') && $('modeDesinf').value;
  if(m) return m;
  const c = $('cfgModeDesinf') && $('cfgModeDesinf').value;
  if(c) return c;
  const last = loadJSON(STORAGE_KEYS.lastInputs, null);
  return (last && last.modeDesinf) || 'chlore';
}

// Mode d'affichage desktop (standard vs cockpit/split-view)
const VIEW_MODE_KEY = 'cp_desktop_view_v1';
function getDesktopViewMode(){
  return localStorage.getItem(VIEW_MODE_KEY) || 'standard';
}
function setDesktopViewMode(mode){
  localStorage.setItem(VIEW_MODE_KEY, mode);
  applyDesktopViewMode();
}
function applyDesktopViewMode(){
  const cockpit = getDesktopViewMode() === 'cockpit';
  document.body.classList.toggle('cockpit-view', cockpit);
  const adv = document.getElementById('advCard');
  if(adv && cockpit && window.matchMedia && window.matchMedia('(min-width: 1000px)').matches){
    adv.open = true;
  }
  // Re-render le live preview si on vient d'activer la vue cockpit
  if(cockpit && typeof renderCorrections === 'function'){
    const target = document.getElementById('liveCorrectionContent');
    if(target) renderCorrections(readInputs(), target);
  }
}

// ============== Multi-bassins ==============
// Palette de couleurs auto-assignées aux nouveaux bassins
const BASSIN_COLORS = ['#5eead4', '#fbbf24', '#f472b6', '#a78bfa', '#60a5fa', '#fb923c', '#34d399'];
const BASSIN_EMOJIS_SUGGEST = ['🏡','🏠','🏊','🌊','🏖️','🌴','💧','☀️'];

function uid(prefix='b'){ return prefix + '_' + Math.random().toString(36).slice(2, 10); }

function getBassins(){ return loadJSON(STORAGE_KEYS.bassins, []); }
function getActiveBassinId(){ return localStorage.getItem(STORAGE_KEYS.activeBassin); }
function setActiveBassinId(id){ localStorage.setItem(STORAGE_KEYS.activeBassin, id); }
function getActiveBassin(){
  const list = getBassins();
  const id = getActiveBassinId();
  return list.find(b => b.id === id) || list.find(b => !b.archived) || list[0] || null;
}
function getActiveBassins(){ return getBassins().filter(b => !b.archived); }
function getBassinById(id){ return getBassins().find(b => b.id === id) || null; }

function saveBassins(list){ saveJSON(STORAGE_KEYS.bassins, list); }

function createBassin(patch){
  const list = getBassins();
  const existingColors = list.map(b => b.couleur);
  const freeColor = BASSIN_COLORS.find(c => !existingColors.includes(c)) || BASSIN_COLORS[list.length % BASSIN_COLORS.length];
  const b = {
    id: uid(),
    nom: patch.nom || 'Bassin',
    emoji: patch.emoji || '🏊',
    couleur: patch.couleur || freeColor,
    archived: false,
    createdAt: Date.now(),
    config: {
      volume: patch.volume ?? null,
      modeDesinf: patch.modeDesinf || 'chlore',
      phSouhaite: patch.phSouhaite ?? 7.4,
      tacSouhaite: patch.tacSouhaite ?? 100,
      cya: patch.cya ?? null,
      cyaSouhaite: patch.cyaSouhaite ?? 30,
      selSouhaite: patch.selSouhaite ?? 4,
      thSouhaite: patch.thSouhaite ?? 25
    }
  };
  list.push(b);
  saveBassins(list);
  return b;
}

function updateBassin(id, patch){
  const list = getBassins();
  const i = list.findIndex(b => b.id === id);
  if(i < 0) return null;
  list[i] = {...list[i], ...patch, config: {...list[i].config, ...(patch.config||{})}};
  saveBassins(list);
  return list[i];
}

function archiveBassin(id){ return updateBassin(id, {archived: true}); }
function restoreBassin(id){ return updateBassin(id, {archived: false}); }

function deleteBassinAndData(id){
  const list = getBassins().filter(b => b.id !== id);
  saveBassins(list);
  // Purge des mesures rattachées
  const measures = loadJSON(STORAGE_KEYS.measurements, []).filter(m => m.bassinId !== id);
  saveJSON(STORAGE_KEYS.measurements, measures);
  // Si c'était l'actif, basculer sur le premier non-archivé
  if(getActiveBassinId() === id){
    const fallback = list.find(b => !b.archived) || list[0];
    if(fallback) setActiveBassinId(fallback.id);
    else localStorage.removeItem(STORAGE_KEYS.activeBassin);
  }
}

/**
 * Migration automatique au démarrage : pour les utilisateurs existants qui ont
 * déjà des mesures sans bassinId, on crée un bassin "Mon bassin" depuis leur
 * config actuelle (cp_last_inputs_v1) et on tagge leurs mesures avec son id.
 *
 * Pour les nouveaux utilisateurs (zéro mesure), on ne crée rien — c'est le
 * wizard qui gère ça (maybeOpenWizard).
 */
function migrateToMultiBassinsIfNeeded(){
  const existing = getBassins();
  if(existing.length > 0) return;

  const measurements = loadJSON(STORAGE_KEYS.measurements, []);
  if(measurements.length === 0) return; // Pas de mesures → pas besoin de migrer, le wizard prendra le relais

  const lastInputs = loadJSON(STORAGE_KEYS.lastInputs, {}) || {};
  const principal = createBassin({
    nom: 'Mon bassin',
    emoji: '🏡',
    couleur: BASSIN_COLORS[0],
    volume: lastInputs.volume ?? null,
    modeDesinf: lastInputs.modeDesinf || 'chlore',
    phSouhaite: lastInputs.phSouhaite ?? 7.4,
    tacSouhaite: lastInputs.tacSouhaite ?? 100,
    cya: lastInputs.cya ?? null,
    cyaSouhaite: lastInputs.cyaSouhaite ?? 30,
    selSouhaite: lastInputs.selSouhaite ?? 4,
    thSouhaite: lastInputs.thSouhaite ?? 25
  });
  setActiveBassinId(principal.id);

  let dirty = false;
  measurements.forEach(m => { if(!m.bassinId){ m.bassinId = principal.id; dirty = true; } });
  if(dirty) saveJSON(STORAGE_KEYS.measurements, measurements);
}

/**
 * Lit toutes les mesures du bassin actif uniquement.
 * Toutes les vues (Historique, Tendances, Graphiques, Doses…) passent par ici.
 */
function loadActiveMeasurements(){
  const id = getActiveBassinId();
  if(!id) return [];
  return loadJSON(STORAGE_KEYS.measurements, []).filter(m => m.bassinId === id);
}

/**
 * Sauve la liste filtrée du bassin actif. Reconstitue le tableau global
 * en concaténant avec les mesures des autres bassins.
 */
function saveActiveMeasurements(list){
  const id = getActiveBassinId();
  if(!id){ saveJSON(STORAGE_KEYS.measurements, list); return; }
  const others = loadJSON(STORAGE_KEYS.measurements, []).filter(m => m.bassinId !== id);
  // S'assurer que les mesures sauvées portent bien le bassinId
  list.forEach(m => { if(!m.bassinId) m.bassinId = id; });
  saveJSON(STORAGE_KEYS.measurements, [...others, ...list]);
}

// ============== Utilitaires ==============
function $(id){return document.getElementById(id)}
function num(id){const v=parseFloat($(id).value);return isNaN(v)?null:v}
function toast(msg,kind='ok',duration=2400){
  const t=$('toast');t.textContent=msg;t.className='toast show '+kind;
  setTimeout(()=>t.classList.remove('show'),duration);
}
function fmt(v,d=2){
  if(v===null||v===undefined||isNaN(v))return '—';
  if(v===0) return '0';
  // Notation scientifique seulement si avec d décimales le résultat arrondirait à zéro
  // (sinon on respecte le nombre de décimales demandé : fmt(0.003, 3) → "0,003")
  const rounded = Number(v.toFixed(d));
  if(rounded === 0) return v.toExponential(2);
  return rounded.toLocaleString('fr-FR',{maximumFractionDigits:d});
}
function loadJSON(key,def){
  try{const v=localStorage.getItem(key);return v?JSON.parse(v):def}catch(e){return def}
}
function saveJSON(key,val){localStorage.setItem(key,JSON.stringify(val))}

// ============== Calculs (depuis Excel) ==============

/**
 * Correction pH par HCl
 * Formule Excel: (volume / 50) * (delta_pH / 0.3) * 0.5
 * = pour 50 m³, 0.5 L d'HCl baisse le pH de 0.3 unité
 */
function calcHcl(volume, phMesure, phSouhaite){
  const delta = phMesure - phSouhaite;
  if(delta <= 0) return null;
  return (volume / 50) * (delta / 0.3) * 0.5;
}

/**
 * Correction pH par poudre pH-
 * Table Excel : g/m³ selon pH mesuré et pH visé
 * Multiplie par volume pour obtenir grammes totaux
 */
const PH_TABLE = {
  // [pH visé][pH mesuré] = g/m³
  7.8: {8.2:9, 8.1:7, 8.0:4, 7.9:2},
  7.7: {8.2:11, 8.1:9, 8.0:6, 7.9:4, 7.8:2},
  7.6: {8.2:14, 8.1:12, 8.0:9, 7.9:7, 7.8:5, 7.7:3},
  7.5: {8.2:17, 8.1:15, 8.0:12, 7.9:10, 7.8:8, 7.7:6, 7.6:3},
  7.4: {8.2:22, 8.1:20, 8.0:17, 7.9:15, 7.8:13, 7.7:11, 7.6:8, 7.5:5},
  7.3: {8.2:31, 8.1:29, 8.0:26, 7.9:24, 7.8:22, 7.7:20, 7.6:17, 7.5:14, 7.4:9},
  7.2: {8.2:45, 8.1:43, 8.0:40, 7.9:38, 7.8:36, 7.7:34, 7.6:31, 7.5:28, 7.4:23, 7.3:14},
  7.0: {8.2:70, 8.1:67, 8.0:64, 7.9:62, 7.8:60, 7.7:58, 7.6:55, 7.5:52, 7.4:47, 7.3:37, 7.2:30}
};
/**
 * Correction pH+ par carbonate de sodium (Na2CO3) quand pH < pH visé.
 * Référence empirique : ~14 g/m³ de carbonate de sodium relève le pH de 0.3
 * pour un TAC moyen autour de 80 ppm.
 * Retourne null si pas de delta positif.
 */
function calcPhPlus(volume, phMesure, phSouhaite){
  if(volume == null || phMesure == null || phSouhaite == null) return null;
  const delta = phSouhaite - phMesure;
  if(delta <= 0.05) return null;
  const gPerM3 = (delta / 0.3) * 14;
  const totalG = gPerM3 * volume;
  return {gPerM3, totalG, delta};
}

function calcPhPoudre(volume, phMesure, phSouhaite){
  // Trouver la cible la plus proche dans la table
  const cibles = Object.keys(PH_TABLE).map(Number).sort((a,b)=>b-a);
  let cible = cibles.find(c => Math.abs(c-phSouhaite)<0.05);
  if(!cible){
    // Prendre la cible la plus proche inférieure ou égale
    cible = cibles.find(c => c <= phSouhaite + 0.05) || cibles[cibles.length-1];
  }
  const row = PH_TABLE[cible];
  // Trouver mesure la plus proche
  const mesures = Object.keys(row).map(Number).sort((a,b)=>a-b);
  let mesure = mesures.find(m => Math.abs(m-phMesure)<0.05);
  if(!mesure){
    // Approximer : interpolation linéaire entre les deux plus proches
    let lower=null, upper=null;
    for(const m of mesures){
      if(m <= phMesure) lower = m;
      if(m >= phMesure && upper===null) upper = m;
    }
    if(lower && upper && lower !== upper){
      const r = (phMesure-lower)/(upper-lower);
      const gPerM3 = row[lower] + r*(row[upper]-row[lower]);
      return {gPerM3, totalG: gPerM3*volume, cibleUtilisee:cible};
    }
    mesure = lower || upper;
  }
  if(!mesure || row[mesure]===undefined) return null;
  return {gPerM3: row[mesure], totalG: row[mesure]*volume, cibleUtilisee:cible};
}

/**
 * Chlore combiné : Tcl - Fcl
 */
function calcCcl(fcl, tcl){
  return tcl - fcl;
}

/**
 * Fcl à viser : CYA / 10
 */
function calcFclVise(cya){
  return cya / 10;
}

/**
 * Javel 9.6° pour atteindre Fcl visé
 * Formule Excel : (FclVisé - FclActuel) * Volume / 100
 */
function calcJavelChloration(volume, fcl, cya){
  const fclVise = calcFclVise(cya);
  const litres = (fclVise - fcl) * volume / 100;
  return {fclVise, litres: Math.max(0, litres)};
}

/**
 * Dose d'entretien quotidienne — compense la consommation naturelle de chlore.
 * Même quand Fcl est dans la cible, le chlore se dégrade : UV (≈40-75 %/jour
 * sans CYA, ≈10-30 % avec CYA 30-50 ppm), oxydation organique, baigneurs.
 *
 * Modèle simplifié :
 *   loss_ppm_jour ≈ (base + soleil) × protection_CYA
 *     base = 0.3 ppm/jour (organiques + baigneurs estimés)
 *     soleil = max(0, (T - 15) / 10) — 0 à ≤15°C, 1 à 25°C, 1.5 à 30°C, 2 à 35°C
 *     protection_CYA = max(0.25, 1 - CYA/100)
 *
 * Retourne : ppmPerDay (perte estimée), javelL (dose quotidienne en L de Javel 9.6°).
 * Renvoie null si pas de température (on n'extrapole pas).
 */
function calcChloreMaintenance(volume, temperature, cya){
  if(volume == null || temperature == null) return null;
  const cyaSafe = (cya == null || cya < 0) ? 0 : cya;
  const sun = Math.max(0, (temperature - 15) / 10);
  const cyaProtect = Math.max(0.25, 1 - cyaSafe / 100);
  const ppmPerDay = (0.3 + sun) * cyaProtect;
  // Javel 9.6° : 1 ppm sur 1 m³ ≈ 0.01 L
  const javelL = (ppmPerDay * volume) / 100;
  return {ppmPerDay, javelL, javelLWeek: javelL * 7};
}

/**
 * Chloration choc : facteur 5 à 10 fois 10% du CYA
 * Javel 9.6 : facteur * (FclVisé - Fcl) * Volume / 100
 * Hypochlorite Calcium : 15 * CYA * facteur * Volume / 100
 */
function calcChlorationChoc(volume, fcl, cya, facteur=5){
  const fclVise = calcFclVise(cya);
  const tauxChlore = facteur * (cya/10);
  const javel = facteur * (fclVise - fcl) * volume / 100;
  const hypocalcium = 15 * cya * facteur * volume / 100;
  return {tauxChlore, javel: Math.max(0, javel), hypocalcium: Math.max(0, hypocalcium), facteur};
}

/**
 * Superchloration (si Ccl > 0.6 ppm) - élimination chloramines
 * Hypochlorite de Calcium : Ccl * Volume * 1.5 * 10 (grammes)
 * Javel 9.6° : 0.1 * (Volume/10) * Ccl * 10 (litres)
 */
function calcSuperchloration(volume, ccl){
  if(ccl <= 0.6) return null;
  const hypocalciumG = ccl * volume * 1.5 * 10;
  const javelL = 0.1 * (volume/10) * ccl * 10;
  return {hypocalciumG, javelL};
}

/**
 * Augmentation TAC
 * Formule Excel : 1.7 * delta_tac * volume (grammes)
 * = 17g/m³ par 10ppm
 */
function calcTacPlus(volume, tacMesure, tacSouhaite){
  const delta = tacSouhaite - tacMesure;
  if(delta <= 0) return null;
  return {delta, totalG: 1.7 * delta * volume};
}

/**
 * Sel (NaCl) à ajouter pour électrolyse
 * 1 g/L = 1 kg/m³ → kg = (cible − actuel) × volume
 * Si > cible : pas d'ajout, signaler dilution.
 */
function calcSel(volume, selMesure, selSouhaite){
  if(volume == null || selSouhaite == null) return null;
  const actuel = selMesure ?? 0;
  const delta = selSouhaite - actuel;
  if(delta <= 0){
    if(actuel - selSouhaite > 0.5) return {action:'dilution', delta: actuel - selSouhaite, kg:0};
    return {action:'ok', delta:0, kg:0};
  }
  return {action:'ajout', delta, kg: delta * volume};
}

/**
 * Acide cyanurique (stabilisant / CYA) à ajouter pour atteindre la cible
 * 1 g de CYA pur dans 1 m³ d'eau ≈ 1 ppm. Le CYA ne s'élimine pas (sauf dilution).
 * Au-delà de cyaSouhaite + 10, on ne propose pas d'ajout (gestion via vidange — computeDrainActions).
 */
function calcCYA(volume, cyaMesure, cyaSouhaite){
  if(volume == null || cyaSouhaite == null) return null;
  const actuel = cyaMesure ?? 0;
  const delta = cyaSouhaite - actuel;
  if(delta <= 0) return {action:'ok', delta:0, g:0};
  return {action:'ajout', delta, g: delta * volume};
}

/**
 * Calcium (CaCl₂ anhydre ~77 %) pour augmenter TH
 * 1 °f = 10 ppm CaCO₃ ≈ 4 ppm Ca²⁺
 * Pour +10 ppm CaCO₃ : ~11 g/m³ de CaCl₂ → ~11 g/m³ par °f
 */
function calcCalcium(volume, thMesure, thSouhaite){
  if(volume == null || thSouhaite == null) return null;
  const actuel = thMesure ?? 0;
  const delta = thSouhaite - actuel;
  if(delta <= 0) return {action: actuel > thSouhaite + 5 ? 'haut' : 'ok', delta:0, gCaCl2:0};
  return {action:'ajout', delta, gCaCl2: 11 * delta * volume};
}

/**
 * Anti-phosphate (produit type SeaKlear, ratio standard)
 * 1 mL/m³ traite ~10 ppb. Plancher ramené à 50 ppb (cible idéale).
 */
function calcAntiPhosphate(volume, phosphate){
  if(volume == null || phosphate == null) return null;
  if(phosphate < 100) return {action: phosphate < 50 ? 'ok' : 'surveiller', mL:0, ppbExcedent:0};
  const ppbExcedent = phosphate - 50;
  return {action:'traiter', ppbExcedent, mL: (ppbExcedent/10) * volume};
}

/**
 * Brome — chloration alternative
 * Cible 2 – 4 ppm. Pastilles BCDMH : 1 g/m³ ≈ 0,5 ppm Br²
 */
function calcBrome(volume, brome, cible=3){
  if(volume == null) return null;
  const actuel = brome ?? 0;
  const delta = cible - actuel;
  if(delta <= 0) return {action: actuel > 5 ? 'haut' : 'ok', delta:0, grammes:0};
  return {action:'ajout', delta, grammes: 2 * delta * volume};
}

/**
 * % de chlore actif (HOCl) en fonction du pH (sans CYA)
 * Équilibre HOCl / OCl⁻ à 25 °C : pKa = 7,54
 */
function calcHOClPct(pH){
  if(pH == null || isNaN(pH)) return null;
  return 1 / (1 + Math.pow(10, pH - 7.54));
}

/**
 * HOCl actif (ppm) — modèle O'Brien/Wojtowicz utilisé par PoolLab/LABCONNECT.
 * Tient compte de pH ET de l'effet stabilisant du CYA.
 *
 * Sans CYA significatif (< 5 ppm) :
 *   HOCl = Fcl × 1 / (1 + 10^(pH − 7,54))
 *
 * Avec CYA : ajustement loi-puissance calibré sur Wojtowicz 2001 (25 °C, pH 7,5)
 *   HOCl(ppm) ≈ Fcl × 0,5 × CYA^−0,89
 *   correction pH atténuée (le CYA aplatit la courbe pH/HOCl)
 *   facteur pH = 10^((7,5 − pH) × 0,25)
 *
 * Valeurs de référence (Fcl 1 ppm, pH 7,5) :
 *   CYA 0   → 0,52 · CYA 30 → 0,025 · CYA 50 → 0,017 · CYA 100 → 0,009
 */
function calcHOClFromCYA(fcl, pH, cya){
  if(fcl == null || pH == null) return null;
  if(!cya || cya < 5) return fcl * calcHOClPct(pH);
  const baseRatio = 0.5 * Math.pow(cya, -0.89);
  const phCorr = Math.pow(10, (7.5 - pH) * 0.25);
  return fcl * baseRatio * phCorr;
}

/**
 * Seuils Fcl alignés sur les formules Excel d'origine :
 * - min    = CYA / 20  (5 %, plancher de désinfection)
 * - cible  = CYA / 10  (formule Excel calcFclVise — chloration journalière)
 * - choc   = CYA / 2   (formule Excel calcChlorationChoc facteur ×5)
 *
 * Sans CYA : repères 0,5 / 1 / 5 ppm.
 */
function fcThresholds(cya){
  if(!cya || cya < 5) return {min:0.5, target:1, shock:5};
  return {
    min:    cya / 20,
    target: cya / 10,
    shock:  cya / 2
  };
}

/**
 * Chlore actif simple (ancien — conservé pour rétrocompat)
 */
function calcChloreActif(fcl, pH){
  return calcHOClFromCYA(fcl, pH, 0);
}

/**
 * Indice de saturation de Langelier (LSI)
 * LSI = pH + TF + CF + AF − C
 *   TF = facteur température
 *   CF = facteur calcium (log10(Ca CaCO₃) − 0,4)
 *   AF = log10(alcalinité corrigée CYA : TAC − CYA/3)
 *   C  = 12,1 (eau douce) ou 12,2 (sel)
 * Lecture :
 *   < −0,3  corrosif
 *   −0,3 à +0,3  équilibré
 *   > +0,3  entartrant
 */
function calcLSI(pH, temp, thF, tac, cya=0, isSalt=false){
  if(pH == null || temp == null || thF == null || tac == null) return null;
  const caCaCO3 = thF * 10; // °f → ppm CaCO₃
  const carbAlk = Math.max(1, tac - (cya||0)/3);
  // TF : interpolation issue des tables Taylor (°C)
  const tfTable = [[0,0],[5,0.1],[10,0.3],[15,0.5],[20,0.6],[25,0.7],[30,0.8],[35,0.9]];
  const TF = interp(tfTable, temp);
  const CF = Math.max(0, Math.log10(Math.max(1, caCaCO3)) - 0.4);
  const AF = Math.log10(carbAlk);
  const C = isSalt ? 12.2 : 12.1;
  return pH + TF + CF + AF - C;
}

function interp(table, x){
  if(x <= table[0][0]) return table[0][1];
  if(x >= table[table.length-1][0]) return table[table.length-1][1];
  for(let i=0;i<table.length-1;i++){
    const [x0,y0] = table[i], [x1,y1] = table[i+1];
    if(x >= x0 && x <= x1) return y0 + (y1-y0) * (x-x0)/(x1-x0);
  }
  return table[table.length-1][1];
}

/**
 * Calcule les vidanges partielles nécessaires pour ramener à la cible
 * les paramètres qui ne peuvent pas être réduits chimiquement :
 * CYA (> 40), sel (> 5 g/L), TH (> 30 °f).
 *
 * Formule : volume_à_vidanger = (val_actuel − val_cible) / val_actuel × volume_bassin
 * → suppose une dilution parfaite par eau neuve à 0.
 * Pour le sel et le TH, l'eau du réseau apporte un peu (notamment TH dans les
 * régions calcaires) — la valeur est une estimation haute.
 */
function computeDrainActions(m){
  const out = [];
  if(!m.volume) return out;
  const computeDrain = (actuel, cible) => {
    if(actuel == null || actuel <= cible) return null;
    return (actuel - cible) / actuel * m.volume;
  };
  // CYA : vidange si on dépasse la cible utilisateur de plus de 5 ppm, OU au-delà de 40 (seuil critique).
  // Le CYA ne se dégrade pas (sauf dilution), donc dès qu'on dépasse durablement la cible, faut vidanger.
  if(m.cya != null){
    const cible = m.cyaSouhaite ?? 30;
    if(m.cya > cible + 5 || m.cya > 40){
      const vol = computeDrain(m.cya, cible);
      if(vol > 0.5) out.push({label:'CYA trop haut', actuel:m.cya, cible, unit:'ppm', volume:vol});
    }
  }
  // Sel : cible 4 g/L (au-delà de 5, électrolyseur encrassé + risque corrosion)
  if(m.sel != null && m.sel > 5){
    const cible = m.selSouhaite ?? 4;
    const vol = computeDrain(m.sel, cible);
    if(vol > 0.5) out.push({label:'Sel trop haut', actuel:m.sel, cible, unit:'g/L', volume:vol});
  }
  // TH : cible 25 °f (au-delà de 30 °f, entartrant + risque dépôts)
  if(m.th != null && m.th > 30){
    const cible = m.thSouhaite ?? 25;
    const vol = computeDrain(m.th, cible);
    if(vol > 0.5) out.push({label:'TH trop haut', actuel:m.th, cible, unit:'°f', volume:vol});
  }
  return out;
}

function lsiStatus(lsi){
  if(lsi == null) return null;
  if(lsi < -0.5) return {level:'danger', text:'Très corrosive', tone:'danger'};
  if(lsi < -0.3) return {level:'warn', text:'Corrosive', tone:'warn'};
  if(lsi > 0.5) return {level:'danger', text:'Très entartrante', tone:'danger'};
  if(lsi > 0.3) return {level:'warn', text:'Entartrante', tone:'warn'};
  return {level:'ok', text:'Eau équilibrée', tone:'ok'};
}

/**
 * pH qui ramène le LSI à 0 (équilibre parfait).
 * LSI = pH + TF + CF + AF − C → dépendance linéaire en pH, donc pH_cible = pH − LSI.
 * On borne dans [6.8, 8.0] : au-delà on suggère d'agir sur TH/TAC plutôt.
 */
function calcPhCibleLSI(pHActuel, lsi){
  if(pHActuel == null || lsi == null) return null;
  return pHActuel - lsi;
}

/**
 * % de HOCl (chlore actif) pour un Fcl/pH/CYA donnés — réutilise calcHOClFromCYA mais en %.
 */
function calcHOClPctFromCYA(fcl, pH, cya){
  if(!fcl) return null;
  const ppmHOCl = calcHOClFromCYA(fcl, pH, cya);
  return (ppmHOCl / fcl) * 100;
}

// ============== Évaluation globale ==============
// Tous les seuils proviennent du Guide SOS Piscine V3 (groupe FB éponyme).
function evaluateStatus(m){
  const issues = [];
  // pH : 6.8 - 7.4 (idéalement 7.2)
  if(m.ph !== null){
    if(m.ph < 6.8 || m.ph > 7.6) issues.push({level:'danger', msg:'pH'});
    else if(m.ph < 6.8 || m.ph > 7.4) issues.push({level:'warn', msg:'pH'});
  }
  // Chlore : ~10 % du CYA si dispo, sinon 1-3 ppm. Max 5 ppm (ARS France).
  if(m.fcl !== null){
    if(m.fcl > 5) issues.push({level:'danger', msg:'Chlore excessif'});
    else if(m.cya !== null && m.cya > 0){
      const clTarget = m.cya / 10;
      if(m.fcl < clTarget * 0.5) issues.push({level:'danger', msg:'Chlore très bas'});
      else if(m.fcl < clTarget * 0.85) issues.push({level:'warn', msg:'Chlore bas'});
    } else {
      if(m.fcl < 0.5) issues.push({level:'danger', msg:'Chlore bas'});
      else if(m.fcl < 1) issues.push({level:'warn', msg:'Chlore'});
    }
  }
  if(m.fcl !== null && m.tcl !== null){
    const ccl = m.tcl - m.fcl;
    if(ccl > 0.6) issues.push({level:'danger', msg:'Chloramines'});
  }
  // TAC : le guide ne donne PAS de plage absolue ("chaque bassin est différent").
  // Plage indicative très large pour signaler les valeurs aberrantes uniquement.
  if(m.tac !== null){
    if(m.tac < 50 || m.tac > 200) issues.push({level:'warn', msg:'TAC inhabituel'});
  }
  // CYA : idéal 15-20 ppm. 20-30 OK. 30-40 toléré. > 40 = vidange.
  if(m.cya !== null){
    if(m.cya > 40) issues.push({level:'danger', msg:'CYA trop élevé — diluer'});
    else if(m.cya > 30) issues.push({level:'warn', msg:'CYA haut'});
    else if(m.cya < 15) issues.push({level:'warn', msg:'CYA bas'});
  }
  // Sel (électrolyse)
  if(m.sel != null){
    if(m.sel < 2.5 || m.sel > 6) issues.push({level:'danger', msg:'Sel hors plage'});
    else if(m.sel < 3 || m.sel > 5) issues.push({level:'warn', msg:'Sel à ajuster'});
  }
  // TH (dureté)
  if(m.th != null){
    if(m.th < 10 || m.th > 60) issues.push({level:'warn', msg:'TH inhabituel'});
  }
  // Phosphates
  if(m.phosphate != null){
    if(m.phosphate > 500) issues.push({level:'danger', msg:'Phosphates élevés'});
    else if(m.phosphate > 100) issues.push({level:'warn', msg:'Phosphates'});
  }
  // Brome (si utilisé)
  if(m.modeDesinf === 'brome' && m.brome != null){
    if(m.brome < 1 || m.brome > 6) issues.push({level:'danger', msg:'Brome hors plage'});
    else if(m.brome < 2 || m.brome > 4) issues.push({level:'warn', msg:'Brome'});
  }
  // Indice de Langelier (si données suffisantes)
  if(m.ph != null && m.temp != null && m.th != null && m.tac != null){
    const lsi = calcLSI(m.ph, m.temp, m.th, m.tac, m.cya, m.modeDesinf === 'sel');
    const st = lsiStatus(lsi);
    if(st && st.level !== 'ok') issues.push({level:st.level, msg:`LSI ${st.text.toLowerCase()}`});
  }
  if(issues.some(i=>i.level==='danger')) return {level:'danger', text:'Action requise'};
  if(issues.length) return {level:'warn', text:'À surveiller'};
  return {level:'ok', text:'Eau équilibrée'};
}

// ============== UI - Onglets ==============
function switchTab(name){
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
  document.querySelectorAll('.tab').forEach(t=>t.classList.remove('active'));
  const page = $('page-'+name);
  if(page) page.classList.add('active');
  // Certaines pages (ex. contact) sont accessibles via lien et n'ont plus d'onglet dédié
  const tab = document.querySelector(`.tab[data-page="${name}"]`);
  if(tab) tab.classList.add('active');
  else {
    // Onglet "parent" : pour contact, on garde Paramètres surligné
    const parent = name === 'contact' ? 'parametres' : null;
    if(parent){
      const parentTab = document.querySelector(`.tab[data-page="${parent}"]`);
      if(parentTab) parentTab.classList.add('active');
    }
  }
  if(name==='historique') renderCharts();
  if(name==='correction'){
    renderCorrections();
    try{ renderHealthScoreCard(); }catch(e){}
    try{ renderInsightsCard(); }catch(e){}
    try{ renderChloreProjectionCard(); }catch(e){}
  }
  if(name==='mesure'){ try{ renderSeasonPromo(); }catch(e){} }
  window.scrollTo({top:0, behavior:'smooth'});
}

// Scroll fluide vers une section de la page Paramètres + surligne l'ancre active
function paramScrollTo(event, sectionId){
  if(event) event.preventDefault();
  const target = document.getElementById(sectionId);
  if(target) target.scrollIntoView({behavior:'smooth', block:'start'});
  document.querySelectorAll('.params-anchors a').forEach(a => a.classList.remove('is-current'));
  const link = document.querySelector(`.params-anchors a[href="#${sectionId}"]`);
  if(link) link.classList.add('is-current');
}

// ============== Saisie & Sauvegarde ==============
function readInputs(){
  const modeEl = $('modeDesinf');
  const opt = getOptionalFields();
  return {
    volume: num('volume'),
    ph: num('phMesure'),
    phSouhaite: num('phSouhaite'),
    fcl: num('fcl'),
    tcl: num('tcl'),
    tac: num('tacMesure'),
    tacSouhaite: num('tacSouhaite'),
    cya: num('cya'),
    cyaSouhaite: num('cyaSouhaite'),
    // Mesures avancées
    temp: num('temp'),
    sel: opt.sel === false ? null : num('selMesure'),
    selSouhaite: opt.sel === false ? null : num('selSouhaite'),
    th: opt.th === false ? null : num('thMesure'),
    thSouhaite: opt.th === false ? null : num('thSouhaite'),
    phosphate: opt.phosphate === false ? null : num('phosphate'),
    brome: opt.brome === false ? null : num('brome'),
    modeDesinf: modeEl ? modeEl.value : 'chlore',
    date: new Date().toISOString()
  };
}

function loadLastInputs(){
  const last = loadJSON(STORAGE_KEYS.lastInputs, null);
  if(!last) return;
  const setVal = (id, key) => { const v=last[key]; if(v!=null && $(id)) $(id).value = v; };
  setVal('volume','volume');
  setVal('phSouhaite','phSouhaite');
  setVal('tacSouhaite','tacSouhaite');
  setVal('cya','cya');
  setVal('cyaSouhaite','cyaSouhaite');
  setVal('selSouhaite','selSouhaite');
  setVal('thSouhaite','thSouhaite');
  if(last.modeDesinf && $('modeDesinf')) $('modeDesinf').value = last.modeDesinf;
  // Synchronise aussi les champs miroir de la page Rappels
  ['cfgVolume','cfgDebit','cfgPhSouhaite','cfgTacSouhaite','cfgCyaSouhaite','cfgSelSouhaite','cfgThSouhaite'].forEach(id => {
    const el = $(id);
    if(!el) return;
    const key = id.replace('cfg','').replace(/^[A-Z]/, c=>c.toLowerCase());
    if(last[key] !== null && last[key] !== undefined) el.value = last[key];
  });
  if(last.modeDesinf && $('cfgModeDesinf')) $('cfgModeDesinf').value = last.modeDesinf;
}

// ============== Auto-save bassin (volume + cibles) ==============
let savedPillTimer = null;
function showSavedPill(){
  const p = $('bassinSavedPill');
  if(!p) return;
  p.classList.add('show');
  clearTimeout(savedPillTimer);
  savedPillTimer = setTimeout(()=>p.classList.remove('show'), 1600);
}

function autoSaveBassinParams(){
  const current = loadJSON(STORAGE_KEYS.lastInputs, {}) || {};
  const debitEl = $('cfgDebit');
  const debitVal = debitEl && debitEl.value !== '' ? parseFloat(debitEl.value) : null;
  const next = {
    volume: num('volume'),
    debit: (debitVal !== null && !isNaN(debitVal)) ? debitVal : null,
    phSouhaite: num('phSouhaite'),
    tacSouhaite: num('tacSouhaite'),
    cya: num('cya'),
    cyaSouhaite: num('cyaSouhaite'),
    selSouhaite: num('selSouhaite'),
    thSouhaite: num('thSouhaite'),
    modeDesinf: $('modeDesinf') ? $('modeDesinf').value : null
  };
  // Ne sauve que les champs renseignés sans écraser les anciens
  const merged = {...current};
  Object.entries(next).forEach(([k,v]) => { if(v !== null && v !== '') merged[k] = v; });
  saveJSON(STORAGE_KEYS.lastInputs, merged);
  // Persiste aussi dans la config du bassin actif (source de vérité multi-bassins)
  const activeId = getActiveBassinId();
  if(activeId){
    const cfgPatch = {};
    Object.entries(next).forEach(([k,v]) => { if(v !== null && v !== '') cfgPatch[k] = v; });
    if(Object.keys(cfgPatch).length) updateBassin(activeId, {config: cfgPatch});
  }
  // Synchronise les champs miroir de la page Rappels
  const mirror = {volume:'cfgVolume', debit:'cfgDebit', phSouhaite:'cfgPhSouhaite', tacSouhaite:'cfgTacSouhaite', cyaSouhaite:'cfgCyaSouhaite', selSouhaite:'cfgSelSouhaite', thSouhaite:'cfgThSouhaite'};
  Object.entries(mirror).forEach(([k, id]) => {
    if(next[k] !== null && $(id)) $(id).value = next[k];
  });
  if(next.modeDesinf && $('cfgModeDesinf')) $('cfgModeDesinf').value = next.modeDesinf;
  showSavedPill();
}

function saveBassinConfigFromRappels(){
  const cfg = {
    volume: parseFloat($('cfgVolume').value) || null,
    debit: parseFloat($('cfgDebit').value) || null,
    phSouhaite: parseFloat($('cfgPhSouhaite').value) || null,
    tacSouhaite: parseFloat($('cfgTacSouhaite').value) || null,
    cyaSouhaite: parseFloat($('cfgCyaSouhaite').value) || null,
    selSouhaite: parseFloat($('cfgSelSouhaite').value) || null,
    thSouhaite: parseFloat($('cfgThSouhaite').value) || null,
    modeDesinf: $('cfgModeDesinf') ? $('cfgModeDesinf').value : null
  };
  if(cfg.volume === null){
    toast('Renseigne au moins le volume', 'warn');
    return;
  }
  const current = loadJSON(STORAGE_KEYS.lastInputs, {}) || {};
  const merged = {...current};
  Object.entries(cfg).forEach(([k,v]) => { if(v !== null && v !== '') merged[k] = v; });
  saveJSON(STORAGE_KEYS.lastInputs, merged);
  // Persiste aussi dans la config du bassin actif
  const activeId = getActiveBassinId();
  if(activeId){
    const cfgPatch = {};
    Object.entries(cfg).forEach(([k,v]) => { if(v !== null && v !== '') cfgPatch[k] = v; });
    if(Object.keys(cfgPatch).length) updateBassin(activeId, {config: cfgPatch});
  }
  // Reflète sur la page Mesures
  const mirror = {volume:'volume', phSouhaite:'phSouhaite', tacSouhaite:'tacSouhaite', cya:'cya', cyaSouhaite:'cyaSouhaite', selSouhaite:'selSouhaite', thSouhaite:'thSouhaite'};
  Object.entries(mirror).forEach(([k, id]) => {
    if(cfg[k] !== null && $(id)) $(id).value = cfg[k];
  });
  if(cfg.modeDesinf && $('modeDesinf')) $('modeDesinf').value = cfg.modeDesinf;
  cloudBackupSync();
  toast('Bassin configuré ✓');
  showSavedPill();
}

// Applique la config d'un bassin aux inputs (utilisé lors d'un switch)
function applyBassinConfigToInputs(bassin){
  if(!bassin || !bassin.config) return;
  const c = bassin.config;
  const setVal = (id, v) => { const el = $(id); if(el && v !== null && v !== undefined) el.value = v; };
  setVal('volume', c.volume);
  setVal('phSouhaite', c.phSouhaite);
  setVal('tacSouhaite', c.tacSouhaite);
  setVal('cya', c.cya);
  setVal('cyaSouhaite', c.cyaSouhaite);
  setVal('selSouhaite', c.selSouhaite);
  setVal('thSouhaite', c.thSouhaite);
  if(c.modeDesinf && $('modeDesinf')) $('modeDesinf').value = c.modeDesinf;
  // Miroir page Rappels
  setVal('cfgVolume', c.volume);
  setVal('cfgDebit', c.debit);
  setVal('cfgPhSouhaite', c.phSouhaite);
  setVal('cfgTacSouhaite', c.tacSouhaite);
  setVal('cfgCyaSouhaite', c.cyaSouhaite);
  setVal('cfgSelSouhaite', c.selSouhaite);
  setVal('cfgThSouhaite', c.thSouhaite);
  if(c.modeDesinf && $('cfgModeDesinf')) $('cfgModeDesinf').value = c.modeDesinf;
}

// ============== Affichage "dernier contrôle il y a X" ==============
function relativeTime(dateStr){
  const d = new Date(dateStr);
  const diffMs = Date.now() - d.getTime();
  const min = Math.round(diffMs / 60000);
  if(min < 1) return "à l'instant";
  if(min < 60) return `il y a ${min} min`;
  const h = Math.round(min / 60);
  if(h < 24) return `il y a ${h} h`;
  const days = Math.round(h / 24);
  if(days === 1) return 'hier';
  if(days < 30) return `il y a ${days} jours`;
  const months = Math.round(days / 30);
  if(months < 12) return `il y a ${months} mois`;
  return `il y a ${Math.round(months/12)} an${months>=24?'s':''}`;
}

function updateLastControlInfo(){
  const el = $('lastControlInfo');
  if(!el) return;
  const list = loadActiveMeasurements();
  if(!list.length){
    el.style.display = 'none';
    return;
  }
  const last = list[list.length - 1];
  $('lastControlText').textContent = `Dernier contrôle ${relativeTime(last.date)}`;
  el.style.display = 'flex';
}

function resetForm(){
  ['phMesure','fcl','tcl','tacMesure'].forEach(id => $(id).value = '');
  $('cclBadge').style.display = 'none';
  toast('Formulaire réinitialisé');
}

function saveAndCalc(){
  const m = readInputs();
  if(m.volume === null){
    toast('Renseigne le volume du bassin','warn');
    return;
  }
  const hasMeasure = m.ph!==null || m.fcl!==null || m.tcl!==null || m.tac!==null;
  if(!hasMeasure){
    toast('Saisis au moins une mesure','warn');
    return;
  }

  // Sauvegarder paramètres réutilisables
  saveJSON(STORAGE_KEYS.lastInputs, {
    volume: m.volume, phSouhaite: m.phSouhaite,
    tacSouhaite: m.tacSouhaite, cya: m.cya
  });

  // Sauvegarder dans l'historique du bassin actif
  m.bassinId = getActiveBassinId();
  const list = loadActiveMeasurements();
  list.push(m);
  saveActiveMeasurements(list);

  updateStatus(m);
  updateCclBadge(m);
  updateLastControlInfo();
  renderCorrections();
  try{ renderHealthScoreCard(); }catch(e){}
  try{ renderInsightsCard(); }catch(e){}
  try{ renderChloreProjectionCard(); }catch(e){}
  cloudBackupSync();
  toast('Mesure enregistrée');
  setTimeout(()=>switchTab('correction'), 600);
}

function updateCclBadge(m){
  if(m.fcl!==null && m.tcl!==null){
    const ccl = m.tcl - m.fcl;
    const badge = $('cclBadge');
    let cls = 'ok', label = 'OK';
    if(ccl > 0.6){cls='danger';label='Superchloration nécessaire'}
    else if(ccl > 0.4){cls='warn';label='Surveiller'}
    badge.innerHTML = `<div class="status-pill ${cls}"><span class="pulse"></span>Chlore combiné · ${fmt(ccl)} ppm · ${label}</div>`;
    badge.style.display = 'block';
  }
}

function updateStatus(m){
  const s = evaluateStatus(m);
  const el = $('globalStatus');
  el.className = 'status-pill ' + s.level;
  $('statusText').textContent = s.text;
}

// ============== Recommandation filtration ==============
// Heures recommandées selon T° eau (règle T°/2 avec paliers saisonniers)
function filtrationHoursForTemp(t){
  if(t === null || t === undefined || isNaN(t)) return null;
  if(t < 10) return 1;
  if(t < 12) return 2;
  if(t > 28) return 24;
  return Math.max(2, Math.round(t / 2));
}

// Calcule cycles/jour + Gage-Bidwell + status
function computeFiltration(temp, volume, debit){
  const hours = filtrationHoursForTemp(temp);
  if(hours === null) return null;
  const out = {hours, temp};
  if(volume && volume > 0 && debit && debit > 0){
    const cycleTime = volume / debit; // h/cycle
    const cycles = hours / cycleTime;
    const renewal = (1 - Math.exp(-cycles)) * 100;
    let level = 'danger';
    if(cycles >= 3) level = 'ok';
    else if(cycles >= 1.5) level = 'warn';
    out.cycleTime = cycleTime;
    out.cycles = cycles;
    out.renewal = renewal;
    out.level = level;
    out.underpowered = cycleTime > 4;
    out.minDebit = volume / 4;
  }
  return out;
}

function renderFiltration(){
  const card = $('filtrationCard');
  if(!card) return;
  const temp = num('temp');
  const volume = num('volume');
  // Le débit vit dans cfgDebit (page Rappels) — lu via storage ou DOM
  let debit = null;
  const debitEl = $('cfgDebit');
  if(debitEl && debitEl.value !== '') debit = parseFloat(debitEl.value);
  if(debit === null || isNaN(debit)){
    const last = loadJSON(STORAGE_KEYS.lastInputs, null);
    if(last && last.debit) debit = last.debit;
  }
  const f = computeFiltration(temp, volume, debit);
  if(!f){ card.style.display = 'none'; return; }
  card.style.display = '';

  const statsEl = $('filtrationStats');
  const pillEl = $('filtrationPill');
  const noteEl = $('filtrationNote');

  // Pill
  if(f.level){
    const labels = {ok:'Bonne filtration', warn:'À surveiller', danger:'Sous-filtré'};
    pillEl.className = 'status-pill ' + f.level;
    pillEl.innerHTML = '<span class="pulse"></span>' + labels[f.level];
    pillEl.style.display = '';
  } else {
    pillEl.style.display = 'none';
    pillEl.className = 'status-pill';
    pillEl.textContent = '';
  }

  // Stats (2 ou 3 items selon dispo)
  const items = [];
  items.push(`<div class="item">
    <div class="result-label">Heures/jour</div>
    <div class="result-value">${f.hours}<span class="unit">h</span></div>
  </div>`);
  if(f.cycles !== undefined){
    items.push(`<div class="item">
      <div class="result-label">Cycles/jour</div>
      <div class="result-value">${f.cycles.toFixed(1)}<span class="unit">×</span></div>
    </div>`);
    items.push(`<div class="item">
      <div class="result-label">Renouvellement</div>
      <div class="result-value">${Math.round(f.renewal)}<span class="unit">%</span></div>
    </div>`);
  }
  statsEl.innerHTML = items.join('');
  statsEl.style.gridTemplateColumns = items.length === 3 ? 'repeat(3,1fr)' : 'repeat(2,1fr)';

  // Note explicative
  const notes = [];
  if(temp < 10) notes.push('Hivernage : eau froide, 1 h/j suffit (ou arrêt total si gel).');
  else if(temp > 28) notes.push('Canicule : filtration en continu 24/24 pour éviter le développement d\'algues.');
  else notes.push(`Règle T°/2 : ${f.temp} °C → ${f.hours} h/j en journée (8 h–20 h).`);
  if(f.cycles !== undefined){
    notes.push(`1 cycle = ${f.cycleTime.toFixed(1)} h (volume ${volume} m³ ÷ débit ${debit} m³/h).`);
    notes.push('Objectif : 3–4 cycles/jour (95–98 % de renouvellement, loi Gage-Bidwell).');
    if(f.underpowered){
      notes.push(`⚠ Pompe sous-dimensionnée : 1 cycle &gt; 4 h. Débit minimum recommandé = ${f.minDebit.toFixed(1)} m³/h.`);
    }
  } else {
    notes.push('Renseigne le débit pompe (Rappels → Configurer mon bassin) pour voir les cycles/jour.');
  }
  noteEl.innerHTML = notes.join('<br>');
}

// ============== Rendu Corrections ==============
function renderCorrections(measurement, targetContainer){
  const m = measurement || readInputs();
  const container = targetContainer || $('correctionContent');

  if(m.volume === null){
    container.innerHTML = `<div class="empty">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707"/></svg>
      <p>Renseigne au moins le volume du bassin</p>
    </div>`;
    return;
  }

  let html = '';
  // Mode brome : les cartes chlore (Chloration, Choc, Superchloration, CYA,
  // Pouvoir désinfectant HOCl) ne s'appliquent pas. Le mode "sel" reste traité
  // comme du chlore (l'électrolyse produit du chlore → CYA/chloration pertinents).
  const isBrome = m.modeDesinf === 'brome';

  // ===== pH =====
  if(m.ph !== null && m.phSouhaite !== null && m.ph > m.phSouhaite){
    const hcl = calcHcl(m.volume, m.ph, m.phSouhaite);
    const poudre = calcPhPoudre(m.volume, m.ph, m.phSouhaite);

    html += `<div class="card">
      <div class="card-header">
        <div class="card-title"><span class="dot"></span>Correction pH</div>
        <span style="font-size:11px;color:var(--shallow);font-family:'JetBrains Mono',monospace">Δ ${fmt(m.ph - m.phSouhaite, 2)}</span>
      </div>
      <div class="result-multi">
        <div class="item">
          <div class="result-label">Acide chlorhydrique</div>
          <div class="result-value">${fmt(hcl, 2)}<span class="unit">L</span></div>
        </div>`;
    if(poudre){
      html += `<div class="item">
        <div class="result-label">pH- Poudre</div>
        <div class="result-value">${fmt(poudre.totalG, 0)}<span class="unit">g</span></div>
      </div>`;
    }
    html += `</div>
      <div class="result-note">⚠️ Appliquer 1/3 à 1/2 de la dose et remesurer le lendemain pour ajuster.</div>`;
    // Aperçu LSI après correction (si on a TH + TAC + temp)
    if(m.th !== null && m.tac !== null && m.temp !== null){
      const lsiAvant = calcLSI(m.ph, m.temp, m.th, m.tac, m.cya, m.modeDesinf === 'sel');
      const lsiApres = calcLSI(m.phSouhaite, m.temp, m.th, m.tac, m.cya, m.modeDesinf === 'sel');
      if(lsiAvant != null && lsiApres != null){
        const stAvant = lsiStatus(lsiAvant), stApres = lsiStatus(lsiApres);
        html += `<div class="result-note" style="margin-top:6px;padding-top:6px;border-top:1px solid var(--depth-line)">
          📊 LSI passera de <strong style="color:${stAvant.tone==='ok'?'var(--leaf)':stAvant.tone==='warn'?'var(--lemon)':'var(--coral)'}">${lsiAvant>=0?'+':''}${fmt(lsiAvant,2)}</strong>
          → <strong style="color:${stApres.tone==='ok'?'var(--leaf)':stApres.tone==='warn'?'var(--lemon)':'var(--coral)'}">${lsiApres>=0?'+':''}${fmt(lsiApres,2)}</strong>
          <span style="opacity:.7">(${stApres.text.toLowerCase()})</span>
        </div>`;
      }
    }
    html += `</div>`;
  } else if(m.ph !== null && m.phSouhaite !== null && m.ph < m.phSouhaite - 0.05){
    // pH sous la cible → recommander pH+ (carbonate de sodium)
    const phPlus = calcPhPlus(m.volume, m.ph, m.phSouhaite);
    const phDelta = m.phSouhaite - m.ph;
    const tacBas = m.tac !== null && m.tacSouhaite !== null && m.tac < m.tacSouhaite;
    if(phDelta < 0.2){
      // Doctrine SOS Piscine : on ne court pas après un pH légèrement bas.
      // Si le TAC est aussi sous la cible, on le règle d'abord (bicarbonate,
      // carte « Augmentation TAC » plus bas) — le pH remonte naturellement avec.
      const msg = tacBas
        ? `pH légèrement bas (Δ +${fmt(phDelta,2)}). Règle d'abord ton <strong>TAC</strong> au bicarbonate de sodium (voir « Augmentation TAC » ci-dessous) : le pH remontera naturellement. Inutile de courir après le pH.`
        : `pH légèrement bas (Δ +${fmt(phDelta,2)}). Souvent inutile de corriger — le pH remonte seul avec l'aération. Surveille${phPlus ? ` ; au besoin une 1/2 dose de carbonate de sodium (~${fmt(phPlus.totalG/2,0)} g) suffit` : ''}.`;
      html += `<div class="card">
        <div class="card-header">
          <div class="card-title"><span class="dot"></span>pH légèrement bas</div>
          <span style="font-size:11px;color:var(--shallow);font-family:'JetBrains Mono',monospace">Δ ${fmt(m.ph - m.phSouhaite, 2)}</span>
        </div>
        <div class="result">
          <div class="result-note">${msg}</div>
        </div>
      </div>`;
    } else if(phPlus){
      const splitNote = phPlus.delta > 0.6
        ? "⚠️ Écart important — applique en 2 fois, séparées de 24 h, en remesurant entre."
        : "⚠️ Applique 1/2 dose, mesure le lendemain, complète au besoin.";
      html += `<div class="card">
        <div class="card-header">
          <div class="card-title"><span class="dot"></span>Correction pH+</div>
          <span style="font-size:11px;color:var(--shallow);font-family:'JetBrains Mono',monospace">Δ +${fmt(phPlus.delta, 2)}</span>
        </div>
        <div class="result-multi">
          <div class="item">
            <div class="result-label">Carbonate de sodium</div>
            <div class="result-value">${fmt(phPlus.totalG, 0)}<span class="unit">g</span></div>
          </div>
        </div>
        <div class="result-note">${splitNote}</div>`;
      if(m.th !== null && m.tac !== null && m.temp !== null){
        const lsiAvant = calcLSI(m.ph, m.temp, m.th, m.tac, m.cya, m.modeDesinf === 'sel');
        const lsiApres = calcLSI(m.phSouhaite, m.temp, m.th, m.tac, m.cya, m.modeDesinf === 'sel');
        if(lsiAvant != null && lsiApres != null){
          const stAvant = lsiStatus(lsiAvant), stApres = lsiStatus(lsiApres);
          html += `<div class="result-note" style="margin-top:6px;padding-top:6px;border-top:1px solid var(--depth-line)">
            📊 LSI passera de <strong style="color:${stAvant.tone==='ok'?'var(--leaf)':stAvant.tone==='warn'?'var(--lemon)':'var(--coral)'}">${lsiAvant>=0?'+':''}${fmt(lsiAvant,2)}</strong>
            → <strong style="color:${stApres.tone==='ok'?'var(--leaf)':stApres.tone==='warn'?'var(--lemon)':'var(--coral)'}">${lsiApres>=0?'+':''}${fmt(lsiApres,2)}</strong>
            <span style="opacity:.7">(${stApres.text.toLowerCase()})</span>
          </div>`;
        }
      }
      html += `</div>`;
    }
  } else if(m.ph !== null && m.phSouhaite !== null){
    html += `<div class="card">
      <div class="card-header"><div class="card-title"><span class="dot"></span>pH</div></div>
      <div class="result ok">
        <div class="result-label">Niveau correct</div>
        <div class="result-note">pH mesuré (${fmt(m.ph,1)}) aligné avec ta cible (${fmt(m.phSouhaite,1)}).</div>
      </div>
    </div>`;
  }

  // ===== Chlore - Chloration normale =====
  // Si Fcl < 50 % de la cible, on saute cette carte : le choc curatif (plus bas)
  // prend le relais — afficher les deux dosages simultanément serait trompeur.
  if(!isBrome && m.fcl !== null && m.cya !== null && m.fcl >= calcFclVise(m.cya) * 0.5){
    const chl = calcJavelChloration(m.volume, m.fcl, m.cya);
    if(chl.litres > 0){
      html += `<div class="card">
        <div class="card-header">
          <div class="card-title"><span class="dot"></span>Chloration</div>
          <span style="font-size:11px;color:var(--shallow);font-family:'JetBrains Mono',monospace">Cible ${fmt(chl.fclVise,2)} ppm</span>
        </div>
        <div class="result">
          <div class="result-label">Javel 9.6° à ajouter</div>
          <div class="result-value">${fmt(chl.litres, 2)}<span class="unit">L</span></div>
          <div class="result-note">Pour atteindre Fcl visé = CYA/10 = ${fmt(chl.fclVise, 2)} ppm</div>
        </div>
      </div>`;
    } else {
      // Niveau correct → propose une dose d'entretien préventive pour compenser
      // la consommation continue (UV, baigneurs, oxydation). En mode chlore
      // uniquement — sel auto-régule, brome a son propre cycle.
      const maint = (m.modeDesinf === 'chlore' || !m.modeDesinf)
        ? calcChloreMaintenance(m.volume, m.temp, m.cya)
        : null;
      if(maint && maint.javelL >= 0.05){
        html += `<div class="card">
          <div class="card-header">
            <div class="card-title"><span class="dot"></span>Chloration · entretien</div>
            <span class="status-pill ok">Fcl ${fmt(m.fcl,2)} ppm</span>
          </div>
          <div class="result ok">
            <div class="result-label">Dose d'entretien quotidienne</div>
            <div class="result-value">${fmt(maint.javelL, 2)}<span class="unit">L</span></div>
            <div class="result-note">Javel 9.6° à ajouter ce soir pour compenser la perte estimée de <strong>${fmt(maint.ppmPerDay, 2)} ppm/jour</strong> (T° ${fmt(m.temp,1)} °C, CYA ${fmt(m.cya || 0, 0)} ppm). Sur 7 j ≈ ${fmt(maint.javelLWeek, 1)} L. Sans cet apport, le Fcl chutera sous la cible en 1-2 jours par temps chaud.</div>
          </div>
        </div>`;
      } else {
        html += `<div class="card">
          <div class="card-header"><div class="card-title"><span class="dot"></span>Chloration</div></div>
          <div class="result ok">
            <div class="result-label">Niveau correct</div>
            <div class="result-note">Fcl mesuré (${fmt(m.fcl,2)} ppm) ≥ cible (CYA/10 = ${fmt(chl.fclVise, 2)} ppm).${m.temp == null ? " Renseigne la température pour estimer la dose d'entretien quotidienne." : ' Aucune chloration à apporter.'}</div>
          </div>
        </div>`;
      }
    }
  }

  // ===== Superchloration (Ccl > 0.6) =====
  if(!isBrome && m.fcl !== null && m.tcl !== null){
    const ccl = m.tcl - m.fcl;
    const sc = calcSuperchloration(m.volume, ccl);
    if(sc){
      html += `<div class="card">
        <div class="card-header">
          <div class="card-title" style="color:var(--coral)"><span class="dot" style="background:var(--coral);box-shadow:0 0 10px var(--coral)"></span>Superchloration</div>
          <span class="status-pill danger"><span class="pulse"></span>Ccl ${fmt(ccl,2)} ppm</span>
        </div>
        <div class="result danger">
          <div class="result-label">Élimination des chloramines</div>
          <div class="result-multi-or">
            <div class="item">
              <div class="result-label">Hypochlorite Ca</div>
              <div class="result-value">${fmt(sc.hypocalciumG, 0)}<span class="unit">g</span></div>
            </div>
            <div class="or-sep">OU</div>
            <div class="item">
              <div class="result-label">Javel 9.6°</div>
              <div class="result-value">${fmt(sc.javelL, 2)}<span class="unit">L</span></div>
            </div>
          </div>
          <div class="result-note">⚠️ Choisir <strong>l'un OU l'autre</strong> · Ccl &gt; 0.6 ppm — superchloration nécessaire</div>
        </div>
      </div>`;
    } else {
      html += `<div class="card">
        <div class="card-header"><div class="card-title"><span class="dot"></span>Chlore combiné</div></div>
        <div class="result ok">
          <div class="result-label">Pas de chloramines</div>
          <div class="result-note">Ccl mesuré (${fmt(ccl,2)} ppm) ≤ 0.6 ppm. Pas de superchloration à prévoir.</div>
        </div>
      </div>`;
    }
  }

  // ===== Chloration choc (curative, alternative à la chloration quotidienne) =====
  // Ne s'affiche QUE si Fcl très bas (< 50 % de la cible) — signal de prolifération.
  // Ne s'ajoute PAS à la chloration quotidienne : c'est SOIT l'un SOIT l'autre.
  if(!isBrome && m.fcl !== null && m.cya !== null && m.fcl < calcFclVise(m.cya) * 0.5){
    const choc = calcChlorationChoc(m.volume, m.fcl, m.cya, 5);
    if(choc.javel > 0 || choc.hypocalcium > 0){
      // Boost pH : si pH actuel > 6.9, calculer le gain HOCl en pré-baissant à 6.8
      let boostHtml = '';
      if(m.ph !== null && m.ph > 6.9){
        // Fcl post-choc (on raisonne sur la cible "post-choc" pour estimer % HOCl)
        const fclPost = calcFclVise(m.cya) * 5; // cible choc ≈ CYA/2
        const pctActuel = calcHOClPctFromCYA(fclPost, m.ph, m.cya);
        const pct68 = calcHOClPctFromCYA(fclPost, 6.8, m.cya);
        if(pctActuel && pct68 && pct68 > pctActuel * 1.10){
          const gain = ((pct68 / pctActuel) - 1) * 100;
          const hclTo68 = calcHcl(m.volume, m.ph, 6.8);
          boostHtml = `<div class="result-note" style="margin-top:10px;padding:10px;background:rgba(110,231,183,.08);border-left:3px solid var(--leaf);border-radius:6px;color:var(--foam)">
            💡 <strong>Boost efficacité (optionnel)</strong> — Avant le choc, baisser le pH à <strong>6,8</strong> rend le chlore actif (HOCl) <strong>+${fmt(gain, 0)}&nbsp;%</strong> plus efficace (${fmt(pctActuel,1)}&nbsp;% → ${fmt(pct68,1)}&nbsp;% de HOCl).
            <br><span style="opacity:.85">Verser ≈ <strong>${fmt(hclTo68, 2)} L d'HCl</strong>, attendre 30 min, puis injecter la javel. Le pH remontera naturellement avec le chlore. Eau légèrement corrosive pendant 6-12 h — sans risque sur cette durée.</span>
          </div>`;
        }
      }
      const chlNorm = calcJavelChloration(m.volume, m.fcl, m.cya);
      html += `<div class="card">
        <div class="card-header">
          <div class="card-title" style="color:var(--lemon)"><span class="dot" style="background:var(--lemon);box-shadow:0 0 10px var(--lemon)"></span>Chlore très bas</div>
          <span class="status-pill warn"><span class="pulse"></span>Fcl ${fmt(m.fcl,2)} ppm</span>
        </div>
        <div class="result warn">
          <div class="result-label">Deux options selon l'état de l'eau</div>
          <div class="result-multi-or" style="margin-top:8px">
            <div class="item">
              <div class="result-label">💧 Eau claire · remise à niveau</div>
              <div class="result-value">${fmt(chlNorm.litres, 2)}<span class="unit">L</span></div>
              <div class="result-note">Javel 9.6° → cible CYA/10 = ${fmt(chlNorm.fclVise,2)} ppm</div>
            </div>
            <div class="or-sep">OU</div>
            <div class="item">
              <div class="result-label">🟢 Eau verte · choc curatif</div>
              <div class="result-value">${fmt(choc.javel, 2)}<span class="unit">L</span></div>
              <div class="result-note">Javel 9.6° (ou Hypochlorite Ca ${fmt(choc.hypocalcium, 0)} g) → CYA/2 ≈ ${fmt(m.cya/2,0)} ppm</div>
            </div>
          </div>
          <div class="result-note">Fcl ${fmt(m.fcl,2)} ppm &lt; 50 % de la cible (${fmt(calcFclVise(m.cya),2)} ppm). <strong>Eau claire</strong> (pompe coupée, oubli) → la remise à niveau suffit. <strong>Eau verte ou trouble</strong> (prolifération d'algues) → choc curatif.</div>
          ${boostHtml}
        </div>
      </div>`;
    }
  }

  // ===== TAC+ =====
  if(m.tac !== null && m.tacSouhaite !== null){
    const tacPlus = calcTacPlus(m.volume, m.tac, m.tacSouhaite);
    if(tacPlus){
      html += `<div class="card">
        <div class="card-header">
          <div class="card-title"><span class="dot"></span>Augmentation TAC</div>
          <span style="font-size:11px;color:var(--shallow);font-family:'JetBrains Mono',monospace">+${fmt(tacPlus.delta,0)} ppm</span>
        </div>
        <div class="result">
          <div class="result-label">TAC+ à ajouter</div>
          <div class="result-value">${fmt(tacPlus.totalG, 0)}<span class="unit">g</span></div>
          <div class="result-note">Base : 17 g/m³ pour +10 ppm</div>
        </div>
      </div>`;
    } else {
      html += `<div class="card">
        <div class="card-header"><div class="card-title"><span class="dot"></span>TAC</div></div>
        <div class="result ok">
          <div class="result-label">TAC suffisant</div>
          <div class="result-note">TAC mesuré (${fmt(m.tac,0)} ppm) ≥ TAC visé (${fmt(m.tacSouhaite,0)} ppm). Pas d'ajout de TAC+.</div>
        </div>
      </div>`;
    }
  }

  // ===== Désinfection (HOCl actif + seuils Fcl PoolLab) =====
  if(!isBrome && m.ph !== null && m.fcl !== null){
    const hocl = calcHOClFromCYA(m.fcl, m.ph, m.cya || 0);
    const t = fcThresholds(m.cya || 0);
    let tone = 'ok', label = 'Désinfection optimale';
    if(m.fcl < t.min){ tone='danger'; label='Fcl insuffisant pour le CYA'; }
    else if(m.fcl < t.target){ tone='warn'; label='Fcl sous la cible'; }
    else if(m.fcl > t.shock){ tone='warn'; label='Fcl niveau choc'; }
    // Verdict HOCl (la vraie mesure de l'efficacité désinfectante)
    let hoclVerdict, hoclColor;
    if(hocl >= 0.10){ hoclVerdict = '✓ Très efficace'; hoclColor = 'var(--leaf)'; }
    else if(hocl >= 0.05){ hoclVerdict = '✓ Suffisant'; hoclColor = 'var(--leaf)'; }
    else if(hocl >= 0.03){ hoclVerdict = '⚠ Limite — vire vite à l\'algue'; hoclColor = 'var(--lemon)'; }
    else { hoclVerdict = '✗ Insuffisant — risque bactérien'; hoclColor = 'var(--coral)'; }
    // Part de Fcl réellement active (en %)
    const actifPct = m.fcl > 0 ? Math.min(100, (hocl/m.fcl)*100) : 0;
    html += `<div class="card">
      <div class="card-header">
        <div class="card-title"><span class="dot" style="background:var(--leaf);box-shadow:0 0 10px var(--leaf)"></span>Pouvoir désinfectant</div>
        <span style="font-size:11px;color:var(--shallow);font-family:'JetBrains Mono',monospace">Modèle O'Brien</span>
      </div>
      <div class="result ${tone}">
        <div class="result-multi">
          <div class="item">
            <div class="result-label">Chlore actif (HOCl)</div>
            <div class="result-value">${fmt(hocl, 3)}<span class="unit">ppm</span></div>
            <div class="result-note" style="color:${hoclColor};font-weight:500;margin-top:4px">${hoclVerdict}</div>
          </div>
          <div class="item">
            <div class="result-label">Cible Fcl total</div>
            <div class="result-value">${fmt(t.target, 2)}<span class="unit">ppm</span></div>
            <div class="result-note" style="margin-top:4px;opacity:.75">min ${fmt(t.min,1)} – choc ${fmt(t.shock,0)} ppm</div>
          </div>
        </div>
        <div class="result-note" style="margin-top:10px;padding-top:10px;border-top:1px solid var(--depth-line);line-height:1.5">
          <strong>Ce que ça veut dire</strong> — sur tes ${fmt(m.fcl,2)} ppm de Fcl mesurés, seuls <strong>${fmt(hocl,3)} ppm (${fmt(actifPct,1)}&nbsp;%)</strong> désinfectent vraiment.
          ${m.cya >= 5 ? `Le reste est séquestré par le CYA (${fmt(m.cya,0)} ppm) — utile pour résister au soleil, mais ça réduit l'efficacité immédiate.` : 'Sans stabilisant (CYA), tout le Fcl est actif mais brûle vite au soleil.'}
          ${tone !== 'ok' ? `<br><span style="color:var(--lemon)">⚠ ${label}.</span>` : ''}
        </div>
      </div>
    </div>`;
  }

  // ===== Sel (électrolyse) =====
  if(m.selSouhaite !== null || m.sel !== null){
    const cible = m.selSouhaite ?? 4.0;
    const s = calcSel(m.volume, m.sel, cible);
    if(s){
      if(s.action === 'ajout'){
        html += `<div class="card">
          <div class="card-header">
            <div class="card-title"><span class="dot"></span>Apport sel</div>
            <span style="font-size:11px;color:var(--shallow);font-family:'JetBrains Mono',monospace">Cible ${fmt(cible,1)} g/L</span>
          </div>
          <div class="result">
            <div class="result-label">Sel à ajouter</div>
            <div class="result-value">${fmt(s.kg, 1)}<span class="unit">kg</span></div>
            <div class="result-note">Δ +${fmt(s.delta,1)} g/L · Verser sel piscine non iodé, filtration en marche.</div>
          </div>
        </div>`;
      } else if(s.action === 'dilution'){
        html += `<div class="card">
          <div class="card-header"><div class="card-title" style="color:var(--coral)"><span class="dot" style="background:var(--coral);box-shadow:0 0 10px var(--coral)"></span>Sel trop élevé</div></div>
          <div class="result warn">
            <div class="result-label">Vidange partielle conseillée</div>
            <div class="result-note">Sel mesuré ${fmt(m.sel,1)} g/L > cible (Δ +${fmt(s.delta,1)} g/L). Diluer avec eau du réseau pour préserver la cellule.</div>
          </div>
        </div>`;
      } else if(m.sel !== null){
        html += `<div class="card">
          <div class="card-header"><div class="card-title"><span class="dot"></span>Sel</div></div>
          <div class="result ok">
            <div class="result-label">Salinité correcte</div>
            <div class="result-note">${fmt(m.sel,1)} g/L ≈ cible. Pas d'ajout.</div>
          </div>
        </div>`;
      }
    }
  }

  // ===== Calcium / TH =====
  if(m.thSouhaite !== null || m.th !== null){
    const cible = m.thSouhaite ?? 25;
    const ca = calcCalcium(m.volume, m.th, cible);
    if(ca && ca.action === 'ajout'){
      html += `<div class="card">
        <div class="card-header">
          <div class="card-title"><span class="dot"></span>Dureté (TH)</div>
          <span style="font-size:11px;color:var(--shallow);font-family:'JetBrains Mono',monospace">+${fmt(ca.delta,0)} °f</span>
        </div>
        <div class="result">
          <div class="result-label">Chlorure de calcium (CaCl₂)</div>
          <div class="result-value">${fmt(ca.gCaCl2, 0)}<span class="unit">g</span></div>
          <div class="result-note">Augmenter progressivement (max +10 °f / semaine) · diluer dans seau avant ajout.</div>
        </div>
      </div>`;
    } else if(ca && ca.action === 'haut'){
      // Le séquestrant/anti-calcaire ne se justifie que si l'eau est réellement
      // entartrante (LSI > +0,3). Un TH élevé avec un LSI équilibré n'entartre pas.
      const lsiTH = (m.ph!==null && m.temp!==null && m.th!==null && m.tac!==null)
        ? calcLSI(m.ph, m.temp, m.th, m.tac, m.cya, m.modeDesinf === 'sel') : null;
      if(lsiTH !== null && lsiTH <= 0.3){
        html += `<div class="card">
          <div class="card-header"><div class="card-title"><span class="dot"></span>Dureté (TH)</div></div>
          <div class="result ok">
            <div class="result-label">TH élevé mais eau équilibrée</div>
            <div class="result-note">TH ${fmt(m.th,0)} °f &gt; cible (${fmt(cible,0)} °f), mais le LSI (${lsiTH>=0?'+':''}${fmt(lsiTH,2)}) reste dans la zone saine : pas de risque d'entartrage, séquestrant inutile pour l'instant.</div>
          </div>
        </div>`;
      } else {
        html += `<div class="card">
          <div class="card-header"><div class="card-title" style="color:var(--coral)"><span class="dot" style="background:var(--coral);box-shadow:0 0 10px var(--coral)"></span>TH trop élevé</div></div>
          <div class="result warn">
            <div class="result-label">Risque d'entartrage</div>
            <div class="result-note">TH ${fmt(m.th,0)} °f &gt; cible (${fmt(cible,0)} °f)${lsiTH!==null?` · LSI ${lsiTH>=0?'+':''}${fmt(lsiTH,2)} (entartrant)`:''}. Diluer (vidange partielle) ou séquestrer (anti-calcaire).</div>
          </div>
        </div>`;
      }
    } else if(m.th !== null){
      html += `<div class="card">
        <div class="card-header"><div class="card-title"><span class="dot"></span>TH</div></div>
        <div class="result ok">
          <div class="result-label">Dureté correcte</div>
          <div class="result-note">TH ${fmt(m.th,0)} °f conforme à la cible (${fmt(cible,0)} °f).</div>
        </div>
      </div>`;
    }
  }

  // ===== CYA (stabilisant) — ajout si trop bas ; vidange gérée par computeDrainActions =====
  // Le CYA ne concerne pas le brome (pas de stabilisation UV du brome).
  if(!isBrome && m.cya !== null){
    const cible = m.cyaSouhaite ?? 30;
    const c = calcCYA(m.volume, m.cya, cible);
    if(c && c.action === 'ajout' && c.g >= 5){
      html += `<div class="card">
        <div class="card-header">
          <div class="card-title"><span class="dot"></span>Apport stabilisant (CYA)</div>
          <span style="font-size:11px;color:var(--shallow);font-family:'JetBrains Mono',monospace">Cible ${fmt(cible,0)} ppm</span>
        </div>
        <div class="result">
          <div class="result-label">Acide cyanurique à ajouter</div>
          <div class="result-value">${fmt(c.g, 0)}<span class="unit">g</span></div>
          <div class="result-note">Δ +${fmt(c.delta,0)} ppm · Verser les granulés dans le panier du skimmer, filtration en marche · dissolution complète sous 2–5 jours.</div>
        </div>
      </div>`;
    } else if(c && c.action === 'ok' && m.cya >= cible - 5 && m.cya <= cible + 5){
      // "Correct" affiché uniquement quand on est proche de la cible (±5 ppm).
      // Au-dessus, la carte vidange (computeDrainActions) prend le relais.
      html += `<div class="card">
        <div class="card-header"><div class="card-title"><span class="dot"></span>CYA</div></div>
        <div class="result ok">
          <div class="result-label">Stabilisant correct</div>
          <div class="result-note">${fmt(m.cya,0)} ppm conforme à la cible (${fmt(cible,0)} ppm).</div>
        </div>
      </div>`;
    }
  }

  // ===== Phosphates =====
  if(m.phosphate !== null){
    const p = calcAntiPhosphate(m.volume, m.phosphate);
    if(p && p.action === 'traiter'){
      html += `<div class="card">
        <div class="card-header">
          <div class="card-title"><span class="dot"></span>Anti-phosphate</div>
          <span class="status-pill warn"><span class="pulse"></span>${fmt(m.phosphate,0)} ppb</span>
        </div>
        <div class="result warn">
          <div class="result-label">Produit anti-phosphate</div>
          <div class="result-value">${fmt(p.mL, 0)}<span class="unit">mL</span></div>
          <div class="result-note">Excès ${fmt(p.ppbExcedent,0)} ppb · Filtrer 24 h puis nettoyer le filtre (les phosphates se fixent dessus).</div>
        </div>
      </div>`;
    } else if(p && p.action === 'surveiller'){
      html += `<div class="card">
        <div class="card-header"><div class="card-title"><span class="dot"></span>Phosphates</div></div>
        <div class="result warn">
          <div class="result-label">À surveiller</div>
          <div class="result-note">${fmt(m.phosphate,0)} ppb · Sous le seuil de traitement (100 ppb), mais à garder à l'œil.</div>
        </div>
      </div>`;
    } else if(p){
      html += `<div class="card">
        <div class="card-header"><div class="card-title"><span class="dot"></span>Phosphates</div></div>
        <div class="result ok">
          <div class="result-label">Niveau bas</div>
          <div class="result-note">${fmt(m.phosphate,0)} ppb &lt; 50 ppb. Pas de risque algues lié au PO₄.</div>
        </div>
      </div>`;
    }
  }

  // ===== Brome (si mode brome) =====
  if(m.modeDesinf === 'brome'){
    const br = calcBrome(m.volume, m.brome, 3);
    if(br && br.action === 'ajout'){
      html += `<div class="card">
        <div class="card-header">
          <div class="card-title"><span class="dot"></span>Brome</div>
          <span style="font-size:11px;color:var(--shallow);font-family:'JetBrains Mono',monospace">Cible 3 ppm</span>
        </div>
        <div class="result">
          <div class="result-label">Pastilles BCDMH</div>
          <div class="result-value">${fmt(br.grammes, 0)}<span class="unit">g</span></div>
          <div class="result-note">Δ +${fmt(br.delta,1)} ppm · Insérer dans brominateur ou skimmer.</div>
        </div>
      </div>`;
    } else if(br && br.action === 'haut'){
      html += `<div class="card">
        <div class="card-header"><div class="card-title" style="color:var(--coral)"><span class="dot" style="background:var(--coral);box-shadow:0 0 10px var(--coral)"></span>Brome élevé</div></div>
        <div class="result warn">
          <div class="result-label">Pause brominateur</div>
          <div class="result-note">${fmt(m.brome,1)} ppm &gt; 5 ppm. Couper l'alimentation jusqu'à retour ≤ 4 ppm.</div>
        </div>
      </div>`;
    } else if(br){
      html += `<div class="card">
        <div class="card-header"><div class="card-title"><span class="dot"></span>Brome</div></div>
        <div class="result ok">
          <div class="result-label">Niveau correct</div>
          <div class="result-note">${fmt(m.brome,1)} ppm dans la plage 2 – 4 ppm.</div>
        </div>
      </div>`;
    }
  }

  // ===== Indice de Langelier (LSI) =====
  if(m.ph !== null && m.temp !== null && m.th !== null && m.tac !== null){
    const lsi = calcLSI(m.ph, m.temp, m.th, m.tac, m.cya, m.modeDesinf === 'sel');
    const st = lsiStatus(lsi);
    const phCible = calcPhCibleLSI(m.ph, lsi);
    // Suggestion pH cible uniquement si correction utile (LSI hors plage saine) et pH cible réaliste
    const showSuggest = Math.abs(lsi) > 0.15 && phCible >= 6.9 && phCible <= 7.9;
    // ID unique pour le canvas Taylor (timestamp + random pour éviter collisions historique/modal)
    const taylorId = 'taylor_' + (m.date || Date.now()) + '_' + Math.random().toString(36).slice(2,7);
    html += `<div class="card">
      <div class="card-header">
        <div class="card-title"><span class="dot"></span>Indice de Langelier</div>
        <span class="status-pill ${st.level}"><span class="pulse"></span>${st.text}</span>
      </div>
      <div class="result ${st.tone}">
        <div class="result-label">LSI</div>
        <div class="result-value">${lsi >= 0 ? '+' : ''}${fmt(lsi, 2)}</div>
        <div class="result-note">Plage saine : −0,3 à +0,3 · &lt; corrosif (attaque métal/joints) · &gt; entartrant (dépôts calcaire).</div>
        ${showSuggest ? `<div class="result-note" style="margin-top:8px;padding-top:8px;border-top:1px solid var(--depth-line);color:var(--foam)">
          🎯 <strong>pH cible pour LSI = 0 :</strong> <span style="font-family:'JetBrains Mono',monospace;color:var(--leaf)">${fmt(phCible, 2)}</span>
          <span style="opacity:.7;font-size:11px"> · à TH/TAC/temp constants</span>
        </div>` : ''}
      </div>
      <div style="margin-top:12px;padding:8px;background:rgba(0,0,0,.15);border-radius:8px">
        <div style="font-size:11px;color:var(--shallow);opacity:.85;margin-bottom:4px;letter-spacing:.5px;text-transform:uppercase">Diagramme Taylor — pH × TAC</div>
        <canvas id="${taylorId}" height="180" style="max-height:200px"></canvas>
      </div>
    </div>`;
    // Rendu différé (le canvas doit exister dans le DOM)
    setTimeout(() => drawTaylorChart(taylorId, m), 50);
  }

  // ===== Vidange partielle (CYA / sel / TH trop élevés — non corrigeables chimiquement) =====
  if(m.volume){
    const drains = computeDrainActions(m);
    if(drains.length){
      const worst = drains.reduce((a, b) => a.volume > b.volume ? a : b);
      const pct = (worst.volume / m.volume) * 100;
      html += `<div class="card">
        <div class="card-header">
          <div class="card-title" style="color:var(--lemon)"><span class="dot" style="background:var(--lemon);box-shadow:0 0 10px var(--lemon)"></span>Vidange partielle</div>
          <span class="status-pill warn"><span class="pulse"></span>${drains.map(d => d.label).join(' · ')}</span>
        </div>
        <div class="result warn">
          <div class="result-multi">
            <div class="item">
              <div class="result-label">Volume à vidanger</div>
              <div class="result-value">${fmt(worst.volume, 1)}<span class="unit">m³</span></div>
              <div class="result-note" style="margin-top:4px;opacity:.75">≈ ${fmt(pct, 0)} % du bassin</div>
            </div>
            <div class="item">
              <div class="result-label">Remplir avec</div>
              <div class="result-value">${fmt(worst.volume, 1)}<span class="unit">m³</span></div>
              <div class="result-note" style="margin-top:4px;opacity:.75">d'eau du réseau</div>
            </div>
          </div>
          <div class="result-note" style="margin-top:10px;padding-top:10px;border-top:1px solid var(--depth-line);line-height:1.5">
            ${drains.map(d => `<div>📉 <strong>${d.label}</strong> ${fmt(d.actuel,1)} → ${fmt(d.cible,1)} ${d.unit} (vidange ${fmt(d.volume,1)} m³)</div>`).join('')}
            <div style="margin-top:8px;opacity:.85">Procédure : vidange par skimmer le matin, remplissage en fin de journée. Remettre Cl et bicarbonate après — la nouvelle eau dilue tous les paramètres, pas seulement celui qui est en excès.</div>
          </div>
        </div>
      </div>`;
    }
  }

  if(html === ''){
    html = `<div class="card">
      <div class="result ok">
        <div class="result-label">Tout est bon</div>
        <div class="result-value" style="font-size:24px">Aucune correction</div>
        <div class="result-note">Selon les mesures saisies, aucun ajustement n'est requis.</div>
      </div>
    </div>`;
  }

  container.innerHTML = html;
}

// ============== Historique ==============
function renderHistory(){
  const list = loadActiveMeasurements();
  const wrap = $('historyList');
  if(list.length === 0){
    wrap.innerHTML = `<div class="empty">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 7l9-4 9 4M3 7v10l9 4 9-4V7M3 7l9 4 9-4M12 11v10"/></svg>
      <p>Aucune mesure enregistrée</p>
    </div>`;
    return;
  }
  const months = ['JAN','FÉV','MAR','AVR','MAI','JUI','JUI','AOÛ','SEP','OCT','NOV','DÉC'];
  // Tri explicite par date décroissante (peu importe l'ordre dans le storage,
  // qui peut varier après un sync cloud)
  const sortedWithIdx = list
    .map((m, idx) => ({ m, idx }))
    .filter(x => x.m && x.m.date)
    .sort((a, b) => new Date(b.m.date).getTime() - new Date(a.m.date).getTime())
    .slice(0, 50);
  wrap.innerHTML = sortedWithIdx.map(({ m, idx }) => {
    const d = new Date(m.date);
    return `<div class="history-item" onclick="openHistDetail(${idx})" style="cursor:pointer">
      <div class="history-date">
        <div class="day">${d.getDate()}</div>
        <div class="month">${months[d.getMonth()]}</div>
      </div>
      <div class="history-data">
        <div class="h-item"><div class="h-label">pH</div><div class="h-value">${m.ph!==null?fmt(m.ph,1):'—'}</div></div>
        <div class="h-item"><div class="h-label">Fcl</div><div class="h-value">${m.fcl!==null?fmt(m.fcl,2):'—'}</div></div>
        <div class="h-item"><div class="h-label">TAC</div><div class="h-value">${m.tac!==null?fmt(m.tac,0):'—'}</div></div>
      </div>
      <button class="history-delete" onclick="event.stopPropagation();deleteMeasurement(${idx})" aria-label="Supprimer">×</button>
    </div>`;
  }).join('');
}

function deleteMeasurement(idx){
  if(!confirm('Supprimer cette mesure ?')) return;
  const list = loadActiveMeasurements();
  list.splice(idx, 1);
  saveActiveMeasurements(list);
  renderHistory();
  renderCharts();
  updateLastControlInfo();
  cloudBackupSync();
  toast('Mesure supprimée');
}

// ============== Graphiques ==============
let chartPh = null, chartTac = null, chartDesinf = null;

const HIST_METRICS_KEY = 'cp_hist_metrics_v1';
const HIST_METRICS_DEFAULT = {chart1: ['ph','tac'], chart2: ['fcl','cya']};
const HIST_METRICS = {
  ph:  {label:'pH',           short:'pH',     color:'#22b4d4', field:'ph'},
  fcl: {label:'Chlore (ppm)', short:'Chlore', color:'#7fdbda', field:'fcl'},
  tac: {label:'TAC (ppm)',    short:'TAC',    color:'#ffd166', field:'tac'},
  cya: {label:'CYA (ppm)',    short:'CYA',    color:'#06d6a0', field:'cya'}
};

function loadHistMetrics(){
  const s = loadJSON(HIST_METRICS_KEY, null);
  const ok = arr => Array.isArray(arr) && arr.length > 0 && arr.every(k => HIST_METRICS[k]);
  return {
    chart1: (s && ok(s.chart1)) ? s.chart1.slice() : HIST_METRICS_DEFAULT.chart1.slice(),
    chart2: (s && ok(s.chart2)) ? s.chart2.slice() : HIST_METRICS_DEFAULT.chart2.slice()
  };
}

function toggleHistMetric(chartId, metricKey){
  if(!HIST_METRICS[metricKey]) return;
  const state = loadHistMetrics();
  const arr = state[chartId] || [];
  const idx = arr.indexOf(metricKey);
  if(idx >= 0){
    if(arr.length > 1) arr.splice(idx, 1);
  } else {
    arr.push(metricKey);
  }
  state[chartId] = arr;
  saveJSON(HIST_METRICS_KEY, state);
  renderHistMetricChips();
  renderCharts();
}

function renderHistMetricChips(){
  const state = loadHistMetrics();
  ['chart1','chart2'].forEach(chartId => {
    const container = document.getElementById('chips-' + chartId);
    if(!container) return;
    const selected = state[chartId];
    container.querySelectorAll('.metric-chip').forEach(chip => {
      chip.classList.toggle('is-active', selected.includes(chip.dataset.metric));
    });
  });
  const t1 = document.getElementById('title-chart1');
  const t2 = document.getElementById('title-chart2');
  if(t1) t1.textContent = histChartTitle(state.chart1);
  if(t2) t2.textContent = histChartTitle(state.chart2);
}

function histChartTitle(keys){
  const parts = keys.map(k => HIST_METRICS[k].short);
  if(parts.length <= 2) return parts.join(' & ');
  return parts.slice(0, -1).join(', ') + ' & ' + parts[parts.length - 1];
}

function hexA(hex, a){
  const h = hex.replace('#','');
  const n = parseInt(h.length === 3 ? h.split('').map(c=>c+c).join('') : h, 16);
  return `rgba(${(n>>16)&255},${(n>>8)&255},${n&255},${a})`;
}

function buildHistChart(canvasId, list, labels, baseConfig, selectedKeys){
  const ctx = $(canvasId);
  if(!ctx) return null;
  const hasPh    = selectedKeys.includes('ph');
  const ppmKeys  = selectedKeys.filter(k => k !== 'ph');
  // pH a sa propre échelle (axe droit) dès qu'il y a au moins une métrique ppm
  const splitPh  = hasPh && ppmKeys.length > 0;
  // Si exactement 2 ppm sans pH, on garde le double axe gauche/droite pour lisibilité
  const dualPpm  = !hasPh && ppmKeys.length === 2;

  const axisFor = (k, i) => {
    if(splitPh) return k === 'ph' ? 'y1' : 'y';
    if(dualPpm) return i === 0 ? 'y' : 'y1';
    return 'y';
  };

  const datasets = selectedKeys.map((k, i) => {
    const cfg = HIST_METRICS[k];
    return {
      label: cfg.label,
      data: list.map(m => m[cfg.field]),
      borderColor: cfg.color,
      backgroundColor: hexA(cfg.color, .1),
      tension: .35, pointRadius: 3, pointHoverRadius: 5,
      spanGaps: true,
      yAxisID: axisFor(k, i)
    };
  });

  const titleFor = id => {
    if(splitPh) return id === 'y1' ? 'pH' : 'ppm';
    if(dualPpm) return HIST_METRICS[selectedKeys[id === 'y' ? 0 : 1]].short;
    return selectedKeys.length === 1 ? HIST_METRICS[selectedKeys[0]].short : 'valeur';
  };

  const scales = {x: baseConfig.scales.x};
  scales.y = {...baseConfig.scales.y, position:'left', title:{display:true, text:titleFor('y'), color:'#7fdbda', font:{family:'Manrope', size:10}}};
  if(splitPh || dualPpm){
    scales.y1 = {...baseConfig.scales.y, position:'right', grid:{drawOnChartArea:false}, title:{display:true, text:titleFor('y1'), color:'#7fdbda', font:{family:'Manrope', size:10}}};
  }

  return new Chart(ctx.getContext('2d'), {
    type: 'line',
    data: {labels, datasets},
    options: {...baseConfig, scales}
  });
}

function renderCharts(){
  renderHistory();
  renderTrends();
  const days = parseInt($('chartRange').value);
  const cutoff = Date.now() - days*86400000;
  const list = loadActiveMeasurements()
    .filter(m => new Date(m.date).getTime() >= cutoff)
    .sort((a,b) => new Date(a.date) - new Date(b.date));

  const labels = list.map(m => {
    const d = new Date(m.date);
    return `${d.getDate()}/${d.getMonth()+1}`;
  });

  const baseConfig = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: {intersect: false, mode: 'index'},
    plugins: {
      legend: {
        labels: {color:'#7fdbda', font:{family:'Manrope', size:11}, usePointStyle:true, pointStyle:'circle'}
      },
      tooltip: {
        backgroundColor:'rgba(4,29,46,.95)',
        borderColor:'rgba(127,219,218,.3)', borderWidth:1,
        titleColor:'#e8f9f8', bodyColor:'#7fdbda',
        titleFont:{family:'Fraunces', size:13},
        bodyFont:{family:'JetBrains Mono', size:11},
        padding:10, cornerRadius:10
      }
    },
    scales: {
      x: {
        ticks:{color:'#7fdbda', font:{family:'JetBrains Mono', size:10}},
        grid:{color:'rgba(127,219,218,.08)'}
      },
      y: {
        ticks:{color:'#7fdbda', font:{family:'JetBrains Mono', size:10}},
        grid:{color:'rgba(127,219,218,.08)'}
      }
    }
  };

  // Charts personnalisables (chart1 + chart2)
  const histState = loadHistMetrics();
  renderHistMetricChips();

  if(chartPh) chartPh.destroy();
  chartPh = buildHistChart('chartPh', list, labels, baseConfig, histState.chart1);

  if(chartTac) chartTac.destroy();
  chartTac = buildHistChart('chartTac', list, labels, baseConfig, histState.chart2);

  // Chart Désinfection — style PoolLab : Fcl mesuré + zones CYA-dépendantes
  const ctxDesinf = $('chartDesinf');
  if(ctxDesinf){
    if(chartDesinf) chartDesinf.destroy();
    // Pour chaque mesure, calcule les seuils Fcl à partir du CYA enregistré
    const thr = list.map(m => fcThresholds(m.cya || 0));
    const fcMin    = thr.map(t => +t.min.toFixed(2));
    const fcTarget = thr.map(t => +t.target.toFixed(2));
    const fcShock  = thr.map(t => +t.shock.toFixed(2));
    const fcMeasured = list.map(m => m.fcl);
    const hoclActif  = list.map(m => (m.ph != null && m.fcl != null) ? +calcHOClFromCYA(m.fcl, m.ph, m.cya || 0).toFixed(3) : null);
    const yMax = Math.max(10, ...fcShock.map(v => v*1.1));

    // Cap visuel : on montre confortablement min/cible/choc + Fcl mesuré
    const fcMax = Math.max(...fcMeasured.filter(v => v != null), 0);
    const tgtMax = Math.max(...fcTarget);
    const shockMax = Math.max(...fcShock);
    const yMaxCapped = Math.min(shockMax * 1.05, Math.max(fcMax * 1.6, tgtMax * 2.2, 4));

    chartDesinf = new Chart(ctxDesinf.getContext('2d'), {
      type: 'line',
      data: {
        labels,
        datasets: [
          // Zone rouge (0 → min) : insuffisant
          {
            label:'Insuffisant',
            data: fcMin,
            borderColor:'rgba(255,107,107,.55)',
            backgroundColor:'rgba(255,107,107,.28)',
            borderWidth:1.2, borderDash:[4,3], pointRadius:0,
            fill:'origin', tension:.2, yAxisID:'y', order:5
          },
          // Zone jaune (min → cible) : limite
          {
            label:'Limite',
            data: fcTarget,
            borderColor:'rgba(255,209,102,.55)',
            backgroundColor:'rgba(255,209,102,.26)',
            borderWidth:1.2, borderDash:[5,3], pointRadius:0,
            fill:'-1', tension:.2, yAxisID:'y', order:4
          },
          // Zone verte (cible → choc) : sain
          {
            label:'Sain',
            data: fcShock,
            borderColor:'rgba(6,214,160,.55)',
            backgroundColor:'rgba(6,214,160,.22)',
            borderWidth:1.2, borderDash:[6,4], pointRadius:0,
            fill:'-1', tension:.2, yAxisID:'y', order:3
          },
          // Fcl mesuré (ligne principale)
          {
            label:'Fcl mesuré (ppm)',
            data: fcMeasured,
            borderColor:'#22b4d4',
            backgroundColor:'#22b4d4',
            borderWidth:2.8, pointRadius:3.5, pointHoverRadius:5,
            tension:.35, spanGaps:true, fill:false, yAxisID:'y', order:1
          },
          // HOCl actif (axe secondaire — vraie désinfection après pénalité CYA)
          {
            label:'HOCl actif (ppm)',
            data: hoclActif,
            borderColor:'#e8f9f8',
            backgroundColor:'rgba(232,249,248,.1)',
            borderWidth:1.8, borderDash:[3,3], pointRadius:2, pointHoverRadius:4,
            tension:.35, spanGaps:true, fill:false, yAxisID:'y1', order:2
          }
        ]
      },
      options: {
        ...baseConfig,
        plugins:{
          ...baseConfig.plugins,
          legend:{
            ...baseConfig.plugins.legend,
            labels:{
              ...baseConfig.plugins.legend.labels,
              filter: (item) => !['Insuffisant','Limite','Sain'].includes(item.text)
            }
          }
        },
        scales: {
          x: baseConfig.scales.x,
          y: {
            ...baseConfig.scales.y, position:'left',
            title:{display:true, text:'Fcl ppm', color:'#7fdbda', font:{family:'Manrope', size:10}},
            min:0, max:yMaxCapped
          },
          y1: {
            ...baseConfig.scales.y, position:'right', grid:{drawOnChartArea:false},
            title:{display:true, text:'HOCl actif', color:'#7fdbda', font:{family:'Manrope', size:10}},
            min:0
          }
        }
      }
    });
  }
}

// ============== Rappels & Notifications ==============
function loadReminders(){
  const r = loadJSON(STORAGE_KEYS.reminders, {
    daily:false, weekly:false, filter:false,
    dailyTime:'09:00', weeklyTime:'10:00'
  });
  $('reminderDaily').checked = r.daily;
  $('reminderWeekly').checked = r.weekly;
  $('reminderFilter').checked = r.filter;
  $('dailyTime').value = r.dailyTime;
  $('weeklyTime').value = r.weeklyTime;
  $('dailyMeta').textContent = `Tous les jours à ${r.dailyTime}`;
  $('weeklyMeta').textContent = `Tous les samedis à ${r.weeklyTime}`;
}

function saveReminders(){
  const r = {
    daily: $('reminderDaily').checked,
    weekly: $('reminderWeekly').checked,
    filter: $('reminderFilter').checked,
    dailyTime: $('dailyTime').value,
    weeklyTime: $('weeklyTime').value
  };
  saveJSON(STORAGE_KEYS.reminders, r);
  $('dailyMeta').textContent = `Tous les jours à ${r.dailyTime}`;
  $('weeklyMeta').textContent = `Tous les samedis à ${r.weeklyTime}`;
  syncPushSubscription();
  cloudBackupSync();
  toast('Rappels enregistrés');
}

async function enableNotifications(){
  if(!('Notification' in window)){
    toast('Notifications non supportées','warn');
    return false;
  }
  const perm = await Notification.requestPermission();
  if(perm === 'granted'){
    $('enableNotifBtn').textContent = 'Activées';
    $('enableNotifBtn').style.color = 'var(--leaf)';
    if($('testNotifBtn')) $('testNotifBtn').style.display = '';
    new Notification('Chimie Piscine', {body:'Notifications activées 🌊', icon:'icon-192.png'});
    syncPushSubscription();
    return true;
  }
  toast('Permission refusée','warn');
  return false;
}

async function testPushNotification(){
  const btn = $('testNotifBtn');
  if(!btn) return;
  btn.disabled = true;
  const original = btn.textContent;
  btn.textContent = 'Envoi...';
  try{
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if(!sub){ toast('Pas d\'abonnement actif','warn'); return; }
    const r = await fetch(`${SUPABASE_URL}/functions/v1/push-send`, {
      method:'POST',
      headers:{'apikey':SUPABASE_KEY,'Content-Type':'application/json'},
      body: JSON.stringify({test:true, endpoint: sub.endpoint})
    });
    if(r.ok) toast('Notification de test envoyée');
    else toast('Echec du test ('+r.status+')','warn');
  }catch(e){
    toast('Erreur: '+e.message,'warn');
  }finally{
    btn.disabled = false;
    btn.textContent = original;
  }
}

// ============== Push notifications (rappels serveur) ==============
// Les rappels sont envoyés par un cron Supabase même quand l'app est fermée.
const VAPID_PUBLIC_KEY = 'BCKLQkgUPvLaSv1m83LJK8Xyqn9-nsJmCKjcheaRtxO_18gbAc7Z7Xj6N5mPBEFY_dhmatnsBsZN5RNnaYMH59c';

function urlBase64ToUint8Array(base64String){
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g,'+').replace(/_/g,'/');
  const raw = atob(base64);
  const arr = new Uint8Array(raw.length);
  for(let i=0;i<raw.length;i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

// Enregistre/actualise l'abonnement push serveur avec la config de rappels courante.
async function syncPushSubscription(){
  if(!('serviceWorker' in navigator) || !('PushManager' in window)) return;
  if(Notification.permission !== 'granted') return;
  try{
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if(!sub){
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
      });
    }
    const reminders = loadJSON(STORAGE_KEYS.reminders, {});
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Paris';
    await fetch(`${SUPABASE_URL}/functions/v1/push-subscribe`, {
      method:'POST',
      headers:{'apikey':SUPABASE_KEY,'Content-Type':'application/json'},
      body: JSON.stringify({action:'subscribe', subscription: sub.toJSON(), tz, reminders})
    });
  }catch(e){ console.warn('push subscribe failed', e); }
}

// Désabonne cet appareil des rappels push.
async function unsyncPushSubscription(){
  if(!('serviceWorker' in navigator)) return;
  try{
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if(!sub) return;
    await fetch(`${SUPABASE_URL}/functions/v1/push-subscribe`, {
      method:'POST',
      headers:{'apikey':SUPABASE_KEY,'Content-Type':'application/json'},
      body: JSON.stringify({action:'unsubscribe', endpoint: sub.endpoint})
    });
    await sub.unsubscribe();
  }catch(e){ console.warn('push unsubscribe failed', e); }
}

// ============== Import / Export ==============
function exportData(){
  const data = {
    measurements: loadJSON(STORAGE_KEYS.measurements, []),
    reminders: loadJSON(STORAGE_KEYS.reminders, {}),
    lastInputs: loadJSON(STORAGE_KEYS.lastInputs, {}),
    bassins: getBassins(),
    activeBassin: getActiveBassinId(),
    exportDate: new Date().toISOString(),
    version: 2
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], {type:'application/json'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `chimie-piscine-${new Date().toISOString().slice(0,10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
  toast('Données exportées');
}

function importData(event){
  const file = event.target.files[0];
  if(!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    try{
      const data = JSON.parse(e.target.result);
      if(data.measurements) saveJSON(STORAGE_KEYS.measurements, data.measurements);
      if(data.reminders) saveJSON(STORAGE_KEYS.reminders, data.reminders);
      if(data.lastInputs) saveJSON(STORAGE_KEYS.lastInputs, data.lastInputs);
      if(data.bassins) saveJSON(STORAGE_KEYS.bassins, data.bassins);
      if(data.activeBassin) setActiveBassinId(data.activeBassin);
      toast('Données importées');
      location.reload();
    }catch(err){
      toast('Fichier invalide','warn');
    }
  };
  reader.readAsText(file);
}

function confirmReset(){
  if(!confirm('Supprimer toutes les données (mesures, rappels, paramètres) ? Cette action est irréversible.')) return;
  Object.values(STORAGE_KEYS).forEach(k => localStorage.removeItem(k));
  localStorage.removeItem('cp_last_notif');
  localStorage.removeItem(BACKUP_CODE_KEY); // déconnecte la sauvegarde cloud (la sauvegarde distante est conservée)
  toast('Données effacées');
  setTimeout(()=>location.reload(), 800);
}

// ============== Sauvegarde cloud ==============
const BACKUP_CODE_KEY = 'cp_backup_code';

function getBackupCode(){ return localStorage.getItem(BACKUP_CODE_KEY); }

// Code lisible, alphabet sans caractères ambigus (pas de I L O 0 1)
function generateBackupCode(){
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let s = 'PISC';
  for(let i=0;i<16;i++){
    if(i%4===0) s += '-';
    s += alphabet[bytes[i] % alphabet.length];
  }
  return s;
}

function collectBackupData(){
  return {
    measurements: loadJSON(STORAGE_KEYS.measurements, []),
    reminders: loadJSON(STORAGE_KEYS.reminders, {}),
    lastInputs: loadJSON(STORAGE_KEYS.lastInputs, {}),
    bassins: getBassins(),
    activeBassin: getActiveBassinId(),
    version: APP_VERSION,
    savedAt: new Date().toISOString()
  };
}

// Collecte d'un bassin unique (pour partage : code par bassin)
function collectSingleBassinBackup(bassinId){
  const b = getBassinById(bassinId);
  if(!b) return null;
  const measurements = loadJSON(STORAGE_KEYS.measurements, []).filter(m => m.bassinId === bassinId);
  return {
    type: 'single-bassin',
    bassin: b,
    measurements,
    version: APP_VERSION,
    savedAt: new Date().toISOString()
  };
}

async function backupCall(payload){
  const resp = await fetch(`${SUPABASE_URL}/functions/v1/backup`, {
    method:'POST',
    headers:{'apikey':SUPABASE_KEY,'Content-Type':'application/json'},
    body: JSON.stringify(payload)
  });
  const data = await resp.json().catch(()=>({}));
  if(!resp.ok) throw new Error(data.error || `HTTP ${resp.status}`);
  return data;
}

// Synchro automatique (debounced) — best-effort, ne bloque jamais l'app
let backupSyncTimer = null;
function cloudBackupSync(){
  const code = getBackupCode();
  if(!code) return;
  clearTimeout(backupSyncTimer);
  backupSyncTimer = setTimeout(async ()=>{
    updateBackupStatus('Synchronisation…');
    try{
      await backupCall({action:'save', code, data: collectBackupData()});
      updateBackupStatus('Synchronisé ' + new Date().toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'}));
    }catch(e){
      console.warn('cloud sync failed', e);
      updateBackupStatus('Échec de synchro — réessai au prochain enregistrement', true);
    }
  }, 1500);
}

function updateBackupStatus(msg, isErr){
  const el = $('backupStatus');
  if(el){ el.textContent = msg; el.className = 'backup-status' + (isErr ? ' err' : ''); }
}

async function enableCloudBackup(){
  let code = getBackupCode();
  if(!code) code = generateBackupCode();
  try{
    await backupCall({action:'save', code, data: collectBackupData()});
    localStorage.setItem(BACKUP_CODE_KEY, code);
    renderBackupUI();
    toast('Sauvegarde cloud activée');
  }catch(e){
    toast('Activation impossible — vérifie ta connexion','warn');
  }
}

function disableCloudBackup(){
  if(!confirm('Désactiver la sauvegarde cloud ?\n\nTes données restent sur cet appareil. La sauvegarde en ligne est conservée et reste récupérable avec ton code.')) return;
  localStorage.removeItem(BACKUP_CODE_KEY);
  renderBackupUI();
  toast('Sauvegarde cloud désactivée');
}

// Formatage live du champ "restoreCode" : force PISC-, majuscules, tirets auto tous les 4 chars
function formatBackupCodeInput(input){
  let raw = (input.value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  // Garantit le préfixe PISC en début (même si l'user efface)
  if(!raw.startsWith('PISC')){
    // On retire un préfixe partiel (P, PI, PIS) et on remet PISC complet
    raw = 'PISC' + raw.replace(/^P?I?S?C?/, '');
  }
  // 4 chars PISC + 16 chars de payload max
  raw = raw.slice(0, 20);
  // Reformate avec tirets : PISC-XXXX-XXXX-XXXX-XXXX
  let out = raw.slice(0, 4);
  for(let i = 4; i < raw.length; i += 4){
    out += '-' + raw.slice(i, i + 4);
  }
  input.value = out;
}

function copyBackupCode(){
  const code = getBackupCode();
  if(!code) return;
  navigator.clipboard.writeText(code)
    .then(()=>toast('Code copié'))
    .catch(()=>toast('Copie impossible','warn'));
}

async function restoreFromCode(){
  const input = $('restoreCode');
  const code = input.value.trim().toUpperCase();
  if(code.length < 12){ toast('Code invalide','warn'); return; }
  if(!confirm('Restaurer cette sauvegarde ?\n\nTes mesures et réglages actuels sur cet appareil seront remplacés.')) return;
  try{
    const res = await backupCall({action:'restore', code});
    const d = res.data || {};

    // Backup d'un bassin unique → fusion (ajouter ce bassin + ses mesures à l'existant)
    if(d.type === 'single-bassin' && d.bassin){
      const existing = getBassins();
      // Si le bassin existe déjà (même id) on demande quoi faire
      if(existing.some(b => b.id === d.bassin.id)){
        if(!confirm('Ce bassin existe déjà dans tes données. Écraser sa config et ses mesures ?')) return;
        // Remplace le bassin et ses mesures
        const others = existing.filter(b => b.id !== d.bassin.id);
        saveBassins([...others, d.bassin]);
        const otherMeasures = loadJSON(STORAGE_KEYS.measurements, []).filter(m => m.bassinId !== d.bassin.id);
        saveJSON(STORAGE_KEYS.measurements, [...otherMeasures, ...(d.measurements||[])]);
      } else {
        // Nouveau bassin : on l'ajoute proprement
        saveBassins([...existing, d.bassin]);
        const allMeasures = loadJSON(STORAGE_KEYS.measurements, []);
        saveJSON(STORAGE_KEYS.measurements, [...allMeasures, ...(d.measurements||[])]);
      }
      setActiveBassinId(d.bassin.id);
      toast(`Bassin "${d.bassin.nom}" importé`);
      setTimeout(()=>location.reload(), 900);
      return;
    }

    // Backup global (legacy ou v2) → remplace tout
    if(d.measurements) saveJSON(STORAGE_KEYS.measurements, d.measurements);
    if(d.reminders) saveJSON(STORAGE_KEYS.reminders, d.reminders);
    if(d.lastInputs) saveJSON(STORAGE_KEYS.lastInputs, d.lastInputs);
    if(d.bassins) saveJSON(STORAGE_KEYS.bassins, d.bassins);
    if(d.activeBassin) setActiveBassinId(d.activeBassin);
    localStorage.setItem(BACKUP_CODE_KEY, code); // adopte ce code pour les synchros futures
    toast('Sauvegarde restaurée');
    setTimeout(()=>location.reload(), 900);
  }catch(e){
    toast(e.message || 'Restauration impossible','warn');
  }
}

// Crée et publie une sauvegarde dédiée à un seul bassin (code distinct)
async function shareBassinCloud(bassinId){
  const b = getBassinById(bassinId);
  if(!b) return;
  const code = generateBackupCode();
  try{
    await backupCall({action:'save', code, data: collectSingleBassinBackup(bassinId)});
    // Stocke le code sur le bassin pour le retrouver
    updateBassin(bassinId, {shareCode: code, shareCodeAt: Date.now()});
    return code;
  }catch(e){
    toast('Génération du code impossible — vérifie ta connexion','warn');
    return null;
  }
}

function renderBackupUI(){
  const el = $('backupContent');
  if(!el) return;
  const code = getBackupCode();
  if(code){
    el.innerHTML = `
      <div class="card-header">
        <div class="card-title"><span class="dot" style="background:var(--leaf);box-shadow:0 0 10px var(--leaf)"></span>Sauvegarde cloud</div>
        <span class="status-pill ok"><span class="pulse"></span>Active</span>
      </div>
      <p style="font-size:12px;color:var(--shallow);opacity:.85;line-height:1.6;margin-bottom:6px">
        Ton code de sauvegarde — note-le précieusement. Il permet de récupérer tes données sur un autre appareil. Sans lui, la sauvegarde est irrécupérable.
      </p>
      <div class="backup-code" onclick="copyBackupCode()">
        <span>${code}</span>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h8a2 2 0 002-2v-2M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m2 0h2a2 2 0 012 2v3"/></svg>
      </div>
      <div id="backupStatus" class="backup-status">Synchro automatique après chaque mesure</div>
      <button class="btn-ghost" style="width:100%" onclick="disableCloudBackup()">Désactiver la sauvegarde cloud</button>`;
  } else {
    el.innerHTML = `
      <div class="card-header">
        <div class="card-title"><span class="dot"></span>Sauvegarde cloud</div>
      </div>
      <p style="font-size:12px;color:var(--shallow);opacity:.85;line-height:1.6;margin-bottom:14px">
        Tes mesures sont stockées sur cet appareil uniquement. Active la sauvegarde cloud pour les retrouver en cas de perte ou de changement de téléphone — un code secret est généré, <strong>sans compte ni email</strong>.
      </p>
      <button class="btn-primary" style="width:100%" onclick="enableCloudBackup()">Activer la sauvegarde cloud</button>
      <details style="margin-top:12px">
        <summary style="cursor:pointer;font-size:12px;color:var(--shallow);opacity:.85">J'ai déjà un code de sauvegarde</summary>
        <div class="field" style="margin-top:10px">
          <label for="restoreCode">Code de sauvegarde</label>
          <input type="text" id="restoreCode" class="contact-input"
            value="PISC-"
            placeholder="PISC-XXXX-XXXX-XXXX-XXXX"
            autocomplete="off" autocapitalize="characters" spellcheck="false"
            maxlength="24"
            style="text-transform:uppercase;font-family:'JetBrains Mono',monospace;letter-spacing:1px"
            oninput="formatBackupCodeInput(this)">
        </div>
        <button class="btn-ghost" style="width:100%" onclick="restoreFromCode()">Restaurer mes données</button>
      </details>`;
  }
}

// ============== Contact / Tickets (Supabase + Chatwoot en parallèle) ==============
const SUPABASE_URL = 'https://tfitkyuvkdogiatglxzr.supabase.co';
const SUPABASE_KEY = 'sb_publishable_BYHvWjbjIXYdt3OkSQtXXQ_luaxs3PI';

// Chatwoot self-hosted — API publique du channel "Formulaire site Chimie Piscine"
const CHATWOOT_URL = 'https://tickets.yannick-uhrig.com';
const CHATWOOT_INBOX = 'socZ7ZeDiw7qvGVs3UYPZXVh';

async function sendToChatwoot(nom, email, sujet, message){
  try{
    const base = `${CHATWOOT_URL}/public/api/v1/inboxes/${CHATWOOT_INBOX}`;
    const cResp = await fetch(`${base}/contacts`, {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({name: nom, email})
    });
    if(!cResp.ok) throw new Error(`contact HTTP ${cResp.status}`);
    const {source_id} = await cResp.json();

    const convResp = await fetch(`${base}/contacts/${source_id}/conversations`, {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({additional_attributes:{subject: sujet}})
    });
    if(!convResp.ok) throw new Error(`conversation HTTP ${convResp.status}`);
    const {id: convId} = await convResp.json();

    const msgResp = await fetch(`${base}/contacts/${source_id}/conversations/${convId}/messages`, {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({content: `**${sujet}**\n\n${message}`})
    });
    if(!msgResp.ok) throw new Error(`message HTTP ${msgResp.status}`);
    console.log('Chatwoot ticket créé', {convId});
  }catch(err){
    console.warn('Chatwoot send failed', err);
  }
}

async function sendContactMessage(){
  const nom = $('contactNom').value.trim();
  const email = $('contactEmail').value.trim();
  const sujet = $('contactSujet').value.trim();
  const message = $('contactMessage').value.trim();
  const hp = $('contactHp').value;
  const result = $('contactResult');
  const btn = $('contactSubmit');

  // Honeypot rempli => bot : succès silencieux, rien n'est envoyé
  if(hp){
    result.innerHTML = `<div class="result ok"><div class="result-label">Message envoyé ✓</div></div>`;
    return;
  }

  if(!nom || !email || !sujet || !message){
    result.innerHTML = `<div class="result warn">
      <div class="result-label">Champs manquants</div>
      <div class="result-note">Merci de remplir le nom, l'email, le sujet et le message.</div>
    </div>`;
    return;
  }
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){
    result.innerHTML = `<div class="result warn">
      <div class="result-label">Email invalide</div>
      <div class="result-note">Vérifie l'adresse email saisie.</div>
    </div>`;
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Envoi…';
  result.innerHTML = '';

  // UUID généré côté client : le rôle anon ne peut pas relire la ligne (RLS insert-only)
  const ticketId = (crypto.randomUUID && crypto.randomUUID()) || null;

  try{
    const resp = await fetch(`${SUPABASE_URL}/rest/v1/messages`, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal'
      },
      body: JSON.stringify(ticketId ? {id: ticketId, nom, email, sujet, message} : {nom, email, sujet, message})
    });
    if(!resp.ok){
      throw new Error(`HTTP ${resp.status} ${await resp.text()}`);
    }

    // Déclenche la notification (best-effort : n'échoue pas le formulaire)
    if(ticketId){
      fetch(`${SUPABASE_URL}/functions/v1/notify-ticket`, {
        method: 'POST',
        headers: {'apikey': SUPABASE_KEY, 'Content-Type': 'application/json'},
        body: JSON.stringify({id: ticketId})
      }).catch(e => console.warn('notify-ticket failed', e));
    }

    // En parallèle : crée aussi une conversation Chatwoot (test ; ne bloque pas l'UX)
    sendToChatwoot(nom, email, sujet, message);

    result.innerHTML = `<div class="result ok">
      <div class="result-label">Message envoyé ✓</div>
      <div class="result-note">Merci ${nom} ! Ton ticket est enregistré, réponse à venir sur ${email}.</div>
    </div>`;
    ['contactNom','contactEmail','contactSujet','contactMessage'].forEach(id => $(id).value = '');
    toast('Message envoyé');
  }catch(err){
    console.warn('Contact send failed', err);
    result.innerHTML = `<div class="result danger">
      <div class="result-label">Échec de l'envoi</div>
      <div class="result-note">Message non envoyé. Vérifie ta connexion internet et réessaie.</div>
    </div>`;
    toast('Échec de l\'envoi', 'warn');
  }finally{
    btn.disabled = false;
    btn.textContent = 'Envoyer le message';
  }
}

// ============== Admin — gestion des tickets ==============
let adminPassword = null;

function escapeHtml(s){
  return String(s == null ? '' : s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

function openAdmin(){
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
  document.querySelectorAll('.tab').forEach(t=>t.classList.remove('active'));
  const pg = $('page-admin');
  if(pg){ pg.classList.add('active'); window.scrollTo({top:0}); }
}

async function adminCall(payload){
  const resp = await fetch(`${SUPABASE_URL}/functions/v1/admin-tickets`, {
    method:'POST',
    headers:{'apikey':SUPABASE_KEY, 'Content-Type':'application/json'},
    body: JSON.stringify(payload)
  });
  const data = await resp.json().catch(()=>({}));
  if(!resp.ok){
    const err = new Error(data.message || data.error || `HTTP ${resp.status}`);
    err.status = resp.status;
    err.data = data;
    throw err;
  }
  return data;
}

let adminLoginCooldownUntil = 0; // ms, blocage UX local
let adminLoginCooldownTimer = null;

function adminCooldownTick(){
  const btn = $('adminLoginBtn');
  if(!btn) return;
  const remain = Math.max(0, adminLoginCooldownUntil - Date.now());
  if(remain <= 0){
    btn.disabled = false;
    btn.textContent = 'Déverrouiller';
    clearInterval(adminLoginCooldownTimer);
    adminLoginCooldownTimer = null;
    return;
  }
  const s = Math.ceil(remain/1000);
  btn.disabled = true;
  btn.textContent = s >= 60 ? `Bloqué (${Math.ceil(s/60)} min)` : `Patiente ${s} s…`;
}

function adminStartCooldown(sec){
  adminLoginCooldownUntil = Date.now() + sec * 1000;
  if(adminLoginCooldownTimer) clearInterval(adminLoginCooldownTimer);
  adminCooldownTick();
  adminLoginCooldownTimer = setInterval(adminCooldownTick, 1000);
}

async function adminLogin(){
  if(Date.now() < adminLoginCooldownUntil) return; // bouton bloqué
  const pwd = $('adminPwd').value;
  const msg = $('adminGateMsg');
  const btn = $('adminLoginBtn');
  if(!pwd){
    msg.innerHTML = `<div class="result warn"><div class="result-label">Mot de passe requis</div></div>`;
    return;
  }
  btn.disabled = true; btn.textContent = 'Vérification…';
  try{
    const data = await adminCall({password: pwd, action:'list'});
    adminPassword = pwd;
    $('adminGate').style.display = 'none';
    $('adminPanel').style.display = 'block';
    $('adminPwd').value = '';
    msg.innerHTML = '';
    renderAdminTickets(data.tickets || []);
  }catch(e){
    const d = e.data || {};
    if(e.status === 429){
      // Trop de tentatives — blocage côté serveur, on synchronise l'UX
      const sec = Math.max(1, parseInt(d.retry_after_sec || 60, 10));
      msg.innerHTML = `<div class="result danger">
        <div class="result-label">Trop de tentatives</div>
        <div class="result-note">${escapeHtml(d.message || `Réessaie dans ${Math.ceil(sec/60)} min.`)}</div>
      </div>`;
      adminStartCooldown(sec);
      return;
    }
    if(e.status === 401 && Number.isFinite(d.attempts_remaining)){
      const left = d.attempts_remaining;
      msg.innerHTML = `<div class="result danger">
        <div class="result-label">Mot de passe incorrect</div>
        <div class="result-note">${left} tentative${left>1?'s':''} restante${left>1?'s':''} avant blocage 15 min.</div>
      </div>`;
      // petit délai UX progressif (2s à chaque échec) pour casser le spam
      adminStartCooldown(2);
      return;
    }
    msg.innerHTML = `<div class="result danger">
      <div class="result-label">Accès refusé</div>
      <div class="result-note">${escapeHtml(e.message)}</div>
    </div>`;
  }finally{
    // Si pas de cooldown actif, on réactive le bouton
    if(Date.now() >= adminLoginCooldownUntil){
      btn.disabled = false; btn.textContent = 'Déverrouiller';
    }
  }
}

function adminLogout(){
  adminPassword = null;
  $('adminPanel').style.display = 'none';
  $('adminGate').style.display = 'block';
  $('adminTicketList').innerHTML = '';
}

async function adminLoadTickets(){
  if(!adminPassword){ adminLogout(); return; }
  try{
    const data = await adminCall({password: adminPassword, action:'list'});
    renderAdminTickets(data.tickets || []);
    toast('Tickets à jour');
  }catch(e){
    toast('Erreur de chargement','warn');
  }
}

function renderAdminTickets(tickets){
  $('adminCount').textContent = `${tickets.length} ticket${tickets.length>1?'s':''}`;
  const list = $('adminTicketList');
  if(!tickets.length){
    list.innerHTML = `<div class="empty"><p>Aucun ticket pour le moment</p></div>`;
    return;
  }
  list.innerHTML = tickets.map(t => {
    const ferme = t.statut === 'ferme';
    const d = new Date(t.created_at);
    const dateStr = d.toLocaleString('fr-FR',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'});
    return `<div class="card ${ferme?'ferme':''}">
      <div class="ticket-meta">
        <div>
          <div class="ticket-from">${escapeHtml(t.nom)}</div>
          <div class="ticket-email">${escapeHtml(t.email)}</div>
        </div>
        <span class="status-pill ${ferme?'ok':'warn'}"><span class="pulse"></span>${ferme?'Fermé':'Ouvert'}</span>
      </div>
      <div class="ticket-sujet">${escapeHtml(t.sujet)}</div>
      <div class="ticket-body">${escapeHtml(t.message)}</div>
      <div class="ticket-date">${dateStr}</div>
      <div class="ticket-actions">
        ${ferme
          ? `<button class="btn-ghost" onclick="adminUpdateTicket('${t.id}','ouvert')">Rouvrir</button>`
          : `<button class="btn-primary" onclick="adminUpdateTicket('${t.id}','ferme')">Clôturer</button>`}
        <button class="btn-ghost" style="color:var(--coral)" onclick="adminDeleteTicket('${t.id}')">Supprimer</button>
      </div>
    </div>`;
  }).join('');
}

async function adminUpdateTicket(id, statut){
  if(!adminPassword) return;
  try{
    await adminCall({password: adminPassword, action:'update', id, statut});
    adminLoadTickets();
  }catch(e){ toast('Erreur de mise à jour','warn'); }
}

async function adminDeleteTicket(id){
  if(!adminPassword) return;
  if(!confirm('Supprimer définitivement ce ticket ?')) return;
  try{
    await adminCall({password: adminPassword, action:'delete', id});
    adminLoadTickets();
  }catch(e){ toast('Erreur de suppression','warn'); }
}

// ============== Live update Ccl pendant la saisie ==============
['fcl','tcl'].forEach(id => {
  document.addEventListener('DOMContentLoaded', ()=>{
    const el = $(id);
    if(el) el.addEventListener('input', ()=>{
      const m = readInputs();
      if(m.fcl!==null && m.tcl!==null) updateCclBadge(m);
    });
  });
});

// ============== Install PWA ==============
let deferredPrompt = null;
window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  deferredPrompt = e;
  $('installBanner').style.display = 'flex';
});
document.addEventListener('DOMContentLoaded', ()=>{
  $('installBtn').addEventListener('click', async ()=>{
    if(!deferredPrompt) return;
    deferredPrompt.prompt();
    const {outcome} = await deferredPrompt.userChoice;
    if(outcome === 'accepted'){
      $('installBanner').style.display = 'none';
      toast('App installée 🎉');
    }
    deferredPrompt = null;
  });
  $('enableNotifBtn').addEventListener('click', enableNotifications);
});

// ============== Service worker ==============
if('serviceWorker' in navigator){
  window.addEventListener('load', ()=>{
    navigator.serviceWorker.register('sw.js').then(reg => {
      if(!reg) return;
      // Vérifie une nouvelle version immédiatement, périodiquement, et à chaque
      // retour au premier plan. Sans ça, le navigateur ne re-vérifie sw.js qu'au
      // chargement : une PWA/app Android qui reste ouverte ne voyait la maj qu'au
      // prochain lancement complet. La bannière "Nouvelle version dispo ·
      // Recharger" (plus bas, via updatefound) fait le reste — un clic suffit.
      reg.update().catch(()=>{});
      setInterval(() => reg.update().catch(()=>{}), 30 * 60 * 1000); // 30 min
      document.addEventListener('visibilitychange', () => {
        if(document.visibilityState === 'visible') reg.update().catch(()=>{});
      });
    }).catch(err => console.warn('SW failed', err));
  });
}

// ============== Diagramme Taylor (pH × TAC, zones LSI) ==============
const _taylorCharts = {};
function drawTaylorChart(canvasId, m){
  const cv = document.getElementById(canvasId);
  if(!cv || typeof Chart === 'undefined') return;
  if(_taylorCharts[canvasId]){ try{ _taylorCharts[canvasId].destroy(); }catch(e){} }

  const isSalt = m.modeDesinf === 'sel';
  // Échantillonnage 2D : pour chaque (pH, TAC) on calcule le LSI à TH/temp/CYA constants
  // → on construit 3 zones (corrosive / équilibrée / entartrante) sous forme de points colorés
  const pHRange = [];
  for(let p = 7.0; p <= 8.2; p += 0.05) pHRange.push(+p.toFixed(2));
  const tacRange = [];
  for(let t = 40; t <= 200; t += 5) tacRange.push(t);

  const corrosive = [], equilibre = [], entartrant = [];
  for(const p of pHRange){
    for(const t of tacRange){
      const lsi = calcLSI(p, m.temp, m.th, t, m.cya, isSalt);
      if(lsi == null) continue;
      const pt = {x: p, y: t};
      if(lsi < -0.3) corrosive.push(pt);
      else if(lsi > 0.3) entartrant.push(pt);
      else equilibre.push(pt);
    }
  }

  const datasets = [
    {label:'Corrosive', data: corrosive, backgroundColor:'rgba(244,114,182,.18)', pointRadius:4, pointStyle:'rect'},
    {label:'Équilibre', data: equilibre, backgroundColor:'rgba(110,231,183,.22)', pointRadius:4, pointStyle:'rect'},
    {label:'Entartrante', data: entartrant, backgroundColor:'rgba(253,224,71,.20)', pointRadius:4, pointStyle:'rect'},
    {label:'Votre eau', data: [{x: m.ph, y: m.tac}], backgroundColor:'#ffffff', borderColor:'#0a3d62', borderWidth:2, pointRadius:7, pointHoverRadius:9, order:0}
  ];

  _taylorCharts[canvasId] = new Chart(cv, {
    type: 'scatter',
    data: { datasets },
    options: {
      responsive: true, maintainAspectRatio: false, animation: false,
      plugins:{
        legend:{display:true, position:'bottom', labels:{font:{size:10}, color:'#cbd5e1', boxWidth:10, padding:8}},
        tooltip:{
          callbacks:{
            label: ctx => {
              const x = ctx.parsed.x, y = ctx.parsed.y;
              if(ctx.dataset.label === 'Votre eau'){
                const lsi = calcLSI(x, m.temp, m.th, y, m.cya, isSalt);
                return `pH ${x.toFixed(2)} · TAC ${y} → LSI ${lsi>=0?'+':''}${lsi.toFixed(2)}`;
              }
              return `${ctx.dataset.label} : pH ${x.toFixed(2)} · TAC ${y}`;
            }
          }
        }
      },
      scales:{
        x:{type:'linear', min:7.0, max:8.2, title:{display:true, text:'pH', color:'#cbd5e1', font:{size:11}}, ticks:{color:'#94a3b8', font:{size:10}}, grid:{color:'rgba(255,255,255,.05)'}},
        y:{type:'linear', min:40, max:200, title:{display:true, text:'TAC (ppm)', color:'#cbd5e1', font:{size:11}}, ticks:{color:'#94a3b8', font:{size:10}}, grid:{color:'rgba(255,255,255,.05)'}}
      }
    }
  });
}

// ============== Tendances ==============
function linearTrend(points){
  const n = points.length;
  if(n < 2) return null;
  const sx = points.reduce((s,p) => s + p.x, 0);
  const sy = points.reduce((s,p) => s + p.y, 0);
  const sxy = points.reduce((s,p) => s + p.x*p.y, 0);
  const sxx = points.reduce((s,p) => s + p.x*p.x, 0);
  const denom = n*sxx - sx*sx;
  if(denom === 0) return null;
  return (n*sxy - sx*sy) / denom;
}

function renderTrends(){
  const wrap = $('trendsContent');
  if(!wrap) return;
  const list = loadActiveMeasurements();
  const insights = [];
  const now = Date.now();

  if(list.length === 0){
    wrap.innerHTML = '<p style="color:var(--shallow);opacity:.7;font-size:13px;padding:4px 0">Pas encore de mesures à analyser.</p>';
    return;
  }

  const last = list[list.length-1];
  const daysSinceLast = Math.round((now - new Date(last.date).getTime()) / 86400000);
  if(daysSinceLast >= 3){
    insights.push({level:'warn', icon:'⏱', text:`${daysSinceLast} jours sans contrôle — pense à mesurer pH et chlore.`});
  }

  const recent = list.filter(m => (now - new Date(m.date).getTime()) <= 14*86400000);
  if(recent.length >= 3){
    const firstTs = new Date(recent[0].date).getTime();
    const toPoints = (key) => recent.filter(m => m[key] !== null && m[key] !== undefined)
      .map(m => ({x: (new Date(m.date).getTime() - firstTs)/86400000, y: m[key]}));

    const phPts = toPoints('ph');
    if(phPts.length >= 3){
      const slope = linearTrend(phPts);
      const spanDays = phPts[phPts.length-1].x - phPts[0].x;
      // pH-creep : on n'alerte que si la dérive est nette ET observée sur 4+ jours
      if(slope !== null && Math.abs(slope) >= 0.04 && spanDays >= 4){
        const dir = slope > 0 ? 'monte' : 'descend';
        const why = slope > 0
          ? 'classique d\'un TAC trop élevé (>120-150 ppm) : le CO₂ s\'échappe et fait remonter le pH. Baisse le TAC à 80-100 ppm pour stabiliser'
          : 'signe d\'un TAC insuffisant (<80 ppm) qui ne tamponne plus l\'eau. Remonte le TAC pour empêcher les chutes';
        const icon = slope > 0 ? '📈' : '📉';
        insights.push({level:'warn', icon, text:`pH ${dir} de ${Math.abs(slope).toFixed(2)}/jour sur ${Math.round(spanDays)} j — ${why}.`});
      }
    }

    const fclPts = toPoints('fcl');
    if(fclPts.length >= 3){
      let drop = 0, days = 0;
      for(let i=1;i<fclPts.length;i++){
        const dt = fclPts[i].x - fclPts[i-1].x;
        if(dt > 0 && dt < 3 && fclPts[i].y < fclPts[i-1].y){
          drop += fclPts[i-1].y - fclPts[i].y;
          days += dt;
        }
      }
      if(days >= 1 && drop/days >= 1.5){
        insights.push({level:'warn', icon:'⚗', text:`Chlore consommé vite (~${(drop/days).toFixed(1)} ppm/jour) — matière organique ou fort ensoleillement, pense au choc.`});
      }
    }

    const tacPts = toPoints('tac');
    if(tacPts.length >= 2){
      const delta = tacPts[tacPts.length-1].y - tacPts[0].y;
      if(delta <= -20){
        insights.push({level:'warn', icon:'⬇', text:`TAC en chute de ${Math.abs(delta)} ppm — une remontée au bicarbonate évite que le pH parte en vrille.`});
      }
    }
  }

  if(last.cya !== null && last.cya > 40){
    insights.push({level:'danger', icon:'⚠', text:'CYA > 40 ppm — vidange partielle nécessaire, il ne s\'élimine que par dilution.'});
  }

  if(insights.length === 0){
    insights.push({level:'ok', icon:'✓', text:'Aucune dérive notable. Tout est sous contrôle.'});
  }

  wrap.innerHTML = insights.map(ins => {
    const color = ins.level === 'danger' ? 'var(--coral)' : ins.level === 'warn' ? 'var(--lemon)' : 'var(--leaf)';
    return `<div style="display:flex;gap:10px;padding:8px 0;align-items:flex-start;font-size:13px;line-height:1.5">
      <span style="color:${color};font-size:16px;flex:0 0 auto;width:20px;text-align:center">${ins.icon}</span>
      <span style="color:var(--foam);opacity:.95">${ins.text}</span>
    </div>`;
  }).join('');
}

// ============== Météo locale (Open-Meteo, gratuit, pas de clé) ==============
const WEATHER_TTL_MS = 3 * 3600 * 1000; // 3 h
const WEATHER_CACHE_KEY = 'cp_weather_cache_v1';

async function fetchWeatherForBassin(bassin){
  if(!bassin || !bassin.config || !bassin.config.geo) return null;
  const {lat, lon} = bassin.config.geo;
  if(!lat || !lon) return null;
  // Cache
  const cacheAll = loadJSON(WEATHER_CACHE_KEY, {});
  const cached = cacheAll[bassin.id];
  if(cached && cached.savedAt && (Date.now() - cached.savedAt) < WEATHER_TTL_MS){
    return cached.data;
  }
  try{
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&daily=temperature_2m_max,uv_index_max,precipitation_sum,weather_code&timezone=auto&forecast_days=3`;
    const resp = await fetch(url);
    if(!resp.ok) return null;
    const data = await resp.json();
    cacheAll[bassin.id] = {savedAt: Date.now(), data};
    saveJSON(WEATHER_CACHE_KEY, cacheAll);
    return data;
  }catch(e){
    console.warn('Open-Meteo fetch failed', e);
    return cached ? cached.data : null;
  }
}

// Recos à partir des prévisions
function computeWeatherInsights(weather, m){
  if(!weather || !weather.daily) return [];
  const out = [];
  const d = weather.daily;
  // Index 0 = aujourd'hui, 1 = demain, 2 = après-demain
  const labels = ["aujourd'hui", "demain", "après-demain"];
  // T° max canicule
  d.temperature_2m_max.forEach((t, i) => {
    if(t >= 30 && i <= 1){
      out.push({level:'warn', icon:'🌡', text:`${labels[i]} ${fmt(t,0)}°C — ajoute +0,3 à 0,5 ppm de chlore préventif (forte conso au soleil).`});
    }
  });
  // UV élevé
  const uvMax = Math.max(...d.uv_index_max);
  if(uvMax >= 8){
    out.push({level:'warn', icon:'☀', text:`UV max ${fmt(uvMax,1)} — assure-toi d'avoir ${m && m.cya >= 25 ? 'ton' : 'au moins 25 ppm de'} CYA pour protéger ton chlore.`});
  }
  // Pluie
  d.precipitation_sum.forEach((mm, i) => {
    if(i > 2) return;
    if(mm >= 20){
      out.push({level:'warn', icon:'🌧', text:`Forte pluie ${labels[i]} (${fmt(mm,0)} mm) — re-mesure tous les paramètres après, l'eau du bassin sera diluée et acidifiée.`});
    } else if(mm >= 10){
      out.push({level:'info', icon:'💧', text:`Pluie ${labels[i]} (${fmt(mm,0)} mm) — pense à re-tester pH et Cl après l'épisode.`});
    }
  });
  return out;
}

function renderWeatherCard(){
  const wrap = $('weatherCard');
  if(!wrap) return;
  const b = getActiveBassin();
  if(!b || !b.config || !b.config.geo){
    wrap.style.display = 'none';
    return;
  }
  wrap.style.display = 'block';
  wrap.innerHTML = `<div class="card-header">
    <div class="card-title"><span class="dot" style="background:#7fd4d2;box-shadow:0 0 10px #7fd4d2"></span>Météo locale</div>
    <span style="font-size:11px;color:var(--shallow);font-family:'JetBrains Mono',monospace">${escapeHtml(b.config.geo.ville || 'Position')}</span>
  </div>
  <div id="weatherContent" style="color:var(--shallow);font-size:13px;padding:8px 0">Chargement…</div>`;

  fetchWeatherForBassin(b).then(w => {
    const content = $('weatherContent');
    if(!content) return;
    if(!w || !w.daily){
      content.innerHTML = `<div style="opacity:.7">Données météo indisponibles. <button class="btn-ghost" style="padding:4px 8px;font-size:12px;margin-left:8px" onclick="renderWeatherCard()">Réessayer</button></div>`;
      return;
    }
    const d = w.daily;
    const labels = ["Auj.", "Demain", "Après-d."];
    const cols = labels.map((lbl, i) => `
      <div style="flex:1;text-align:center;padding:10px;background:rgba(255,255,255,.04);border-radius:10px">
        <div style="font-size:11px;color:var(--shallow);opacity:.7;text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px">${lbl}</div>
        <div style="font-size:20px;font-weight:600;color:#fff">${fmt(d.temperature_2m_max[i],0)}°C</div>
        <div style="font-size:11px;color:var(--shallow);margin-top:4px">UV ${fmt(d.uv_index_max[i],1)} · ${fmt(d.precipitation_sum[i],0)} mm</div>
      </div>`).join('');
    const m = loadActiveMeasurements().slice(-1)[0] || null;
    const insights = computeWeatherInsights(w, m);
    const insightsHtml = insights.length
      ? `<div style="margin-top:14px;padding-top:14px;border-top:1px solid var(--depth-line)">${insights.map(i => `
          <div style="display:flex;gap:10px;padding:6px 0;font-size:13px;line-height:1.5;color:var(--foam)">
            <span style="color:${i.level==='warn'?'var(--lemon)':'#7fd4d2'};flex:0 0 auto;width:20px;text-align:center">${i.icon}</span>
            <span>${i.text}</span>
          </div>`).join('')}</div>`
      : `<div style="margin-top:10px;color:var(--leaf);font-size:13px">✓ Conditions stables — pas d'action préventive nécessaire.</div>`;
    content.innerHTML = `<div style="display:flex;gap:8px">${cols}</div>${insightsHtml}`;
  });
}

// ============== Score santé global du bassin ==============
const HEALTH_SCORE_ENABLED_KEY = 'cp_health_score_enabled_v1';
function isHealthScoreEnabled(){
  const v = localStorage.getItem(HEALTH_SCORE_ENABLED_KEY);
  return v === null ? true : v === '1';
}

function calcHealthScore(m){
  if(!m) return null;
  let score = 100;
  const breakdown = [];

  if(m.ph != null && m.phSouhaite != null){
    const diff = Math.abs(m.ph - m.phSouhaite);
    let p = 0;
    if(diff > 0.5) p = 40;
    else if(diff > 0.3) p = 25;
    else if(diff > 0.15) p = 10;
    else if(diff > 0.05) p = 3;
    score -= p;
    breakdown.push({key:'ph', name:'pH', value:fmt(m.ph,1), penalty:p, status: p < 5 ? 'ok' : p < 25 ? 'warn' : 'bad'});
  }

  let chlorineCritical = false;
  if(m.fcl != null){
    if(m.fcl < 0.3){
      // Chlore quasi nul = aucune désinfection. Critique quel que soit le CYA :
      // l'eau n'est plus protégée. On écrase le score (voir cap plus bas).
      chlorineCritical = true;
      const p = 70;
      score -= p;
      breakdown.push({key:'fcl', name:'Chlore libre', value:fmt(m.fcl,2)+' ppm', penalty:p, status:'bad'});
    } else if(m.cya != null){
      const target = m.cya / 10;
      const ratio = m.fcl / Math.max(0.5, target);
      let p = 0;
      if(ratio < 0.3) p = 30;
      else if(ratio < 0.6) p = 20;
      else if(ratio < 0.9) p = 8;
      else if(ratio > 2.5) p = 15;
      else if(ratio > 1.8) p = 6;
      score -= p;
      breakdown.push({key:'fcl', name:'Chlore libre', value:fmt(m.fcl,2)+' ppm', penalty:p, status: p < 5 ? 'ok' : p < 20 ? 'warn' : 'bad'});
    } else {
      // Pas de CYA renseigné : cible désinfection 0,5–1 ppm.
      let p = 0;
      if(m.fcl < 0.5) p = 25;
      else if(m.fcl < 1) p = 8;
      score -= p;
      breakdown.push({key:'fcl', name:'Chlore libre', value:fmt(m.fcl,2)+' ppm', penalty:p, status: p < 5 ? 'ok' : p < 20 ? 'warn' : 'bad'});
    }
  }

  if(m.tac != null){
    let p = 0;
    if(m.tac < 40 || m.tac > 200) p = 15;
    else if(m.tac < 60 || m.tac > 150) p = 8;
    else if(m.tac < 80 || m.tac > 120) p = 3;
    score -= p;
    breakdown.push({key:'tac', name:'TAC', value:fmt(m.tac,0)+' ppm', penalty:p, status: p < 5 ? 'ok' : p < 10 ? 'warn' : 'bad'});
  }

  if(m.cya != null){
    let p = 0;
    if(m.cya > 100) p = 10;
    else if(m.cya > 70) p = 6;
    else if(m.cya > 50) p = 3;
    else if(m.cya < 15) p = 5;
    score -= p;
    breakdown.push({key:'cya', name:'CYA', value:fmt(m.cya,0)+' ppm', penalty:p, status: p < 4 ? 'ok' : p < 8 ? 'warn' : 'bad'});
  }

  if(m.ph != null && m.temp != null && m.th != null && m.tac != null){
    const lsi = calcLSI(m.ph, m.temp, m.th, m.tac, m.cya, m.modeDesinf === 'sel');
    if(lsi != null){
      let p = 0;
      if(Math.abs(lsi) > 1) p = 5;
      else if(Math.abs(lsi) > 0.5) p = 3;
      score -= p;
      breakdown.push({key:'lsi', name:'Équilibre LSI', value:(lsi>=0?'+':'')+fmt(lsi,2), penalty:p, status: p < 2 ? 'ok' : p < 4 ? 'warn' : 'bad'});
    }
  }

  score = Math.max(0, Math.min(100, Math.round(score)));
  // Chlore quasi nul : l'eau n'est pas désinfectée → on force la zone "Urgent"
  // même si tous les autres paramètres sont parfaits.
  if(chlorineCritical) score = Math.min(score, 25);
  let label, color;
  if(score >= 85){ label = 'Excellent'; color = '#5eead4'; }
  else if(score >= 70){ label = 'Bon'; color = '#a8d8ea'; }
  else if(score >= 55){ label = 'Correct'; color = '#fbbf24'; }
  else if(score >= 35){ label = 'À surveiller'; color = '#fb923c'; }
  else { label = 'Urgent'; color = '#f87171'; }

  // Trop peu de paramètres notés → un "100 Excellent" sur 1 seule valeur est
  // faussement rassurant. On marque "données insuffisantes" (< 3 paramètres),
  // SAUF si le chlore est critique (un Fcl ≈ 0 reste un danger affichable seul).
  const insufficient = !chlorineCritical && breakdown.length < 3;

  return {score, label, color, breakdown, insufficient};
}

function renderHealthScoreCard(){
  const wrap = document.getElementById('healthScoreCard');
  if(!wrap) return;
  if(!isHealthScoreEnabled()){ wrap.style.display = 'none'; return; }
  const latest = loadActiveMeasurements().slice(-1)[0];
  if(!latest){ wrap.style.display = 'none'; return; }
  const result = calcHealthScore(latest);
  if(!result){ wrap.style.display = 'none'; return; }
  wrap.style.display = 'block';
  wrap.innerHTML = healthScoreInnerHTML(result);
}

// HTML interne de la carte Score (jauge OU état "données insuffisantes").
// Réutilisé par la carte Doses ET la modale détail d'historique.
function healthScoreInnerHTML(result){
  const nb = result.breakdown.length;
  if(result.insufficient){
    return `<div class="card-header">
      <div class="card-title"><span class="dot" style="background:#94a3b8;box-shadow:0 0 10px #94a3b8"></span>Score santé global</div>
      <span style="font-size:11px;color:var(--shallow);font-family:'JetBrains Mono',monospace">${nb} paramètre${nb>1?'s':''}</span>
    </div>
    <div style="display:flex;align-items:center;gap:14px;margin:8px 0 4px">
      <div style="font-size:34px;flex:0 0 auto;opacity:.85">📋</div>
      <div style="flex:1;min-width:0">
        <div style="font-size:17px;font-weight:600;color:#cbd5e1;font-family:'Fraunces',serif;margin-bottom:4px">Données insuffisantes</div>
        <div style="font-size:12px;color:var(--shallow);opacity:.75;line-height:1.5">Renseigne au moins 3 paramètres (pH, chlore, TAC, CYA…) pour un score fiable. ${nb===0?'Aucune valeur notable sur cette mesure.':`Seulement ${nb} paramètre${nb>1?'s':''} connu${nb>1?'s':''}.`}</div>
      </div>
    </div>`;
  }
  const r = 52;
  const c = 2 * Math.PI * r;
  const dashoffset = c * (1 - result.score / 100);
  const colorMap = {ok:'#5eead4', warn:'#fbbf24', bad:'#f87171'};
  const breakdown = result.breakdown.map(b => `
    <div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid rgba(255,255,255,.04);font-size:13px">
      <span style="width:8px;height:8px;border-radius:50%;background:${colorMap[b.status]};flex:0 0 auto"></span>
      <span style="flex:1;color:var(--shallow)">${b.name}</span>
      <span style="font-family:'JetBrains Mono',monospace;color:#fff;font-size:12px">${b.value}</span>
      <span style="font-size:11px;color:var(--shallow);opacity:.55;font-family:'JetBrains Mono',monospace;min-width:36px;text-align:right">${b.penalty === 0 ? '✓' : '−'+b.penalty}</span>
    </div>`).join('');
  return `<div class="card-header">
    <div class="card-title"><span class="dot" style="background:${result.color};box-shadow:0 0 10px ${result.color}"></span>Score santé global</div>
    <span style="font-size:11px;color:var(--shallow);font-family:'JetBrains Mono',monospace">${nb} paramètres</span>
  </div>
  <div style="display:flex;align-items:center;gap:18px;margin:8px 0 6px">
    <div style="position:relative;width:120px;height:120px;flex:0 0 auto">
      <svg width="120" height="120" viewBox="0 0 120 120" style="transform:rotate(-90deg)">
        <circle cx="60" cy="60" r="${r}" fill="none" stroke="rgba(255,255,255,.08)" stroke-width="10"/>
        <circle cx="60" cy="60" r="${r}" fill="none" stroke="${result.color}" stroke-width="10" stroke-linecap="round" stroke-dasharray="${c}" stroke-dashoffset="${dashoffset}" style="transition:stroke-dashoffset .6s ease-out,stroke .3s"/>
      </svg>
      <div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;line-height:1">
        <div style="font-size:32px;font-weight:600;color:#fff;font-family:'Fraunces',serif">${result.score}</div>
        <div style="font-size:10px;color:var(--shallow);opacity:.65;text-transform:uppercase;letter-spacing:.5px;margin-top:4px">/ 100</div>
      </div>
    </div>
    <div style="flex:1;min-width:0">
      <div style="font-size:18px;font-weight:600;color:${result.color};font-family:'Fraunces',serif;margin-bottom:4px">${result.label}</div>
      <div style="font-size:12px;color:var(--shallow);opacity:.75;line-height:1.5">Score composite pondéré : pH (40 pts), Cl (30), TAC (15), CYA (10), LSI (5).</div>
    </div>
  </div>
  <div style="margin-top:10px;padding-top:10px;border-top:1px solid var(--depth-line)">${breakdown}</div>`;
}

// ============== Insights tendances historiques ==============
// Algo pur JS sur cp_measurements pour détecter dérives, conso anormale, etc.
// Aucun service externe — tout est calculé sur les données déjà locales.

const INSIGHTS_ENABLED_KEY = 'cp_insights_enabled_v1';
function isInsightsEnabled(){
  const v = localStorage.getItem(INSIGHTS_ENABLED_KEY);
  return v === null ? true : v === '1';
}

function linearRegression(points){
  if(!points || points.length < 2) return null;
  const n = points.length;
  let sx=0, sy=0, sxy=0, sxx=0, syy=0;
  points.forEach(([x, y]) => { sx += x; sy += y; sxy += x*y; sxx += x*x; syy += y*y; });
  const denom = n * sxx - sx * sx;
  if(denom === 0) return null;
  const slope = (n * sxy - sx * sy) / denom;
  const intercept = (sy - slope * sx) / n;
  const ssRes = points.reduce((acc, [x, y]) => acc + Math.pow(y - (slope * x + intercept), 2), 0);
  const ssTot = syy - sy * sy / n;
  const r2 = ssTot === 0 ? 1 : 1 - ssRes / ssTot;
  return {slope, intercept, r2};
}

function stdDev(values){
  if(!values || values.length < 2) return 0;
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

function analyzeTrends(measurements){
  const out = [];
  if(!measurements || measurements.length < 3) return out;
  const sorted = measurements.filter(m => m && m.date).sort((a, b) => new Date(a.date) - new Date(b.date));
  const now = Date.now();
  const recent30d = sorted.filter(m => (now - new Date(m.date).getTime()) <= 30 * 86400000);
  const recent7d = sorted.filter(m => (now - new Date(m.date).getTime()) <= 7 * 86400000);
  const latest = sorted[sorted.length - 1];

  // 1. Dérive pH monotone récente
  const phChain = sorted.filter(m => m.ph != null).slice(-5);
  if(phChain.length >= 3){
    let upCount = 0, downCount = 0;
    for(let i = 1; i < phChain.length; i++){
      const diff = phChain[i].ph - phChain[i-1].ph;
      if(diff > 0.03) upCount++;
      else if(diff < -0.03) downCount++;
    }
    const totalDelta = phChain[phChain.length-1].ph - phChain[0].ph;
    if(upCount >= 3 && totalDelta >= 0.2){
      out.push({level:'warn', icon:'↗', text:`Ton pH dérive vers le haut depuis ${phChain.length} mesures (+${fmt(totalDelta,1)} cumulé). Vérifie ton TAC et ta cible — un pH qui monte régulièrement signe souvent un TAC élevé ou une eau trop dure.`});
    } else if(downCount >= 3 && totalDelta <= -0.2){
      out.push({level:'warn', icon:'↘', text:`Ton pH dérive vers le bas depuis ${phChain.length} mesures (${fmt(totalDelta,1)} cumulé). Surveille — un pH bas attaque les revêtements et fragilise l'équilibre.`});
    }
  }

  // 2. Volatilité pH (instabilité = TAC trop bas)
  const phRecent = recent30d.map(m => m.ph).filter(v => v != null);
  if(phRecent.length >= 4){
    const sd = stdDev(phRecent);
    if(sd > 0.3){
      out.push({level:'info', icon:'〰', text:`Ton pH varie beaucoup (écart-type ${fmt(sd,2)} sur 30 j). Cause classique : TAC trop bas, l'eau n'est pas tamponnée. Vise un TAC à 80-120 ppm.`});
    }
  }

  // 3. Conso Cl anormale : compare vitesse 7j vs 30j
  function chloreRate(list){
    const points = list.filter(m => m.fcl != null && m.date);
    if(points.length < 2) return null;
    const rates = [];
    for(let i = 1; i < points.length; i++){
      const prev = points[i-1], cur = points[i];
      if(cur.fcl >= prev.fcl) continue;
      const hours = (new Date(cur.date) - new Date(prev.date)) / 3600000;
      if(hours < 6 || hours > 96) continue;
      const ppmPerDay = (prev.fcl - cur.fcl) / (hours / 24);
      if(ppmPerDay > 0 && ppmPerDay < 5) rates.push(ppmPerDay);
    }
    if(rates.length < 2) return null;
    rates.sort((a, b) => a - b);
    return rates.length % 2 ? rates[(rates.length-1)/2] : (rates[rates.length/2 - 1] + rates[rates.length/2]) / 2;
  }
  const rate7 = chloreRate(recent7d);
  const rate30 = chloreRate(recent30d);
  if(rate7 && rate30 && rate30 > 0.1){
    const ratio = rate7 / rate30;
    if(ratio >= 1.4){
      out.push({level:'warn', icon:'🔥', text:`Ta conso chlore récente est +${fmt((ratio-1)*100,0)}% vs ta moyenne 30 j (${fmt(rate7,2)} vs ${fmt(rate30,2)} ppm/j). Probable : chaleur, baignade plus fréquente, ou CYA insuffisant.`});
    } else if(ratio <= 0.6){
      out.push({level:'info', icon:'❄', text:`Ta conso chlore a chuté de ${fmt((1-ratio)*100,0)}% vs ta moyenne 30 j. Probable : météo plus fraîche ou couverture utilisée.`});
    }
  }

  // 4. CYA en accumulation (>50 ppm)
  if(latest && latest.cya != null && latest.cya > 50){
    out.push({level:'alert', icon:'🧪', text:`CYA à ${fmt(latest.cya,0)} ppm — au-dessus de 50, ton chlore devient progressivement inefficace (chlore-lock). Envisage une vidange partielle (~30%) pour redescendre vers 30 ppm.`});
  }

  // 5. TAC en baisse régulière (régression linéaire sur 5+ mesures)
  const tacPoints = recent30d.filter(m => m.tac != null);
  if(tacPoints.length >= 5){
    const t0 = new Date(tacPoints[0].date).getTime();
    const reg = linearRegression(tacPoints.map(m => [(new Date(m.date).getTime() - t0) / 86400000, m.tac]));
    if(reg && reg.slope < -0.5 && reg.r2 > 0.5){
      const drop7d = reg.slope * 7;
      out.push({level:'warn', icon:'📉', text:`Ton TAC baisse régulièrement (~${fmt(drop7d, 0)} ppm/semaine). Quand il chute, le pH devient instable. Prévois un ajustement avec du bicarbonate de sodium.`});
    }
  }

  // 6. Pas de mesure depuis longtemps (>10 jours en saison avril-octobre)
  const month = new Date().getMonth();
  const inSeason = month >= 3 && month <= 9;
  if(inSeason && latest){
    const daysSince = Math.floor((now - new Date(latest.date).getTime()) / 86400000);
    if(daysSince >= 10){
      out.push({level:'info', icon:'🕒', text:`Ta dernière analyse remonte à ${daysSince} jours. En pleine saison, contrôle au moins toutes les semaines — beaucoup de choses peuvent changer.`});
    }
  }

  return out;
}

function renderInsightsCard(){
  const wrap = document.getElementById('insightsCard');
  if(!wrap) return;
  if(!isInsightsEnabled()){ wrap.style.display = 'none'; return; }
  const measurements = loadActiveMeasurements();
  if(!measurements || measurements.length < 3){ wrap.style.display = 'none'; return; }
  const insights = analyzeTrends(measurements);
  const colorMap = {ok:'#5eead4', info:'#7fd4d2', warn:'#fbbf24', alert:'#f87171'};
  if(insights.length === 0){
    wrap.style.display = 'block';
    wrap.innerHTML = `<div class="card-header">
      <div class="card-title"><span class="dot" style="background:#5eead4;box-shadow:0 0 10px #5eead4"></span>Insights</div>
      <span style="font-size:11px;color:var(--shallow);font-family:'JetBrains Mono',monospace">${measurements.length} mesures analysées</span>
    </div>
    <div style="color:var(--leaf);font-size:13px;padding:8px 0;line-height:1.5">✓ Tendances stables sur les 30 derniers jours — rien à signaler.</div>`;
    return;
  }
  wrap.style.display = 'block';
  const items = insights.map(ins => `
    <div style="display:flex;gap:12px;padding:10px 0;border-bottom:1px solid var(--depth-line);font-size:13px;line-height:1.55;color:var(--foam)">
      <span style="color:${colorMap[ins.level]||'#7fd4d2'};flex:0 0 auto;width:22px;text-align:center;font-size:15px">${ins.icon}</span>
      <span>${ins.text}</span>
    </div>`).join('');
  wrap.innerHTML = `<div class="card-header">
    <div class="card-title"><span class="dot" style="background:#5eead4;box-shadow:0 0 10px #5eead4"></span>Insights</div>
    <span style="font-size:11px;color:var(--shallow);font-family:'JetBrains Mono',monospace">${measurements.length} mesures · 30 j</span>
  </div>
  <div style="padding:4px 0">${items}</div>`;
}

// ============== Projection conso chlore (chimie × météo × historique) ==============
const CHLORE_PROJECTION_ENABLED_KEY = 'cp_chlore_projection_enabled_v1';
function isChloreProjectionEnabled(){
  const v = localStorage.getItem(CHLORE_PROJECTION_ENABLED_KEY);
  return v === null ? true : v === '1';
}

/**
 * Estime la vitesse de consommation Cl quotidienne (ppm/jour) à partir de
 * l'historique. On retient les paires de mesures consécutives où Fcl a baissé
 * (= chlore consommé, pas un ajout). Renvoie null si pas assez de données.
 */
function estimateChloreRateFromHistory(measurements){
  const sorted = measurements
    .filter(m => m && m.fcl != null && m.date)
    .sort((a, b) => new Date(a.date) - new Date(b.date));
  if(sorted.length < 2) return null;
  const cutoff = Date.now() - 14 * 86400000;
  const rates = [];
  for(let i = 1; i < sorted.length; i++){
    const prev = sorted[i-1];
    const cur = sorted[i];
    if(new Date(cur.date).getTime() < cutoff) continue;
    if(cur.fcl >= prev.fcl) continue; // ajout de chlore, on ignore
    const hours = (new Date(cur.date) - new Date(prev.date)) / 3600000;
    if(hours < 6 || hours > 72) continue; // < 6h trop bruité, > 72h trop incertain
    const ppmPerDay = (prev.fcl - cur.fcl) / (hours / 24);
    if(ppmPerDay > 0 && ppmPerDay < 5) rates.push(ppmPerDay); // garde-fous outliers
  }
  if(rates.length < 2) return null;
  rates.sort((a, b) => a - b);
  // Médiane pour robustesse aux outliers
  return rates.length % 2 ? rates[(rates.length-1)/2] : (rates[rates.length/2 - 1] + rates[rates.length/2]) / 2;
}

/**
 * Facteur multiplicateur quotidien basé sur la météo prévisionnelle.
 * Référence : journée tempérée, T° 22°C, UV 5, pas de pluie → 1.0
 */
function weatherConsumptionFactor(tempMax, uvMax, rainMm){
  const tempF = Math.max(0.5, 1 + (tempMax - 22) * 0.045); // +4.5%/°C au-dessus 22
  const uvF = Math.max(0.7, 1 + (uvMax - 5) * 0.05);       // +5%/UV au-dessus 5
  const rainF = rainMm >= 20 ? 1.25 : rainMm >= 10 ? 1.10 : 1.0; // dilution + photolyse
  return tempF * uvF * rainF;
}

/**
 * Projette l'évolution de Fcl sur 3 jours.
 * Retourne null si données insuffisantes.
 */
function projectChloreEvolution(currentFcl, baseRate, weather, cyaTarget){
  if(currentFcl == null || baseRate == null || !weather || !weather.daily) return null;
  const d = weather.daily;
  if(!d.temperature_2m_max || d.temperature_2m_max.length < 3) return null;
  const target = cyaTarget && cyaTarget > 0 ? cyaTarget / 10 : 1.5;
  const minSafe = Math.max(0.5, target * 0.8);
  let fcl = currentFcl;
  const days = [];
  for(let i = 0; i < 3; i++){
    const factor = weatherConsumptionFactor(d.temperature_2m_max[i], d.uv_index_max[i], d.precipitation_sum[i]);
    const loss = baseRate * factor;
    fcl = Math.max(0, fcl - loss);
    let status = 'ok';
    if(fcl < minSafe) status = 'danger';
    else if(fcl < target) status = 'warn';
    days.push({
      label: ['Auj.', 'Demain', 'Après-d.'][i],
      tempMax: d.temperature_2m_max[i],
      uvMax: d.uv_index_max[i],
      rain: d.precipitation_sum[i],
      factor,
      loss,
      projectedFcl: fcl,
      status,
    });
  }
  return {target, minSafe, days, baseRate};
}

function renderChloreProjectionCard(){
  const wrap = document.getElementById('chloreProjectionCard');
  if(!wrap) return;
  if(!isChloreProjectionEnabled()){ wrap.style.display = 'none'; return; }
  const b = getActiveBassin();
  if(!b || !b.config || !b.config.geo){ wrap.style.display = 'none'; return; }
  const cfg = b.config;
  const mode = (loadJSON(STORAGE_KEYS.lastInputs, {}) || {}).modeDesinf || cfg.modeDesinf || 'chlore';
  if(mode !== 'chlore'){ wrap.style.display = 'none'; return; } // pas pertinent en mode brome/sel
  const measurements = loadActiveMeasurements();
  const latest = measurements.slice(-1)[0];
  if(!latest || latest.fcl == null){ wrap.style.display = 'none'; return; }
  const volume = (latest && latest.volume) || cfg.volume;
  const cyaSouhaite = cfg.cyaSouhaite || 30;
  const cya = (latest && latest.cya) || cyaSouhaite;
  // Vitesse de conso : historique en priorité, sinon modèle théorique calcChloreMaintenance
  let baseRate = estimateChloreRateFromHistory(measurements);
  let rateSource = 'historique';
  if(baseRate == null){
    const temp = latest.temp || 22;
    const maint = calcChloreMaintenance(volume, temp, cya);
    if(maint) { baseRate = maint.ppmPerDay; rateSource = 'théorique'; }
  }
  if(baseRate == null){ wrap.style.display = 'none'; return; }

  wrap.style.display = 'block';
  wrap.innerHTML = `<div class="card-header">
    <div class="card-title"><span class="dot" style="background:#a78bfa;box-shadow:0 0 10px #a78bfa"></span>Projection chlore</div>
    <span style="font-size:11px;color:var(--shallow);font-family:'JetBrains Mono',monospace">3 jours · ${rateSource}</span>
  </div>
  <div id="chloreProjectionContent" style="color:var(--shallow);font-size:13px;padding:8px 0">Calcul…</div>`;

  fetchWeatherForBassin(b).then(weather => {
    const content = document.getElementById('chloreProjectionContent');
    if(!content) return;
    const proj = projectChloreEvolution(latest.fcl, baseRate, weather, cyaSouhaite);
    if(!proj){
      content.innerHTML = '<div style="opacity:.7">Pas assez de données pour projeter.</div>';
      return;
    }
    const colorMap = {ok:'#5eead4', warn:'#fbbf24', danger:'#f87171'};
    const iconMap = {ok:'✓', warn:'⚠', danger:'🚨'};
    const cols = proj.days.map(day => `
      <div style="flex:1;text-align:center;padding:12px 8px;background:rgba(255,255,255,.04);border-radius:10px;border:1px solid ${colorMap[day.status]}33">
        <div style="font-size:11px;color:var(--shallow);opacity:.7;text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px">${day.label}</div>
        <div style="font-size:18px;font-weight:600;color:${colorMap[day.status]}">${iconMap[day.status]} ${fmt(day.projectedFcl, 1)}</div>
        <div style="font-size:10px;color:var(--shallow);opacity:.65;margin-top:4px;font-family:'JetBrains Mono',monospace">ppm Fcl</div>
        <div style="font-size:10px;color:var(--shallow);opacity:.55;margin-top:6px;line-height:1.3">${fmt(day.tempMax,0)}°C · UV${fmt(day.uvMax,0)}${day.rain>=5?` · ${fmt(day.rain,0)}mm`:''}</div>
      </div>`).join('');
    // Recommandation : si un jour passe sous la cible, calcule la dose préventive à ajouter maintenant
    const firstDrop = proj.days.find(d => d.status !== 'ok');
    let action;
    if(firstDrop){
      // Combien faut-il ajouter pour tenir 3 jours au-dessus de target ?
      const totalLoss3d = proj.days.reduce((s, d) => s + d.loss, 0);
      const need = Math.max(0, (proj.target + 0.2) - latest.fcl + totalLoss3d);
      const javelMl = volume ? Math.round((need * volume / 100) * 1000) : null;
      action = `<div style="margin-top:14px;padding:12px;background:rgba(167,139,250,.08);border:1px solid rgba(167,139,250,.25);border-radius:10px;font-size:13px;line-height:1.55;color:#e4d9ff">
        <strong>💡 ${firstDrop.label === 'Auj.' ? "Aujourd'hui" : firstDrop.label.replace('.', '')}</strong> ton chlore va passer sous ${fmt(proj.target,1)} ppm (cible CYA/10).<br>
        ${javelMl ? `Ajoute <strong>~${javelMl} mL de Javel 9.6°</strong> maintenant pour tenir 3 jours.` : 'Ajoute du chlore préventif.'}
      </div>`;
    } else {
      action = `<div style="margin-top:14px;color:var(--leaf);font-size:13px">✓ Niveau Fcl tient les 3 prochains jours sans ajout préventif.</div>`;
    }
    const baseRateHint = `<div style="margin-top:10px;font-size:11px;color:var(--shallow);opacity:.55;line-height:1.45">Conso ${rateSource} : ~${fmt(proj.baseRate,2)} ppm/jour · cible CYA/10 = ${fmt(proj.target,1)} ppm</div>`;
    content.innerHTML = `<div style="display:flex;gap:8px">${cols}</div>${action}${baseRateHint}`;
  }).catch(err => {
    const content = document.getElementById('chloreProjectionContent');
    if(content) content.innerHTML = '<div style="opacity:.7">Météo indisponible, projection impossible.</div>';
  });
}

// Chaîne le rendu de la projection chlore + insights + score santé après chaque update météo
const _origRenderWeatherCard = renderWeatherCard;
window.renderWeatherCard = function(){
  _origRenderWeatherCard();
  try{ renderHealthScoreCard(); }catch(e){ console.warn('HealthScore render failed', e); }
  try{ renderChloreProjectionCard(); }catch(e){ console.warn('Projection render failed', e); }
  try{ renderInsightsCard(); }catch(e){ console.warn('Insights render failed', e); }
};

// Géolocalisation rapide pour une carte de bassin
async function setBassinGeoFromBrowser(bassinId){
  if(!navigator.geolocation){ toast('Géolocalisation indisponible', 'warn'); return null; }
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      async pos => {
        const {latitude:lat, longitude:lon} = pos.coords;
        // Reverse-geocode léger via Open-Meteo (gratuit)
        let ville = 'Position GPS';
        try{
          const r = await fetch(`https://geocoding-api.open-meteo.com/v1/reverse?latitude=${lat}&longitude=${lon}&count=1&language=fr&format=json`);
          if(r.ok){
            const j = await r.json();
            if(j.results && j.results[0]){
              const it = j.results[0];
              ville = it.name + (it.admin1 ? ', ' + it.admin1 : '');
            }
          }
        }catch(e){}
        updateBassin(bassinId, {config: {geo: {lat, lon, ville}}});
        toast(`Météo activée pour ${ville}`);
        resolve({lat, lon, ville});
      },
      err => { toast('Permission de localisation refusée', 'warn'); resolve(null); },
      {timeout: 8000, maximumAge: 24*3600*1000}
    );
  });
}

async function geolocateActiveBassinForWeather(){
  const b = getActiveBassin();
  if(!b) return;
  const r = await setBassinGeoFromBrowser(b.id);
  if(r) renderWeatherCard();
}

// ============== UI bassins (switcher + modale) ==============
let _bassinModalEditingId = null;
let _bassinModalEmoji = '🏊';
let _bassinModalCouleur = BASSIN_COLORS[0];

function renderBassinSwitcher(){
  const wrap = $('bassinSwitcher');
  if(!wrap) return;
  const bassins = getActiveBassins();
  const activeId = getActiveBassinId();

  // Pas de bassin du tout (avant wizard) : on cache
  if(bassins.length === 0){
    wrap.style.display = 'none';
    wrap.innerHTML = '';
    return;
  }
  // Sinon toujours affiché : on a besoin du bouton "+ Bassin" même avec un seul bassin
  wrap.style.display = 'flex';

  const chips = bassins.map(b => {
    const isActive = b.id === activeId;
    const actions = isActive
      ? `<span class="bassin-chip-edit" onclick="event.stopPropagation();openShareModal('${b.id}')" title="Partager en lecture seule">🔗</span>
         <span class="bassin-chip-edit" onclick="event.stopPropagation();openBassinModal('${b.id}')" title="Modifier">⚙</span>`
      : '';
    return `<div class="bassin-chip ${isActive?'active':''}" onclick="switchBassin('${b.id}')" data-id="${b.id}">
      <span class="dot-color" style="color:${b.couleur};background:${b.couleur}"></span>
      <span class="chip-emoji">${b.emoji||'🏊'}</span>
      <span>${escapeHtml(b.nom)}</span>
      ${actions}
    </div>`;
  }).join('');

  const addChip = `<div class="bassin-chip bassin-chip-add" onclick="openBassinModal()">＋ Bassin</div>`;
  wrap.innerHTML = chips + addChip;
}

function switchBassin(id){
  const b = getBassinById(id);
  if(!b || b.archived) return;
  setActiveBassinId(id);
  applyBassinConfigToInputs(b);
  // Re-render toutes les vues qui dépendent du bassin
  renderBassinSwitcher();
  updateLastControlInfo();
  renderHistory();
  renderTrends();
  if(typeof renderCorrections === 'function') renderCorrections();
  if(typeof renderCharts === 'function') renderCharts();
  if(typeof renderWeatherCard === 'function') renderWeatherCard();
  toast(`Bassin actif : ${b.emoji||''} ${b.nom}`);
}

function openBassinModal(id){
  _bassinModalEditingId = id || null;
  const b = id ? getBassinById(id) : null;
  const isEdit = !!b;

  $('bassinModalTitle').textContent = isEdit ? `Modifier "${b.nom}"` : 'Nouveau bassin';
  $('bassinModalSaveBtn').textContent = isEdit ? 'Enregistrer' : 'Créer le bassin';
  $('bassinModalNom').value = isEdit ? b.nom : '';
  $('bassinModalVolume').value = isEdit ? (b.config.volume ?? '') : '';
  $('bassinModalMode').value = isEdit ? (b.config.modeDesinf || 'chlore') : 'chlore';
  _bassinModalEmoji = isEdit ? (b.emoji || '🏊') : '🏊';
  _bassinModalCouleur = isEdit ? (b.couleur || BASSIN_COLORS[0]) : BASSIN_COLORS[getBassins().length % BASSIN_COLORS.length];

  // Render emoji picker
  $('bassinModalEmoji').innerHTML = BASSIN_EMOJIS_SUGGEST.map(e =>
    `<span class="${e===_bassinModalEmoji?'selected':''}" onclick="pickBassinEmoji('${e}')">${e}</span>`
  ).join('');
  // Render color picker
  $('bassinModalCouleur').innerHTML = BASSIN_COLORS.map(c =>
    `<span class="${c===_bassinModalCouleur?'selected':''}" style="background:${c};color:${c}" onclick="pickBassinCouleur('${c}')"></span>`
  ).join('');

  // Section actions
  const actions = $('bassinModalActions');
  if(actions){
    actions.style.display = isEdit ? 'block' : 'none';
    // Texte du bouton archiver/restaurer
    const archBtn = $('bassinArchiveBtn');
    if(archBtn && b){
      archBtn.innerHTML = b.archived
        ? '♻️ Restaurer <span style="opacity:.6;font-size:12px">— remettre dans la liste active</span>'
        : '📦 Archiver <span style="opacity:.6;font-size:12px">— cacher sans supprimer</span>';
    }
    // Reset share code box
    const shareBox = $('bassinShareCodeBox');
    if(shareBox){ shareBox.style.display = 'none'; shareBox.innerHTML = ''; }
  }

  $('bassinModalOverlay').style.display = 'flex';
}

function closeBassinModal(){
  $('bassinModalOverlay').style.display = 'none';
  _bassinModalEditingId = null;
}

function pickBassinEmoji(e){
  _bassinModalEmoji = e;
  $('bassinModalEmoji').querySelectorAll('span').forEach(s => {
    s.classList.toggle('selected', s.textContent === e);
  });
}

function pickBassinCouleur(c){
  _bassinModalCouleur = c;
  $('bassinModalCouleur').querySelectorAll('span').forEach(s => {
    s.classList.toggle('selected', s.style.backgroundColor && getComputedStyle(s).backgroundColor === hexToRgb(c));
  });
}
function hexToRgb(hex){
  const r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16);
  return `rgb(${r}, ${g}, ${b})`;
}

function saveBassinFromModal(){
  const nom = $('bassinModalNom').value.trim();
  if(!nom){ toast('Donne un nom au bassin','warn'); return; }
  const volume = parseFloat($('bassinModalVolume').value);
  const modeDesinf = $('bassinModalMode').value;
  const patch = {
    nom, emoji: _bassinModalEmoji, couleur: _bassinModalCouleur,
    config: {
      volume: isNaN(volume) ? null : volume,
      modeDesinf
    }
  };
  if(_bassinModalEditingId){
    updateBassin(_bassinModalEditingId, patch);
    toast('Bassin mis à jour');
  } else {
    const b = createBassin({
      nom, emoji: _bassinModalEmoji, couleur: _bassinModalCouleur,
      volume: patch.config.volume, modeDesinf
    });
    setActiveBassinId(b.id);
    applyBassinConfigToInputs(b);
    toast(`Bassin "${b.nom}" créé`);
  }
  closeBassinModal();
  renderBassinSwitcher();
  updateLastControlInfo();
  renderHistory();
  renderTrends();
  cloudBackupSync();
}

function archiveBassinFromModal(){
  if(!_bassinModalEditingId) return;
  const b = getBassinById(_bassinModalEditingId);
  if(!b) return;
  if(b.archived){
    restoreBassin(b.id);
    toast('Bassin restauré');
  } else {
    // S'il ne reste qu'un bassin actif, on refuse
    if(getActiveBassins().length <= 1){
      toast('Impossible d\'archiver le dernier bassin actif','warn');
      return;
    }
    archiveBassin(b.id);
    // Si c'était l'actif, on bascule
    if(getActiveBassinId() === b.id){
      const fallback = getActiveBassins()[0];
      if(fallback){ setActiveBassinId(fallback.id); applyBassinConfigToInputs(fallback); }
    }
    toast('Bassin archivé');
  }
  closeBassinModal();
  renderBassinSwitcher();
  updateLastControlInfo();
  renderHistory();
  renderTrends();
  cloudBackupSync();
}

function deleteBassinFromModal(){
  if(!_bassinModalEditingId) return;
  const b = getBassinById(_bassinModalEditingId);
  if(!b) return;
  if(getActiveBassins().length <= 1 && !b.archived){
    toast('Impossible de supprimer le dernier bassin actif','warn');
    return;
  }
  const measureCount = loadJSON(STORAGE_KEYS.measurements, []).filter(m => m.bassinId === b.id).length;
  if(!confirm(`Supprimer "${b.nom}" définitivement ?\n\n${measureCount} mesure${measureCount>1?'s':''} ${measureCount>1?'seront':'sera'} aussi effacée${measureCount>1?'s':''}. Cette action est irréversible.`)) return;
  deleteBassinAndData(b.id);
  closeBassinModal();
  // Recharge config du nouveau bassin actif
  const newActive = getActiveBassin();
  if(newActive) applyBassinConfigToInputs(newActive);
  renderBassinSwitcher();
  updateLastControlInfo();
  renderHistory();
  renderTrends();
  cloudBackupSync();
  toast('Bassin supprimé');
}

async function geolocateBassinFromModal(){
  if(!_bassinModalEditingId) return;
  const btn = $('bassinGeoBtn');
  if(btn){ btn.disabled = true; btn.innerHTML = '⏳ Localisation en cours…'; }
  const r = await setBassinGeoFromBrowser(_bassinModalEditingId);
  if(btn){
    btn.disabled = false;
    if(r){
      btn.innerHTML = `✓ Météo activée — ${escapeHtml(r.ville)} <span style="opacity:.6;font-size:12px">(modifier pour mettre à jour)</span>`;
    } else {
      btn.innerHTML = '📍 Activer la météo locale <span style="opacity:.6;font-size:12px">— GPS du navigateur</span>';
    }
  }
  renderWeatherCard();
}

// Recherche par ville / code postal via Open-Meteo geocoding (gratuit, sans clé)
async function setBassinGeoFromAddress(){
  if(!_bassinModalEditingId) return;
  const input = $('bassinManualVille');
  const searchBtn = $('bassinGeoSearchBtn');
  const geoBtn = $('bassinGeoBtn');
  const q = (input?.value || '').trim();
  if(!q){ toast('Saisis une ville ou un code postal', 'warn'); return; }
  if(searchBtn){ searchBtn.disabled = true; searchBtn.textContent = '⏳'; }
  try{
    const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=1&language=fr&format=json`;
    const r = await fetch(url);
    if(!r.ok) throw new Error('HTTP ' + r.status);
    const j = await r.json();
    if(!j.results || !j.results[0]){
      toast('Adresse introuvable — essaie une ville plus grande', 'warn');
      return;
    }
    const it = j.results[0];
    const ville = it.name
      + (it.admin1 ? ', ' + it.admin1 : '')
      + (it.country_code && it.country_code !== 'FR' ? ' (' + it.country_code + ')' : '');
    updateBassin(_bassinModalEditingId, {config: {geo: {lat: it.latitude, lon: it.longitude, ville}}});
    // Purge le cache météo pour ce bassin (nouvelle position)
    const cacheAll = loadJSON(WEATHER_CACHE_KEY, {});
    delete cacheAll[_bassinModalEditingId];
    saveJSON(WEATHER_CACHE_KEY, cacheAll);
    if(geoBtn){
      geoBtn.innerHTML = `✓ Météo activée — ${escapeHtml(ville)} <span style="opacity:.6;font-size:12px">(modifier pour mettre à jour)</span>`;
    }
    if(input) input.value = '';
    toast(`Météo activée pour ${ville}`);
    renderWeatherCard();
  }catch(e){
    console.warn('Geocoding failed', e);
    toast('Recherche impossible — vérifie ta connexion', 'warn');
  }finally{
    if(searchBtn){ searchBtn.disabled = false; searchBtn.textContent = 'Chercher'; }
  }
}

async function generateShareCodeForBassin(){
  if(!_bassinModalEditingId) return;
  const box = $('bassinShareCodeBox');
  if(box){ box.style.display = 'block'; box.innerHTML = '⏳ Génération en cours…'; }
  const code = await shareBassinCloud(_bassinModalEditingId);
  if(!code){
    if(box){ box.innerHTML = '<span style="color:var(--coral)">Échec — vérifie ta connexion</span>'; }
    return;
  }
  if(box){
    box.innerHTML = `
      <div style="margin-bottom:8px;opacity:.85">Donne ce code à qui veut récupérer ce bassin :</div>
      <div style="font-size:15px;letter-spacing:1px;font-weight:600;word-break:break-all">${code}</div>
      <button class="btn-ghost" style="margin-top:10px;padding:6px 10px;font-size:12px" onclick="navigator.clipboard.writeText('${code}').then(()=>toast('Code copié'))">Copier</button>
    `;
  }
}

// ============== Section éducation / glossaire ==============
const EDU_ARTICLES = [
  {
    id: 'parametres',
    icon: '🧪',
    title: 'Les paramètres clés',
    summary: 'pH, Fcl, CYA, TAC, TH — à quoi ça sert et où viser ?',
    body: `
      <h3>pH (acidité)</h3>
      <p>Indicateur de l'acidité de l'eau. <strong>Cible 7,2-7,4</strong>. En dessous = corrosif (joints, métaux). Au-dessus = chlore inactif + dépôts calcaires + irritations.</p>

      <h3>Chlore libre (Fcl)</h3>
      <p>La quantité de chlore disponible pour désinfecter. <strong>Cible = CYA / 10</strong> (donc 3 ppm si CYA à 30). Sans CYA, vise 0,5-1 ppm seulement.</p>

      <h3>Chlore total (Tcl) et chloramines (Ccl)</h3>
      <p>Tcl = tout le chlore, libre + combiné. Ccl = Tcl − Fcl = chlore déjà consommé par les contaminants. <strong>Si Ccl > 0,6 ppm → superchloration nécessaire</strong> (odeur typique de "javel" qui pique).</p>

      <h3>CYA (stabilisant / acide cyanurique)</h3>
      <p>Protège ton chlore du soleil. <strong>Cible 20-30 ppm</strong>. Au-delà de 40 ppm, le chlore devient inefficace — vidange partielle obligatoire (le CYA ne s'élimine que par dilution).</p>

      <h3>TAC (alcalinité)</h3>
      <p>C'est le "tampon" qui stabilise ton pH. <strong>Cible 80-100 ppm</strong>. Trop bas (< 60) = pH qui plonge. Trop haut (> 150) = pH qui monte tout le temps (dégazage CO₂).</p>

      <h3>TH (dureté / calcaire)</h3>
      <p>Quantité de calcium et magnésium dans l'eau. <strong>Cible 15-25 °f</strong>. Trop bas = eau corrosive. Trop haut = entartrage des équipements et des parois.</p>

      <h3>Sel</h3>
      <p>Pour les piscines à électrolyse au sel. <strong>Cible 4 g/L</strong> (vérifie ta notice — les électrolyseurs récents acceptent 2,5-3,5). Trop haut = corrosion + électrolyseur encrassé.</p>
    `
  },
  {
    id: 'hocl',
    icon: '💧',
    title: 'HOCl : la vraie mesure de désinfection',
    summary: 'Pourquoi 3 ppm de chlore libre ne désinfectent pas vraiment 3 ppm.',
    body: `
      <p>Quand tu mesures du <strong>chlore libre (Fcl)</strong>, tu mesures la somme de deux choses :</p>
      <ul>
        <li><strong>HOCl</strong> (acide hypochloreux) — la forme <em>active</em> qui désinfecte</li>
        <li><strong>OCl⁻</strong> (ion hypochlorite) — la forme <em>inactive</em>, juste un stock</li>
      </ul>
      <p>La répartition entre les deux dépend du <strong>pH</strong> et du <strong>CYA</strong>.</p>
      <h3>L'effet du pH</h3>
      <p>À pH 7,5 : 50 % HOCl, 50 % OCl⁻. À pH 6,8 : <strong>85 % HOCl</strong>. À pH 8,0 : seulement 25 % HOCl. C'est pour ça qu'un pH élevé "désactive" ton chlore.</p>
      <h3>L'effet du CYA</h3>
      <p>Le CYA séquestre une grande partie du chlore libre pour le protéger du soleil. Avec CYA à 30 ppm, seulement <strong>2-3 % de ton Fcl est actif</strong>. C'est normal — c'est le prix à payer pour ne pas tout perdre au soleil.</p>
      <h3>Le bon seuil</h3>
      <p>Pour désinfecter efficacement, vise <strong>HOCl ≥ 0,05 ppm</strong>. En dessous, les bactéries prennent le dessus. C'est ce que la carte "Pouvoir désinfectant" calcule pour toi.</p>
      <h3>Astuce choc</h3>
      <p>Avant un choc curatif, baisse temporairement ton pH à 6,8 → tu multiplies l'efficacité du chlore par ~2. Tu remontes le pH à 7,2 après.</p>
    `
  },
  {
    id: 'eau-verte',
    icon: '🦠',
    title: 'Eau trouble, eau verte, eau brune — que faire ?',
    summary: 'Diagnostic et actions selon la couleur du problème.',
    body: `
      <h3>Eau verte (algues)</h3>
      <p><strong>Cause</strong> : prolifération d'algues, souvent à cause d'un chlore qui chute (manque, CYA trop bas pour le soleil, ou trop élevé qui rend le chlore inefficace).</p>
      <ol>
        <li>Brosse les parois (les algues se fixent dessus)</li>
        <li>Vérifie pH (vise 7,2) et CYA</li>
        <li>Choc curatif : Fcl à CYA × 0,5 (donc 15 ppm si CYA 30)</li>
        <li>Filtre 24-48 h en continu, lave le filtre à mi-parcours</li>
        <li>Floculant si l'eau reste laiteuse après</li>
      </ol>

      <h3>Eau trouble laiteuse</h3>
      <p><strong>Cause</strong> : eau dure (calcaire en suspension), pH ou TAC mal réglés, ou filtration insuffisante.</p>
      <ul>
        <li>Vérifie TH (si > 30 °f → vidange partielle)</li>
        <li>Vérifie pH et LSI (si entartrant → baisse pH)</li>
        <li>Floculant + filtration prolongée</li>
      </ul>

      <h3>Eau brune / rouille</h3>
      <p><strong>Cause</strong> : présence de fer ou manganèse (souvent une nouvelle arrivée d'eau du réseau ou puits). Aggravé par un chlore qui oxyde le métal en suspension.</p>
      <ul>
        <li>Séquestrant métaux (anti-fer / chélateur)</li>
        <li>Filtration prolongée + lavage filtre</li>
        <li>Évite la superchloration tant que le fer n'est pas séquestré</li>
      </ul>

      <h3>Mousse en surface</h3>
      <p>Souvent des crèmes solaires + sueur + surfactants. Anti-mousse en spray + brosser pour aider la filtration à les capter.</p>
    `
  },
  {
    id: 'ph-instable',
    icon: '📈',
    title: 'Pourquoi mon pH ne reste pas stable ?',
    summary: 'Diagnostiquer une dérive du pH en regardant le TAC.',
    body: `
      <p>Si ton pH dérive régulièrement, le coupable n'est presque jamais le pH lui-même mais le <strong>TAC</strong> (alcalinité).</p>

      <h3>Le TAC = le "tampon"</h3>
      <p>Imagine le TAC comme un amortisseur. Si tu n'en as pas assez (< 60 ppm), le pH descend tout seul (les acides comme le CO₂ dissous l'attaquent). Si tu en as trop (> 150 ppm), le CO₂ s'échappe (dégazage) et le pH <em>monte</em> tout seul.</p>

      <h3>Diagnostic</h3>
      <table style="width:100%;border-collapse:collapse;font-size:13px;margin:10px 0">
        <tr style="background:rgba(255,255,255,.05)"><th style="text-align:left;padding:6px">Tu observes</th><th style="text-align:left;padding:6px">Cause probable</th></tr>
        <tr><td style="padding:6px">pH ↗ régulièrement</td><td style="padding:6px">TAC trop élevé (baisse à 80-100)</td></tr>
        <tr style="background:rgba(255,255,255,.03)"><td style="padding:6px">pH ↘ régulièrement</td><td style="padding:6px">TAC trop bas (remonte à 80-100)</td></tr>
        <tr><td style="padding:6px">pH stable</td><td style="padding:6px">TAC OK ✓</td></tr>
      </table>

      <h3>Erreur fréquente</h3>
      <p>Ajouter de l'acide chlorhydrique en boucle parce que le pH monte. Si le TAC est trop haut, tu corriges le symptôme et l'acide va aussi te baisser le TAC, ce qui peut <em>aggraver</em> la situation à long terme. Vérifie ton TAC <strong>avant</strong> d'ajouter de l'acide.</p>

      <h3>L'app le détecte automatiquement</h3>
      <p>La carte "Tendances" surveille la pente de ton pH sur 14 jours. Si elle dérive de plus de 0,04 par jour sur 4+ jours, tu auras une alerte avec la cause probable.</p>
    `
  },
  {
    id: 'choc',
    icon: '⚡',
    title: 'Choc chloré : quand et comment ?',
    summary: 'Curatif, préventif, superchloration — comment ne pas se planter.',
    body: `
      <h3>3 types de "choc" à ne pas confondre</h3>

      <h4>1. Choc curatif</h4>
      <p>Réservé aux <strong>vrais problèmes</strong> : eau verte, Fcl < 50 % de la cible, après une grosse contamination (animal, accident, etc.).</p>
      <ul>
        <li>Vise Fcl = CYA × 0,5 (15 ppm pour CYA à 30)</li>
        <li>Reste hors du bassin tant que Fcl > 5 ppm</li>
        <li>Astuce : baisse le pH à 6,8 avant pour maximiser l'efficacité</li>
      </ul>

      <h4>2. Superchloration (élimination des chloramines)</h4>
      <p>Quand le chlore combiné (Ccl) dépasse 0,6 ppm. C'est lui qui crée l'odeur "javel" et l'irritation des yeux.</p>
      <ul>
        <li>Vise Fcl = 10 × Ccl pour casser la liaison</li>
        <li>Le calcul est fait par l'app dans la carte "Superchloration"</li>
      </ul>

      <h4>3. Choc préventif (à éviter en général)</h4>
      <p>Beaucoup de gens "chlorent à fond" par sécurité. C'est <strong>contre-productif</strong> : tu fais grimper ton CYA (si tu utilises du stabilisé), tu attaques les liners, et tu n'es pas plus protégé. Mieux vaut maintenir Fcl à la cible <strong>constamment</strong>.</p>

      <h3>Choc = pas de baignade</h3>
      <p>Tant que Fcl > 5 ppm, ne te baigne pas (irritation cutanée, oculaire, voire respiratoire avec un mauvais pH). Compte 24-48 h selon le soleil pour que ça redescende.</p>
    `
  },
  {
    id: 'cycle',
    icon: '📅',
    title: 'Le cycle d\'une saison',
    summary: 'Mise en route, été, fin de saison, hivernage.',
    body: `
      <h3>🌱 Mise en route (mars-avril)</h3>
      <ol>
        <li>Vide les bouchons d'hivernage, redémarre la filtration</li>
        <li>Lave le filtre à fond (l'eau qui sort doit être claire)</li>
        <li>Mesure tous les paramètres et corrige (pH, TAC en priorité, puis Cl et CYA)</li>
        <li>Choc curatif si l'eau est laiteuse ou verte (souvent oui)</li>
        <li>Filtre 24/24 les premiers jours</li>
      </ol>

      <h3>☀ Été (mai-août)</h3>
      <ul>
        <li>Mesure 2× par semaine (pH + Fcl), 1× tous les 15 j pour le reste</li>
        <li>Filtre = durée en heures ≈ T° eau / 2 (eau à 28°C → 14 h/jour)</li>
        <li>Brosse les parois 1× par semaine pour empêcher les algues</li>
        <li>Lave le filtre quand la pression monte de +0,5 bar par rapport au filtre propre</li>
      </ul>

      <h3>🍂 Fin de saison (septembre)</h3>
      <ul>
        <li>Recommence à réduire la durée de filtration</li>
        <li>Maintiens Fcl jusqu'à 12°C d'eau</li>
        <li>Lave le filtre à fond avant de couper</li>
      </ul>

      <h3>❄ Hivernage (octobre-mars)</h3>
      <p>Deux écoles :</p>
      <ul>
        <li><strong>Actif</strong> : filtration 2-4 h/jour quand T° eau < 12°C, pas de produit hivernage. Plus simple, mais consomme un peu d'électricité.</li>
        <li><strong>Passif</strong> : couvrir, baisser le niveau d'eau, vidanger les skimmers, ajouter un anti-algues hivernage. Plus économe en énergie, mais demande une remise en route plus longue au printemps.</li>
      </ul>
      <p>Dans tous les cas : <strong>équilibre l'eau avant</strong> (pH, TAC, TH). Une eau déséquilibrée pendant 5 mois fait beaucoup plus de dégâts qu'une saison entière.</p>
    `
  },
  {
    id: 'filtration',
    icon: '🔁',
    title: 'Filtration — combien d\'heures, combien de cycles',
    summary: 'Règle T°/2, cycles de Gage-Bidwell, entretien filtre et calendrier saisonnier.',
    body: `
      <h3>Pourquoi filtrer ?</h3>
      <p>La filtration sert à mécaniquement retirer les particules <em>et</em> à distribuer le désinfectant uniformément dans le bassin. Sans elle, le chlore ne touche pas toute l'eau et des zones « mortes » développent des algues.</p>

      <h3>Combien d'heures par jour ?</h3>
      <p>Règle universelle : <strong>temps de filtration (h) = T° eau ÷ 2</strong>.</p>
      <table style="width:100%;border-collapse:collapse;font-size:13px;margin:10px 0">
        <tr style="background:rgba(255,255,255,.05)"><th style="text-align:left;padding:6px">T° eau</th><th style="text-align:left;padding:6px">Heures/jour</th><th style="text-align:left;padding:6px">Phase</th></tr>
        <tr><td style="padding:6px">&lt; 10 °C</td><td style="padding:6px">1 h (ou arrêt)</td><td style="padding:6px">Hivernage</td></tr>
        <tr style="background:rgba(255,255,255,.03)"><td style="padding:6px">10-12 °C</td><td style="padding:6px">2 h</td><td style="padding:6px">Hivernage actif</td></tr>
        <tr><td style="padding:6px">12-16 °C</td><td style="padding:6px">4-6 h</td><td style="padding:6px">Démarrage / déshivernage</td></tr>
        <tr style="background:rgba(255,255,255,.03)"><td style="padding:6px">16-20 °C</td><td style="padding:6px">8-10 h</td><td style="padding:6px">Printemps</td></tr>
        <tr><td style="padding:6px">20-24 °C</td><td style="padding:6px">10-12 h</td><td style="padding:6px">Été doux</td></tr>
        <tr style="background:rgba(255,255,255,.03)"><td style="padding:6px">24-28 °C</td><td style="padding:6px">12-14 h</td><td style="padding:6px">Pleine saison</td></tr>
        <tr><td style="padding:6px">&gt; 28 °C</td><td style="padding:6px">24 h</td><td style="padding:6px">Canicule (continu)</td></tr>
      </table>
      <p><strong>Toujours en journée</strong> (8 h–20 h) : la photosynthèse et la chaleur réveillent les algues le jour, donc c'est le moment où chlore et filtration doivent travailler.</p>

      <h3>1 cycle = 1 volume du bassin filtré</h3>
      <p>Un « cycle » signifie que la pompe a fait passer un volume d'eau équivalent à tout le bassin dans le filtre.</p>
      <p><strong>Cycles/jour = (heures de filtration) ÷ (volume ÷ débit pompe)</strong>.</p>
      <p>Règle pro : un cycle doit durer <strong>≤ 4 h</strong>, donc débit minimum = volume ÷ 4.</p>

      <h3>Loi de Gage-Bidwell — pourquoi viser 3-4 cycles</h3>
      <p>À cause du mélange, un seul cycle ne renouvelle pas 100 % de l'eau. Le taux théorique de renouvellement après N cycles = <code>1 − e^(−N)</code> :</p>
      <table style="width:100%;border-collapse:collapse;font-size:13px;margin:10px 0">
        <tr style="background:rgba(255,255,255,.05)"><th style="text-align:left;padding:6px">Cycles</th><th style="text-align:left;padding:6px">Renouvellement</th></tr>
        <tr><td style="padding:6px">1</td><td style="padding:6px">63 %</td></tr>
        <tr style="background:rgba(255,255,255,.03)"><td style="padding:6px">2</td><td style="padding:6px">86 %</td></tr>
        <tr><td style="padding:6px">3</td><td style="padding:6px"><strong>95 %</strong> ← objectif</td></tr>
        <tr style="background:rgba(255,255,255,.03)"><td style="padding:6px">4</td><td style="padding:6px"><strong>98 %</strong> ← objectif</td></tr>
        <tr><td style="padding:6px">6</td><td style="padding:6px">99,7 %</td></tr>
        <tr style="background:rgba(255,255,255,.03)"><td style="padding:6px">10</td><td style="padding:6px">~100 %</td></tr>
      </table>
      <p>L'objectif standard est donc <strong>3 à 4 cycles complets par jour</strong>.</p>

      <h3>Entretien du filtre</h3>
      <ul>
        <li><strong>Filtre à sable</strong> : backwash dès que le manomètre monte de +0,3-0,5 bar au-dessus de la pression propre (env. 1×/mois hors saison, 1×/sem en saison). Procédure : Backwash 3-5 min → Rinçage 1-2 min → Filtration.</li>
        <li><strong>Filtre à cartouche</strong> : nettoyage au jet tous les 15 jours, remplacement annuel.</li>
        <li><strong>Sable</strong> à remplacer tous les 5-7 ans, <strong>verre filtrant</strong> tous les 8-10 ans.</li>
      </ul>

      <h3>Le cycle saisonnier</h3>
      <ul>
        <li><strong>Mars-avril (déshivernage)</strong> : démarrer la filtration dès que l'eau atteint 12 °C, T°/2.</li>
        <li><strong>Été</strong> : suivre la règle, passer en 24/24 au-dessus de 28 °C.</li>
        <li><strong>Sept-oct</strong> : descendre progressivement avec la T°.</li>
        <li><strong>Hivernage actif</strong> (climat doux, gel rare) : 2 h/j sur le créneau le plus chaud (ex. 11h-13h) + produit antigel.</li>
        <li><strong>Hivernage passif</strong> (gel fréquent) : arrêt total, vidange partielle, flotteurs/gizmo.</li>
      </ul>

      <h3>L'app le calcule pour toi</h3>
      <p>Quand tu saisis la T° eau sur la page Mesure, une carte « Filtration recommandée » apparaît automatiquement. Renseigne aussi ton débit pompe (Rappels → Configurer mon bassin) pour voir tes cycles/jour et le % de renouvellement.</p>
    `
  }
];

function openEducation(articleId){
  if(!$('eduOverlay')) return;
  $('eduOverlay').style.display = 'flex';
  showEduScreen(articleId || null);
}
function closeEducation(){
  if($('eduOverlay')) $('eduOverlay').style.display = 'none';
}
function showEduScreen(articleId){
  const list = $('eduList');
  const detail = $('eduDetail');
  if(!list || !detail) return;
  if(!articleId){
    list.style.display = 'block';
    detail.style.display = 'none';
    $('eduBack').style.display = 'none';
    $('eduTitle').textContent = 'Apprendre la chimie de l\'eau';
    list.innerHTML = EDU_ARTICLES.map(a => `
      <div onclick="showEduScreen('${a.id}')" style="display:flex;gap:14px;padding:14px;margin-bottom:10px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.06);border-radius:12px;cursor:pointer;transition:transform .12s,background .15s" onmouseenter="this.style.background='rgba(255,255,255,.07)'" onmouseleave="this.style.background='rgba(255,255,255,.04)'">
        <div style="font-size:24px;flex:0 0 auto">${a.icon}</div>
        <div style="flex:1 1 auto">
          <div style="font-weight:600;color:#fff;margin-bottom:4px">${escapeHtml(a.title)}</div>
          <div style="font-size:13px;color:var(--shallow);opacity:.85;line-height:1.5">${escapeHtml(a.summary)}</div>
        </div>
      </div>
    `).join('');
  } else {
    const a = EDU_ARTICLES.find(x => x.id === articleId);
    if(!a) return showEduScreen(null);
    list.style.display = 'none';
    detail.style.display = 'block';
    $('eduBack').style.display = 'inline-block';
    $('eduTitle').textContent = `${a.icon} ${a.title}`;
    detail.innerHTML = a.body;
  }
}

// ============== Partage bassin en lecture seule ==============
let _viewerMode = false;
let _viewerBassin = null;
let _viewerMeasurements = [];
let _viewerOwnerLabel = null;

function isViewerMode(){ return _viewerMode; }

// Cache de session des liens fraîchement créés/révoqués. Supabase a un délai de
// cohérence lecture-après-écriture : un SELECT lancé juste après l'INSERT ne voit
// pas encore la nouvelle ligne (elle n'apparaissait qu'après un refresh). On
// fusionne ce cache avec les résultats DB pour un affichage immédiat (dédup token).
let _recentShareLinks = [];

function generateShareToken(){
  const arr = new Uint8Array(9);
  crypto.getRandomValues(arr);
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  let token = '';
  for(const b of arr) token += alphabet[b % alphabet.length];
  return token;
}

async function createShareLink(bassinId){
  if(!_authUser){ toast('Connecte-toi pour partager ton bassin', 'warn'); return null; }
  const supa = getSupa();
  if(!supa) return null;
  const b = getBassinById(bassinId);
  if(!b){ toast('Bassin introuvable', 'err'); return null; }
  const token = generateShareToken();
  const { error } = await supa.from('cp_share_links').insert({
    token, owner_id: _authUser.id, bassin_id: bassinId, bassin_name: b.nom || 'Bassin',
  });
  if(error){ toast('Erreur création lien', 'err'); console.warn(error); return null; }
  // Renvoie la ligne complète (mêmes champs que listShareLinks) pour l'affichage
  // optimiste immédiat, sans attendre que le SELECT DB soit cohérent.
  return {
    token, bassin_id: bassinId, bassin_name: b.nom || 'Bassin',
    created_at: new Date().toISOString(), revoked_at: null,
    last_accessed_at: null, access_count: 0,
  };
}

async function listShareLinks(bassinId){
  if(!_authUser) return [];
  const supa = getSupa();
  if(!supa) return [];
  const { data, error } = await supa.from('cp_share_links')
    .select('token, bassin_id, bassin_name, created_at, revoked_at, last_accessed_at, access_count')
    .eq('owner_id', _authUser.id)
    .eq('bassin_id', bassinId)
    .order('created_at', { ascending: false });
  if(error){ console.warn(error); return []; }
  return data || [];
}

window.revokeShareLink = async function(token){
  if(!_authUser) return;
  const supa = getSupa();
  if(!supa) return;
  if(!confirm('Révoquer ce lien ? Il deviendra inaccessible immédiatement.')) return;
  const { error } = await supa.from('cp_share_links').update({ revoked_at: new Date().toISOString() }).eq('token', token);
  if(error){ toast('Erreur révocation', 'err'); console.warn(error); return; }
  // Reflète la révocation dans le cache de session (sinon un lien créé puis
  // révoqué dans la même session réapparaîtrait actif tant que la DB n'est pas
  // cohérente).
  const cached = _recentShareLinks.find(l => l.token === token);
  if(cached) cached.revoked_at = new Date().toISOString();
  toast('Lien révoqué', 'ok');
  renderShareLinksList();
};

function shareUrl(token){
  return `${window.location.origin}${window.location.pathname}?share=${token}`;
}

window.openShareModal = function(bassinId){
  if(!_authUser){
    if(confirm("Pour partager un lien de lecture seule, il faut un compte (gratuit, magic link). Te connecter maintenant ?")){
      openAccountLogin();
    }
    return;
  }
  const ov = document.getElementById('shareOverlay');
  if(!ov) return;
  ov.dataset.bassinId = bassinId || getActiveBassinId();
  ov.style.display = 'flex';
  renderShareLinksList();
};
window.closeShareModal = function(){
  const ov = document.getElementById('shareOverlay');
  if(ov) ov.style.display = 'none';
};

async function renderShareLinksList(){
  const ov = document.getElementById('shareOverlay');
  const body = document.getElementById('shareLinksList');
  if(!ov || !body) return;
  const bassinId = ov.dataset.bassinId;
  if(!bassinId){ body.innerHTML = '<div style="color:var(--shallow);opacity:.7">Aucun bassin sélectionné.</div>'; return; }
  const b = getBassinById(bassinId);
  const titleEl = document.getElementById('shareModalTitle');
  if(titleEl) titleEl.textContent = `Partager « ${b ? (b.emoji + ' ' + b.nom) : 'bassin'} »`;
  body.innerHTML = '<div style="color:var(--shallow);opacity:.7;font-size:13px;padding:12px 0">Chargement…</div>';
  const dbLinks = await listShareLinks(bassinId);
  // Fusionne les liens DB avec ceux créés/révoqués dans cette session que la DB
  // ne renvoie pas encore (délai de cohérence). La version DB prime si présente.
  const dbTokens = new Set(dbLinks.map(l => l.token));
  const pending = _recentShareLinks.filter(l => l.bassin_id === bassinId && !dbTokens.has(l.token));
  const links = [...pending, ...dbLinks].sort((a,b) => new Date(b.created_at) - new Date(a.created_at));
  if(!links.length){
    body.innerHTML = `<div style="text-align:center;color:var(--shallow);font-size:13px;padding:18px 0;line-height:1.55;opacity:.85">
      Aucun lien actif pour ce bassin.<br>
      <span style="opacity:.6;font-size:12px">Crée un lien pour partager une vue lecture seule de tes mesures et de ton historique.</span>
    </div>`;
    return;
  }
  body.innerHTML = links.map(l => {
    const isRevoked = !!l.revoked_at;
    const url = shareUrl(l.token);
    const meta = isRevoked
      ? `<span style="color:var(--coral)">Révoqué le ${new Date(l.revoked_at).toLocaleDateString('fr-FR')}</span>`
      : `${l.access_count || 0} accès${l.last_accessed_at ? ` · dernier ${relativeTime(l.last_accessed_at)}` : ''}`;
    return `<div style="padding:12px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,${isRevoked?'.04':'.10'});border-radius:12px;margin-bottom:8px;opacity:${isRevoked?'.55':'1'}">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
        <div style="flex:1;font-family:'JetBrains Mono',monospace;font-size:12px;color:var(--shallow);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(url)}</div>
        ${isRevoked ? '' : `<button class="btn-ghost" style="padding:4px 10px;font-size:12px;width:auto" onclick="copyShareLink('${l.token}')">📋 Copier</button>`}
      </div>
      <div style="display:flex;justify-content:space-between;align-items:center;font-size:11px;color:var(--shallow);opacity:.7">
        <span>${meta}</span>
        ${isRevoked ? '' : `<button class="btn-ghost" style="padding:2px 8px;font-size:11px;width:auto;color:var(--coral)" onclick="revokeShareLink('${l.token}')">Révoquer</button>`}
      </div>
    </div>`;
  }).join('');
}

window.copyShareLink = async function(token){
  const url = shareUrl(token);
  try {
    await navigator.clipboard.writeText(url);
    toast('Lien copié dans le presse-papier');
  } catch(e){
    prompt('Copie le lien :', url);
  }
};

window.createNewShareLink = async function(){
  const ov = document.getElementById('shareOverlay');
  if(!ov) return;
  const bassinId = ov.dataset.bassinId;
  if(!bassinId) return;
  const row = await createShareLink(bassinId);
  if(row){
    _recentShareLinks = _recentShareLinks.filter(l => l.token !== row.token);
    _recentShareLinks.unshift(row);
    toast('Lien créé');
    renderShareLinksList();
  }
};

// === Viewer mode (lecture seule via ?share=TOKEN) ===
async function checkShareMode(){
  const params = new URLSearchParams(window.location.search);
  const token = params.get('share');
  if(!token) return false;
  try{
    const resp = await fetch(`${SUPABASE_URL}/functions/v1/share-view?token=${encodeURIComponent(token)}`, {
      headers: { 'apikey': SUPABASE_KEY }
    });
    if(!resp.ok){
      const err = await resp.json().catch(() => ({}));
      showViewerError(err.error || `HTTP ${resp.status}`);
      return false;
    }
    const data = await resp.json();
    _viewerMode = true;
    _viewerBassin = data.bassin;
    _viewerMeasurements = (data.measurements || []).slice().sort((a, b) => new Date(b.date) - new Date(a.date));
    _viewerOwnerLabel = data.bassinName;
    document.body.classList.add('viewer-mode');
    showViewerBanner();
    return true;
  } catch(e){
    console.error('Share fetch failed', e);
    showViewerError('network');
    return false;
  }
}

function showViewerError(code){
  const map = {
    invalid_token: 'Lien invalide.',
    not_found: 'Lien introuvable.',
    revoked: 'Ce lien a été révoqué par son propriétaire.',
    bassin_missing: 'Bassin partagé supprimé.',
    network: 'Connexion impossible.',
  };
  const msg = map[code] || ('Erreur : ' + code);
  document.body.classList.add('viewer-error');
  const banner = document.createElement('div');
  banner.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:10000;padding:14px 20px;background:linear-gradient(135deg,#f87171,#ef4444);color:#fff;font-size:14px;line-height:1.5;display:flex;justify-content:space-between;align-items:center;gap:14px;box-shadow:0 2px 14px rgba(248,113,113,.4)';
  banner.innerHTML = `<div>🔒 <strong>Lien de partage indisponible</strong> — ${escapeHtml(msg)}</div><a href="?" style="color:#fff;text-decoration:underline;font-size:13px;font-weight:600">Aller à l'app</a>`;
  document.body.appendChild(banner);
}

function showViewerBanner(){
  const banner = document.createElement('div');
  banner.id = 'viewerBanner';
  banner.style.cssText = 'position:sticky;top:0;left:0;right:0;z-index:200;padding:12px 20px;background:linear-gradient(135deg,#0a3d62,#1d7a8c);color:#fff;font-size:13px;line-height:1.5;display:flex;justify-content:space-between;align-items:center;gap:14px;box-shadow:0 2px 12px rgba(10,61,98,.5)';
  banner.innerHTML = `<div>👁 <strong>Mode lecture seule</strong> — ${escapeHtml(_viewerOwnerLabel || 'Bassin partagé')} <span style="opacity:.7">(${_viewerMeasurements.length} mesures)</span></div><button onclick="exitViewerMode()" style="background:rgba(255,255,255,.15);color:#fff;border:1px solid rgba(255,255,255,.3);border-radius:8px;padding:6px 12px;font-size:12px;cursor:pointer;font-family:inherit">Quitter</button>`;
  document.body.insertBefore(banner, document.body.firstChild);
}

window.exitViewerMode = function(){
  const u = new URL(window.location.href);
  u.searchParams.delete('share');
  window.location.href = u.toString();
};

// === Overrides accesseurs bassins/mesures pour mode lecture seule ===
const _origGetBassinsVM = getBassins;
window.getBassins = function(){ return _viewerMode && _viewerBassin ? [_viewerBassin] : _origGetBassinsVM(); };
const _origGetActiveBassinIdVM = getActiveBassinId;
window.getActiveBassinId = function(){ return _viewerMode && _viewerBassin ? _viewerBassin.id : _origGetActiveBassinIdVM(); };
const _origLoadActiveMeasurementsVM = loadActiveMeasurements;
window.loadActiveMeasurements = function(){ return _viewerMode ? _viewerMeasurements.slice() : _origLoadActiveMeasurementsVM(); };

// ============== Mode Saisons (Hivernage / Remise en route) ==============
const SEASON_STATE_KEY = 'cp_season_state_v1';

const SEASON_HIVERNAGE_STEPS = [
  {title:"Choc chlore préventif", detail:"Effectue un choc chloré (Fcl 5-10 ppm) la veille pour décontaminer l'eau et stocker une réserve oxydante. Filtration 24 h avant de passer à l'étape suivante."},
  {title:"Ajuster pH et TAC", detail:"Le pH doit être stable entre 7.0 et 7.4 et le TAC entre 80 et 120 ppm. Un mauvais équilibre pendant l'hiver attaque les revêtements."},
  {title:"Lavage à contre-courant + nettoyage filtre", detail:"Lavage complet du filtre à sable (rinçage final inclus) ou démontage/nettoyage cartouche. Détartrer si entartré (acide chlorhydrique dilué)."},
  {title:"Baisser le niveau d'eau", detail:"Descends le niveau d'eau sous les buses de refoulement (typiquement 10-15 cm). Évite le gel des canalisations en cas d'hivernage passif."},
  {title:"Vidanger canalisations + équipements", detail:"Vide skimmers, canalisations, filtre, pompe. Soit par les bouchons de vidange, soit avec un compresseur. Toute eau résiduelle peut geler et fissurer."},
  {title:"Installer flotteurs antigel + bouchons", detail:"Place les flotteurs (gizmos) en diagonale dans le bassin pour absorber la pression du gel, et bouche les buses avec des bouchons d'hivernage."},
  {title:"Ajouter le produit d'hivernage", detail:"Verse un algicide longue durée (produit dédié hivernage) selon la dose préconisée par le volume. Brasse l'eau pour homogénéiser."},
  {title:"Couvrir la piscine", detail:"Pose une bâche d'hivernage ou couverture filet. Vérifie qu'elle est bien tendue pour éviter qu'elle ne touche l'eau."},
];

const SEASON_REMISE_STEPS = [
  {title:"Retirer la bâche + débris", detail:"Nettoie la bâche avant rangement (sèche-la). Retire feuilles et débris en surface au filet avant d'enlever les flotteurs."},
  {title:"Retirer flotteurs antigel + bouchons", detail:"Ôte les gizmos et bouchons d'hivernage. Inspecte qu'aucun joint n'est dégradé."},
  {title:"Compléter le niveau d'eau", detail:"Remets le niveau d'eau au milieu du skimmer. Si nécessaire, vidange une partie pour diluer si la conductivité a augmenté."},
  {title:"Filtration 24 h non-stop (2-3 jours)", detail:"Lance la pompe en continu pendant 48-72 h pour homogénéiser et oxygéner. Surveille bruit/débit anormaux."},
  {title:"Nettoyer/rincer le filtre", detail:"Lavage à contre-courant si filtre à sable. Démontage + nettoyage si cartouche. Remplace la cartouche si > 2 ans ou très encrassée."},
  {title:"Première analyse complète", detail:"Mesure pH, TAC, Fcl, CYA, T°. Le bassin a probablement dérivé pendant l'hiver — c'est normal."},
  {title:"Ajuster pH et TAC d'abord", detail:"Vise pH 7.2-7.4 et TAC 80-120 ppm. C'est la base avant tout chlore — sans bon équilibre, le chlore reste inefficace."},
  {title:"Choc chlore décontamination", detail:"Choc à 5-10 ppm Fcl pour éliminer la charge organique accumulée. Filtration 24 h après le choc."},
  {title:"Vérifier/compléter CYA", detail:"Si CYA < 25 ppm, ajoute du stabilisant (acide cyanurique) pour atteindre 25-30 ppm — sinon ton chlore sera détruit par les UV."},
  {title:"Re-mesurer 24-48 h après le choc", detail:"Contrôle que le Fcl est redescendu sous 3 ppm avant baignade. Si tout est aligné, ton bassin est prêt pour la saison."},
];

function getSeasonState(){
  const def = {hivernage:{year:0,completed:[],dismissedPromo:false},remise:{year:0,completed:[],dismissedPromo:false}};
  return Object.assign({}, def, loadJSON(SEASON_STATE_KEY, {}));
}
function saveSeasonState(s){ saveJSON(SEASON_STATE_KEY, s); }
function currentYear(){ return new Date().getFullYear(); }

function inHivernageWindow(){
  const m = new Date().getMonth(); // 0=jan
  return m === 9 || m === 10; // octobre + novembre
}
function inRemiseWindow(){
  const m = new Date().getMonth();
  return m === 2 || m === 3; // mars + avril
}

function toggleSeasonStep(mode, idx){
  const s = getSeasonState();
  if(s[mode].year !== currentYear()){ s[mode].year = currentYear(); s[mode].completed = []; }
  const i = s[mode].completed.indexOf(idx);
  if(i >= 0) s[mode].completed.splice(i, 1);
  else s[mode].completed.push(idx);
  saveSeasonState(s);
  renderSeasonModal(mode);
}

function dismissSeasonPromo(mode){
  const s = getSeasonState();
  s[mode].year = currentYear();
  s[mode].dismissedPromo = true;
  saveSeasonState(s);
  renderSeasonPromo();
}

function openSeasonGuide(mode){
  const ov = document.getElementById('seasonOverlay');
  if(!ov) return;
  ov.dataset.mode = mode || (inRemiseWindow() ? 'remise' : 'hivernage');
  ov.style.display = 'flex';
  renderSeasonModal(ov.dataset.mode);
}
function closeSeasonGuide(){
  const ov = document.getElementById('seasonOverlay');
  if(ov) ov.style.display = 'none';
}
function switchSeasonMode(mode){
  const ov = document.getElementById('seasonOverlay');
  if(ov) ov.dataset.mode = mode;
  renderSeasonModal(mode);
}

function renderSeasonModal(mode){
  const title = document.getElementById('seasonTitle');
  const tabs = document.getElementById('seasonTabs');
  const body = document.getElementById('seasonBody');
  if(!title || !tabs || !body) return;
  const steps = mode === 'remise' ? SEASON_REMISE_STEPS : SEASON_HIVERNAGE_STEPS;
  const state = getSeasonState();
  // Reset progress si année différente (changement d'année calendaire)
  if(state[mode].year !== currentYear()){
    state[mode].year = currentYear();
    state[mode].completed = [];
    saveSeasonState(state);
  }
  const completed = state[mode].completed || [];
  const total = steps.length;
  const done = completed.length;
  const pct = Math.round((done / total) * 100);
  title.textContent = mode === 'remise' ? '🌸 Remise en route' : '❄ Hivernage';
  tabs.innerHTML = `
    <button class="season-tab${mode==='hivernage'?' active':''}" onclick="switchSeasonMode('hivernage')">❄ Hivernage</button>
    <button class="season-tab${mode==='remise'?' active':''}" onclick="switchSeasonMode('remise')">🌸 Remise en route</button>
  `;
  const progressHtml = `
    <div style="margin-bottom:18px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;font-size:12px;color:var(--shallow);text-transform:uppercase;letter-spacing:.5px">
        <span>Progression</span><span>${done} / ${total}</span>
      </div>
      <div style="height:8px;background:rgba(255,255,255,.08);border-radius:4px;overflow:hidden">
        <div style="width:${pct}%;height:100%;background:linear-gradient(90deg,#5eead4,${mode==='remise'?'#fbbf24':'#a8d8ea'});transition:width .3s"></div>
      </div>
    </div>`;
  const stepsHtml = steps.map((step, i) => {
    const isDone = completed.includes(i);
    return `<div class="season-step${isDone?' done':''}" onclick="toggleSeasonStep('${mode}',${i})">
      <div class="season-step-check">${isDone ? '✓' : (i+1)}</div>
      <div class="season-step-body">
        <div class="season-step-title">${escapeHtml(step.title)}</div>
        <div class="season-step-detail">${escapeHtml(step.detail)}</div>
      </div>
    </div>`;
  }).join('');
  const completedAll = done === total;
  const footer = completedAll
    ? `<div style="margin-top:18px;padding:14px;background:rgba(94,234,212,.10);border:1px solid rgba(94,234,212,.30);border-radius:12px;font-size:13px;line-height:1.55;color:#a8f8e8;text-align:center">🎉 <strong>Bravo, tout est coché pour ${currentYear()} !</strong><br>Ton bassin est ${mode === 'remise' ? 'prêt pour la saison' : 'protégé pour l\'hiver'}.</div>`
    : `<div style="margin-top:14px;font-size:11px;color:var(--shallow);opacity:.55;line-height:1.5;text-align:center">Coche chaque étape au fur et à mesure — la progression est sauvegardée automatiquement pour cette année.</div>`;
  body.innerHTML = progressHtml + stepsHtml + footer;
}

function renderSeasonPromo(){
  const wrap = document.getElementById('seasonPromoCard');
  if(!wrap) return;
  const state = getSeasonState();
  let mode = null;
  if(inHivernageWindow()){
    const h = state.hivernage;
    if(h.year !== currentYear() || (!h.dismissedPromo && h.completed.length < SEASON_HIVERNAGE_STEPS.length)) mode = 'hivernage';
  } else if(inRemiseWindow()){
    const r = state.remise;
    if(r.year !== currentYear() || (!r.dismissedPromo && r.completed.length < SEASON_REMISE_STEPS.length)) mode = 'remise';
  }
  if(!mode){ wrap.style.display = 'none'; return; }
  const colors = mode === 'remise'
    ? {bg:'linear-gradient(135deg,rgba(251,191,36,.12),rgba(251,191,36,.04))', border:'rgba(251,191,36,.30)', icon:'🌸', accent:'#fbbf24'}
    : {bg:'linear-gradient(135deg,rgba(96,165,250,.12),rgba(96,165,250,.04))', border:'rgba(96,165,250,.30)', icon:'❄', accent:'#60a5fa'};
  const label = mode === 'remise' ? 'Remise en route' : 'Hivernage';
  const desc = mode === 'remise'
    ? "C'est la période idéale pour redémarrer le bassin — checklist guidée des 10 étapes pour repartir sans accroc."
    : "C'est le moment d'hiverner — checklist guidée des 8 étapes pour protéger ton bassin du gel.";
  wrap.style.display = 'block';
  wrap.style.background = colors.bg;
  wrap.style.border = `1px solid ${colors.border}`;
  wrap.innerHTML = `
    <div style="display:flex;align-items:center;gap:14px">
      <div style="font-size:32px">${colors.icon}</div>
      <div style="flex:1;cursor:pointer" onclick="openSeasonGuide('${mode}')">
        <div style="font-weight:600;color:#fff;margin-bottom:4px">${label} — checklist guidée</div>
        <div style="font-size:13px;color:var(--shallow);opacity:.85;line-height:1.5">${desc}</div>
      </div>
      <button onclick="dismissSeasonPromo('${mode}')" style="background:transparent;border:none;color:var(--shallow);opacity:.6;cursor:pointer;font-size:18px;padding:6px 10px;border-radius:8px" title="Masquer pour cette année">×</button>
    </div>`;
}

// ============== Wizard premier lancement ==============
function maybeOpenWizard(){
  // Premier lancement = aucun bassin créé (ni mesures)
  if(getBassins().length === 0 && !localStorage.getItem('cp_wizard_done')){
    // Crée un bassin par défaut, le wizard l'enrichira
    const b = createBassin({nom: 'Mon bassin', emoji: '🏡'});
    setActiveBassinId(b.id);
    setTimeout(openWizard, 400);
  }
}

function openWizard(){
  if(!$('wizardOverlay')) return;
  $('wizardOverlay').style.display = 'flex';
  showWizardStep(1);
}

function closeWizard(){
  $('wizardOverlay').style.display = 'none';
  localStorage.setItem('cp_wizard_done', '1');
}

function showWizardStep(n){
  [1,2].forEach(i => {
    const el = $('wizardStep'+i);
    if(el) el.style.display = i===n ? 'block' : 'none';
  });
  if($('wizardProgress')) $('wizardProgress').textContent = `${n}/2`;
}

function wizardStep1Next(){
  const v = num('wizVolume');
  if(v === null || v <= 0){ toast('Saisis un volume valide','warn'); return; }
  if($('volume')) $('volume').value = v;
  if($('cfgVolume')) $('cfgVolume').value = v;
  autoSaveBassinParams();
  showWizardStep(2);
}

function wizardSetMode(mode){
  if($('modeDesinf')) $('modeDesinf').value = mode;
  if($('cfgModeDesinf')) $('cfgModeDesinf').value = mode;
  autoSaveBassinParams();
  renderBassinSwitcher();
  closeWizard();
  toast('Configuration enregistrée — à toi de mesurer !');
}

// ============== Aides « ? » inline ==============
const HINTS = {
  volume: 'Volume d\'eau du bassin en m³. Calcule par L × l × profondeur moyenne, ou regarde la facture du pisciniste.',
  phMesure: 'pH = acidité de l\'eau. Cible 6.8–7.4 (idéal 7.2). Hors plage, le chlore devient inefficace ou irritant.',
  phSouhaite: 'pH que tu veux atteindre. 7.2 est le standard.',
  fcl: 'Chlore libre — la fraction active qui désinfecte. Cible ≈ 10 % du CYA (max 5 ppm en France).',
  tcl: 'Chlore total. Soustraction Tcl − Fcl = chloramines (chlore consommé). Si > 0,6, superchloration.',
  tacMesure: 'TAC = alcalinité totale, sert de tampon pour le pH. Le guide ne fixe pas de plage absolue : surveille la dérive du pH plutôt qu\'un nombre.',
  tacSouhaite: 'TAC visé. Démarre vers 80–100 ppm et ajuste selon la stabilité du pH dans le temps.',
  cya: 'Stabilisant (acide cyanurique). Protège le chlore du soleil. Idéal 15–20 ppm. Au-delà de 40, vidange partielle obligatoire — il ne s\'élimine que par dilution.',
  temp: 'Température de l\'eau. Sous 12 °C : plus de prolifération d\'algues. Coupe l\'électrolyseur sous 16 °C.',
  selMesure: 'Salinité en g/L. Cible 3–5 g/L selon ton électrolyseur (voir notice).',
  thMesure: 'Dureté de l\'eau (titre hydrotimétrique). > 22 °f → séquestrant calcaire conseillé.',
  phosphate: 'Phosphates en ppb. > 100 = source de nourriture pour les algues, ajoute de l\'anti-phosphate.',
  brome: 'Brome (alternative au chlore, spas). Cible 2–4 ppm.'
};

function setupHints(){
  document.querySelectorAll('.hint-trigger').forEach(el => el.remove());
  if(localStorage.getItem('cp_hints_enabled') === '0') return;
  Object.entries(HINTS).forEach(([id, text]) => {
    const el = $(id);
    if(!el) return;
    const field = el.closest('.field');
    const label = field ? field.querySelector('label') : null;
    if(!label) return;
    const btn = document.createElement('button');
    btn.className = 'hint-trigger';
    btn.type = 'button';
    btn.textContent = '?';
    btn.setAttribute('aria-label', 'Aide pour ' + label.textContent);
    btn.style.cssText = 'margin-left:6px;width:18px;height:18px;border:0;border-radius:50%;background:rgba(255,255,255,.12);color:var(--shallow);font-size:11px;font-weight:600;cursor:pointer;line-height:1;vertical-align:middle;padding:0';
    btn.onclick = (e) => { e.preventDefault(); toast(text, 'ok', 6500); };
    label.appendChild(btn);
  });
}

function toggleHints(e){
  const enabled = e.target.checked;
  localStorage.setItem('cp_hints_enabled', enabled ? '1' : '0');
  setupHints();
  toast(enabled ? 'Aides affichées' : 'Aides masquées');
}

// ============== Partage en image ==============
function getActionsTextList(m){
  const out = [];
  if(m.volume === null || m.volume === undefined) return out;

  if(m.ph !== null && m.phSouhaite !== null && m.phSouhaite !== undefined && m.ph > m.phSouhaite){
    const hcl = calcHcl(m.volume, m.ph, m.phSouhaite);
    out.push(`pH ${fmt(m.ph,1)} → ${fmt(m.phSouhaite,1)} · ${fmt(hcl,2)} L acide HCl`);
  }

  if(m.fcl !== null && m.cya !== null){
    const chl = calcJavelChloration(m.volume, m.fcl, m.cya);
    if(chl.litres > 0){
      out.push(`Chloration · ${fmt(chl.litres,2)} L Javel 9.6° (cible ${fmt(chl.fclVise,2)} ppm)`);
    }
  }

  if(m.fcl !== null && m.tcl !== null){
    const ccl = m.tcl - m.fcl;
    const sc = calcSuperchloration(m.volume, ccl);
    if(sc){
      out.push(`Superchloration · ${fmt(sc.javelL,2)} L Javel OU ${fmt(sc.hypocalciumG,0)} g hypocalcium`);
    }
  }

  if(m.tac !== null && m.tacSouhaite !== null && m.tacSouhaite !== undefined){
    const tp = calcTacPlus(m.volume, m.tac, m.tacSouhaite);
    if(tp){
      out.push(`TAC + · ${fmt(tp.totalG,0)} g (+${fmt(tp.delta,0)} ppm)`);
    }
  }

  if(m.sel !== null && m.sel !== undefined){
    const s = calcSel(m.volume, m.sel, m.selSouhaite ?? 4);
    if(s && s.action === 'ajout') out.push(`Sel · +${fmt(s.kg,1)} kg`);
    else if(s && s.action === 'dilution') out.push(`Sel trop élevé · vidange partielle`);
  }

  if(m.th !== null && m.th !== undefined){
    const ca = calcCalcium(m.volume, m.th, m.thSouhaite ?? 25);
    if(ca && ca.action === 'ajout') out.push(`Dureté · +${fmt(ca.gCaCl2,0)} g CaCl₂`);
    else if(ca && ca.action === 'haut') out.push(`TH trop élevé · diluer ou séquestrer`);
  }

  if(m.cya !== null && m.cya > 40){
    out.push(`CYA ${fmt(m.cya,0)} ppm > 40 · vidange partielle obligatoire`);
  }

  if(m.phosphate !== null && m.phosphate !== undefined && m.phosphate > 100){
    const p = calcAntiPhosphate(m.volume, m.phosphate);
    if(p && p.action === 'traiter') out.push(`Anti-phosphate · ${fmt(p.mL,0)} mL`);
  }

  if(m.modeDesinf === 'brome' && m.brome !== null && m.brome !== undefined){
    const br = calcBrome(m.volume, m.brome, 3);
    if(br && br.action === 'ajout') out.push(`Brome · +${fmt(br.grammes,0)} g BCDMH`);
    else if(br && br.action === 'haut') out.push(`Brome élevé · couper le brominateur`);
  }

  return out;
}

function shareControl(measurement, opts){
  opts = opts || {};
  const view = opts.view || 'both'; // 'measures' | 'actions' | 'both'
  const showMeasures = view === 'measures' || view === 'both';
  const showActions  = view === 'actions'  || view === 'both';

  const list = loadActiveMeasurements();
  if(list.length === 0 && !measurement){ toast('Aucune mesure à partager','warn'); return; }
  const m = measurement || list[list.length-1];
  const st = evaluateStatus(m);

  const W = 1080;
  const ccl = (m.fcl !== null && m.tcl !== null) ? (m.tcl - m.fcl) : null;
  const modeLabel = {chlore:'Chlore', sel:'Sel (électrolyse)', brome:'Brome'}[m.modeDesinf] || m.modeDesinf;
  // Mêmes champs et même filtrage que l'écran (renderHistEntryMeasurements) :
  // l'image partagée reflète exactement les mesures renseignées — cibles, volume
  // et mesures avancées (Sel/TH/Phosphates/Brome) inclus, champs vides masqués.
  const items = [
    {label:'pH mesuré',            value: m.ph!==null ? fmt(m.ph,1) : null},
    {label:'pH souhaité',          value: (m.phSouhaite!==null && m.phSouhaite!==undefined) ? fmt(m.phSouhaite,1) : null},
    {label:'Chlore libre (Fcl)',   value: m.fcl!==null ? fmt(m.fcl,2)+' ppm' : null},
    {label:'Chlore total (Tcl)',   value: m.tcl!==null ? fmt(m.tcl,2)+' ppm' : null},
    {label:'Chloramines (Ccl)',    value: ccl!==null ? fmt(ccl,2)+' ppm' : null},
    {label:'TAC mesuré',           value: m.tac!==null ? fmt(m.tac,0)+' ppm' : null},
    {label:'TAC visé',             value: (m.tacSouhaite!==null && m.tacSouhaite!==undefined) ? fmt(m.tacSouhaite,0)+' ppm' : null},
    {label:'CYA',                  value: m.cya!==null ? fmt(m.cya,0)+' ppm' : null},
    {label:'Volume du bassin',     value: m.volume!==null ? fmt(m.volume,1)+' m³' : null},
    {label:'Température',           value: (m.temp!==null && m.temp!==undefined) ? fmt(m.temp,1)+' °C' : null},
    {label:'Sel',                  value: (m.sel!==null && m.sel!==undefined) ? fmt(m.sel,2)+' g/L' : null},
    {label:'TH (dureté)',          value: (m.th!==null && m.th!==undefined) ? fmt(m.th,0)+' °f' : null},
    {label:'Phosphates',           value: (m.phosphate!==null && m.phosphate!==undefined) ? fmt(m.phosphate,0)+' ppb' : null},
    {label:'Brome',                value: (m.brome!==null && m.brome!==undefined) ? fmt(m.brome,1)+' ppm' : null},
    {label:'Mode de désinfection', value: modeLabel || null},
  ].filter(it => it.value !== null && it.value !== undefined && it.value !== 'null');
  const actions = getActionsTextList(m).slice(0, 6);
  const measuresStart = 400, measuresRowH = 95;
  const measuresEnd = showMeasures ? measuresStart + items.length * measuresRowH : measuresStart;
  const actionsHeaderY = showActions ? measuresEnd + (showMeasures ? 30 : 0) : measuresEnd;
  const actionsItemH = 70;
  const actionsCount = Math.max(actions.length, 1);
  const H = showActions
    ? actionsHeaderY + 60 + actionsCount * actionsItemH + 100
    : measuresEnd + 100;

  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  if(!ctx.roundRect){
    ctx.roundRect = function(x,y,w,h,r){
      this.moveTo(x+r,y); this.arcTo(x+w,y,x+w,y+h,r);
      this.arcTo(x+w,y+h,x,y+h,r); this.arcTo(x,y+h,x,y,r);
      this.arcTo(x,y,x+w,y,r); this.closePath();
    };
  }

  const grad = ctx.createLinearGradient(0,0,W,H);
  grad.addColorStop(0, '#0a3a5e');
  grad.addColorStop(1, '#062842');
  ctx.fillStyle = grad;
  ctx.fillRect(0,0,W,H);

  ctx.fillStyle = 'rgba(255,255,255,.06)';
  ctx.beginPath(); ctx.arc(W*0.85, 150, 220, 0, Math.PI*2); ctx.fill();
  ctx.beginPath(); ctx.arc(W*0.1, H - 100, 180, 0, Math.PI*2); ctx.fill();

  ctx.fillStyle = '#fff';
  ctx.font = '600 56px "Fraunces", serif';
  ctx.fillText('Mon contrôle', 80, 130);
  ctx.fillStyle = '#7fd4d2';
  ctx.font = 'italic 600 56px "Fraunces", serif';
  ctx.fillText('du jour', 80, 200);

  // Badge bassin en haut à droite (emoji + nom + couleur d'accent)
  const bassin = m.bassinId ? getBassinById(m.bassinId) : getActiveBassin();
  if(bassin){
    const badgeText = `${bassin.emoji || '🏊'}  ${bassin.nom}`;
    ctx.font = '600 28px "Manrope", sans-serif';
    const tw = ctx.measureText(badgeText).width;
    const padX = 22, padY = 14;
    const bw = tw + padX*2, bh = 50;
    const bx = W - 80 - bw, by = 110;
    ctx.fillStyle = (bassin.couleur || '#7fd4d2') + '22';
    ctx.strokeStyle = (bassin.couleur || '#7fd4d2') + '66';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.roundRect(bx, by, bw, bh, 25); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.textBaseline = 'middle';
    ctx.fillText(badgeText, bx + padX, by + bh/2 + 1);
    ctx.textBaseline = 'alphabetic';
  }

  const d = new Date(m.date);
  const dateStr = d.toLocaleDateString('fr-FR', {weekday:'long', day:'numeric', month:'long'});
  ctx.fillStyle = 'rgba(255,255,255,.6)';
  ctx.font = '400 26px "JetBrains Mono", monospace';
  ctx.fillText(dateStr, 80, 250);

  const statusColor = st.level === 'danger' ? '#ff7a7a' : st.level === 'warn' ? '#ffd76e' : '#7fd4a8';
  ctx.fillStyle = statusColor;
  ctx.font = '600 28px "Manrope", sans-serif';
  ctx.fillText('● ' + st.text, 80, 305);

  // Score santé du contrôle (sous le statut), si la fonctionnalité est activée
  if(isHealthScoreEnabled()){
    const hs = calcHealthScore(m);
    if(hs){
      ctx.font = '600 26px "Manrope", sans-serif';
      if(hs.insufficient){
        ctx.fillStyle = 'rgba(255,255,255,.55)';
        ctx.fillText('Score santé · données insuffisantes', 80, 352);
      } else {
        ctx.fillStyle = hs.color;
        ctx.fillText(`Score santé ${hs.score}/100 · ${hs.label}`, 80, 352);
      }
    }
  }

  if(showMeasures){
    items.forEach((it, i) => {
      const y = measuresStart + i*measuresRowH;
      ctx.fillStyle = 'rgba(255,255,255,.05)';
      ctx.beginPath(); ctx.roundRect(80, y, W - 160, measuresRowH - 15, 16); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,.6)';
      ctx.font = '500 22px "Manrope", sans-serif';
      ctx.fillText(it.label.toUpperCase(), 110, y + 32);
      ctx.fillStyle = '#fff';
      ctx.font = '600 38px "JetBrains Mono", monospace';
      ctx.textAlign = 'right';
      ctx.fillText(it.value, W - 110, y + 50);
      ctx.textAlign = 'left';
    });
  }

  if(showActions){
    ctx.fillStyle = '#7fd4d2';
    ctx.font = 'italic 600 40px "Fraunces", serif';
    ctx.fillText('Actions à suivre', 80, actionsHeaderY + 20);

    const actionsStart = actionsHeaderY + 50;
    if(actions.length === 0){
      ctx.fillStyle = 'rgba(127, 212, 168, .12)';
      ctx.beginPath(); ctx.roundRect(80, actionsStart, W - 160, actionsItemH - 10, 14); ctx.fill();
      ctx.fillStyle = '#7fd4a8';
      ctx.font = '600 26px "Manrope", sans-serif';
      ctx.fillText('✓  Aucune action requise', 110, actionsStart + 40);
    } else {
      actions.forEach((txt, i) => {
        const y = actionsStart + i * actionsItemH;
        ctx.fillStyle = 'rgba(255,255,255,.05)';
        ctx.beginPath(); ctx.roundRect(80, y, W - 160, actionsItemH - 10, 14); ctx.fill();
        ctx.fillStyle = '#ffd76e';
        ctx.font = '600 28px "Manrope", sans-serif';
        ctx.fillText('•', 110, y + 40);
        ctx.fillStyle = '#fff';
        ctx.font = '500 24px "Manrope", sans-serif';
        ctx.fillText(txt, 140, y + 40);
      });
    }
  }

  ctx.fillStyle = 'rgba(255,255,255,.5)';
  ctx.font = '500 22px "Manrope", sans-serif';
  ctx.fillText('chimie-piscine.vercel.app', 80, H - 50);

  canvas.toBlob(async (blob) => {
    if(!blob){ toast('Erreur génération image','warn'); return; }
    const file = new File([blob], `controle-piscine-${d.toISOString().slice(0,10)}.png`, {type:'image/png'});
    if(navigator.canShare && navigator.canShare({files:[file]})){
      try {
        await navigator.share({files:[file], title:'Mon contrôle piscine'});
        return;
      } catch(e) { if(e.name === 'AbortError') return; }
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = file.name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast('Image téléchargée');
  }, 'image/png');
}

// ============== Détail d'une mesure historique ==============
let __histDetailIdx = null;

function renderHistEntryMeasurements(m){
  const ccl = (m.fcl !== null && m.tcl !== null) ? (m.tcl - m.fcl) : null;
  const modeLabel = {chlore:'Chlore', sel:'Sel (électrolyse)', brome:'Brome'}[m.modeDesinf] || m.modeDesinf;
  const rows = [
    {label:'pH mesuré', value: m.ph !== null ? fmt(m.ph,1) : null},
    {label:'pH souhaité', value: m.phSouhaite !== null && m.phSouhaite !== undefined ? fmt(m.phSouhaite,1) : null},
    {label:'Chlore libre (Fcl)', value: m.fcl !== null ? fmt(m.fcl,2)+' ppm' : null},
    {label:'Chlore total (Tcl)', value: m.tcl !== null ? fmt(m.tcl,2)+' ppm' : null},
    {label:'Chloramines (Ccl)', value: ccl !== null ? fmt(ccl,2)+' ppm' : null},
    {label:'TAC mesuré', value: m.tac !== null ? fmt(m.tac,0)+' ppm' : null},
    {label:'TAC visé', value: m.tacSouhaite !== null && m.tacSouhaite !== undefined ? fmt(m.tacSouhaite,0)+' ppm' : null},
    {label:'CYA (stabilisant)', value: m.cya !== null ? fmt(m.cya,0)+' ppm' : null},
    {label:'Volume du bassin', value: m.volume !== null ? fmt(m.volume,1)+' m³' : null},
    {label:'Température', value: m.temp !== null && m.temp !== undefined ? fmt(m.temp,1)+' °C' : null},
    {label:'Sel', value: m.sel !== null && m.sel !== undefined ? fmt(m.sel,2)+' g/L' : null},
    {label:'TH (dureté)', value: m.th !== null && m.th !== undefined ? fmt(m.th,0)+' °f' : null},
    {label:'Phosphates', value: m.phosphate !== null && m.phosphate !== undefined ? fmt(m.phosphate,0)+' ppb' : null},
    {label:'Brome', value: m.brome !== null && m.brome !== undefined ? fmt(m.brome,1)+' ppm' : null},
    {label:'Mode de désinfection', value: modeLabel || null}
  ].filter(r => r.value !== null && r.value !== undefined && r.value !== 'null');
  // Score santé de CETTE mesure (en tête), si la fonctionnalité est activée.
  let scoreHTML = '';
  if(isHealthScoreEnabled()){
    const res = calcHealthScore(m);
    if(res) scoreHTML = `<div class="card" style="margin:0 0 14px">${healthScoreInnerHTML(res)}</div>`;
  }
  return scoreHTML + rows.map(r => `<div style="display:flex;justify-content:space-between;padding:10px 0;border-bottom:1px solid rgba(255,255,255,.07);font-size:13px;gap:10px">
    <span style="color:var(--shallow);opacity:.85">${r.label}</span>
    <span style="color:#fff;font-family:'JetBrains Mono',monospace;font-weight:500;text-align:right">${r.value}</span>
  </div>`).join('');
}

function openHistDetail(idx){
  const list = loadActiveMeasurements();
  const m = list[idx];
  if(!m) return;
  __histDetailIdx = idx;
  const d = new Date(m.date);
  const dateStr = d.toLocaleDateString('fr-FR', {weekday:'long', day:'numeric', month:'long', year:'numeric'});
  const timeStr = d.toLocaleTimeString('fr-FR', {hour:'2-digit', minute:'2-digit'});
  if($('histDetailTitle')) $('histDetailTitle').textContent = `${dateStr} · ${timeStr}`;
  if($('histDetailMeasure')) $('histDetailMeasure').innerHTML = renderHistEntryMeasurements(m);
  renderCorrections(m, $('histDetailActions'));
  switchHistTab('measure');
  $('histDetailOverlay').style.display = 'flex';
}

function closeHistDetail(){
  if($('histDetailOverlay')) $('histDetailOverlay').style.display = 'none';
  __histDetailIdx = null;
}

function switchHistTab(tab){
  const isM = tab === 'measure';
  if($('histDetailMeasure')) $('histDetailMeasure').style.display = isM ? 'block' : 'none';
  if($('histDetailActions')) $('histDetailActions').style.display = isM ? 'none' : 'block';
  const btnM = $('histTabMeasure'), btnA = $('histTabActions');
  if(btnM) btnM.style.background = isM ? 'var(--glass-strong)' : 'var(--glass)';
  if(btnA) btnA.style.background = isM ? 'var(--glass)' : 'var(--glass-strong)';
}

function shareHistEntry(){
  if(__histDetailIdx === null) return;
  const list = loadActiveMeasurements();
  const m = list[__histDetailIdx];
  if(!m) return;
  // Détecte l'onglet visible dans la modale pour ne partager que ce qui est à l'écran
  const measureVisible = $('histDetailMeasure') && $('histDetailMeasure').style.display !== 'none';
  shareControl(m, {view: measureVisible ? 'measures' : 'actions'});
}

// Remplit les champs du formulaire Mesure (+ miroirs Paramètres) à partir d'un
// objet mesure. Utilisé par "Recharger" (historique) ET le mode lecture seule
// (?share=TOKEN) — sans ça, readInputs() renvoie des null en mode viewer et les
// cartes pH/Chloration/Pouvoir désinfectant n'apparaissent pas.
function applyMeasurementToInputs(m){
  const fieldMap = {
    volume:'volume', phMesure:'ph', phSouhaite:'phSouhaite',
    fcl:'fcl', tcl:'tcl', tacMesure:'tac', tacSouhaite:'tacSouhaite',
    cya:'cya', cyaSouhaite:'cyaSouhaite', temp:'temp', selMesure:'sel', selSouhaite:'selSouhaite',
    thMesure:'th', thSouhaite:'thSouhaite', phosphate:'phosphate', brome:'brome'
  };
  Object.entries(fieldMap).forEach(([fieldId, key]) => {
    const el = $(fieldId);
    if(!el) return;
    const v = m[key];
    el.value = (v !== null && v !== undefined) ? v : '';
  });
  if($('modeDesinf') && m.modeDesinf) $('modeDesinf').value = m.modeDesinf;
  if($('cfgVolume')) $('cfgVolume').value = m.volume ?? '';
  if($('cfgPhSouhaite')) $('cfgPhSouhaite').value = m.phSouhaite ?? '';
  if($('cfgTacSouhaite')) $('cfgTacSouhaite').value = m.tacSouhaite ?? '';
  if($('cfgCya')) $('cfgCya').value = m.cya ?? '';
  if($('cfgCyaSouhaite')) $('cfgCyaSouhaite').value = m.cyaSouhaite ?? '';
}

function reloadHistEntry(){
  if(__histDetailIdx === null) return;
  const list = loadActiveMeasurements();
  const m = list[__histDetailIdx];
  if(!m) return;
  applyMeasurementToInputs(m);
  updateCclBadge(m);
  closeHistDetail();
  switchTab('mesure');
  toast('Valeurs chargées — vérifie et saisis tes nouvelles mesures');
}

// ============== Init ==============
document.addEventListener('DOMContentLoaded', ()=>{
  if($('appVersion')) $('appVersion').textContent = 'v' + APP_VERSION;
  // Migration multi-bassins (no-op si déjà fait) — DOIT s'exécuter avant loadLastInputs
  migrateToMultiBassinsIfNeeded();
  // Si un bassin existe, sa config prime sur lastInputs
  const activeB = getActiveBassin();
  if(activeB) applyBassinConfigToInputs(activeB);
  loadLastInputs();
  // Réapplique la config bassin actif après loadLastInputs (priorité bassin)
  if(activeB) applyBassinConfigToInputs(activeB);
  renderBassinSwitcher();
  loadReminders();
  renderHistory();
  renderTrends();
  renderBackupUI();
  updateLastControlInfo();
  renderWeatherCard();
  try{ renderSeasonPromo(); }catch(e){}

  if($('shareBtn')) $('shareBtn').addEventListener('click', () => shareControl());

  const hintsEnabled = localStorage.getItem('cp_hints_enabled') !== '0';
  if($('hintsToggle')){
    $('hintsToggle').checked = hintsEnabled;
    $('hintsToggle').addEventListener('change', toggleHints);
  }
  setupHints();

  // Mode lecture seule (?share=TOKEN) : on charge les données distantes AVANT
  // toute action dépendante de l'utilisateur (wizard, popups, sync auto).
  checkShareMode().then(isViewer => {
    if(isViewer){
      // Remplit le formulaire avec la dernière mesure partagée AVANT le rendu :
      // renderCorrections() lit readInputs() (le formulaire), pas la mesure. Sans
      // ça, ph/fcl/tac restaient null et seules les cartes basées sur le CYA/volume
      // locaux s'affichaient (cartes pH/Chloration/Chlore combiné/Pouvoir
      // désinfectant manquantes en lecture seule).
      try{
        const latest = loadActiveMeasurements()[0];
        if(latest){ applyMeasurementToInputs(latest); updateCclBadge(latest); }
      }catch(e){}
      // En mode viewer on bascule directement sur la page Doses (vue d'analyse)
      try{ switchTab('correction'); }catch(e){}
      try{ renderWeatherCard(); }catch(e){}
      try{ renderInsightsCard(); }catch(e){}
      try{ renderChloreProjectionCard(); }catch(e){}
      try{ renderHealthScoreCard(); }catch(e){}
      try{ renderCharts(); }catch(e){}
      return; // on s'arrête là — pas de wizard, pas de popup, pas de sync
    }
    maybeOpenWizard();
    try{ maybeShowReleaseNotes(); }catch(e){}
  });

  // Accès admin discret via #admin dans l'URL
  if(location.hash === '#admin') openAdmin();
  window.addEventListener('hashchange', ()=>{
    if(location.hash === '#admin') openAdmin();
  });

  // Met à jour le badge si données pré-saisies
  const m = readInputs();
  if(m.fcl!==null && m.tcl!==null) updateCclBadge(m);

  // Toggles "Champs avancés affichés" — init + listeners
  ['sel','th','phosphate','brome'].forEach(k => {
    const cb = $('optField_' + k);
    if(!cb) return;
    cb.checked = getOptionalFields()[k] !== false;
    cb.addEventListener('change', () => {
      setOptionalField(k, cb.checked);
      // Toggle manuel sur sel/brome → mémorise l'override pour ne pas être écrasé au prochain load
      if(k === 'sel' || k === 'brome') markOptionalFieldsManual();
    });
  });
  applyOptionalFieldsVisibility();

  // Mode désinfection (Mesure + Paramètres) → masque/affiche sel et brome
  // Change explicite : applique + reset le flag manuel. Au load (silent) : applique seulement
  // si pas d'override manuel enregistré.
  ['modeDesinf','cfgModeDesinf'].forEach(id => {
    const el = $(id);
    if(!el) return;
    el.addEventListener('change', () => applyModeFieldDefaults(el.value));
  });
  // Application initiale au chargement — sauf si l'utilisateur a manuellement
  // toggle un champ avancé depuis le dernier changement de mode.
  if(localStorage.getItem(OPT_MANUAL_KEY) !== '1'){
    applyModeFieldDefaults(getCurrentMode(), {silent:true});
  }

  // Toggle "Vue cockpit (PC)"
  const viewToggle = $('viewModeCockpit');
  if(viewToggle){
    viewToggle.checked = getDesktopViewMode() === 'cockpit';
    viewToggle.addEventListener('change', () => {
      setDesktopViewMode(viewToggle.checked ? 'cockpit' : 'standard');
    });
  }
  applyDesktopViewMode();

  // Toggle "Projection chlore"
  const projToggle = $('chloreProjectionToggle');
  if(projToggle){
    projToggle.checked = isChloreProjectionEnabled();
    projToggle.addEventListener('change', () => {
      localStorage.setItem(CHLORE_PROJECTION_ENABLED_KEY, projToggle.checked ? '1' : '0');
      renderChloreProjectionCard();
    });
  }

  // Toggle "Insights tendances"
  const insightsToggle = $('insightsToggle');
  if(insightsToggle){
    insightsToggle.checked = isInsightsEnabled();
    insightsToggle.addEventListener('change', () => {
      localStorage.setItem(INSIGHTS_ENABLED_KEY, insightsToggle.checked ? '1' : '0');
      renderInsightsCard();
    });
  }

  // Toggle "Score santé global"
  const healthToggle = $('healthScoreToggle');
  if(healthToggle){
    healthToggle.checked = isHealthScoreEnabled();
    healthToggle.addEventListener('change', () => {
      localStorage.setItem(HEALTH_SCORE_ENABLED_KEY, healthToggle.checked ? '1' : '0');
      renderHealthScoreCard();
    });
  }

  // Auto-save sur les paramètres bassin (debounced via input event)
  ['volume','phSouhaite','tacSouhaite','cya','cyaSouhaite','selSouhaite','thSouhaite'].forEach(id => {
    const el = $(id);
    if(el) el.addEventListener('input', autoSaveBassinParams);
  });
  if($('modeDesinf')) $('modeDesinf').addEventListener('change', autoSaveBassinParams);

  // === Plan C : aperçu live des doses (desktop split view) ===
  let _livePreviewTimer = null;
  function scheduleLivePreview(){
    if(_livePreviewTimer) clearTimeout(_livePreviewTimer);
    _livePreviewTimer = setTimeout(()=>{
      const target = $('liveCorrectionContent');
      if(target && typeof renderCorrections === 'function'){
        renderCorrections(readInputs(), target);
      }
    }, 180);
  }
  // Tous les inputs de mesure déclenchent le live preview
  ['volume','phMesure','phSouhaite','fcl','tcl','tacMesure','tacSouhaite','cya','cyaSouhaite',
   'temp','modeDesinf','selMesure','selSouhaite','thMesure','thSouhaite','phosphate','brome']
    .forEach(id => {
      const el = $(id);
      if(el){
        el.addEventListener('input', scheduleLivePreview);
        if(el.tagName === 'SELECT') el.addEventListener('change', scheduleLivePreview);
      }
    });
  // Filtration : rafraîchi par T°, volume, débit (et au chargement)
  ['temp','volume'].forEach(id => {
    const el = $(id);
    if(el) el.addEventListener('input', renderFiltration);
  });
  renderFiltration();
  // Render initial si données pré-saisies
  if(window.matchMedia && window.matchMedia('(min-width: 1000px)').matches){
    scheduleLivePreview();
  }
  const cfgMap = {cfgVolume:'volume',cfgPhSouhaite:'phSouhaite',cfgTacSouhaite:'tacSouhaite',cfgCya:'cya',cfgCyaSouhaite:'cyaSouhaite',cfgSelSouhaite:'selSouhaite',cfgThSouhaite:'thSouhaite'};
  Object.entries(cfgMap).forEach(([id, mainId]) => {
    const el = $(id);
    if(el) el.addEventListener('input', () => {
      const target = $(mainId);
      if(target) target.value = el.value;
      autoSaveBassinParams();
    });
  });
  if($('cfgModeDesinf')) $('cfgModeDesinf').addEventListener('change', () => {
    if($('modeDesinf')) $('modeDesinf').value = $('cfgModeDesinf').value;
    autoSaveBassinParams();
  });
  // cfgDebit n'a pas de miroir Mesure : déclenche juste la sauvegarde + live preview + filtration
  if($('cfgDebit')) $('cfgDebit').addEventListener('input', () => {
    autoSaveBassinParams();
    if(typeof scheduleLivePreview === 'function') scheduleLivePreview();
    if(typeof renderFiltration === 'function') renderFiltration();
  });

  // Vérifier permission notifications
  if('Notification' in window && Notification.permission === 'granted'){
    $('enableNotifBtn').textContent = 'Activées';
    $('enableNotifBtn').style.color = 'var(--leaf)';
    if($('testNotifBtn')) $('testNotifBtn').style.display = '';
  }
  if($('testNotifBtn')) $('testNotifBtn').addEventListener('click', testPushNotification);

  // Rafraîchit le "il y a X jours" toutes les minutes
  setInterval(updateLastControlInfo, 60000);

  // Si la permission a été révoquée côté navigateur, nettoyer le serveur
  if('Notification' in window && Notification.permission !== 'granted'){
    unsyncPushSubscription();
  } else {
    syncPushSubscription();
  }

  // Toast "nouvelle version" si un SW met à jour pendant la session
  if('serviceWorker' in navigator){
    let reloading = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if(reloading) return;
      reloading = true;
      location.reload();
    });
    const showUpdateToast = (waitingWorker) => {
      const t = $('toast');
      if(!t) return;
      t.innerHTML = 'Nouvelle version dispo · <button type="button" style="background:rgba(255,255,255,.15);color:#fff;border:0;padding:4px 10px;border-radius:8px;font:inherit;cursor:pointer">Recharger</button>';
      t.className = 'toast show';
      t.style.pointerEvents = 'auto';
      t.querySelector('button').addEventListener('click', () => {
        if(waitingWorker) waitingWorker.postMessage({type:'SKIP_WAITING'});
        else location.reload();
      });
    };
    navigator.serviceWorker.getRegistration().then(reg => {
      if(!reg) return;
      if(reg.waiting && navigator.serviceWorker.controller) showUpdateToast(reg.waiting);
      reg.addEventListener('updatefound', () => {
        const nw = reg.installing;
        if(!nw) return;
        nw.addEventListener('statechange', () => {
          if(nw.state === 'installed' && navigator.serviceWorker.controller) showUpdateToast(nw);
        });
      });
    });
  }
});

// ============== Theme mode (standard / spa / glass) ==============
const THEME_MODE_KEY = 'cp_theme_mode_v1';
const THEME_MODES = ['standard','spa','glass'];
function getThemeMode(){
  const v = localStorage.getItem(THEME_MODE_KEY);
  return THEME_MODES.includes(v) ? v : 'standard';
}
function setThemeMode(m){
  m = THEME_MODES.includes(m) ? m : 'standard';
  localStorage.setItem(THEME_MODE_KEY, m);
  document.body.classList.remove('theme-spa','theme-glass');
  if(m === 'spa') document.body.classList.add('theme-spa');
  else if(m === 'glass') document.body.classList.add('theme-glass');
}

// ============== Eyebrow date (mode spa uniquement) ==============
document.addEventListener('DOMContentLoaded', () => {
  // Sélecteur de thème dans Rappels → Apparence
  const sel = document.getElementById('themeModeSelect');
  if(sel){
    sel.value = getThemeMode();
    sel.addEventListener('change', () => setThemeMode(sel.value));
  }
  // Eyebrow date (toutes pages — le CSS le masque en mode standard)
  const eb = document.getElementById('todayEyebrow');
  if(!eb) return;
  function refreshEyebrow(){
    const now = new Date();
    const days = ['Dimanche','Lundi','Mardi','Mercredi','Jeudi','Vendredi','Samedi'];
    const day = days[now.getDay()];
    const h = String(now.getHours()).padStart(2,'0');
    const m = String(now.getMinutes()).padStart(2,'0');
    eb.textContent = `${day} · ${h} h ${m}`;
  }
  refreshEyebrow();
  setInterval(refreshEyebrow, 60_000);
});

// ============== Compte & sync multi-appareils (Supabase Auth) ==============
// Sans compte : app 100% locale (comportement historique inchangé).
// Avec compte : config piscine + historique + rappels + préférences synchronisés via Supabase.
const SYNC_DEBOUNCE_MS = 1500;
const ACCOUNT_LAST_PULL_KEY = 'cp_last_pull_v1';
const SUPA_AUTH_STORAGE_KEY = 'cp_sb_auth_v1';

const SYNCABLE_KEYS = new Set([
  STORAGE_KEYS.measurements,
  STORAGE_KEYS.bassins,
  STORAGE_KEYS.activeBassin,
  STORAGE_KEYS.reminders,
  STORAGE_KEYS.optionalFields,
  STORAGE_KEYS.lastInputs,
  'cp_theme_mode_v1',
  'cp_hist_metrics_v1',
  'cp_desktop_view_v1',
  'cp_chlore_projection_enabled_v1',
  'cp_insights_enabled_v1',
  'cp_season_state_v1',
  'cp_health_score_enabled_v1',
]);

let _supa = null;
let _authUser = null;
let _syncTimer = null;
let _isPulling = false;
let _initialSyncDone = false;
// Refs aux setters originaux capturés AVANT patching pour les écritures internes
const _rawSetItem = localStorage.setItem.bind(localStorage);
const _rawRemoveItem = localStorage.removeItem.bind(localStorage);
const _rawSaveJSON = saveJSON;

function getSupa(){
  if(_supa) return _supa;
  if(!window.supabase || !window.supabase.createClient) return null;
  _supa = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: {
      persistSession: true,
      detectSessionInUrl: true,
      autoRefreshToken: true,
      storageKey: SUPA_AUTH_STORAGE_KEY,
    }
  });
  return _supa;
}

function updateSyncBadge(state){
  const badge = document.getElementById('accountSyncBadge');
  if(!badge) return;
  if(!state){ badge.style.display = 'none'; return; }
  badge.style.display = 'inline-flex';
  badge.className = 'sync-badge' + (state === 'syncing' ? ' syncing' : state === 'error' ? ' error' : '');
  badge.textContent = state === 'syncing' ? 'Sync…' : state === 'error' ? 'Erreur' : 'À jour';
}

function updateAccountUI(){
  const out = document.getElementById('accountLoggedOut');
  const panel = document.getElementById('accountLoggedIn');
  if(!out || !panel) return;
  if(_authUser){
    out.style.display = 'none';
    panel.style.display = '';
    const emailEl = document.getElementById('accountEmail');
    if(emailEl) emailEl.textContent = _authUser.email || '';
    const av = document.getElementById('accountAvatar');
    if(av) av.textContent = (_authUser.email || '?').slice(0,1).toUpperCase();
    const last = localStorage.getItem(ACCOUNT_LAST_PULL_KEY);
    const status = document.getElementById('accountSyncStatus');
    if(status){
      status.textContent = last
        ? `Dernière synchro : ${relativeTime(last)}`
        : 'Synchronisation initiale en cours…';
    }
  } else {
    out.style.display = '';
    panel.style.display = 'none';
    updateSyncBadge(null);
  }
}

// === Handlers UI ===
window.openAccountLogin = function(){
  const ov = document.getElementById('accountLoginOverlay');
  if(!ov) return;
  ov.style.display = 'flex';
  document.getElementById('accountLoginStep1').style.display = '';
  document.getElementById('accountLoginStep2').style.display = 'none';
  const inp = document.getElementById('accountLoginEmail');
  if(inp) setTimeout(()=>inp.focus(), 50);
};
window.closeAccountLogin = function(){
  const ov = document.getElementById('accountLoginOverlay');
  if(ov) ov.style.display = 'none';
};

window.sendMagicLink = async function(){
  const inp = document.getElementById('accountLoginEmail');
  const btn = document.getElementById('accountLoginSubmit');
  if(!inp || !btn) return;
  const email = inp.value.trim();
  if(!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){
    toast('Email invalide', 'warn');
    return;
  }
  btn.disabled = true;
  btn.textContent = 'Envoi…';
  try{
    const supa = getSupa();
    if(!supa) throw new Error('Supabase SDK non chargé');
    const { error } = await supa.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: window.location.origin + window.location.pathname }
    });
    if(error) throw error;
    document.getElementById('accountLoginStep1').style.display = 'none';
    document.getElementById('accountLoginStep2').style.display = '';
  }catch(err){
    console.warn('Magic link failed', err);
    toast("Impossible d'envoyer le lien : " + (err.message || 'erreur réseau'), 'err', 3500);
  }finally{
    btn.disabled = false;
    btn.textContent = 'Recevoir le lien magique';
  }
};

window.accountLogout = async function(){
  if(!confirm('Te déconnecter ? Tes données restent sur cet appareil.')) return;
  const supa = getSupa();
  if(supa){ try{ await supa.auth.signOut(); }catch(e){} }
  _authUser = null;
  _initialSyncDone = false;
  _rawRemoveItem(ACCOUNT_LAST_PULL_KEY);
  updateAccountUI();
  toast('Déconnecté', 'ok');
};

window.forceSyncNow = async function(){
  if(!_authUser){ toast("Connecte-toi d'abord", 'warn'); return; }
  await syncPushAll();
  await syncPullAll();
  toast('Synchronisation terminée', 'ok');
};

// === Sync layer ===
function scheduleSyncPush(){
  if(!_authUser || !_initialSyncDone || _isPulling) return;
  if(_syncTimer) clearTimeout(_syncTimer);
  _syncTimer = setTimeout(() => { syncPushAll().catch(()=>{}); }, SYNC_DEBOUNCE_MS);
}

function collectConfigPayload(){
  return {
    bassins: loadJSON(STORAGE_KEYS.bassins, []),
    active_bassin_id: localStorage.getItem(STORAGE_KEYS.activeBassin) || null,
    last_inputs: loadJSON(STORAGE_KEYS.lastInputs, null),
  };
}
function collectPrefsPayload(){
  return {
    theme: localStorage.getItem('cp_theme_mode_v1') || null,
    hist_metrics: loadJSON('cp_hist_metrics_v1', null),
    desktop_view: localStorage.getItem('cp_desktop_view_v1') || null,
    optional_fields: loadJSON(STORAGE_KEYS.optionalFields, null),
    chlore_projection_enabled: localStorage.getItem('cp_chlore_projection_enabled_v1'),
    insights_enabled: localStorage.getItem('cp_insights_enabled_v1'),
    season_state: loadJSON('cp_season_state_v1', null),
    health_score_enabled: localStorage.getItem('cp_health_score_enabled_v1'),
  };
}

// Helper : fusionne deux listes de bassins en préservant le geo. Le geo est
// "sticky" — une fois positionné, on ne le perd plus à cause d'un appareil
// qui n'aurait pas la valeur en local. Source = la liste à enrichir, ref = celle qui peut
// contenir un geo manquant dans source.
function mergeBassinsPreservingGeo(source, ref){
  if(!Array.isArray(source) || !Array.isArray(ref)) return source || [];
  return source.map(b => {
    if(!b || !b.id) return b;
    const hasGeo = b.config && b.config.geo && b.config.geo.lat != null;
    if(hasGeo) return b;
    const r = ref.find(x => x && x.id === b.id);
    if(r && r.config && r.config.geo && r.config.geo.lat != null){
      return { ...b, config: { ...(b.config || {}), geo: r.config.geo } };
    }
    return b;
  });
}

async function syncPushAll(){
  if(!_authUser) return;
  const supa = getSupa();
  if(!supa) return;
  updateSyncBadge('syncing');
  try{
    const uid = _authUser.id;
    const nowIso = new Date().toISOString();
    // Récupère la version cloud des bassins pour préserver geo (et éviter le wipe d'une donnée
    // que le device courant n'aurait pas pour une raison X).
    let payload = collectConfigPayload();
    try{
      const { data: cloudCfg } = await supa.from('cp_pool_config').select('data').eq('user_id', uid).maybeSingle();
      const cloudBassins = (cloudCfg && cloudCfg.data && cloudCfg.data.bassins) || [];
      const mergedBassins = mergeBassinsPreservingGeo(payload.bassins, cloudBassins);
      if(JSON.stringify(mergedBassins) !== JSON.stringify(payload.bassins)){
        _rawSetItem(STORAGE_KEYS.bassins, JSON.stringify(mergedBassins));
        payload = { ...payload, bassins: mergedBassins };
      }
    }catch(e){ console.warn('Geo preservation read failed', e); }
    await supa.from('cp_pool_config').upsert({ user_id: uid, data: payload, updated_at: nowIso });
    await supa.from('cp_preferences').upsert({ user_id: uid, data: collectPrefsPayload(), updated_at: nowIso });
    await supa.from('cp_reminders').upsert({ user_id: uid, data: loadJSON(STORAGE_KEYS.reminders, {}), updated_at: nowIso });
    const localMeasures = loadJSON(STORAGE_KEYS.measurements, []);
    if(localMeasures.length){
      const rows = localMeasures.filter(m => m && m.date).map(m => ({
        user_id: uid,
        measured_at: m.date,
        data: m,
        updated_at: nowIso,
      }));
      for(let i=0; i<rows.length; i+=100){
        const { error } = await supa.from('cp_measurements').upsert(rows.slice(i, i+100), { onConflict: 'user_id,measured_at' });
        if(error) throw error;
      }
    }
    _rawSetItem(ACCOUNT_LAST_PULL_KEY, nowIso);
    updateSyncBadge('ok');
    updateAccountUI();
  }catch(err){
    console.warn('Sync push failed', err);
    updateSyncBadge('error');
  }
}

async function syncPullAll(){
  if(!_authUser) return;
  const supa = getSupa();
  if(!supa) return;
  _isPulling = true;
  updateSyncBadge('syncing');
  try{
    const uid = _authUser.id;
    const [cfg, prefs, rem, meas] = await Promise.all([
      supa.from('cp_pool_config').select('data, updated_at').eq('user_id', uid).maybeSingle(),
      supa.from('cp_preferences').select('data, updated_at').eq('user_id', uid).maybeSingle(),
      supa.from('cp_reminders').select('data, updated_at').eq('user_id', uid).maybeSingle(),
      supa.from('cp_measurements').select('measured_at, data, updated_at').eq('user_id', uid),
    ]);
    if(cfg.data && cfg.data.data){
      const d = cfg.data.data;
      if(Array.isArray(d.bassins)){
        // Sticky geo : si le cloud a un bassin sans geo mais local en a un, on garde le local
        const localBassins = loadJSON(STORAGE_KEYS.bassins, []);
        const merged = mergeBassinsPreservingGeo(d.bassins, localBassins);
        _rawSetItem(STORAGE_KEYS.bassins, JSON.stringify(merged));
      }
      if(d.active_bassin_id) _rawSetItem(STORAGE_KEYS.activeBassin, d.active_bassin_id);
      if(d.last_inputs) _rawSetItem(STORAGE_KEYS.lastInputs, JSON.stringify(d.last_inputs));
    }
    if(prefs.data && prefs.data.data){
      const d = prefs.data.data;
      if(d.theme){ _rawSetItem('cp_theme_mode_v1', d.theme); if(typeof setThemeMode === 'function') setThemeMode(d.theme); }
      if(d.hist_metrics) _rawSetItem('cp_hist_metrics_v1', JSON.stringify(d.hist_metrics));
      if(d.desktop_view) _rawSetItem('cp_desktop_view_v1', d.desktop_view);
      if(d.optional_fields) _rawSetItem(STORAGE_KEYS.optionalFields, JSON.stringify(d.optional_fields));
      if(d.chlore_projection_enabled === '0' || d.chlore_projection_enabled === '1') _rawSetItem('cp_chlore_projection_enabled_v1', d.chlore_projection_enabled);
      if(d.insights_enabled === '0' || d.insights_enabled === '1') _rawSetItem('cp_insights_enabled_v1', d.insights_enabled);
      if(d.season_state && typeof d.season_state === 'object') _rawSetItem('cp_season_state_v1', JSON.stringify(d.season_state));
      if(d.health_score_enabled === '0' || d.health_score_enabled === '1') _rawSetItem('cp_health_score_enabled_v1', d.health_score_enabled);
    }
    if(rem.data && rem.data.data && Object.keys(rem.data.data).length){
      _rawSetItem(STORAGE_KEYS.reminders, JSON.stringify(rem.data.data));
    }
    if(meas.data && meas.data.length){
      // Merge dédupliqué par date (cloud gagne pour mêmes dates)
      const local = loadJSON(STORAGE_KEYS.measurements, []);
      const byKey = new Map();
      local.forEach(m => { if(m && m.date) byKey.set(m.date, m); });
      meas.data.forEach(row => {
        const m = row.data;
        const k = (m && m.date) || row.measured_at;
        if(k) byKey.set(k, m);
      });
      const merged = Array.from(byKey.values()).sort((a,b) => new Date(b.date).getTime() - new Date(a.date).getTime());
      _rawSetItem(STORAGE_KEYS.measurements, JSON.stringify(merged));
    }
    const nowIso = new Date().toISOString();
    _rawSetItem(ACCOUNT_LAST_PULL_KEY, nowIso);
    updateSyncBadge('ok');
    updateAccountUI();
    // Re-render des vues qui dépendent des données rechargées
    try{ if(typeof loadLastInputs === 'function') loadLastInputs(); }catch(e){}
    try{ if(typeof renderHistory === 'function') renderHistory(); }catch(e){}
    try{ if(typeof renderCharts === 'function') renderCharts(); }catch(e){}
    try{ if(typeof applyOptionalFieldsVisibility === 'function') applyOptionalFieldsVisibility(); }catch(e){}
  }catch(err){
    console.warn('Sync pull failed', err);
    updateSyncBadge('error');
  }finally{
    _isPulling = false;
  }
}

// === Wrappers d'écriture : déclenchent push après chaque save syncable ===
window.saveJSON = function(key, val){
  _rawSaveJSON(key, val);
  if(SYNCABLE_KEYS.has(key)) scheduleSyncPush();
};
localStorage.setItem = function(key, val){
  _rawSetItem(key, val);
  if(SYNCABLE_KEYS.has(key)) scheduleSyncPush();
};
localStorage.removeItem = function(key){
  _rawRemoveItem(key);
  if(SYNCABLE_KEYS.has(key)) scheduleSyncPush();
};

// === Modale premier login (merge ou écrase) ===
let _pendingMergeResolve = null;
function showMergeModal(stats){
  const ov = document.getElementById('accountMergeOverlay');
  const box = document.getElementById('accountMergeStats');
  if(box){
    const lines = [
      `${stats.measurements} mesure${stats.measurements>1?'s':''} dans l'historique`,
      `${stats.bassins} bassin${stats.bassins>1?'s':''} configuré${stats.bassins>1?'s':''}`,
      stats.hasReminders ? 'Rappels configurés' : 'Pas de rappels',
    ];
    box.innerHTML = '<strong>Sur cet appareil :</strong><br>• ' + lines.join('<br>• ');
  }
  if(ov) ov.style.display = 'flex';
  return new Promise(res => { _pendingMergeResolve = res; });
}
window.resolveMergeChoice = function(choice){
  const ov = document.getElementById('accountMergeOverlay');
  if(ov) ov.style.display = 'none';
  if(_pendingMergeResolve){ _pendingMergeResolve(choice); _pendingMergeResolve = null; }
};

// Persiste à travers les déconnexions : marque qu'un user_id donné a déjà
// résolu son choix de fusion sur cet appareil. Skip la modale si match.
const ACCOUNT_LAST_USER_KEY = 'cp_last_synced_user_v1';

async function handleFirstLogin(){
  const supa = getSupa();
  if(!supa) return;
  const uid = _authUser.id;

  // Si cet appareil a déjà été initialisé pour ce user, on saute la modale
  // de fusion et on fait juste un pull silencieux pour récupérer les nouveautés.
  if(localStorage.getItem(ACCOUNT_LAST_USER_KEY) === uid){
    await syncPullAll();
    _initialSyncDone = true;
    return;
  }

  const localMeasures = loadJSON(STORAGE_KEYS.measurements, []);
  const localBassins = loadJSON(STORAGE_KEYS.bassins, []);
  const localReminders = loadJSON(STORAGE_KEYS.reminders, null);
  const hasLocal = (localMeasures && localMeasures.length > 0) || (localBassins && localBassins.length > 0);
  let hasCloud = false;
  try{
    const { count } = await supa.from('cp_measurements').select('*', { count: 'exact', head: true }).eq('user_id', uid);
    if(count && count > 0) hasCloud = true;
    if(!hasCloud){
      const { data: cfg } = await supa.from('cp_pool_config').select('data').eq('user_id', uid).maybeSingle();
      if(cfg && cfg.data && Array.isArray(cfg.data.bassins) && cfg.data.bassins.length) hasCloud = true;
    }
  }catch(err){ console.warn('Cloud probe failed', err); }
  if(hasLocal && hasCloud){
    const choice = await showMergeModal({
      measurements: localMeasures.length,
      bassins: localBassins.length,
      hasReminders: !!localReminders,
    });
    if(choice === 'import'){
      _initialSyncDone = true;
      await syncPushAll();
      await syncPullAll();
    } else {
      // Backup des données locales irréversibles (geo des bassins) avant écrasement
      const geoBackup = {};
      localBassins.forEach(b => { if(b && b.id && b.config && b.config.geo) geoBackup[b.id] = b.config.geo; });
      [STORAGE_KEYS.measurements, STORAGE_KEYS.bassins, STORAGE_KEYS.activeBassin, STORAGE_KEYS.reminders,
       STORAGE_KEYS.optionalFields, STORAGE_KEYS.lastInputs, 'cp_theme_mode_v1', 'cp_hist_metrics_v1',
       'cp_desktop_view_v1'].forEach(k => _rawRemoveItem(k));
      await syncPullAll();
      // Restaure le geo pour les bassins qui matchent par id (le cloud les a peut-être sans geo)
      if(Object.keys(geoBackup).length){
        const newBassins = loadJSON(STORAGE_KEYS.bassins, []);
        let restored = false;
        newBassins.forEach(b => {
          if(b && b.id && geoBackup[b.id] && (!b.config.geo)){
            b.config.geo = geoBackup[b.id];
            restored = true;
          }
        });
        if(restored){
          _rawSetItem(STORAGE_KEYS.bassins, JSON.stringify(newBassins));
          await syncPushAll();
        }
      }
      _initialSyncDone = true;
    }
  } else if(hasLocal && !hasCloud){
    _initialSyncDone = true;
    await syncPushAll();
  } else {
    await syncPullAll();
    _initialSyncDone = true;
  }

  _rawSetItem(ACCOUNT_LAST_USER_KEY, uid);
}

// === Bootstrap session au chargement ===
document.addEventListener('DOMContentLoaded', async () => {
  if(new URLSearchParams(window.location.search).has('share')) return; // mode viewer : pas de sync auth
  const supa = getSupa();
  if(!supa){ console.warn('Supabase SDK indisponible — sync désactivé'); return; }
  try{
    const { data: { session } } = await supa.auth.getSession();
    if(session && session.user){
      _authUser = session.user;
      updateAccountUI();
      handleFirstLogin().catch(err => console.warn('First-login failed', err));
    } else {
      updateAccountUI();
    }
  }catch(e){ console.warn('getSession failed', e); }

  supa.auth.onAuthStateChange((event, session) => {
    const wasLoggedIn = !!_authUser;
    _authUser = (session && session.user) || null;
    updateAccountUI();
    if(_authUser && !wasLoggedIn){
      handleFirstLogin().catch(err => console.warn('First-login failed', err));
      closeAccountLogin();
      toast('Connecté en tant que ' + _authUser.email, 'ok');
    }
  });

  // Popup d'info sync (one-shot, opt-out persistant)
  if(!_viewerMode) setTimeout(maybeShowSyncPromo, 2500);
});

// ============== Release notes (popup nouveautés par version) ==============
const RELEASE_NOTES_KEY = 'cp_release_notes_seen_v1';

const RELEASE_NOTES = [
  {
    version: '1.21.0',
    icon: '🔗',
    color: '#7fd4d2',
    title: 'Partage de bassin en lecture seule',
    body: "Génère un lien public à envoyer à un pisciniste, un copain ou un forum — la personne voit ton historique et tes analyses mais ne peut rien modifier. Bouton 🔗 dans le bassin switcher en haut, ou Paramètres → Bassin → Partager.",
  },
  {
    version: '1.20.0',
    icon: '💯',
    color: '#a8d8ea',
    title: 'Score santé global du bassin',
    body: "Une jauge 0-100 en haut de la page Doses, calculée depuis pH, Cl libre, TAC, CYA et LSI pondérés. Verdict instantané (Excellent / Bon / Correct / À surveiller / Urgent) + breakdown par paramètre.",
  },
  {
    version: '1.17.0',
    icon: '🔮',
    color: '#a78bfa',
    title: 'Projection chlore via météo locale',
    body: "Une carte sur la page Doses qui prédit l'évolution de ton Fcl sur 3 jours en croisant ta vitesse de consommation historique et la météo prévisionnelle Open-Meteo. Recommande une dose préventive si ton chlore risque de chuter sous la cible.",
  },
  {
    version: '1.16.0',
    icon: '🪄',
    color: '#fbbf24',
    title: 'Compte avec sauvegarde Supabase',
    body: "Connecte-toi par lien magique (aucun mot de passe à retenir) pour synchroniser ton bassin, ton historique, tes rappels et tes préférences entre tous tes appareils. 100% optionnel — l'app reste utilisable sans compte comme avant.",
  },
];

function compareVersions(a, b){
  const pa = (a || '0.0.0').split('.').map(Number);
  const pb = (b || '0.0.0').split('.').map(Number);
  for(let i = 0; i < Math.max(pa.length, pb.length); i++){
    const va = pa[i] || 0, vb = pb[i] || 0;
    if(va < vb) return -1;
    if(va > vb) return 1;
  }
  return 0;
}

function getUnseenReleaseNotes(){
  const seen = localStorage.getItem(RELEASE_NOTES_KEY);
  return RELEASE_NOTES.filter(n => !seen || compareVersions(n.version, seen) > 0);
}

function maybeShowReleaseNotes(){
  if(_viewerMode) return;
  if(getBassins().length === 0) return;
  const unseen = getUnseenReleaseNotes();
  if(unseen.length === 0) return;
  setTimeout(() => openReleaseNotes(unseen), 1200);
}

function _hexToRgbStr(hex){
  if(!hex || hex[0] !== '#') return '255,255,255';
  const h = hex.replace('#','');
  const r = parseInt(h.substr(0,2), 16);
  const g = parseInt(h.substr(2,2), 16);
  const b = parseInt(h.substr(4,2), 16);
  return `${r},${g},${b}`;
}

window.openReleaseNotes = function(notes){
  const ov = document.getElementById('releaseNotesOverlay');
  const list = document.getElementById('releaseNotesList');
  if(!ov || !list) return;
  notes = notes || RELEASE_NOTES;
  list.innerHTML = notes.map(n => {
    const rgb = _hexToRgbStr(n.color);
    return `<div style="display:flex;gap:12px;padding:14px;margin-bottom:10px;background:rgba(${rgb},.06);border:1px solid rgba(${rgb},.18);border-radius:12px">
      <div style="font-size:28px;flex:0 0 auto;line-height:1">${n.icon}</div>
      <div style="flex:1;min-width:0">
        <div style="font-weight:600;color:#fff;margin-bottom:4px;font-size:14px">${escapeHtml(n.title)}</div>
        <div style="font-size:13px;color:var(--shallow);line-height:1.55">${escapeHtml(n.body)}</div>
      </div>
    </div>`;
  }).join('');
  ov.style.display = 'flex';
};

window.closeReleaseNotes = function(){
  const ov = document.getElementById('releaseNotesOverlay');
  if(ov) ov.style.display = 'none';
  try{ _rawSetItem(RELEASE_NOTES_KEY, APP_VERSION); }catch(e){}
};

window.showAllReleaseNotes = function(){
  openReleaseNotes(RELEASE_NOTES);
};

// ============== Popup promo création de compte ==============
const SYNC_PROMO_KEY = 'cp_sync_promo_dismissed_v1';

function maybeShowSyncPromo(){
  if(_viewerMode) return;                                            // mode lecture seule
  if(_authUser) return;                                              // déjà connecté
  if(localStorage.getItem(SYNC_PROMO_KEY) === '1') return;           // déjà dismissé
  const wizard = document.getElementById('wizardOverlay');
  if(wizard && wizard.style.display !== 'none' && wizard.offsetParent !== null) return; // wizard en cours
  if(getBassins().length === 0) return;                              // brand new user, focus sur le setup
  openSyncPromo();
}

window.openSyncPromo = function(){
  const ov = document.getElementById('syncPromoOverlay');
  if(ov) ov.style.display = 'flex';
};

window.closeSyncPromo = function(){
  const cb = document.getElementById('syncPromoNeverShow');
  if(cb && cb.checked){
    try{ _rawSetItem(SYNC_PROMO_KEY, '1'); }catch(e){}
  }
  const ov = document.getElementById('syncPromoOverlay');
  if(ov) ov.style.display = 'none';
};

window.syncPromoCreateAccount = function(){
  // Si la coche est activée, on respecte aussi (pas re-popup si l'utilisateur se déconnecte ensuite)
  const cb = document.getElementById('syncPromoNeverShow');
  if(cb && cb.checked){
    try{ _rawSetItem(SYNC_PROMO_KEY, '1'); }catch(e){}
  }
  const ov = document.getElementById('syncPromoOverlay');
  if(ov) ov.style.display = 'none';
  openAccountLogin();
};
