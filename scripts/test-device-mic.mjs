import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'

const adb = resolve(import.meta.dirname, '../.tooling/android-sdk/platform-tools/adb.exe')
const serial = process.env.ANDROID_SERIAL || execFileSync(adb, ['get-serialno'], { encoding: 'utf8' }).trim()
execFileSync(adb, ['-s', serial, 'shell', 'am', 'start', '-W', '-n',
  'com.dklabs.jianliao/com.dklabs.deepseeklite.MainActivity'], { stdio: 'ignore' })
await new Promise(resolve => setTimeout(resolve, 1200))
const pid = execFileSync(adb, ['-s', serial, 'shell', 'pidof', 'com.dklabs.jianliao'], { encoding: 'utf8' }).trim()
assert(pid, 'Quovia is not running')
execFileSync(adb, ['-s', serial, 'forward', 'tcp:9222', `localabstract:webview_devtools_remote_${pid}`])
const page = (await (await fetch('http://127.0.0.1:9222/json/list')).json())
  .find(target => target.type === 'page' && target.url.startsWith('https://appassets.androidplatform.net/'))
assert(page, 'Connect ADB forward tcp:9222 to the running Quovia WebView first')

const socket = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true })
  socket.addEventListener('error', reject, { once: true })
})
let nextId = 0
const pending = new Map()
socket.addEventListener('message', ({ data }) => {
  const message = JSON.parse(data)
  const task = pending.get(message.id)
  if (task) {
    pending.delete(message.id)
    task.resolve(message.result?.result?.value)
  }
})
const evaluate = expression => new Promise((resolve, reject) => {
  const id = ++nextId
  pending.set(id, { resolve })
  socket.send(JSON.stringify({
    id,
    method: 'Runtime.evaluate',
    params: { expression, returnByValue: true, awaitPromise: true },
  }))
  setTimeout(() => {
    if (pending.delete(id)) reject(new Error('WebView evaluation timed out'))
  }, 5000)
})

try {
  await evaluate(`document.querySelector('button[aria-label="语音输入"]').click()`)
  let status = ''
  for (let i = 0; i < 80; i++) {
    await new Promise(resolve => setTimeout(resolve, 100))
    status = await evaluate(`document.querySelector('[role="status"]')?.innerText ?? ''`)
    if (status.includes('正在录音')) break
  }
  assert(status.includes('正在录音'), `Native microphone did not start: ${status}`)
  console.log('PASS Android AudioRecord started:', status.replaceAll('\n', ' '))
  await new Promise(resolve => setTimeout(resolve, 1500))
  execFileSync(adb, ['-s', serial, 'shell', 'input', 'keyevent', 'KEYCODE_HOME'])
  await new Promise(resolve => setTimeout(resolve, 1200))
  const audio = execFileSync(adb, ['-s', serial, 'shell', 'dumpsys', 'audio'], { encoding: 'utf8' })
  const recent = audio.split(/\r?\n/).filter(line => line.includes('com.dklabs.jianliao'))
  assert(recent.some(line => line.includes('rec update')) && recent.some(line => line.includes('rec stop')),
    'Android did not report both microphone acquisition and release for Quovia')
  console.log('PASS Android reports Quovia microphone acquisition and release; no transcription request was sent')
  execFileSync(adb, ['-s', serial, 'shell', 'am', 'start', '-n',
    'com.dklabs.jianliao/com.dklabs.deepseeklite.MainActivity'], { stdio: 'ignore' })
} finally {
  socket.close()
}
