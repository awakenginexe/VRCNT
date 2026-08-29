import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const buildScript = path.resolve(testDirectory, '../../../../scripts/build_tauri.ps1');

function previewBuild({ signingKey } = {}) {
  const environment = { ...process.env };
  delete environment.TAURI_SIGNING_PRIVATE_KEY;
  delete environment.TAURI_SIGNING_PRIVATE_KEY_PASSWORD;
  if (signingKey) {
    environment.TAURI_SIGNING_PRIVATE_KEY = signingKey;
  }

  return execFileSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      buildScript,
      '-DryRun',
    ],
    { encoding: 'utf8', env: environment, stdio: 'pipe' },
  );
}

test('local Tauri builds create only the reusable shell without a public installer bundle', { skip: process.platform !== 'win32' }, () => {
  assert.equal(previewBuild().trim(), 'build --no-bundle');
});

test('release Tauri shell builds do not depend on signing keys or NSIS updater output', { skip: process.platform !== 'win32' }, () => {
  assert.equal(previewBuild({ signingKey: 'test-signing-key' }).trim(), 'build --no-bundle');
});
