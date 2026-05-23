# Changelog

Toutes les évolutions notables de Chimie Piscine sont consignées dans ce fichier.

Format inspiré de [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/),
versionnage selon [SemVer](https://semver.org/lang/fr/).

## [1.4.3] — 2026-05-23

### Ajouté
- **Chlore total (Tcl)** ajouté à l'image partagée, à côté de Chlore libre et Chloramines.

### Corrigé
- Bug Doses : la carte « Chloration choc » s'affichait toujours à cause d'un `|| true` resté dans la condition. Conséquence : sur une mesure avec Fcl légèrement bas, l'app proposait *à la fois* 0,36 L de Javel (quotidien) ET 1,78 L de Javel (choc), ce qui est trompeur — le choc n'est PAS un dosage en plus, c'est une **alternative** à la chloration quotidienne. La carte ne s'affiche désormais que si Fcl < 50 % de la cible (signal réel de prolifération), et le wording précise que la dose remplace celle du quotidien.

## [1.4.2] — 2026-05-23

### Ajouté
- L'image partagée inclut désormais une section **« Actions à suivre »** sous les mesures : liste des doses recommandées (HCl, Javel, TAC+, sel, CaCl₂, anti-phosphate, brome…) ou « ✓ Aucune action requise » si rien à faire. Hauteur du canvas dynamique selon le nombre d'actions.

### Corrigé
- Modale détail d'une mesure historique : les boutons *Partager / Recharger* étaient masqués par la barre de navigation quand le contenu était long. Modale capée à `100vh - 40px`, contenu interne scrollable, header et boutons toujours visibles.
- Bouton **Partager** du panneau Tendances ne fonctionnait plus : `addEventListener('click', shareControl)` passait l'objet Event comme paramètre `measurement` depuis le refactor. Corrigé avec wrapper `() => shareControl()`.

## [1.4.1] — 2026-05-23

### Ajouté
- **Modale détail d'une mesure historique** : clic sur une ligne de l'Historique → vue complète avec 2 onglets *Mesures* (toutes les valeurs sauvegardées) et *Actions à suivre* (corrections recalculées à partir de cette mesure).
- Bouton **Partager en image** dans la modale détail : possibilité d'exporter n'importe quelle mesure passée, pas seulement la dernière.
- Bouton **Recharger dans l'app** : remplit le formulaire Mesure avec les valeurs de l'entrée choisie comme point de départ.
- Mention explicite **« Chloramines (Ccl) »** dans l'image partagée à la place de « Chlore combiné ».

### Modifié
- `renderCorrections` accepte maintenant une mesure et un container cibles (utilisé par la modale détail).
- Les lignes d'historique deviennent cliquables (le bouton × de suppression reste isolé).

## [1.4.0] — 2026-05-23

### Ajouté
- **Notifications push serveur** : rappels (quotidien, hebdomadaire, lavage filtre) envoyés même app fermée via un cron Supabase. Edge Functions `push-subscribe` et `push-send`, journal `push_log` (rétention 30 j).
- **Bouton « Tester »** dans Rappels pour vérifier que les notifs arrivent sans attendre l'heure du rappel.
- Détection de la révocation de permission au démarrage : nettoyage automatique des abonnements orphelins côté serveur.
- Toast « Nouvelle version dispo · Recharger » dès qu'un service worker met à jour pendant la session.
- **Carte Tendances** dans Historique : régression linéaire du pH sur 14 jours, consommation Cl excessive, chute de TAC, alerte si pas de mesure depuis 3+ jours, alerte CYA > 40.
- **Wizard de premier lancement** : volume du bassin, mode de désinfection, marque de bandelette. Skippable à chaque étape, ne réapparaît pas après.
- **Aides contextuelles** (« ? » à côté de chaque champ) avec explications courtes, désactivables dans Rappels.
- **Partage du contrôle en image** : bouton dans Tendances qui génère un PNG 1080×1080 stylé (Web Share natif sur mobile, sinon téléchargement).
- ESLint en CI (workflow `lint.yml`) pour catcher les refs orphelines avant production.

## [1.3.0] — 2026-05-22

### Ajouté
- Rubrique **Contact** : formulaire (nom, email, sujet, message) qui crée un ticket.
- Stockage des tickets dans Supabase, avec statut ouvert / fermé et historique.
- Notifications automatiques à chaque ticket : **email** (Resend) + **Discord** (Notifiarr).
- **Page admin** protégée par mot de passe : consulter, clôturer, rouvrir et supprimer les tickets.
- Accès admin in-app (lien dans la page Contact) en plus de l'URL `#admin`.
- Numéro de version affiché à côté du titre.
- Fichiers `CHANGELOG.md` et README mis à jour.

## [1.2.0] — 2026-05-19

### Ajouté
- Calculateurs avancés : **sel** (électrolyse), **TH / dureté** (chlorure de calcium), **phosphates**, **brome**, **indice de Langelier (LSI)**.
- Carte « Mesures avancées » repliable + cibles avancées dans la configuration du bassin.
- Graphique de **désinfection** style PoolLab : zones colorées dépendantes du CYA et chlore actif HOCl (modèle O'Brien / Wojtowicz).

### Modifié
- Seuils de chlore libre alignés sur les formules Excel d'origine (min / cible / choc).
- Séparateur « OU » entre Javel et Hypochlorite de calcium (doses exclusives) dans les cartes Chloration choc et Superchloration.

## [1.1.0] — 2026-05-03

### Ajouté
- Sauvegarde automatique des paramètres du bassin (volume, valeurs cibles).
- Carte de configuration dédiée et indicateur « dernier contrôle il y a X ».
- Cartes « aucune correction nécessaire » explicites sur la page Doses.
- Vue Home Assistant miroir de la PWA.

### Modifié
- Tous les seuils alignés sur le Guide SOS Piscine V3.

## [1.0.0] — 2026-05-01

### Ajouté
- PWA installable + APK Android (Trusted Web Activity).
- Calculateurs pH (acide chlorhydrique + poudre), chloration, chloration choc, superchloration, TAC+.
- Détection automatique du chlore combiné (Ccl > 0,6 ppm → superchloration).
- Historique des mesures (localStorage) et graphiques d'évolution pH / chlore / TAC / CYA.
- Rappels quotidien, hebdomadaire et lavage du filtre via notifications.
- Fonctionnement hors ligne (service worker), import / export JSON.
