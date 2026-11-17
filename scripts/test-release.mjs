// Exercise publishing with a locally re-signed fixture; nothing is uploaded.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import { spawnSync } from 'node:child_process'

const root = resolve(import.meta.dirname, '..')
const require = createRequire(join(root, 'web/package.json'))
const { unzipSync, zipSync, strToU8 } = require('fflate')
const temp = mkdtempSync(join(tmpdir(), 'jianliao-release-test-'))
const version = readFileSync(join(root, 'version.properties'), 'utf8').match(/^versionName=(.+)$/m)[1].trim()
const apk = join(root, 'artifacts', 'jianliao-' + version + '-preview.apk')
function publish(args) {
  return spawnSync(process.execPath, [join(root, 'scripts/prepare-release.mjs'), ...args], { encoding: 'utf8', windowsHide: true })
}
try {
  const verified = publish(['--verify-only', '--apk', apk])
  assert.equal(verified.status, 0, verified.stderr)
  const report = JSON.parse(verified.stdout)
  assert.equal(report.versionName, version)
  assert.equal(report.manifestUrl, 'https://github.com/jinc3476-gif/cj-s-ds/releases/latest/download/latest.json')
  const disabled = publish(['--apk', apk, '--repo', 'wrong/repo'])
  assert.notEqual(disabled.status, 0)
  assert.match(disabled.stderr, /does not match the URL embedded/)

  const files = unzipSync(readFileSync(apk))
  files['assets/update-config.json'] = strToU8(JSON.stringify({ manifestUrl: 'https://github.com/jinc3476-gif/cj-s-ds/releases/latest/download/latest.json' }))
  for (const name of Object.keys(files)) if (/^META-INF\/.*(\.SF|\.RSA|\.DSA|\.EC|MANIFEST\.MF)$/i.test(name)) delete files[name]
  const unsigned = join(temp, 'unsigned.apk'), signed = join(temp, 'fixture.apk')
  writeFileSync(unsigned, zipSync(files))
  const sign = spawnSync(join(root, '.tooling/jdk/jdk-17.0.13+11/bin/java.exe'), [
    '-jar', join(root, '.tooling/android-sdk/build-tools/34.0.0/lib/apksigner.jar'), 'sign',
    '--ks', join(root, '.signing/jianliao-preview.keystore'), '--ks-key-alias', 'androiddebugkey',
    '--ks-pass', 'pass:android', '--key-pass', 'pass:android', '--out', signed, unsigned,
  ], { encoding: 'utf8', windowsHide: true })
  assert.equal(sign.status, 0, sign.stderr)
  const output = join(temp, 'release')
  const prepared = publish(['--apk', signed, '--repo', 'jinc3476-gif/cj-s-ds', '--output', output])
  assert.equal(prepared.status, 0, prepared.stderr)
  const metadata = JSON.parse(readFileSync(join(output, 'latest.json'), 'utf8'))
  assert.equal(metadata.versionCode, report.versionCode)
  assert.equal(metadata.applicationId, report.applicationId)
  assert.equal(metadata.minSdk, report.minSdk)
  assert.equal(metadata.apkUrl, 'https://github.com/jinc3476-gif/cj-s-ds/releases/download/v' + version + '/jianliao-' + version + '-' + report.versionCode + '.apk')
  assert.equal(metadata.size, readFileSync(signed).length)
  assert.equal(metadata.sha256, createHash('sha256').update(readFileSync(signed)).digest('hex'))
  assert.deepEqual(readFileSync(join(output, new URL(metadata.apkUrl).pathname.split('/').pop())), readFileSync(signed))
  const mismatch = publish(['--apk', signed, '--repo', 'someone/else', '--output', output])
  assert.notEqual(mismatch.status, 0)
  assert.match(mismatch.stderr, /does not match/)
  const uppercaseRepo = publish(['--apk', signed, '--repo', 'JINC3476-GIF/CJ-S-DS', '--output', output])
  assert.equal(uppercaseRepo.status, 0, uppercaseRepo.stderr)
  console.log('PASS APK verification, wrong-repository rejection, signed release generation, manifest contents and case-insensitive repository match (5 checks)')
} finally {
  // This is the exact temporary directory returned by mkdtempSync above.
  rmSync(temp, { recursive: true, force: true })
}
