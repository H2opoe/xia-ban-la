const { mkdirSync } = require('node:fs');
const { dirname, join } = require('node:path');
const { spawnSync } = require('node:child_process');

const root = dirname(__dirname);

if (process.platform !== 'darwin') {
  console.log('skip native EventKit helper: current platform is not macOS');
  process.exit(0);
}

const eventKitSource = join(root, 'native', 'EventKitBridge.swift');
const eventKitPlist = join(root, 'native', 'EventKitBridge-Info.plist');
const eventKitOutput = join(root, 'dist-electron', 'native', 'eventkit-bridge');
const statusBarSource = join(root, 'native', 'StatusBarHelper.swift');
const statusBarOutput = join(root, 'dist-electron', 'native', 'status-bar-helper');
const universalArchs = ['arm64', 'x86_64'];

mkdirSync(dirname(eventKitOutput), { recursive: true });

buildUniversalBinary({
  source: eventKitSource,
  output: eventKitOutput,
  framework: 'EventKit',
  plist: eventKitPlist
});

buildUniversalBinary({
  source: statusBarSource,
  output: statusBarOutput,
  framework: 'AppKit'
});

function buildUniversalBinary({ source, output, framework, plist }) {
  const archOutputs = universalArchs.map((targetArch) => {
    const archOutput = `${output}-${targetArch}`;
    const args = [
      source,
      '-target',
      `${targetArch}-apple-macos13.0`,
      '-framework',
      framework,
      '-O',
      '-o',
      archOutput
    ];

    if (plist) {
      args.splice(
        args.length - 2,
        0,
        '-Xlinker',
        '-sectcreate',
        '-Xlinker',
        '__TEXT',
        '-Xlinker',
        '__info_plist',
        '-Xlinker',
        plist
      );
    }

    runSwiftc(args);
    return archOutput;
  });

  runCommand('lipo', ['-create', ...archOutputs, '-output', output]);
}

function runSwiftc(args) {
  runCommand('xcrun', ['swiftc', ...args]);
}

function runCommand(command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: 'inherit'
  });

  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}
