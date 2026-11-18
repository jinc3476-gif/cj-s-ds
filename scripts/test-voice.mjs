import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE
  ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright')
process.env.PORT = '8092'
const { server } = await import('./preview.mjs')
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH,
  args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
})
const context = await browser.newContext({
  locale: 'zh-CN', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
  permissions: ['microphone'],
})
const page = await context.newPage()
const errors = []
page.on('pageerror', error => errors.push(error.message))
let asrUploads = 0
await page.route('https://api.deepseek.com/**', async route => {
  assert.equal(new URL(route.request().url()).pathname, '/v1/tools/asr')
  const body = route.request().postDataBuffer()
  const offset = body.indexOf('RIFF')
  assert(offset >= 0)
  assert.equal(body.readUInt32LE(offset + 24), 16000)
  assert.equal(body.readUInt16LE(offset + 22), 1)
  assert(body.readUInt32LE(offset + 40) > 1000)
  asrUploads++
  await route.fulfill({ json: { text: '测试录音' }, headers: { 'Access-Control-Allow-Origin': '*' } })
})
await page.addInitScript(() => {
  window.nativeEnabled = true
  window.voiceCalls = []
  window.emitSpeech = (state, extra = {}) => window.dispatchEvent(new CustomEvent('jianliao-speech', {
    detail: { state, id: window.voiceId, ...extra },
  }))
  window.AndroidBridge = {
    getApiKey: () => 'sk-synthetic-voice-test',
    hasNativeSpeech: () => window.nativeEnabled,
    startNativeSpeech(id, lang) {
      window.voiceId = id
      window.voiceCalls.push(['start', id, lang])
    },
    stopNativeSpeech(id) {
      window.voiceCalls.push(['stop', id])
      window.emitSpeech('transcribing')
    },
    cancelNativeSpeech(id) { window.voiceCalls.push(['cancel', id]) },
  }
})
const button = name => page.getByRole('button', { name, exact: true })
const draft = page.getByRole('textbox', { name: '发消息或按住说话' })
const visible = element => element.waitFor({ state: 'visible', timeout: 5000 })
try {
  await page.goto('http://127.0.0.1:8092')
  await visible(draft)
  await visible(button('语音输入'))
  assert.equal(await button('发送').count(), 0)
  await draft.fill('左右')
  await draft.evaluate(el => el.setSelectionRange(1, 1))
  await button('语音输入').click()
  await visible(page.getByText('正在打开麦克风…'))
  assert.equal(await page.evaluate(() => window.voiceCalls[0][2]), 'zh-CN')
  await page.evaluate(() => window.emitSpeech('recording'))
  await visible(page.getByText('正在聆听，点按麦克风结束'))
  await button('结束录音并转写').click()
  await visible(page.getByText('正在转写…'))
  await page.evaluate(() => window.emitSpeech('result', { text: '听写' }))
  assert.equal(await draft.inputValue(), '左听写右')
  await visible(button('发送'))
  console.log('PASS Native dictation inserts at the cursor and leaves an editable draft')

  await draft.fill('')
  const cdp = await context.newCDPSession(page)
  for (const target of [draft, button('语音输入')]) {
    const { x, y, width, height } = await target.boundingBox()
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x + width / 2, y: y + height / 2 }] })
    await visible(button('取消打开麦克风'))
    await page.evaluate(() => window.emitSpeech('recording'))
    await visible(page.getByText('正在聆听，松开转写'))
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    await visible(page.getByText('正在转写…'))
    await page.evaluate(() => window.emitSpeech('result', { text: '已松开' }))
    assert.equal(await draft.inputValue(), '已松开')
    await draft.fill('')
  }
  console.log('PASS Holding the text field or mic records; release transcribes exactly once')

  await button('语音输入').click()
  await button('取消打开麦克风').click()
  await page.evaluate(() => window.emitSpeech('result', { text: '迟到的结果' }))
  assert.equal(await draft.inputValue(), '')
  assert.equal(await page.evaluate(() => window.voiceCalls.at(-1)[0]), 'cancel')
  await button('语音输入').click()
  await page.evaluate(() => window.emitSpeech('error', { error: 'permission' }))
  await visible(page.getByText('没有麦克风权限，请在应用或网站权限设置中允许访问'))
  console.log('PASS Cancellation drops late results; denied access has an actionable message')

  await button('语音输入').click()
  await page.evaluate(() => window.emitSpeech('error', { error: 'unavailable' }))
  await visible(page.getByText('系统语音识别不可用，再次点按麦克风可使用 DeepSeek 转写'))
  for (const nativeEnabled of [true, false]) {
    if (!nativeEnabled) {
      await page.reload()
      await page.evaluate(() => { window.nativeEnabled = false })
    }
    await button('语音输入').click()
    await visible(page.getByText('正在聆听，点按麦克风结束'))
    await page.waitForTimeout(450)
    await button('结束录音并转写').click()
    await page.waitForFunction(() => document.querySelector('textarea')?.value === '测试录音')
    await draft.fill('')
  }
  assert.equal(asrUploads, 2)
  assert.deepEqual(errors, [])
  console.log('PASS Missing and broken native services fall back to a validated WAV upload')
} finally {
  await browser.close()
  server.close()
}
