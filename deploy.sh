#!/bin/bash
# Script tout-en-un : déploie sur Vercel + génère APK
# Usage: ./deploy.sh

set -e

echo "🌊 Chimie Piscine - Déploiement & APK"
echo "======================================"
echo ""

# 1. Vérifier les outils
command -v vercel >/dev/null 2>&1 || { echo "→ Installation de vercel..."; npm install -g vercel; }
command -v bubblewrap >/dev/null 2>&1 || { echo "→ Installation de bubblewrap..."; npm install -g @bubblewrap/cli; }

# 2. Déploiement Vercel
echo "📤 Déploiement sur Vercel..."
DEPLOY_OUTPUT=$(vercel --prod --yes 2>&1)
echo "$DEPLOY_OUTPUT"

# Extraire l'URL
PWA_URL=$(echo "$DEPLOY_OUTPUT" | grep -oE 'https://[a-zA-Z0-9.-]+\.vercel\.app' | tail -1)

if [ -z "$PWA_URL" ]; then
  echo "❌ Échec extraction URL. Lance manuellement avec : ./deploy.sh <url>"
  exit 1
fi

echo "✅ Déployé : $PWA_URL"
echo ""

# 3. Vérifier que la PWA est valide
echo "🔍 Vérification du manifest..."
curl -sf "$PWA_URL/manifest.json" >/dev/null && echo "  ✓ manifest.json OK" || echo "  ⚠️  manifest.json indisponible"
curl -sf "$PWA_URL/sw.js" >/dev/null && echo "  ✓ sw.js OK" || echo "  ⚠️  sw.js indisponible"
echo ""

# 4. Génération de l'APK
echo "📱 Génération de l'APK..."
mkdir -p apk-build
cd apk-build

# Si pas de keystore, en créer un
if [ ! -f "android.keystore" ]; then
  echo "→ Création de la clé de signature..."
  keytool -genkey -v -keystore android.keystore \
    -alias android -keyalg RSA -keysize 2048 -validity 10000 \
    -storepass chimiepiscine -keypass chimiepiscine \
    -dname "CN=Yannick Uhrig, O=Personal, C=FR" 2>/dev/null
fi

# Init bubblewrap
if [ ! -f "twa-manifest.json" ]; then
  bubblewrap init --manifest="$PWA_URL/manifest.json" --directory=.
fi

# Build
bubblewrap build --skipPwaValidation

# Trouver l'APK
APK=$(find . -name "*-release-signed.apk" | head -1)
if [ -z "$APK" ]; then
  APK=$(find . -name "*.apk" | head -1)
fi

cd ..
cp "apk-build/$APK" "chimie-piscine.apk" 2>/dev/null || cp "$APK" "chimie-piscine.apk"

echo ""
echo "🎉 Terminé !"
echo "   PWA : $PWA_URL"
echo "   APK : chimie-piscine.apk"
echo ""
echo "→ Transfère chimie-piscine.apk sur ton Android et installe-le"
