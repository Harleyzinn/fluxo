import { execFileSync } from 'node:child_process';
import { access, readFile, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const baselineApk = process.env.BASELINE_APK, candidateApk = process.env.CANDIDATE_APK;
assert.ok(baselineApk && candidateApk, 'BASELINE_APK and CANDIDATE_APK are required');
await access(baselineApk); await access(candidateApk);
const adb = `${process.env.ANDROID_HOME}/platform-tools/adb.exe`;
const serial = process.env.ANDROID_SERIAL || 'emulator-5554';
const interleaved = process.env.METRICS_ORDER === 'interleaved';
const install = apk => execFileSync(adb, ['-s', serial, 'install', '-r', '-d', apk], { encoding: 'utf8', timeout: 60000 });
const samples = { baseline: [], candidate: [] };
try {
  const versions = [['baseline', baselineApk], ['candidate', candidateApk]];
  const plan = interleaved ? [1, 2, 3].flatMap(run => versions.map(([name, apk]) => ({ name, apk, runs: [run + 10] })))
    : versions.map(([name, apk]) => ({ name, apk, runs: [1, 2, 3] }));
  for (const { name, apk, runs } of plan) {
    console.log(install(apk));
    for (const run of runs) {
      execFileSync(process.execPath, ['tests/native-idle-metrics.mjs'], { stdio: 'inherit', timeout: 90000,
        env: { ...process.env, FOCUS_BASELINE: name === 'baseline' ? '1' : '0', METRICS_RUN: String(run) } });
      samples[name].push(JSON.parse(await readFile(`.qa/idle-${name === 'baseline' ? 'baseline' : 'fixed'}-${run}.json`, 'utf8')));
    }
  }
  const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
  const summary = Object.fromEntries(Object.entries(samples).map(([name, rows]) => [name, {
    medianLaunchMs: median(rows.map(r => r.totalLaunchMs)), medianPssKb: median(rows.map(r => r.pssKb)),
    idleEvents: rows.map(r => r.unsolicitedStateEvents), servicesPresent: rows.map(r => r.servicePresent)
  }]));
  assert.ok(samples.candidate.every(r => r.unsolicitedStateEvents === 0 && !r.servicePresent));
  await writeFile(`.qa/idle-comparison${interleaved ? '-interleaved' : ''}.json`, JSON.stringify({ interleaved, samples, summary }, null, 2)); console.log(summary);
} finally { console.log(install(candidateApk)); }
