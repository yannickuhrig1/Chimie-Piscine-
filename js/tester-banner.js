/*
 * Bannière de recrutement de testeurs — test fermé "Alpha" sur le Play Store.
 *
 * Google exige 12 testeurs opt-in pendant 14 jours consécutifs avant d'autoriser
 * la publication en production. Cette bannière propose aux utilisateurs Android
 * de la PWA de rejoindre le test, et renvoie vers /testeurs qui détaille la
 * marche à suivre.
 *
 * ---------------------------------------------------------------------------
 * PARAMÈTRES D'URL DE DEBUG
 *
 *   ?cp_test=1       Force l'affichage de la bannière en ignorant TOUTES les
 *                    conditions (Android, TWA, nombre d'ouvertures, report,
 *                    date de fin). Indispensable pour tester depuis un
 *                    navigateur desktop, où la bannière ne s'afficherait
 *                    jamais à cause du test Android.
 *
 *   ?cp_test=reset   Efface les trois clés localStorage de la bannière
 *                    (cp_tester_opens_v1, cp_tester_done_v1,
 *                    cp_tester_snooze_v1) puis recharge la page sans le
 *                    paramètre. Remet l'état à celui d'un nouvel utilisateur.
 * ---------------------------------------------------------------------------
 */
(function () {
  'use strict';

  // ---- Configuration -------------------------------------------------------

  // Fin de campagne : passé cette date, la bannière ne s'affiche plus jamais.
  // Laisse le temps de recruter les testeurs manquants puis de tenir les 14 jours.
  var CAMPAIGN_END = Date.parse('2026-09-30T23:59:59+02:00');

  // On ne sollicite pas un visiteur au tout premier lancement : il découvre
  // encore l'app. La bannière apparaît à partir de la 2e ouverture.
  var MIN_OPENS = 2;

  // Durée du report déclenché par « Plus tard » et par Échap.
  var SNOOZE_DAYS = 7;

  var TARGET = '/testeurs'; // vercel.json a cleanUrls:true → pas de .html

  var KEY_OPENS = 'cp_tester_opens_v1';
  var KEY_DONE = 'cp_tester_done_v1';
  var KEY_SNOOZE = 'cp_tester_snooze_v1';
  // sessionStorage : marque la session en cours comme déjà comptabilisée.
  var KEY_SESSION = 'cp_tester_session_v1';

  // ---- Accès localStorage tolérant aux pannes ------------------------------
  // En navigation privée (ou si le quota est plein), localStorage lève une
  // exception à la lecture comme à l'écriture. La bannière doit rester
  // fonctionnelle : elle s'affichera simplement à chaque visite.

  function lsGet(key) {
    try {
      return localStorage.getItem(key);
    } catch (e) {
      return null;
    }
  }

  function lsSet(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch (e) {
      /* stockage indisponible : on ignore */
    }
  }

  function lsRemove(key) {
    try {
      localStorage.removeItem(key);
    } catch (e) {
      /* stockage indisponible : on ignore */
    }
  }

  function ssGet(key) {
    try {
      return sessionStorage.getItem(key);
    } catch (e) {
      return null;
    }
  }

  function ssSet(key, value) {
    try {
      sessionStorage.setItem(key, value);
    } catch (e) {
      /* stockage indisponible : on ignore */
    }
  }

  function ssRemove(key) {
    try {
      sessionStorage.removeItem(key);
    } catch (e) {
      /* stockage indisponible : on ignore */
    }
  }

  // ---- Mode debug ----------------------------------------------------------

  var testMode = '';
  try {
    testMode = new URLSearchParams(window.location.search).get('cp_test') || '';
  } catch (e) {
    testMode = '';
  }

  if (testMode === 'reset') {
    lsRemove(KEY_OPENS);
    lsRemove(KEY_DONE);
    lsRemove(KEY_SNOOZE);
    ssRemove(KEY_SESSION);
    // Recharge sans le paramètre pour repartir sur un état propre.
    var clean = window.location.pathname + window.location.hash;
    window.location.replace(clean);
    return;
  }

  var forced = testMode === '1';

  // ---- Conditions d'affichage ---------------------------------------------

  // Compteur d'ouvertures : incrémenté même quand la bannière ne s'affiche pas
  // (sinon le seuil ne serait jamais atteint).
  //
  // Une « ouverture » = une session de navigation, pas un chargement de page.
  // app.js recharge la page quand le service worker prend le contrôle
  // (écouteur `controllerchange`), et l'app se recharge aussi après un import
  // ou une restauration : sans ce garde-fou, une toute première visite
  // compterait double et la bannière s'afficherait dès le premier lancement.
  function bumpOpens() {
    var n = parseInt(lsGet(KEY_OPENS) || '0', 10);
    if (isNaN(n) || n < 0) n = 0;
    if (ssGet(KEY_SESSION) === '1') return n; // session déjà comptabilisée
    n += 1;
    lsSet(KEY_OPENS, String(n));
    ssSet(KEY_SESSION, '1');
    return n;
  }

  function shouldShow(opens) {
    if (forced) return true;

    // Campagne terminée.
    if (Date.now() > CAMPAIGN_END) return false;

    // Un iPhone ne peut pas participer à un test fermé Android.
    if (!/Android/i.test(navigator.userAgent)) return false;

    // Déjà dans la TWA installée depuis le Play Store : la personne est déjà
    // testeuse, lui proposer de s'inscrire n'a aucun sens.
    if (document.referrer && document.referrer.indexOf('android-app://') === 0) return false;

    // A répondu « Je participe » ou fermé via la croix : plus jamais.
    if (lsGet(KEY_DONE) === '1') return false;

    // Report en cours.
    var until = parseInt(lsGet(KEY_SNOOZE) || '0', 10);
    if (!isNaN(until) && until > Date.now()) return false;

    // Pas au tout premier lancement.
    if (opens < MIN_OPENS) return false;

    return true;
  }

  // ---- Rendu ---------------------------------------------------------------

  var STYLE = [
    '.cp-tb{',
    '  position:fixed;left:0;right:0;',
    '  bottom:calc(env(safe-area-inset-bottom, 0px) + 92px);',
    '  padding-left:calc(env(safe-area-inset-left, 0px) + 12px);',
    '  padding-right:calc(env(safe-area-inset-right, 0px) + 12px);',
    '  z-index:9000;display:flex;justify-content:center;pointer-events:none;',
    '}',
    '.cp-tb-card{',
    '  pointer-events:auto;width:100%;max-width:520px;',
    '  background:rgba(4,29,46,.94);',
    '  -webkit-backdrop-filter:blur(24px) saturate(180%);',
    '  backdrop-filter:blur(24px) saturate(180%);',
    '  border:1px solid var(--border, rgba(127,219,218,.18));',
    '  border-radius:20px;padding:14px 14px 12px;',
    '  box-shadow:0 -10px 34px rgba(0,0,0,.42);',
    '  color:var(--foam, #e8f9f8);',
    '  font-family:inherit;',
    '  animation:cp-tb-in .32s cubic-bezier(.22,1,.36,1) both;',
    '}',
    '@keyframes cp-tb-in{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:translateY(0)}}',
    '@media (prefers-reduced-motion: reduce){',
    '  .cp-tb-card{animation:none}',
    '}',
    '.cp-tb-head{display:flex;align-items:flex-start;gap:10px}',
    '.cp-tb-icon{',
    '  flex-shrink:0;width:34px;height:34px;border-radius:11px;',
    '  background:linear-gradient(135deg,var(--water, #22b4d4),var(--shallow, #7fdbda));',
    '  display:grid;place-items:center;font-size:17px;line-height:1;',
    '}',
    '.cp-tb-txt{flex:1;min-width:0}',
    '.cp-tb-title{',
    '  font-size:14px;font-weight:700;letter-spacing:-.01em;margin:1px 0 3px;',
    '  color:var(--foam, #e8f9f8);',
    '}',
    '.cp-tb-desc{font-size:12.5px;line-height:1.45;color:var(--text-muted, rgba(232,249,248,.65))}',
    '.cp-tb-close{',
    '  flex-shrink:0;appearance:none;border:none;background:transparent;cursor:pointer;',
    '  color:var(--text-faint, rgba(232,249,248,.4));',
    '  width:30px;height:30px;border-radius:9px;font-size:19px;line-height:1;',
    '  display:grid;place-items:center;font-family:inherit;margin:-3px -3px 0 0;',
    '}',
    '.cp-tb-close:hover{color:var(--foam, #e8f9f8);background:rgba(255,255,255,.08)}',
    '.cp-tb-actions{display:flex;gap:8px;margin-top:11px}',
    '.cp-tb-btn{',
    '  appearance:none;cursor:pointer;font-family:inherit;',
    '  border-radius:12px;padding:9px 14px;font-size:12.5px;font-weight:600;',
    '  letter-spacing:.01em;text-decoration:none;text-align:center;',
    '  transition:filter .2s,background .2s;',
    '}',
    '@media (prefers-reduced-motion: reduce){',
    '  .cp-tb-btn{transition:none}',
    '}',
    '.cp-tb-go{',
    '  flex:1;border:none;',
    '  background:linear-gradient(135deg,var(--water, #22b4d4),var(--mid, #1c6b8c));',
    '  color:#fff;box-shadow:0 4px 14px -4px rgba(34,180,212,.6);',
    '}',
    '.cp-tb-go:hover{filter:brightness(1.08)}',
    '.cp-tb-later{',
    '  border:1px solid var(--border, rgba(127,219,218,.18));',
    '  background:transparent;color:var(--shallow, #7fdbda);',
    '}',
    '.cp-tb-later:hover{background:rgba(255,255,255,.06)}',
    '.cp-tb-card :focus-visible{',
    '  outline:2px solid var(--shallow, #7fdbda);outline-offset:2px;',
    '}',
    '@media (max-width:360px){',
    '  .cp-tb-actions{flex-direction:column}',
    '  .cp-tb-desc{font-size:12px}',
    '}'
  ].join('\n');

  var MARKUP = [
    '<div class="cp-tb-card">',
    '  <div class="cp-tb-head">',
    '    <div class="cp-tb-icon" aria-hidden="true">☀️</div>',
    '    <div class="cp-tb-txt">',
    '      <div class="cp-tb-title" id="cpTbTitle">Testez la version Android</div>',
    '      <div class="cp-tb-desc">Chimie Piscine arrive sur le Play&nbsp;Store. Il me manque quelques testeurs pour pouvoir la publier&nbsp;: l’inscription prend deux minutes.</div>',
    '    </div>',
    '    <button type="button" class="cp-tb-close" id="cpTbClose" aria-label="Fermer et ne plus afficher">×</button>',
    '  </div>',
    '  <div class="cp-tb-actions">',
    '    <a class="cp-tb-btn cp-tb-go" id="cpTbGo" href="' + TARGET + '">Je participe</a>',
    '    <button type="button" class="cp-tb-btn cp-tb-later" id="cpTbLater">Plus tard</button>',
    '  </div>',
    '</div>'
  ].join('\n');

  var banner = null;
  var onKeydown = null;

  function remove() {
    if (onKeydown) {
      document.removeEventListener('keydown', onKeydown);
      onKeydown = null;
    }
    if (banner && banner.parentNode) banner.parentNode.removeChild(banner);
    banner = null;
  }

  // « Plus tard » / Échap : report de SNOOZE_DAYS jours.
  function snooze() {
    lsSet(KEY_SNOOZE, String(Date.now() + SNOOZE_DAYS * 24 * 60 * 60 * 1000));
    remove();
  }

  // Croix / « Je participe » : ne plus jamais réafficher.
  function done() {
    lsSet(KEY_DONE, '1');
    remove();
  }

  function render() {
    var style = document.createElement('style');
    style.id = 'cpTbStyle';
    style.textContent = STYLE;
    document.head.appendChild(style);

    banner = document.createElement('div');
    banner.className = 'cp-tb';
    banner.id = 'cpTesterBanner';
    banner.setAttribute('role', 'region');
    banner.setAttribute('aria-labelledby', 'cpTbTitle');
    banner.innerHTML = MARKUP;
    document.body.appendChild(banner);

    document.getElementById('cpTbClose').addEventListener('click', done);
    document.getElementById('cpTbLater').addEventListener('click', snooze);
    // Le lien navigue de lui-même ; on marque juste l'état avant de partir.
    document.getElementById('cpTbGo').addEventListener('click', function () {
      lsSet(KEY_DONE, '1');
    });

    onKeydown = function (e) {
      if (e.key === 'Escape') snooze();
    };
    document.addEventListener('keydown', onKeydown);
  }

  // ---- Amorçage ------------------------------------------------------------

  function init() {
    var opens = bumpOpens();
    if (!shouldShow(opens)) return;
    render();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
