#!/usr/bin/env node
/**
 * Keep the gitignored android tree Play-ready without expo prebuild.
 * Sideload builds stay on com.anonymous.warthogwallet.
 * bundleRelease -PplayStore=true switches the id to org.warthog.wallet.
 * Safe to run repeatedly.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const gradlePath = path.join(root, 'android', 'app', 'build.gradle');
const manifestPath = path.join(root, 'android', 'app', 'src', 'main', 'AndroidManifest.xml');

const playFlag = `def playStore = (findProperty('playStore') ?: 'false').toBoolean()`;
const playApplicationId = `applicationId playStore ? 'org.warthog.wallet' : 'com.anonymous.warthogwallet'`;
const sideloadApplicationId = `applicationId 'com.anonymous.warthogwallet'`;
const symbolLevel = `debugSymbolLevel 'SYMBOL_TABLE'`;

const releaseNsc = `<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
    <base-config cleartextTrafficPermitted="false" />
</network-security-config>
`;
const debugNsc = `<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
    <base-config cleartextTrafficPermitted="true" />
</network-security-config>
`;

function writeIfChanged(file, contents) {
  const prev = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
  if (prev === contents) return false;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, contents);
  return true;
}

if (!fs.existsSync(gradlePath)) {
  console.error('android/app/build.gradle not found');
  process.exit(1);
}

let gradle = fs.readFileSync(gradlePath, 'utf8');
let gradleChanged = false;

if (!gradle.includes(playFlag)) {
  const anchor = 'android {';
  const at = gradle.indexOf(anchor);
  if (at < 0) {
    console.error('Could not find android block in build.gradle');
    process.exit(1);
  }
  gradle = `${gradle.slice(0, at)}${playFlag}\n\n${gradle.slice(at)}`;
  gradleChanged = true;
}

if (!gradle.includes(playApplicationId)) {
  if (!gradle.includes(sideloadApplicationId)) {
    console.error('Could not find the sideload applicationId to switch');
    process.exit(1);
  }
  gradle = gradle.replace(sideloadApplicationId, playApplicationId);
  gradleChanged = true;
}

if (!gradle.includes(symbolLevel)) {
  const versionName = gradle.match(/versionName "[^"]+"/);
  if (!versionName) {
    console.error('Could not find versionName in build.gradle');
    process.exit(1);
  }
  const insertAt = gradle.indexOf(versionName[0]) + versionName[0].length;
  gradle =
    gradle.slice(0, insertAt) +
    `\n\n        ndk {\n            ${symbolLevel}\n        }` +
    gradle.slice(insertAt);
  gradleChanged = true;
}

if (gradleChanged) {
  fs.writeFileSync(gradlePath, gradle);
  console.log('Updated android/app/build.gradle for Play Store builds');
} else {
  console.log('Play Store gradle settings already applied');
}

if (!fs.existsSync(manifestPath)) {
  console.error('AndroidManifest.xml not found');
  process.exit(1);
}

let manifest = fs.readFileSync(manifestPath, 'utf8');
let manifestChanged = false;

if (!manifest.includes('android:usesCleartextTraffic="false"')) {
  manifest = manifest.replace(
    '<application ',
    '<application android:usesCleartextTraffic="false" android:networkSecurityConfig="@xml/network_security_config" ',
  );
  manifestChanged = true;
}

if (!manifest.includes('com.google.android.gms.permission.AD_ID')) {
  manifest = manifest.replace(
    '<uses-permission android:name="android.permission.CAMERA"/>',
    `<uses-permission android:name="android.permission.CAMERA"/>
  <uses-permission android:name="com.google.android.gms.permission.AD_ID" tools:node="remove"/>
  <uses-permission android:name="android.permission.QUERY_ALL_PACKAGES" tools:node="remove"/>
  <uses-feature android:name="android.hardware.camera" android:required="false"/>
  <uses-feature android:name="android.hardware.camera.autofocus" android:required="false"/>`,
  );
  manifestChanged = true;
}

if (manifestChanged) {
  fs.writeFileSync(manifestPath, manifest);
  console.log('Updated AndroidManifest.xml');
} else {
  console.log('Manifest Play settings already applied');
}

const xmlWrites = [
  [path.join(root, 'android/app/src/main/res/xml/network_security_config.xml'), releaseNsc],
  [path.join(root, 'android/app/src/debug/res/xml/network_security_config.xml'), debugNsc],
  [path.join(root, 'android/app/src/debugOptimized/res/xml/network_security_config.xml'), debugNsc],
];
for (const [file, contents] of xmlWrites) {
  if (writeIfChanged(file, contents)) console.log('Wrote', path.relative(root, file));
}
