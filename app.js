/* =========================================================
   CHIMIE PISCINE - Application logic
   Calculs transposés depuis le fichier Excel d'origine
   ========================================================= */

const STORAGE_KEYS = {
  measurements: 'cp_measurements_v1',
  reminders: 'cp_reminders_v1',
  lastInputs: 'cp_last_inputs_v1'
};

// ============== Utilitaires ==============
function $(id){return document.getElementById(id)}
function num(id){const v=parseFloat($(id).value);return isNaN(v)?null:v}
function toast(msg,kind='ok'){
  const t=$('toast');t.textContent=msg;t.className='toast show '+kind;
  setTimeout(()=>t.classList.remove('show'),2400);
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

// ============== Évaluation globale ==============
function evaluateStatus(m){
  const issues = [];
  if(m.ph !== null){
    if(m.ph < 6.8 || m.ph > 7.6) issues.push({level:'danger', msg:'pH'});
    else if(m.ph < 7.0 || m.ph > 7.4) issues.push({level:'warn', msg:'pH'});
  }
  if(m.fcl !== null){
    if(m.fcl < 0.5) issues.push({level:'danger', msg:'Chlore bas'});
    else if(m.fcl < 1) issues.push({level:'warn', msg:'Chlore'});
  }
  if(m.fcl !== null && m.tcl !== null){
    const ccl = m.tcl - m.fcl;
    if(ccl > 0.6) issues.push({level:'danger', msg:'Chloramines'});
  }
  if(m.tac !== null){
    if(m.tac < 60 || m.tac > 150) issues.push({level:'warn', msg:'TAC'});
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
  return {
    volume: num('volume'),
    ph: num('phMesure'),
    phSouhaite: num('phSouhaite'),
    fcl: num('fcl'),
    tcl: num('tcl'),
    tac: num('tacMesure'),
    tacSouhaite: num('tacSouhaite'),
    cya: num('cya'),
    date: new Date().toISOString()
  };
}

function loadLastInputs(){
  const last = loadJSON(STORAGE_KEYS.lastInputs, null);
  if(!last) return;
  if(last.volume!==null) $('volume').value = last.volume;
  if(last.phSouhaite!==null) $('phSouhaite').value = last.phSouhaite;
  if(last.tacSouhaite!==null) $('tacSouhaite').value = last.tacSouhaite;
  if(last.cya!==null) $('cya').value = last.cya;
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

  // Sauvegarder dans l'historique
  const list = loadJSON(STORAGE_KEYS.measurements, []);
  list.push(m);
  saveJSON(STORAGE_KEYS.measurements, list);

  updateStatus(m);
  updateCclBadge(m);
  renderCorrections();
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
function renderCorrections(){
  const m = readInputs();
  const container = $('correctionContent');

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
      <div class="result-note">⚠️ Appliquer 1/3 à 1/2 de la dose et remesurer le lendemain pour ajuster.</div>
    </div>`;
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
  if(m.fcl !== null && m.cya !== null){
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
          <div class="result-multi">
            <div class="item">
              <div class="result-label">Hypochlorite Ca</div>
              <div class="result-value">${fmt(sc.hypocalciumG, 0)}<span class="unit">g</span></div>
            </div>
            <div class="item">
              <div class="result-label">Javel 9.6°</div>
              <div class="result-value">${fmt(sc.javelL, 2)}<span class="unit">L</span></div>
            </div>
          </div>
          <div class="result-note">Ccl &gt; 0.6 ppm — superchloration nécessaire</div>
        </div>
      </div>`;
    }
  }

  // ===== Chloration choc (préventive) =====
  if(m.fcl !== null && m.cya !== null && (m.fcl < calcFclVise(m.cya) || true)){
    const choc = calcChlorationChoc(m.volume, m.fcl, m.cya, 5);
    if(choc.javel > 0 || choc.hypocalcium > 0){
      html += `<div class="card">
        <div class="card-header">
          <div class="card-title"><span class="dot"></span>Chloration choc</div>
          <span style="font-size:11px;color:var(--shallow);font-family:'JetBrains Mono',monospace">×${choc.facteur} · ${fmt(choc.tauxChlore,1)} ppm</span>
        </div>
        <div class="result-multi">
          <div class="item">
            <div class="result-label">Javel 9.6°</div>
            <div class="result-value">${fmt(choc.javel, 2)}<span class="unit">L</span></div>
          </div>
          <div class="item">
            <div class="result-label">Hypochlorite Ca</div>
            <div class="result-value">${fmt(choc.hypocalcium, 0)}<span class="unit">g</span></div>
          </div>
        </div>
        <div class="result-note">Facteur 5 à 10 × 10% du CYA · Choc préventif</div>
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
  const list = loadJSON(STORAGE_KEYS.measurements, []);
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
    return `<div class="history-item">
      <div class="history-date">
        <div class="day">${d.getDate()}</div>
        <div class="month">${months[d.getMonth()]}</div>
      </div>
      <div class="history-data">
        <div class="h-item"><div class="h-label">pH</div><div class="h-value">${m.ph!==null?fmt(m.ph,1):'—'}</div></div>
        <div class="h-item"><div class="h-label">Fcl</div><div class="h-value">${m.fcl!==null?fmt(m.fcl,2):'—'}</div></div>
        <div class="h-item"><div class="h-label">TAC</div><div class="h-value">${m.tac!==null?fmt(m.tac,0):'—'}</div></div>
      </div>
      <button class="history-delete" onclick="deleteMeasurement(${realIdx})" aria-label="Supprimer">×</button>
    </div>`;
  }).join('');
}

function deleteMeasurement(idx){
  if(!confirm('Supprimer cette mesure ?')) return;
  const list = loadJSON(STORAGE_KEYS.measurements, []);
  list.splice(idx, 1);
  saveJSON(STORAGE_KEYS.measurements, list);
  renderHistory();
  renderCharts();
  toast('Mesure supprimée');
}

// ============== Graphiques ==============
let chartPh = null, chartTac = null;

function renderCharts(){
  renderHistory();
  const days = parseInt($('chartRange').value);
  const cutoff = Date.now() - days*86400000;
  const list = loadJSON(STORAGE_KEYS.measurements, [])
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
  scheduleNotifications();
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
    new Notification('Chimie Piscine', {body:'Notifications activées 🌊', icon:'icon-192.png'});
    return true;
  }
  toast('Permission refusée','warn');
  return false;
}

function scheduleNotifications(){
  // Stocker les rappels prévus dans le service worker via localStorage
  // L'app vérifie les rappels au démarrage et toutes les 60 secondes si elle est ouverte
}

function checkRemindersDue(){
  const r = loadJSON(STORAGE_KEYS.reminders, null);
  if(!r) return;
  if(Notification.permission !== 'granted') return;

  const now = new Date();
  const today = now.toDateString();
  const lastShown = loadJSON('cp_last_notif', {});

  // Quotidien
  if(r.daily){
    const [h,m] = r.dailyTime.split(':').map(Number);
    if(now.getHours() === h && now.getMinutes() === m && lastShown.daily !== today){
      new Notification('Contrôle piscine quotidien', {body:'C\'est l\'heure de mesurer pH et chlore 🏊', icon:'icon-192.png', tag:'daily'});
      lastShown.daily = today;
      saveJSON('cp_last_notif', lastShown);
    }
  }

  // Hebdomadaire (samedi)
  if(r.weekly && now.getDay() === 6){
    const [h,m] = r.weeklyTime.split(':').map(Number);
    if(now.getHours() === h && now.getMinutes() === m && lastShown.weekly !== today){
      new Notification('Contrôle hebdomadaire', {body:'Mesure complète : pH, Cl, TAC, CYA 🧪', icon:'icon-192.png', tag:'weekly'});
      lastShown.weekly = today;
      saveJSON('cp_last_notif', lastShown);
    }
  }

  // Filtre tous les 15 jours
  if(r.filter){
    const lastFilter = lastShown.filter ? new Date(lastShown.filter) : null;
    const days = lastFilter ? (now - lastFilter) / 86400000 : 999;
    if(days >= 15 && now.getHours() === 10 && now.getMinutes() === 0){
      new Notification('Lavage du filtre', {body:'Il est temps de laver le filtre de la piscine', icon:'icon-192.png', tag:'filter'});
      lastShown.filter = now.toISOString();
      saveJSON('cp_last_notif', lastShown);
    }
  }
}

// ============== Import / Export ==============
function exportData(){
  const data = {
    measurements: loadJSON(STORAGE_KEYS.measurements, []),
    reminders: loadJSON(STORAGE_KEYS.reminders, {}),
    lastInputs: loadJSON(STORAGE_KEYS.lastInputs, {}),
    exportDate: new Date().toISOString(),
    version: 1
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
  toast('Données effacées');
  setTimeout(()=>location.reload(), 800);
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

// ============== Init ==============
document.addEventListener('DOMContentLoaded', ()=>{
  loadLastInputs();
  loadReminders();
  renderHistory();

  // Met à jour le badge si données pré-saisies
  const m = readInputs();
  if(m.fcl!==null && m.tcl!==null) updateCclBadge(m);

  // Vérifier permission notifications
  if('Notification' in window && Notification.permission === 'granted'){
    $('enableNotifBtn').textContent = 'Activées';
    $('enableNotifBtn').style.color = 'var(--leaf)';
  }

  // Vérifier les rappels périodiquement
  setInterval(checkRemindersDue, 60000);
  checkRemindersDue();
});
