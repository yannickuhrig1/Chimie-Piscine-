# Changelog

Toutes les évolutions notables de Chimie Piscine sont consignées dans ce fichier.

Format inspiré de [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/),
versionnage selon [SemVer](https://semver.org/lang/fr/).

## [1.24.2] — 2026-06-29

### Corrigé
- **HOCl surestimé quand le CYA n'est pas re-saisi** : la carte « Pouvoir désinfectant » et la courbe HOCl de l'historique supposaient un CYA de 0 dès que le champ « CYA mesuré » était laissé vide — affichant alors un HOCl proche du maximum théorique (ex. Fcl 0,9 / placeholder CYA 30 → **0,6 ppm « Très efficace »** au lieu de **~0,03 ppm**, en contradiction avec PoolLab/Toollab). Le CYA évoluant très lentement, l'app reprend désormais la dernière valeur connue (dernier relevé → config du bassin → cible) au lieu de retomber à 0. Si aucun CYA n'est connu, la carte affiche « CYA non renseigné — efficacité incertaine » plutôt qu'un faux « Très efficace ». La courbe HOCl de l'historique applique le même report (plus de pics artificiels). _(Bug remonté par Daniel A.)_

## [1.24.1] — 2026-06-26

### Corrigé
- **Sync Supabase robuste à l'édition de date** : la fusion au pull/réimport déduplique désormais les mesures par identifiant stable (`id`) plutôt que par date seule, avec arbitrage sur `updated_at`. Sans ça, modifier la date d'une mesure (nouveauté 1.23.0) laissait une ligne orpheline à l'ancienne date côté cloud, qui réapparaissait en double à la réimportation. Les nouveaux champs (`note`, actions « Fait », `id`) sont stockés tels quels dans la colonne `jsonb` — aucune migration de schéma nécessaire.

## [1.24.0] — 2026-06-26

### Ajouté
- **Coche « Fait » sur les doses proposées** : chaque carte de la page Doses qui recommande un produit chiffré affiche une coche « Fait ? » pour valider que l'ajout a réellement été effectué. Non bloquant (ne pas cocher n'empêche rien). L'état est rattaché à la mesure : il réapparaît dans le détail de l'entrée d'historique (onglet « Actions à suivre ») et un compteur ✓ s'affiche sur la ligne d'historique. _(Demande de Daniel A.)_
- **Lien « Contacter le support » en bas des pages** : footer discret sur les pages Mesure, Doses, Historique, Apprendre et Paramètres, ouvrant directement le formulaire de tickets — plus besoin de chercher dans les Paramètres. Masqué en mode lecture seule.

## [1.23.0] — 2026-06-26

### Ajouté
- **Date de mesure modifiable** : nouvelle carte « Date & note » en bas du formulaire de saisie avec un champ date/heure (par défaut l'instant présent). On peut désormais reculer la date d'une mesure faite un autre jour pour qu'elle apparaisse au bon endroit dans l'historique et les graphiques. La date est aussi modifiable a posteriori depuis le détail d'une mesure dans l'historique. _(Demande de Daniel A. via le formulaire de contact.)_
- **Note / annotation par mesure** : champ texte libre pour consigner les produits ajoutés et observations suite à une mesure et ses corrections (ex. « ajout 500 g pH−, 1 galet chlore lent »). La note s'affiche dans le détail de la mesure et est éditable a posteriori. _(Demande de Daniel A.)_

## [1.7.1] — 2026-05-24

### Ajouté
- **Saisie manuelle de la ville pour la météo** : sous le bouton GPS dans la modale d'édition du bassin, un champ texte « Ou saisir une ville / code postal » + bouton **Chercher**. Utile quand le GPS du navigateur est refusé / imprécis, ou pour suivre la météo d'un bassin distant. Géocoding via Open-Meteo (gratuit, sans clé). Entrée clavier supporte la touche Entrée.

## [1.7.0] — 2026-05-24

### Ajouté
- **Calculateur de vidange partielle** : nouvelle carte dans Doses qui s'affiche quand au moins un paramètre est trop haut pour être corrigé chimiquement (CYA > 40, sel > 5 g/L, TH > 30 °f). Calcule automatiquement le volume d'eau à vidanger pour ramener à la cible, le pourcentage du bassin que ça représente, et la procédure à suivre. Si plusieurs paramètres sont concernés en même temps, l'app prend la plus grosse vidange et précise tous les paramètres traités.
- **Météo locale (Open-Meteo)** : carte « Météo locale » en haut des Doses avec les 3 prochains jours (T° max, UV, pluie) et recommandations préventives : *« demain 32°C, ajoute +0,3 ppm de chlore ce soir »*, *« forte pluie après-demain, re-mesure après »*, *« UV à 8, vérifie que ton CYA protège ton chlore »*. Activation par bouton « 📍 Activer la météo locale » dans la modale d'édition du bassin → géolocalisation navigateur + reverse-geocode gratuit. Données mises en cache 3 h pour ne pas spammer l'API.
- **Section « Apprendre la chimie de l'eau »** dans Rappels : modale plein écran avec 6 articles courts (Les paramètres clés, HOCl la vraie désinfection, Eau trouble/verte/brune, pH instable, Choc chloré, Le cycle d'une saison). Contenu rédigé à partir des conseils récurrents du groupe SOS Piscine V3.

## [1.6.8] — 2026-05-24

### Ajouté
- Carte **« Crédits & ressources »** dans la page Contact avec un bouton qui ouvre le groupe Facebook **SOS Piscine V3**, source d'une grande partie des formules, seuils et conseils utilisés par l'app. Manière de remercier la communauté et de pointer les nouveaux utilisateurs vers une vraie expertise piscine.

## [1.6.7] — 2026-05-24

### Corrigé
- **Notation scientifique cryptique** (ex. « 2.76e-3 ppm » sur le HOCl) remplacée par du décimal classique (« 0,003 ppm »). La fonction `fmt()` ne bascule désormais en exponentielle que si la valeur est si petite qu'avec le nombre de décimales demandé elle s'afficherait `0` — sinon elle respecte les décimales (utile pour `fmt(0.003, 3)` qui rendait avant `3.00e-3` au lieu de `0,003`).

## [1.6.6] — 2026-05-24

### Modifié
- **Champ « code de sauvegarde » plus accueillant** dans la carte Restauration : le préfixe **`PISC-`** est désormais pré-rempli, les **majuscules forcées** (texte CSS + autocapitalize) et les **tirets sont insérés automatiquement** tous les 4 caractères à la saisie. Plus besoin d'écrire les `-` ni de basculer en majuscules — l'utilisateur peut juste taper les 16 lettres/chiffres.

## [1.6.5] — 2026-05-24

### Modifié
- **Carte « Désinfection » réécrite** pour être compréhensible sans formation chimique :
  - Renommée en **« Pouvoir désinfectant »**, plus parlant.
  - Le label « HOCl actif » devient **« Chlore actif (HOCl) »** avec un verdict instantané sous la valeur : *✓ Très efficace / ✓ Suffisant / ⚠ Limite — vire vite à l'algue / ✗ Insuffisant — risque bactérien*, selon des paliers (0,03 / 0,05 / 0,10 ppm) issus de la littérature désinfection eau.
  - Le label « Fcl cible (CYA / 10) » devient **« Cible Fcl total »**, avec en sous-texte « min X – choc Y ppm » plus court.
  - **Phrase d'explication ajoutée en bas de la carte** : *« Sur tes 2 ppm de Fcl mesurés, seuls 0,051 ppm (2,6 %) désinfectent vraiment. Le reste est séquestré par le CYA (30 ppm) — utile pour résister au soleil, mais ça réduit l'efficacité immédiate. »* — fait le pont entre Fcl mesuré et HOCl réel.

## [1.6.4] — 2026-05-24

### Corrigé
- **Modale d'édition de bassin masquée par la barre de navigation** : sur écrans courts ou avec beaucoup de contenu, le bas de la modale (boutons « Archiver / Supprimer / Générer un code de partage ») passait sous la nav du bas. Même fix que la modale d'historique en v1.4.2 : `max-height:100vh − 140px` + `margin-bottom:120px` pour réserver l'espace de la nav.

## [1.6.3] — 2026-05-24

### Corrigé
- **Impossible de créer un 2ᵉ bassin** : le sélecteur (qui contient le bouton **＋ Bassin**) était caché tant qu'on n'avait qu'un seul bassin, pour faire « propre ». Effet de bord : aucune façon d'ajouter un autre bassin sans passer par la console. Le sélecteur est maintenant toujours affiché dès qu'au moins un bassin existe.

## [1.6.2] — 2026-05-23

### Corrigé
- **Double affichage de chloration éliminé** : quand Fcl était très bas (< 50 % de la cible), la carte « Chloration » (dose quotidienne pour rattraper la cible) ET la carte « Choc curatif » (dose pour atteindre CYA/2) s'affichaient toutes les deux. Le wording précisait « pas en plus », mais voir deux dosages côte à côte restait visuellement trompeur. Désormais : si on est en zone choc, la carte « Chloration » est masquée et seul le choc s'affiche.
- Wording du choc affiné : titre « Choc curatif — remplace la chloration quotidienne » + note qui explique qu'on cible CYA/2 (pas une dose en plus).

## [1.6.1] — 2026-05-23

### Ajouté
- **Badge bassin sur l'image partagée** : la pastille emoji + nom du bassin (avec sa couleur d'accent) s'affiche en haut à droite du PNG généré, pour qu'on sache de quelle piscine on parle quand on partage. La couleur du badge reprend celle choisie dans la modale d'édition du bassin.

## [1.6.0] — 2026-05-23

### Ajouté
- **Gestion multi-bassins** : l'app suit plusieurs piscines (la tienne, celle d'un proche, etc.) sans mélanger les données. Chaque bassin a son nom, son emoji, sa couleur d'accent, sa config (volume, mode désinfection, cibles pH/TAC/CYA/sel/TH) et son propre historique de mesures.
- **Sélecteur de bassins** en haut de page (ligne de chips colorées emoji + nom + ⚙ pour modifier). Tap pour switcher, **＋** pour créer un nouveau bassin. Caché tant qu'il n'y a qu'un bassin (UI propre par défaut).
- **Modale création / édition** : choix de l'emoji (8 préréglés), couleur d'accent (palette 7 teintes), volume, mode de désinfection.
- **Archivage** (cache un bassin sans rien supprimer, restaurable) et **suppression définitive** (bassin + ses mesures, confirmation avec nombre de mesures impactées).
- **Sauvegarde cloud par bassin** : bouton « Générer un code de partage » dans la modale d'édition, code dédié à ce bassin uniquement, transférable à un autre appareil (utile pour rendre la gestion à un proche).
- **Sauvegarde cloud globale étendue** : le code global existant embarque maintenant tous les bassins + configs + mesures. Restauration complète sur un nouvel appareil.
- **Migration automatique** : à la première ouverture de la v1.6, les mesures et la config existantes sont rattachées à un bassin « Mon bassin » créé d'office. Aucune action utilisateur, aucune perte de données.

### Modifié
- Toutes les vues (Historique, Tendances, Doses, Graphiques, Partage en image) filtrent désormais par bassin actif.
- `autoSaveBassinParams` et `saveBassinConfigFromRappels` persistent en plus la config dans le bassin actif (source de vérité multi-bassins). `lastInputs` reste pour rétro-compatibilité.
- Export / Import JSON inclut maintenant la liste des bassins et l'id du bassin actif. Version du format passée à 2.

### Retiré
- **Étape 3 du wizard (marque de bandelette)** : le champ n'était utilisé nulle part dans l'app, c'était un faux ami qui suggérait une personnalisation inexistante. Le wizard passe de 3 à 2 étapes (volume → mode de désinfection → c'est fini).

## [1.5.0] — 2026-05-23

### Ajouté
- **Diagramme Taylor (pH × TAC)** sous la carte Langelier : graphique 2D avec 3 zones colorées (corrosive / équilibrée / entartrante) calculées dynamiquement selon TH, température et CYA. Point blanc = ta mesure actuelle, tooltip affiche le LSI exact en survolant n'importe quel point.
- **Suggestion pH cible LSI = 0** sous la carte Langelier dès que le LSI sort de la plage saine : « pH cible : 7,35 » (formule pH − LSI, valide car LSI est linéaire en pH).
- **Aperçu LSI avant/après correction** sous la carte « Correction pH » : montre comment ta dose d'acide va déplacer le LSI (ex. « +0,42 → +0,08 (équilibrée) »), couleurs vives selon le statut résultant.
- **Boost choc curatif via pH 6,8** : sur la carte « Choc curatif », nouvelle astuce optionnelle qui calcule le gain de chlore actif (HOCl) si on pré-baisse le pH à 6,8 avant la javel, avec la dose d'HCl correspondante. Apparaît uniquement si le gain est significatif (>10 %). Repose sur le modèle Wojtowicz 2001 déjà en place dans l'app.

### Modifié
- **Détection pH-creep raffinée** dans Tendances : seuil 0,04/jour (au lieu de 0,05), persistance minimale de 4 jours pour éviter les fausses alertes sur du bruit, **cause inversée corrigée** — pH qui monte = TAC trop élevé (CO₂ qui dégaze), pas trop bas comme indiqué précédemment. Suggestion d'action chiffrée (baisser le TAC à 80-100 ppm).

## [1.4.4] — 2026-05-23

### Sécurité
- **Rate limit sur la page admin** : 5 tentatives de mot de passe échouées par IP en 15 min déclenchent un blocage de 15 min, validé côté serveur (Edge Function `admin-tickets`). Le client ne peut plus brute-forcer en boucle.
- Journalisation des tentatives dans la table `admin_login_attempts` (IP hashée SHA-256 + pepper, jamais en clair), purge automatique au-delà de 30 jours via `pg_cron`.
- Comparaison du mot de passe en temps constant (déjà en place) + message UX précisant le nombre de tentatives restantes avant blocage.
- Délai UX progressif (2 s) entre deux essais infructueux pour casser le spam local du formulaire.

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
