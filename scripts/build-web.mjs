import { existsSync, cpSync, readdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
const root = resolve(import.meta.dirname, '..')
const web = resolve(root, 'web')
const cli = resolve(web, 'node_modules/@rspack/cli/bin/rspack.js')
const result = spawnSync(process.execPath, [cli, 'build', '-c', 'rspack.config.ts'], {
  cwd: web, env: { ...process.env, NODE_ENV: 'production' }, stdio: 'inherit'
})
if (result.status !== 0) process.exit(result.status ?? 1)
// Include the actual dependency license texts alongside the upstream MIT notice.
let notices = '简聊 — third-party notices\n\nUpstream: https://github.com/deepseek-ai/chat-demo\n\n' + readFileSync(resolve(web, 'LICENSE'), 'utf8')
const seen = new Set()
function collect(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue
    const folder = resolve(dir, entry.name)
    if (entry.name.startsWith('@')) { collect(folder); continue }
    const pkgPath = resolve(folder, 'package.json')
    if (!existsSync(pkgPath)) continue
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
    const id = `${pkg.name}@${pkg.version}`
    if (seen.has(id)) continue
    seen.add(id)
    const licenseFile = readdirSync(folder).find(f => /^(license|copying)(\.|$)/i.test(f))
    if (licenseFile) notices += `\n\n===== ${id} (${pkg.license ?? 'see text'}) =====\n` + readFileSync(resolve(folder, licenseFile), 'utf8')
    if (existsSync(resolve(folder, 'node_modules'))) collect(resolve(folder, 'node_modules'))
  }
}
collect(resolve(web, 'node_modules'))
writeFileSync(resolve(web, 'dist/THIRD_PARTY_NOTICES.txt'), notices)
const assets = resolve(root, 'app/src/main/assets')
rmSync(assets, { recursive: true, force: true })
cpSync(resolve(web, 'dist'), assets, { recursive: true })
console.log(`Bundled front-end and ${seen.size} dependency notices into Android assets.`)
