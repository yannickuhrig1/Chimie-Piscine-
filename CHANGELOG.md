# Changelog

Toutes les évolutions notables de Chimie Piscine sont consignées dans ce fichier.

Format inspiré de [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/),
versionnage selon [SemVer](https://semver.org/lang/fr/).

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
