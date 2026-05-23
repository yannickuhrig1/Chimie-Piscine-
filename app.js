/* =========================================================
   CHIMIE PISCINE - Application logic
   Calculs transposés depuis le fichier Excel d'origine
   ========================================================= */

const APP_VERSION = '1.6.2';

const STORAGE_KEYS = {
  measurements: 'cp_measurements_v1',
  reminders: 'cp_reminders_v1',
  lastInputs: 'cp_last_inputs_v1',
  bassins: 'cp_bassins_v1',
  activeBassin: 'cp_active_bassin_id'
};

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
  if(Math.abs(v)<0.01&&v!==0)return v.toExponential(2);
  return Number(v.toFixed(d)).toLocaleString('fr-FR',{maximumFractionDigits:d});
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
  $('page-'+name).classList.add('active');
  document.querySelector(`.tab[data-page="${name}"]`).classList.add('active');
  if(name==='historique') renderCharts();
  if(name==='correction') renderCorrections();
  window.scrollTo({top:0, behavior:'smooth'});
}

// ============== Saisie & Sauvegarde ==============
function readInputs(){
  const modeEl = $('modeDesinf');
  return {
    volume: num('volume'),
    ph: num('phMesure'),
    phSouhaite: num('phSouhaite'),
    fcl: num('fcl'),
    tcl: num('tcl'),
    tac: num('tacMesure'),
    tacSouhaite: num('tacSouhaite'),
    cya: num('cya'),
    // Mesures avancées
    temp: num('temp'),
    sel: num('selMesure'),
    selSouhaite: num('selSouhaite'),
    th: num('thMesure'),
    thSouhaite: num('thSouhaite'),
    phosphate: num('phosphate'),
    brome: num('brome'),
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
  setVal('selSouhaite','selSouhaite');
  setVal('thSouhaite','thSouhaite');
  if(last.modeDesinf && $('modeDesinf')) $('modeDesinf').value = last.modeDesinf;
  // Synchronise aussi les champs miroir de la page Rappels
  ['cfgVolume','cfgPhSouhaite','cfgTacSouhaite','cfgCya','cfgSelSouhaite','cfgThSouhaite'].forEach(id => {
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
  const next = {
    volume: num('volume'),
    phSouhaite: num('phSouhaite'),
    tacSouhaite: num('tacSouhaite'),
    cya: num('cya'),
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
  const mirror = {volume:'cfgVolume', phSouhaite:'cfgPhSouhaite', tacSouhaite:'cfgTacSouhaite', cya:'cfgCya', selSouhaite:'cfgSelSouhaite', thSouhaite:'cfgThSouhaite'};
  Object.entries(mirror).forEach(([k, id]) => {
    if(next[k] !== null && $(id)) $(id).value = next[k];
  });
  if(next.modeDesinf && $('cfgModeDesinf')) $('cfgModeDesinf').value = next.modeDesinf;
  showSavedPill();
}

function saveBassinConfigFromRappels(){
  const cfg = {
    volume: parseFloat($('cfgVolume').value) || null,
    phSouhaite: parseFloat($('cfgPhSouhaite').value) || null,
    tacSouhaite: parseFloat($('cfgTacSouhaite').value) || null,
    cya: parseFloat($('cfgCya').value) || null,
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
  const mirror = {volume:'volume', phSouhaite:'phSouhaite', tacSouhaite:'tacSouhaite', cya:'cya', selSouhaite:'selSouhaite', thSouhaite:'thSouhaite'};
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
  setVal('selSouhaite', c.selSouhaite);
  setVal('thSouhaite', c.thSouhaite);
  if(c.modeDesinf && $('modeDesinf')) $('modeDesinf').value = c.modeDesinf;
  // Miroir page Rappels
  setVal('cfgVolume', c.volume);
  setVal('cfgPhSouhaite', c.phSouhaite);
  setVal('cfgTacSouhaite', c.tacSouhaite);
  setVal('cfgCya', c.cya);
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
  } else if(m.ph !== null && m.phSouhaite !== null){
    html += `<div class="card">
      <div class="card-header"><div class="card-title"><span class="dot"></span>pH</div></div>
      <div class="result ok">
        <div class="result-label">Aucune correction nécessaire</div>
        <div class="result-note">pH mesuré (${fmt(m.ph,1)}) déjà ≤ pH souhaité (${fmt(m.phSouhaite,1)})</div>
      </div>
    </div>`;
  }

  // ===== Chlore - Chloration normale =====
  // Si Fcl < 50 % de la cible, on saute cette carte : le choc curatif (plus bas)
  // prend le relais — afficher les deux dosages simultanément serait trompeur.
  if(m.fcl !== null && m.cya !== null && m.fcl >= calcFclVise(m.cya) * 0.5){
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
      html += `<div class="card">
        <div class="card-header"><div class="card-title"><span class="dot"></span>Chloration</div></div>
        <div class="result ok">
          <div class="result-label">Niveau correct</div>
          <div class="result-note">Fcl mesuré (${fmt(m.fcl,2)} ppm) ≥ cible (CYA/10 = ${fmt(chl.fclVise, 2)} ppm). Aucune chloration journalière à apporter.</div>
        </div>
      </div>`;
    }
  }

  // ===== Superchloration (Ccl > 0.6) =====
  if(m.fcl !== null && m.tcl !== null){
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
  if(m.fcl !== null && m.cya !== null && m.fcl < calcFclVise(m.cya) * 0.5){
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
      html += `<div class="card">
        <div class="card-header">
          <div class="card-title" style="color:var(--lemon)"><span class="dot" style="background:var(--lemon);box-shadow:0 0 10px var(--lemon)"></span>Choc curatif</div>
          <span class="status-pill warn"><span class="pulse"></span>Fcl très bas</span>
        </div>
        <div class="result warn">
          <div class="result-label">Choc curatif — remplace la chloration quotidienne</div>
          <div class="result-multi-or" style="margin-top:8px">
            <div class="item">
              <div class="result-label">Javel 9.6°</div>
              <div class="result-value">${fmt(choc.javel, 2)}<span class="unit">L</span></div>
            </div>
            <div class="or-sep">OU</div>
            <div class="item">
              <div class="result-label">Hypochlorite Ca</div>
              <div class="result-value">${fmt(choc.hypocalcium, 0)}<span class="unit">g</span></div>
            </div>
          </div>
          <div class="result-note">Fcl ${fmt(m.fcl,2)} ppm &lt; 50 % de la cible (${fmt(calcFclVise(m.cya),2)} ppm). Trop bas pour rattraper avec une dose quotidienne : on passe directement au choc, qui ramène Fcl à <strong>CYA/2 ≈ ${fmt(m.cya/2,0)} ppm</strong>.</div>
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
  if(m.ph !== null && m.fcl !== null){
    const hocl = calcHOClFromCYA(m.fcl, m.ph, m.cya || 0);
    const t = fcThresholds(m.cya || 0);
    let tone = 'ok', label = 'Désinfection optimale';
    if(m.fcl < t.min){ tone='danger'; label='Fcl insuffisant pour le CYA'; }
    else if(m.fcl < t.target){ tone='warn'; label='Fcl sous la cible'; }
    else if(m.fcl > t.shock){ tone='warn'; label='Fcl niveau choc'; }
    html += `<div class="card">
      <div class="card-header">
        <div class="card-title"><span class="dot" style="background:var(--leaf);box-shadow:0 0 10px var(--leaf)"></span>Désinfection</div>
        <span style="font-size:11px;color:var(--shallow);font-family:'JetBrains Mono',monospace">Modèle O'Brien</span>
      </div>
      <div class="result ${tone}">
        <div class="result-multi">
          <div class="item">
            <div class="result-label">HOCl actif</div>
            <div class="result-value">${fmt(hocl, 3)}<span class="unit">ppm</span></div>
          </div>
          <div class="item">
            <div class="result-label">Fcl cible (CYA / 10)</div>
            <div class="result-value">${fmt(t.target, 2)}<span class="unit">ppm</span></div>
          </div>
        </div>
        <div class="result-note">${label} · min ${fmt(t.min,2)} – cible ${fmt(t.target,2)} – choc ${fmt(t.shock,2)} ppm (CYA ${m.cya ? fmt(m.cya,0)+' ppm' : 'non saisi'})</div>
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
      html += `<div class="card">
        <div class="card-header"><div class="card-title" style="color:var(--coral)"><span class="dot" style="background:var(--coral);box-shadow:0 0 10px var(--coral)"></span>TH trop élevé</div></div>
        <div class="result warn">
          <div class="result-label">Risque d'entartrage</div>
          <div class="result-note">TH ${fmt(m.th,0)} °f &gt; cible (${fmt(cible,0)} °f). Diluer (vidange partielle) ou séquestrer (anti-calcaire).</div>
        </div>
      </div>`;
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
  wrap.innerHTML = list.slice().reverse().slice(0, 50).map((m, idx) => {
    const realIdx = list.length - 1 - idx;
    const d = new Date(m.date);
    return `<div class="history-item" onclick="openHistDetail(${realIdx})" style="cursor:pointer">
      <div class="history-date">
        <div class="day">${d.getDate()}</div>
        <div class="month">${months[d.getMonth()]}</div>
      </div>
      <div class="history-data">
        <div class="h-item"><div class="h-label">pH</div><div class="h-value">${m.ph!==null?fmt(m.ph,1):'—'}</div></div>
        <div class="h-item"><div class="h-label">Fcl</div><div class="h-value">${m.fcl!==null?fmt(m.fcl,2):'—'}</div></div>
        <div class="h-item"><div class="h-label">TAC</div><div class="h-value">${m.tac!==null?fmt(m.tac,0):'—'}</div></div>
      </div>
      <button class="history-delete" onclick="event.stopPropagation();deleteMeasurement(${realIdx})" aria-label="Supprimer">×</button>
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

  // Chart pH & Chlore
  const ctxPh = $('chartPh').getContext('2d');
  if(chartPh) chartPh.destroy();
  chartPh = new Chart(ctxPh, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label:'pH',
          data: list.map(m => m.ph),
          borderColor:'#22b4d4',
          backgroundColor:'rgba(34,180,212,.1)',
          tension:.35, pointRadius:3, pointHoverRadius:5,
          spanGaps:true, yAxisID:'y'
        },
        {
          label:'Chlore libre (ppm)',
          data: list.map(m => m.fcl),
          borderColor:'#7fdbda',
          backgroundColor:'rgba(127,219,218,.1)',
          tension:.35, pointRadius:3, pointHoverRadius:5,
          spanGaps:true, yAxisID:'y1'
        }
      ]
    },
    options: {
      ...baseConfig,
      scales: {
        x: baseConfig.scales.x,
        y: {...baseConfig.scales.y, position:'left', title:{display:true, text:'pH', color:'#7fdbda', font:{family:'Manrope', size:10}}},
        y1: {...baseConfig.scales.y, position:'right', grid:{drawOnChartArea:false}, title:{display:true, text:'Cl libre', color:'#7fdbda', font:{family:'Manrope', size:10}}}
      }
    }
  });

  // Chart TAC & CYA
  const ctxTac = $('chartTac').getContext('2d');
  if(chartTac) chartTac.destroy();
  chartTac = new Chart(ctxTac, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label:'TAC (ppm)',
          data: list.map(m => m.tac),
          borderColor:'#ffd166',
          backgroundColor:'rgba(255,209,102,.1)',
          tension:.35, pointRadius:3, pointHoverRadius:5,
          spanGaps:true, fill:true
        },
        {
          label:'CYA (ppm)',
          data: list.map(m => m.cya),
          borderColor:'#06d6a0',
          backgroundColor:'rgba(6,214,160,.1)',
          tension:.35, pointRadius:3, pointHoverRadius:5,
          spanGaps:true
        }
      ]
    },
    options: baseConfig
  });

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
          <input type="text" id="restoreCode" class="contact-input" placeholder="PISC-XXXX-XXXX-XXXX-XXXX" autocomplete="off" autocapitalize="characters">
        </div>
        <button class="btn-ghost" style="width:100%" onclick="restoreFromCode()">Restaurer mes données</button>
      </details>`;
  }
}

// ============== Contact / Tickets (Supabase) ==============
const SUPABASE_URL = 'https://tfitkyuvkdogiatglxzr.supabase.co';
const SUPABASE_KEY = 'sb_publishable_BYHvWjbjIXYdt3OkSQtXXQ_luaxs3PI';

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
    navigator.serviceWorker.register('sw.js').catch(err => console.warn('SW failed', err));
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

// ============== UI bassins (switcher + modale) ==============
let _bassinModalEditingId = null;
let _bassinModalEmoji = '🏊';
let _bassinModalCouleur = BASSIN_COLORS[0];

function renderBassinSwitcher(){
  const wrap = $('bassinSwitcher');
  if(!wrap) return;
  const bassins = getActiveBassins();
  const activeId = getActiveBassinId();

  // N'affiche pas le switcher si un seul bassin et aucun archivé (UI propre tant qu'on n'en a qu'un)
  const archived = getBassins().filter(b => b.archived).length;
  if(bassins.length <= 1 && archived === 0){
    wrap.style.display = 'none';
    // Mais on peut quand même proposer d'ajouter un bassin via un mini-CTA
    wrap.innerHTML = '';
    return;
  }
  wrap.style.display = 'flex';

  const chips = bassins.map(b => {
    const isActive = b.id === activeId;
    const editBtn = isActive
      ? `<span class="bassin-chip-edit" onclick="event.stopPropagation();openBassinModal('${b.id}')" title="Modifier">⚙</span>`
      : '';
    return `<div class="bassin-chip ${isActive?'active':''}" onclick="switchBassin('${b.id}')" data-id="${b.id}">
      <span class="dot-color" style="color:${b.couleur};background:${b.couleur}"></span>
      <span class="chip-emoji">${b.emoji||'🏊'}</span>
      <span>${escapeHtml(b.nom)}</span>
      ${editBtn}
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

function shareControl(measurement){
  const list = loadActiveMeasurements();
  if(list.length === 0 && !measurement){ toast('Aucune mesure à partager','warn'); return; }
  const m = measurement || list[list.length-1];
  const st = evaluateStatus(m);

  const W = 1080;
  const ccl = (m.fcl !== null && m.tcl !== null) ? (m.tcl - m.fcl) : null;
  const items = [
    {label:'pH', value: m.ph!==null?fmt(m.ph,1):'—'},
    {label:'Chlore libre (Fcl)', value: m.fcl!==null?fmt(m.fcl,2)+' ppm':'—'},
    {label:'Chlore total (Tcl)', value: m.tcl!==null?fmt(m.tcl,2)+' ppm':'—'},
    {label:'Chloramines (Ccl)', value: ccl!==null?fmt(ccl,2)+' ppm':'—'},
    {label:'TAC', value: m.tac!==null?fmt(m.tac,0)+' ppm':'—'},
    {label:'CYA', value: m.cya!==null?fmt(m.cya,0)+' ppm':'—'},
    {label:'Température', value: m.temp!==null?fmt(m.temp,1)+' °C':'—'}
  ];
  const actions = getActionsTextList(m).slice(0, 6);
  const measuresStart = 400, measuresRowH = 95;
  const measuresEnd = measuresStart + items.length * measuresRowH;
  const actionsHeaderY = measuresEnd + 30;
  const actionsItemH = 70;
  const actionsCount = Math.max(actions.length, 1);
  const H = actionsHeaderY + 60 + actionsCount * actionsItemH + 100;

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
  return rows.map(r => `<div style="display:flex;justify-content:space-between;padding:10px 0;border-bottom:1px solid rgba(255,255,255,.07);font-size:13px;gap:10px">
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
  if(m) shareControl(m);
}

function reloadHistEntry(){
  if(__histDetailIdx === null) return;
  const list = loadActiveMeasurements();
  const m = list[__histDetailIdx];
  if(!m) return;
  const fieldMap = {
    volume:'volume', phMesure:'ph', phSouhaite:'phSouhaite',
    fcl:'fcl', tcl:'tcl', tacMesure:'tac', tacSouhaite:'tacSouhaite',
    cya:'cya', temp:'temp', selMesure:'sel', selSouhaite:'selSouhaite',
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

  if($('shareBtn')) $('shareBtn').addEventListener('click', () => shareControl());

  const hintsEnabled = localStorage.getItem('cp_hints_enabled') !== '0';
  if($('hintsToggle')){
    $('hintsToggle').checked = hintsEnabled;
    $('hintsToggle').addEventListener('change', toggleHints);
  }
  setupHints();

  maybeOpenWizard();

  // Accès admin discret via #admin dans l'URL
  if(location.hash === '#admin') openAdmin();
  window.addEventListener('hashchange', ()=>{
    if(location.hash === '#admin') openAdmin();
  });

  // Met à jour le badge si données pré-saisies
  const m = readInputs();
  if(m.fcl!==null && m.tcl!==null) updateCclBadge(m);

  // Auto-save sur les paramètres bassin (debounced via input event)
  ['volume','phSouhaite','tacSouhaite','cya','selSouhaite','thSouhaite'].forEach(id => {
    const el = $(id);
    if(el) el.addEventListener('input', autoSaveBassinParams);
  });
  if($('modeDesinf')) $('modeDesinf').addEventListener('change', autoSaveBassinParams);
  const cfgMap = {cfgVolume:'volume',cfgPhSouhaite:'phSouhaite',cfgTacSouhaite:'tacSouhaite',cfgCya:'cya',cfgSelSouhaite:'selSouhaite',cfgThSouhaite:'thSouhaite'};
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
