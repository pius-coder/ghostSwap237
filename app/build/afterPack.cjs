// afterPack.cjs — electron-builder afterPack hook
// Copies the 3 required Windows 11 camera binaries from the MSVC outputs
// into resources/henshin-cam/ inside the packaged app.
// This runs AFTER electron-builder packages the app but BEFORE the installer
// is created, so the binaries are bundled into the final installer.

'use strict';

const fs   = require('fs');
const path = require('path');

const BINARIES = [
  ['registrar/build/Release/henshin-vcam-register.exe', 'henshin-vcam-register.exe'],
  ['publisher/build/Release/henshin-vcam-publisher.exe', 'henshin-vcam-publisher.exe'],
  ['driver/build/Release/henshin-vcam.dll', 'henshin-vcam.dll'],
];

exports.default = async function afterPack(context) {
  const { appOutDir } = context;

  // Source: native-camera-v2 component Release outputs.
  const repoRoot = path.resolve(__dirname, '..', '..');
  const configuredBinDir = String(process.env.HENSHIN_NATIVE_BIN_DIR || '').trim();
  const srcDir = configuredBinDir
    ? path.resolve(repoRoot, configuredBinDir)
    : path.join(repoRoot, 'native-camera-v2');

  // Destination: <packaged-app>/resources/henshin-cam/
  const dstDir = path.join(appOutDir, 'resources', 'henshin-cam');

  if (!fs.existsSync(srcDir)) {
    throw new Error(
      `[afterPack] Native binaries source dir not found: ${srcDir}\n` +
      `  Run: bun run camera:build`
    );
  }

  fs.mkdirSync(dstDir, { recursive: true });

  const missing = [];
  for (const [relativeSource, outputName] of BINARIES) {
    const src = path.join(srcDir, relativeSource);
    const dst = path.join(dstDir, outputName);
    if (!fs.existsSync(src)) {
      missing.push(src);
      continue;
    }
    fs.copyFileSync(src, dst);
    console.log(`[afterPack] Bundled: ${outputName}`);
  }

  if (missing.length > 0) {
    throw new Error(
      '[afterPack] Missing native camera binaries:\n' +
      missing.map((file) => `  - ${file}`).join('\n')
    );
  }

  console.log('[afterPack] All native camera binaries bundled successfully');
};
