// Suite de tests Chimie Piscine — s'exécute avec `node tests/run.js` (zéro dépendance).
//
// Couvre :
//  1. Calculs chimiques purs (non-régression des formules)
//  2. B1 : jamais de dose calculée depuis une mesure absente
//  3. Validation des plages de saisie (INPUT_RANGES / validateMeasurement)
//  4. Tombstones de suppression (sync cloud)
//  5. COHÉRENCE écran ↔ image partagée : computeCorrectionPlan est le moteur
//     unique ; on vérifie sur toute la matrice de scénarios que le HTML de la
//     page Doses (renderCorrections) et le texte du partage (getActionsTextList)
//     racontent la même chose. Toute règle ajoutée hors du moteur casse ces tests.
const fs = require('fs');
const path = require('path');
const { store } = require('./browser-stubs.js');
const scenarios = require('./scenarios.js');

const src = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
(0, eval)(src);

let pass = 0, fail = 0;
function check(name, cond){
  if(cond){ pass++; }
  else { fail++; console.log('FAIL:', name); }
}
const approx = (a, b, eps = 0.01) => Math.abs(a - b) < eps;

function resetStore(){
  store.clear();
  store.set('cp_bassins_v1', JSON.stringify([{ id: 'b1', nom: 'Test', config: {} }]));
  store.set('cp_active_bassin_id', 'b1');
  store.set('cp_measurements_v1', JSON.stringify([]));
}

// ============ 1. Calculs chimiques (non-régression) ============
check('calcHcl 50m³ 7.8→7.5 = 0.5 L', approx(calcHcl(50, 7.8, 7.5), 0.5));
check('calcJavelChloration 1→3ppm 50m³ = 1 L', approx(calcJavelChloration(50, 1, 30).litres, 1));
check('calcTacPlus +10ppm 50m³ = 850 g', approx(calcTacPlus(50, 70, 80).totalG, 850));
check('calcSel +1g/L 70m³ = 70 kg', approx(calcSel(70, 3, 4).kg, 70));
check('calcCalcium +10°f 70m³ = 7700 g', approx(calcCalcium(70, 15, 25).gCaCl2, 7700));
check('calcCYA +20ppm 70m³ = 1400 g', approx(calcCYA(70, 10, 30).g, 1400));
check('calcBrome +2ppm 70m³ = 280 g', approx(calcBrome(70, 1, 3).grammes, 280));
check('calcLSI eau équilibrée plausible', (() => { const l = calcLSI(7.4, 26, 20, 100, 30, false); return l > -0.5 && l < 0.5; })());
check('calcHOClPct pH 7.54 = 50 %', approx(calcHOClPct(7.54), 0.5));

// ============ 2. B1 : mesure absente → pas de dose ============
check('calcSel mesure absente → null', calcSel(70, null, 4) === null);
check('calcCalcium mesure absente → null', calcCalcium(70, null, 25) === null);
check('calcBrome mesure absente → null', calcBrome(70, null, 3) === null);
check('calcCYA mesure absente → null', calcCYA(70, null, 30) === null);

// ============ 3. Validation des plages ============
const base = { volume: 70, ph: 7.4, phSouhaite: 7.2, fcl: 1, tcl: 1.2, tac: 100,
  tacSouhaite: 100, cya: 30, cyaSouhaite: 30, temp: 26, sel: null, selSouhaite: null,
  th: null, thSouhaite: null, phosphate: null, brome: null };
check('mesure valide → 0 erreur', validateMeasurement(base).length === 0);
check('pH 14 refusé', validateMeasurement({ ...base, ph: 14 }).length === 1);
check('température négative refusée', validateMeasurement({ ...base, temp: -3 }).length === 1);
check('Tcl < Fcl refusé', validateMeasurement({ ...base, fcl: 2, tcl: 1 }).length === 1);
check('Tcl ≈ Fcl toléré (0,3 ppm)', validateMeasurement({ ...base, fcl: 1.2, tcl: 1.0 }).length === 0);

// ============ 4. Tombstones ============
resetStore();
const m1 = { id: 'm_aaa', date: '2026-07-01T10:00:00.000Z', bassinId: 'b1', ph: 7.2 };
const legacy = { date: '2026-06-01T08:00:00.000Z', bassinId: 'b1', ph: 7.0 };
addMeasureTombstones([m1, legacy]);
let tombs = getMeasureTombstones();
check('tombstones créées (id + legacy date)', tombs.length === 2);
addMeasureTombstones([m1]);
check('tombstones sans doublon', getMeasureTombstones().length === 2);
check('match par id', isMeasureTombstoned(tombs, m1, null) === true);
check('mesure re-créée même date (id neuf) survit',
  isMeasureTombstoned(tombs, { id: 'm_new', date: m1.date }, m1.date) === false);
check('legacy match par date reformatée',
  isMeasureTombstoned(tombs, { date: '2026-06-01T08:00:00+00:00' }, null) === true);

// ============ 5. Cohérence écran ↔ partage (moteur unique) ============
// Pour chaque scénario : le plan, le HTML de la page Doses et le texte du
// partage doivent être d'accord. Les marqueurs sont des textes uniques des cartes.
resetStore();
const renderHtml = (m) => {
  const c = { innerHTML: '', querySelectorAll: () => [] };
  renderCorrections(m, c);
  return c.innerHTML;
};

for(const [name, m] of Object.entries(scenarios)){
  const plan = computeCorrectionPlan(m);
  const html = renderHtml(m);
  const actions = getActionsTextList(m);
  const joined = actions.join('\n');

  // -- Mode brome : aucune action chlore, ni à l'écran ni dans le partage
  if(plan.isBrome){
    check(`${name}: brome → pas de javel à l'écran`, !html.includes('Javel 9.6° à ajouter'));
    check(`${name}: brome → pas de javel dans le partage`, !joined.includes('Javel'));
  }
  // -- Chloration : dose à l'écran ⇔ dose dans le partage
  // (marqueur exact : la carte entretien contient aussi « Javel 9.6° à ajouter ce soir »)
  check(`${name}: chloration dose écran⇔partage`,
    html.includes('Javel 9.6° à ajouter</div>') === (plan.chloration != null && plan.chloration.type === 'dose')
    && joined.includes('Chloration ·') === (plan.chloration != null && plan.chloration.type === 'dose'));
  // -- Entretien quotidien
  check(`${name}: entretien écran⇔partage`,
    html.includes("Dose d'entretien quotidienne") === (plan.chloration != null && plan.chloration.type === 'maintenance')
    && joined.includes('Entretien ·') === (plan.chloration != null && plan.chloration.type === 'maintenance'));
  // -- Choc : les deux montrent les deux options, jamais en même temps que la chloration
  check(`${name}: choc écran⇔partage`,
    html.includes('Eau verte · choc curatif') === (plan.choc != null)
    && joined.includes('Chlore très bas') === (plan.choc != null));
  if(plan.choc) check(`${name}: choc exclut chloration`, plan.chloration === null);
  // -- Superchloration
  check(`${name}: superchloration écran⇔partage`,
    html.includes('Élimination des chloramines') === (plan.superchloration != null && plan.superchloration.type === 'dose')
    && joined.includes('Superchloration ·') === (plan.superchloration != null && plan.superchloration.type === 'dose'));
  // -- pH+ (présent dans le partage depuis le moteur unique)
  check(`${name}: pH+ écran⇔partage`,
    html.includes('Correction pH+') === (plan.ph != null && plan.ph.type === 'up')
    && joined.includes('carbonate de sodium') === (plan.ph != null && plan.ph.type === 'up'));
  check(`${name}: pH- écran⇔partage`,
    html.includes('Acide chlorhydrique') === (plan.ph != null && plan.ph.type === 'down')
    && joined.includes('L acide HCl') === (plan.ph != null && plan.ph.type === 'down'));
  // -- TAC : garde LSI respectée des deux côtés
  check(`${name}: TAC+ écran⇔partage`,
    html.includes('TAC+ à ajouter') === (plan.tac != null && plan.tac.type === 'dose')
    && joined.includes('TAC + ·') === (plan.tac != null && plan.tac.type === 'dose'));
  check(`${name}: TAC bloqué LSI écran⇔partage`,
    html.includes('TAC bas, mais eau entartrante') === (plan.tac != null && plan.tac.type === 'blocked-lsi')
    && joined.includes('TAC bas mais eau entartrante') === (plan.tac != null && plan.tac.type === 'blocked-lsi'));
  // -- TH : gardes LSI dans les deux sens
  check(`${name}: CaCl₂ écran⇔partage`,
    html.includes('Chlorure de calcium') === (plan.th != null && plan.th.type === 'dose')
    && joined.includes('g CaCl₂') === (plan.th != null && plan.th.type === 'dose'));
  check(`${name}: TH élevé écran⇔partage`,
    html.includes("Risque d'entartrage") === (plan.th != null && plan.th.type === 'high')
    && joined.includes('TH trop élevé') === (plan.th != null && plan.th.type === 'high'));
  // -- CYA
  check(`${name}: CYA dose écran⇔partage`,
    html.includes('Acide cyanurique à ajouter') === (plan.cya != null && plan.cya.type === 'dose')
    && joined.includes('Stabilisant ·') === (plan.cya != null && plan.cya.type === 'dose'));
  // -- Sel / mesures manquantes
  check(`${name}: sel ajout écran⇔partage`,
    html.includes('Sel à ajouter') === (plan.sel != null && plan.sel.type === 'ajout')
    && joined.includes('Sel · +') === (plan.sel != null && plan.sel.type === 'ajout'));
  check(`${name}: sel non mesuré écran⇔partage`,
    html.includes('Sel non mesuré') === (plan.sel != null && plan.sel.type === 'missing')
    && joined.includes('Sel non mesuré') === (plan.sel != null && plan.sel.type === 'missing'));
  check(`${name}: brome non mesuré écran⇔partage`,
    html.includes('Brome non mesuré') === (plan.brome != null && plan.brome.type === 'missing')
    && joined.includes('Brome non mesuré') === (plan.brome != null && plan.brome.type === 'missing'));
  check(`${name}: brome dose écran⇔partage`,
    html.includes('Pastilles BCDMH') === (plan.brome != null && plan.brome.type === 'dose')
    && joined.includes('g BCDMH') === (plan.brome != null && plan.brome.type === 'dose'));
  // -- Phosphates
  check(`${name}: anti-phosphate écran⇔partage`,
    html.includes('Produit anti-phosphate') === (plan.phosphate != null && plan.phosphate.type === 'traiter')
    && joined.includes('Anti-phosphate ·') === (plan.phosphate != null && plan.phosphate.type === 'traiter'));
  // -- Vidanges
  check(`${name}: vidanges écran⇔partage`,
    html.includes('Vidange partielle') === (plan.drains.length > 0)
    && (joined.includes('vidange') || joined.includes('Vidange')) === (plan.drains.length > 0 || (plan.sel != null && plan.sel.type === 'dilution')));
}

// Cas ciblés hérités de l'audit (les divergences historiques ne doivent pas revenir)
{
  const bromeM = scenarios['brome_dose'];
  const acts = getActionsTextList({ ...bromeM, fcl: 0.2, tcl: 2, cya: 30 });
  check('audit: mode brome + résidus chlore → aucune ligne javel/choc', !acts.join(' ').match(/Javel|choc|Superchloration/));
  const chocM = scenarios['chlore_tres_bas_choc_boost'];
  const acts2 = getActionsTextList(chocM);
  check('audit: fcl<50% → ligne choc, pas de dose normale', acts2.some(a => a.includes('Chlore très bas')) && !acts2.some(a => a.startsWith('Chloration ·')));
}

console.log(`\n${pass} OK, ${fail} FAIL`);
process.exit(fail ? 1 : 0);
