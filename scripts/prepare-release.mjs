import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { readFileSync, writeFileSync, mkdirSync, existsSync, copyFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { parseArgs } from 'node:util'

const root = resolve(import.meta.dirname, '..')
const { values } = parseArgs({ options: {
  repo: { type: 'string' }, apk: { type: 'string' }, output: { type: 'string' },
  'notes-file': { type: 'string' }, 'verify-only': { type: 'boolean', default: false },
} })
function run(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8', windowsHide: true })
  if (result.error || result.status !== 0) throw new Error(result.error?.message ?? result.stderr ?? 'Command failed')
  return result.stdout
}
function https(value) {
  const url = new URL(value)
  if (url.protocol !== 'https:' || url.username || url.password || url.hash) throw new Error('An HTTPS URL without credentials or a fragment is required')
  return url
}
const version = readFileSync(join(root, 'version.properties'), 'utf8').match(/^versionName=(.+)$/m)?.[1]?.trim()
const apk = resolve(values.apk ?? join(root, 'artifacts', 'jianliao-' + version + '-preview.apk'))
const sdk = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT ?? join(root, '.tooling/android-sdk')
const buildTools = process.env.ANDROID_BUILD_TOOLS ?? join(sdk, 'build-tools/34.0.0')
const bundledJava = join(root, '.tooling/jdk/jdk-17.0.13+11/bin/java.exe')
const java = process.env.JAVA_HOME ? join(process.env.JAVA_HOME, 'bin', process.platform === 'win32' ? 'java.exe' : 'java') : existsSync(bundledJava) ? bundledJava : 'java'
const badging = run(join(buildTools, process.platform === 'win32' ? 'aapt.exe' : 'aapt'), ['dump', 'badging', apk])
const name = badging.match(/^package: name='([^']+)' versionCode='(\d+)' versionName='([^']+)'/m)
const minSdk = Number(badging.match(/^sdkVersion:'(\d+)'/m)?.[1])
if (!name || name[1] !== 'com.dklabs.jianliao' || !minSdk) throw new Error('Not a valid Jianliao APK')
const signature = run(java, ['-jar', join(buildTools, 'lib/apksigner.jar'), 'verify', '--print-certs', apk])
const certs = [...signature.matchAll(/^Signer #\d+ certificate SHA-256 digest: ([a-f0-9]+)\r?$/gm)].map(match => match[1])
const expectedCert = readFileSync(join(root, 'signing-certificate.sha256'), 'utf8').trim()
if (certs.length !== 1 || certs[0] !== expectedCert) throw new Error('APK signing certificate does not match the installed preview app')
const bytes = readFileSync(apk)
const require = createRequire(join(root, 'web/package.json'))
const { unzipSync, strFromU8 } = require('fflate')
const files = unzipSync(bytes, { filter: entry => ['assets/update-config.json', 'assets/index.html'].includes(entry.name) })
if (!files['assets/update-config.json']) throw new Error('APK does not include update support')
const config = JSON.parse(strFromU8(files['assets/update-config.json']))
const html = strFromU8(files['assets/index.html'] ?? new Uint8Array())
if (!html.includes('name="application-version" content="' + name[3] + '"') && !html.includes('content="' + name[3] + '" name="application-version"')) {
  throw new Error('Bundled web version is stale; rebuild without -SkipWeb')
}
const report = { apk, applicationId: name[1], versionCode: Number(name[2]), versionName: name[3], minSdk,
  size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), certificateSha256: certs[0], manifestUrl: config.manifestUrl }
if (values['verify-only']) {
  console.log(JSON.stringify(report, null, 2))
} else {
  if (!config.manifestUrl) throw new Error('Update hosting is not configured in this APK. Set update.properties and rebuild before preparing a release.')
  const manifestUrl = https(config.manifestUrl)
  const repoMatch = manifestUrl.hostname === 'github.com'
    ? manifestUrl.pathname.match(/^\/([^/]+)\/([^/]+)\/releases\/latest\/download\/latest\.json$/)
    : null
  if (!repoMatch) throw new Error('The configured update URL must be a GitHub latest.json release asset URL')
  const repo = repoMatch[1] + '/' + repoMatch[2].replace(/\.git$/, '')
  if (values.repo && values.repo.toLowerCase() !== repo.toLowerCase()) throw new Error('The selected GitHub repository does not match the URL embedded in the APK')
  const history = JSON.parse(readFileSync(join(root, 'release-history.json'), 'utf8'))
  if (history[0]?.version !== name[3]) throw new Error('The release history must begin with the APK version')
  const notes = values['notes-file']
    ? readFileSync(resolve(values['notes-file']), 'utf8').trim()
    : history[0]['zh-CN'].join('\n')
  if (notes.length > 8000) throw new Error('Release notes exceed 8000 characters')
  const filename = 'jianliao-' + name[3] + '-' + name[2] + '.apk'
  if (!/^[a-zA-Z0-9._-]+$/.test(filename)) throw new Error('Version name is not safe for an APK filename')
  const output = resolve(values.output ?? join(root, 'artifacts/releases', name[3] + '-' + name[2]))
  mkdirSync(output, { recursive: true })
  const tag = 'v' + name[3]
  const apkUrl = 'https://github.com/' + repo + '/releases/download/' + encodeURIComponent(tag) + '/' + encodeURIComponent(filename)
  copyFileSync(apk, join(output, filename))
  const manifest = { schemaVersion: 1, applicationId: report.applicationId, versionCode: report.versionCode,
    versionName: report.versionName, minSdk, apkUrl, size: report.size, sha256: report.sha256, notes }
  writeFileSync(join(output, 'latest.json'), JSON.stringify(manifest, null, 2) + '\n')
  writeFileSync(join(output, filename + '.sha256'), report.sha256 + '  ' + filename + '\n')
  console.log('Release prepared at ' + output + '\nCreate GitHub Release ' + tag + ' in ' + repo + ', upload all generated files, then publish it as the latest release. No upload has been performed.')
}
