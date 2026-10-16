#!/bin/bash
# Gera APKs de debug dos dois apps. Requer JDK 21 e Android SDK (ANDROID_HOME).
set -e
cd "$(dirname "$0")/.."
export ANDROID_HOME=${ANDROID_HOME:-$HOME/android}
sh scripts/copy-shared.sh
mkdir -p /workspace/eja-apks
for app in cliente motoboy; do
  (cd apps/$app && npx cap sync android && cd android && ./gradlew -q assembleDebug $([ -f keystore.properties ] && echo bundleRelease))
  cp apps/$app/android/app/build/outputs/apk/debug/app-debug.apk /workspace/eja-apks/eja-$app-debug.apk
  [ -f apps/$app/android/app/build/outputs/bundle/release/app-release.aab ] && cp apps/$app/android/app/build/outputs/bundle/release/app-release.aab /workspace/eja-apks/eja-$app-release.aab || true
done
ls -la /workspace/eja-apks
