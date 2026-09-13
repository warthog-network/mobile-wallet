#!/usr/bin/env node
/**
 * After `npx expo prebuild`, re-apply release signing so we never fall back
 * to debug.keystore. Safe to run repeatedly.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const gradlePath = path.join(root, 'android', 'app', 'build.gradle');

if (!fs.existsSync(gradlePath)) {
  console.error('android/app/build.gradle not found — run expo prebuild first');
  process.exit(1);
}

let src = fs.readFileSync(gradlePath, 'utf8');
const ksPath = 'rootProject.file("../.secrets/keystore.properties")';
let changed = false;

const debugBlock = `signingConfigs {
        debug {
            storeFile file('debug.keystore')
            storePassword 'android'
            keyAlias 'androiddebugkey'
            keyPassword 'android'
        }
    }`;

const releaseBlock = `signingConfigs {
        debug {
            storeFile file('debug.keystore')
            storePassword 'android'
            keyAlias 'androiddebugkey'
            keyPassword 'android'
        }
        release {
            def ksPropsFile = ${ksPath}
            if (!ksPropsFile.exists()) {
                throw new GradleException(
                    "Release keystore missing. Copy keystore.properties.example to .secrets/keystore.properties and generate a PKCS12 keystore."
                )
            }
            def ks = new Properties()
            ksPropsFile.withInputStream { ks.load(it) }
            storeFile rootProject.file("../.secrets/" + ks['storeFile'])
            storePassword ks['storePassword']
            keyAlias ks['keyAlias']
            keyPassword ks['keyPassword']
        }
    }`;

if (!src.includes(ksPath)) {
  if (!src.includes(debugBlock)) {
    console.error('Could not find default Expo debug signingConfigs block to replace');
    process.exit(1);
  }
  src = src.replace(debugBlock, releaseBlock);
  changed = true;
}

// Anchor on buildTypes so signingConfigs.release is not matched first.
const debugType = src.replace(
  /(buildTypes\s*\{[\s\S]*?debug\s*\{[\s\S]*?)signingConfig signingConfigs\.\w+/,
  '$1signingConfig signingConfigs.debug',
);
if (debugType !== src) {
  src = debugType;
  changed = true;
}
const releaseType = src.replace(
  /(buildTypes\s*\{[\s\S]*?release\s*\{[\s\S]*?)signingConfig signingConfigs\.\w+/,
  '$1signingConfig signingConfigs.release',
);
if (releaseType !== src) {
  src = releaseType;
  changed = true;
}

if (!/buildTypes\s*\{[\s\S]*?release\s*\{[\s\S]*?signingConfig signingConfigs\.release/.test(src)) {
  console.error('Could not point release buildType at signingConfigs.release');
  process.exit(1);
}

if (changed) {
  fs.writeFileSync(gradlePath, src);
  console.log('Applied release signing to android/app/build.gradle');
} else {
  console.log('Release signing already applied');
}
