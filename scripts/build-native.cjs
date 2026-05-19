const { mkdirSync } = require('node:fs');
const { dirname, join } = require('node:path');
const { spawnSync } = require('node:child_process');

const root = dirname(__dirname);

if (process.platform !== 'darwin') {
  console.log('skip native EventKit helper: current platform is not macOS');
  process.exit(0);
}

const arch = process.env.npm_config_arch || process.arch;
const targetArch = arch === 'x64' ? 'x86_64' : 'arm64';
const eventKitSource = join(root, 'native', 'EventKitBridge.swift');
const eventKitPlist = join(root, 'native', 'EventKitBridge-Info.plist');
const eventKitOutput = join(root, 'dist-electron', 'native', 'eventkit-bridge');
const statusBarSource = join(root, 'native', 'StatusBarHelper.swift');
const statusBarOutput = join(root, 'dist-electron', 'native', 'status-bar-helper');

mkdirSync(dirname(eventKitOutput), { recursive: true });

runSwiftc([
  eventKitSource,
  '-target',
  `${targetArch}-apple-macos13.0`,
  '-framework',
  'EventKit',
  '-O',
  '-Xlinker',
  '-sectcreate',
  '-Xlinker',
  '__TEXT',
  '-Xlinker',
  '__info_plist',
  '-Xlinker',
  eventKitPlist,
  '-o',
  eventKitOutput
]);

runSwiftc([
  statusBarSource,
  '-target',
  `${targetArch}-apple-macos13.0`,
  '-framework',
  'AppKit',
  '-O',
  '-o',
  statusBarOutput
]);

function runSwiftc(args) {
  const result = spawnSync('xcrun', ['swiftc', ...args], {
    cwd: root,
    stdio: 'inherit'
  });

  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}
