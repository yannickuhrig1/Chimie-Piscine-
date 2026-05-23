# Chimie Piscine — PWA & APK Android

PWA installable + APK Android généré automatiquement via TWA (Trusted Web Activity).

## ⚡ Démarrage rapide — 3 options

### Option A — Tout automatique en local (recommandé)

Une seule commande qui déploie sur Vercel ET génère l'APK :

```bash
chmod +x deploy.sh
./deploy.sh
```

Pré-requis : Node.js, JDK 17+, `keytool` (inclus avec le JDK).
À la fin, tu obtiens :
- L'URL Vercel HTTPS de la PWA
- Un fichier `chimie-piscine.apk` prêt à transférer sur ton Android

### Option B — GitHub Actions automatique

1. Crée un repo `chimie-piscine` sur GitHub :
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git remote add origin https://github.com/yannickuhrig1/chimie-piscine.git
   git push -u origin main
   ```

2. Connecte ton repo à Vercel (via dashboard Vercel → Import Git Repository)
   → déploiement HTTPS automatique à chaque push

3. Configure une variable de repo GitHub :
   - Settings → Variables → Actions → New variable
   - Nom : `PWA_URL` · Valeur : `https://chimie-piscine.vercel.app` (ou ton URL)

4. Le workflow `.github/workflows/build-apk.yml` build automatiquement l'APK à chaque push
   → Onglet Actions → dernier run → télécharge l'artifact `chimie-piscine-apk`

5. Pour créer une release officielle avec APK attaché :
   ```bash
   git tag v1.0.0
   git push origin v1.0.0
   ```

### Option C — Déploiement manuel étape par étape

```bash
# 1. Déployer sur Vercel
npx vercel --prod

# 2. Noter l'URL retournée (ex: https://chimie-piscine-xxx.vercel.app)

# 3. Générer l'APK avec Bubblewrap
mkdir apk-build && cd apk-build
npx @bubblewrap/cli init --manifest=https://TON-URL.vercel.app/manifest.json
npx @bubblewrap/cli build
# → app-release-signed.apk généré
```

Ou via interface web : https://www.pwabuilder.com → entre l'URL → "Package for stores" → Android → Signed APK.

## 📱 Installation de l'APK sur Android

1. Transfère `chimie-piscine.apk` sur ton téléphone (USB, Google Drive, lien direct...)
2. Active "Sources inconnues" dans Paramètres → Sécurité (si demandé)
3. Ouvre le fichier APK → Installer
4. L'icône goutte d'eau apparaît sur ton écran d'accueil
5. L'app s'ouvre en plein écran sans barre Chrome

## ✨ Fonctionnalités

### Calculs & corrections
- pH : acide chlorhydrique + poudre pH-
- Chlore : chloration quotidienne, choc ×5-10, superchloration (chloramines)
- TAC+ (alcalinité)
- Calculateurs avancés : sel (électrolyse), TH/dureté (chlorure de calcium), phosphates, brome
- Indice de Langelier (LSI) : équilibre corrosif / entartrant
- Détection auto du chlore combiné (Ccl > 0.6 ppm → superchloration)

### Suivi
- Historique des mesures (localStorage, persistant) + **modale détail** par mesure (onglets *Mesures* / *Actions à suivre*)
- Graphiques d'évolution pH/Cl, TAC/CYA et désinfection (zones de chlore selon le CYA, chlore actif HOCl — modèle O'Brien)
- **Carte Tendances** : régression linéaire pH 14 j, alertes consommation Cl excessive, chute TAC, CYA > 40, absence de mesure depuis 3+ j
- Rappels quotidien, hebdo, lavage filtre via **notifications push serveur** (Supabase Edge Function + pg_cron — arrivent même app fermée)
- **Partage du contrôle en image** : génère un PNG stylé (Web Share natif sur mobile, sinon téléchargement) avec mesures + actions à suivre
- **Wizard de premier lancement** (volume, désinfection, marque de bandelette) et **aides contextuelles** désactivables

### Contact & admin
- Rubrique Contact : envoi de messages transformés en tickets (Supabase)
- Notifications automatiques email (Resend) + Discord (Notifiarr) à chaque ticket
- Page admin protégée par mot de passe (`/#admin` ou lien in-app dans la page Contact) : consulter, clôturer, supprimer les tickets
- **Rate limit serveur** : 5 tentatives échouées / 15 min par IP → blocage 15 min, IP hashée SHA-256+pepper (jamais stockée en clair), purge auto à 30 j

### Technique
- PWA installable + APK Android, fonctionne hors ligne (service worker)
- Import/Export JSON
- ESLint en CI (GitHub Actions) pour catcher les refs orphelines avant production
- Toast « Nouvelle version dispo · Recharger » à chaque mise à jour du service worker

Voir [`CHANGELOG.md`](CHANGELOG.md) pour le détail des versions.

## 📂 Structure

```
chimie-piscine/
├── index.html              # UI principale
├── app.js                  # Logique + calculs (APP_VERSION en tête)
├── sw.js                   # Service worker
├── manifest.json           # Manifest PWA
├── vercel.json             # Config Vercel (headers PWA)
├── icon-192.png            # Icône Android
├── icon-512.png            # Icône splash
├── deploy.sh               # Script déploiement + APK tout-en-un
├── .github/workflows/
│   ├── build-apk.yml       # CI/CD GitHub Actions (APK auto)
│   └── lint.yml            # ESLint sur chaque push
├── .eslintrc.json          # Config ESLint (browser + serviceworker)
├── CHANGELOG.md            # Historique des versions
└── README.md
```

Le backend Contact (table `messages` + Edge Functions de notification) est hébergé sur Supabase, hors de ce dépôt.

## 🔧 Configuration TWA (APK)

Le package Android utilise :
- **Package ID** : `fr.yannickuhrig.chimiepiscine`
- **Couleur de thème** : `#0a3d62` (deep teal)
- **Splash screen** : `#041d2e` (abyss)
- **Icônes adaptatives** depuis `icon-512.png`
- **Notifications** activées
- **Min SDK** : 21 (Android 5.0+)

## 🔐 Données

Les **mesures et l'historique du bassin** sont stockés en `localStorage` du navigateur intégré (TWA) — ils ne quittent jamais l'appareil. L'APK et la PWA web partagent automatiquement les mêmes données via le même domaine.

Sont transmis vers Supabase :
- Les **messages du formulaire Contact** (tickets de support + notifications email/Discord)
- Les **abonnements push** (endpoint web-push uniquement, pas de données de bassin) pour permettre l'envoi des rappels serveur même app fermée
- Les **tentatives de connexion admin** (uniquement IP **hashée** SHA-256 + pepper + success/fail) pour le rate limit — l'IP réelle n'est jamais stockée, purge automatique à 30 j

## 🚀 Pour publier sur Play Store

1. Génère un AAB au lieu d'un APK : `bubblewrap build --target=appbundle`
2. Crée un compte Google Play Developer (25 USD une fois)
3. Configure le Digital Asset Links avec `assetlinks.json`
4. Upload le `.aab` sur la Play Console

Le workflow GitHub Actions génère déjà aussi le `.aab` en artifact.
