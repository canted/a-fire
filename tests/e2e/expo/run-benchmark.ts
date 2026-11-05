import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const exec = promisify(execFile);
const [platform, device] = process.argv.slice(2);
if (!['ios', 'android'].includes(platform) || !device) throw new Error('Usage: run-benchmark.ts ios|android DEVICE_ID');
const evidence = resolve(process.env.EXPO_NATIVE_EVIDENCE || `/tmp/afire-profile-${platform}`);
const app = 'co.canted.afire.preview.localhttps';
const adb = process.env.ADB_BIN || `${process.env.ANDROID_HOME}/platform-tools/adb`;
await mkdir(evidence, { recursive: true });
for (let repetition = 1; repetition <= 3; repetition++) {
  for (const count of [70, 500, 2000]) {
    const output = `${evidence}/${count}-${repetition}`;
    await mkdir(output, { recursive: true });
    if (platform === 'android') await exec(adb, ['-s', device, 'shell', 'dumpsys', 'gfxinfo', app, 'reset']);
    await new Promise<void>((done, reject) => {
      const child = spawn(process.env.MAESTRO_BIN || 'maestro', ['--device', device, 'test', '--test-output-dir', output, '-e', `COUNT=${count}`, 'tests/e2e/expo/https-room-navigation.yaml'], {
        stdio: 'inherit', env: { ...process.env, MAESTRO_CLI_NO_ANALYTICS: '1', MAESTRO_CLI_ANALYSIS_NOTIFICATION_DISABLED: 'true' },
      });
      child.once('error', reject);
      child.once('exit', code => code === 0 ? done() : reject(new Error(`Benchmark ${count}/${repetition} failed (${code})`)));
    });
    if (platform === 'android') {
      // Maestro starts a fresh device log for each flow. Preserve each sample
      // before the next invocation clears it.
      const sampleLogs = await exec(adb, ['-s', device, 'logcat', '-d', '-s', 'ReactNativeJS:I'], { maxBuffer: 8 * 1024 * 1024 });
      await writeFile(`${output}/benchmark.log`, sampleLogs.stdout.split('\n').filter(line => /\[Room (benchmark|reading)\]/.test(line)).join('\n'));
      await writeFile(`${output}/memory.txt`, (await exec(adb, ['-s', device, 'shell', 'dumpsys', 'meminfo', app])).stdout);
      await writeFile(`${output}/frames.txt`, (await exec(adb, ['-s', device, 'shell', 'dumpsys', 'gfxinfo', app])).stdout);
    } else {
      const processRows = (await exec('ps', ['-axo', 'pid,rss,comm'])).stdout.split('\n');
      await writeFile(`${output}/memory.txt`, processRows.filter(row => row.includes('AFireLocalHTTPS.app/')).join('\n'));
    }
  }
}
const logs = platform === 'android'
  ? await exec(adb, ['-s', device, 'logcat', '-d', '-s', 'ReactNativeJS:I'], { maxBuffer: 8 * 1024 * 1024 })
  : await exec('xcrun', ['simctl', 'spawn', device, 'log', 'show', '--last', '15m', '--info', '--debug', '--predicate', 'process == "AFireLocalHTTPS" AND eventMessage CONTAINS "Room benchmark"', '--style', 'compact'], { maxBuffer: 8 * 1024 * 1024 });
await writeFile(`${evidence}/benchmark.log`, logs.stdout.split('\n').filter(line => line.includes('[Room benchmark]')).join('\n'));
console.log(`PASS ${platform}: nine Home/Room navigation samples; evidence ${evidence}`);
