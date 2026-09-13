# start the expo dev server with a fresh cache (see README)
start:
    npx expo start -c

# Play Store Android App Bundle (requires .secrets/keystore.properties)
android-bundle:
    npx expo prebuild --platform android
    node scripts/apply-release-signing.mjs
    cd android && ./gradlew bundleRelease
