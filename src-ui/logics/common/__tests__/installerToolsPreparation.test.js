import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const prepareScript = path.resolve(
  testDirectory,
  '../../../../scripts/prepare_installer_tools.ps1',
);

test('installer tool preparation accepts a complete bundled tool set', { skip: process.platform !== 'win32' }, () => {
  const toolDirectory = mkdtempSync(path.join(os.tmpdir(), 'vrcnt-installer-tools-'));

  try {
    for (const tool of ['7za.exe', 'minisign.exe', 'VRCNT.ReleaseHelper.exe']) {
      writeFileSync(path.join(toolDirectory, tool), 'test-tool');
    }

    assert.doesNotThrow(() => {
      execFileSync(
        'powershell.exe',
        [
          '-NoProfile',
          '-ExecutionPolicy',
          'Bypass',
          '-File',
          prepareScript,
          '-ToolDir',
          toolDirectory,
          '-CheckOnly',
        ],
        { encoding: 'utf8', stdio: 'pipe' },
      );
    });
  } finally {
    rmSync(toolDirectory, { recursive: true, force: true });
  }
});
