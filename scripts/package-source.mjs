import { createRequire } from 'node:module'
import { readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolve, relative } from 'node:path'
const root = resolve(import.meta.dirname, '..')
const version = readFileSync(resolve(root, 'version.properties'), 'utf8').match(/^versionName=(.+)$/m)?.[1]?.trim()
if (!version) throw new Error('Missing versionName')
const require = createRequire(resolve(root, 'web/package.json'))
const { zipSync } = require('fflate')
const files = {}
const include = [
  'app/src', 'app/build.gradle', 'web/src', 'web/LICENSE', 'web/package.json',
  'web/package-lock.json', 'web/rspack.config.ts', 'web/tsconfig.json',
  'web/.oxfmtrc.json', 'web/.oxlintrc.json', 'web/README.md', 'web/README.zh-CN.md',
  'scripts', 'gradle', 'gradlew', 'gradlew.bat', 'build.gradle', 'settings.gradle',
  'gradle.properties', '.gitignore', 'README.md', 'UPSTREAM.md', 'artifacts/qa/results.json',
  'version.properties', 'update.properties', 'signing-certificate.sha256', 'release-history.json', 'UPDATES.md',
]
function add(path) {
  if (statSync(path).isDirectory()) {
    for (const name of readdirSync(path)) add(resolve(path, name))
  } else {
    files['jianliao-' + version + '/' + relative(root, path).replaceAll('\\', '/')] = readFileSync(path)
  }
}
for (const path of include) add(resolve(root, path))
mkdirSync(resolve(root, 'artifacts'), { recursive: true })
writeFileSync(resolve(root, 'artifacts/jianliao-' + version + '-source.zip'), zipSync(files, { level: 6 }))
console.log('Source archive: ' + Object.keys(files).length + ' files; no API keys or build toolchains included.')
