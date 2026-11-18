import { createServer } from 'node:http'
import { createReadStream, statSync } from 'node:fs'
import { resolve, extname, sep } from 'node:path'
const root = resolve(import.meta.dirname, '../web/dist')
const types = { '.js': 'application/javascript', '.css': 'text/css', '.html': 'text/html', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.txt': 'text/plain' }
export const server = createServer((req, res) => {
  let file
  try { file = resolve(root, '.' + decodeURIComponent(new URL(req.url, 'http://localhost').pathname)) }
  catch { res.writeHead(400).end(); return }
  if (file === root) file = resolve(root, 'index.html')
  if (!file.startsWith(root + sep)) { res.writeHead(403).end(); return }
  try {
    if (!statSync(file).isFile()) throw new Error('not a file')
    res.writeHead(200, { 'Content-Type': types[extname(file)] ?? 'text/plain', 'Cache-Control': 'no-store' })
    createReadStream(file).pipe(res)
  } catch { res.writeHead(404).end() }
})
server.listen(Number(process.env.PORT ?? 8090), '127.0.0.1', () => console.log('Quovia preview: http://127.0.0.1:' + server.address().port))
