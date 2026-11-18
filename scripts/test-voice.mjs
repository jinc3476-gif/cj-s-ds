import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE
  ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright')
process.env.PORT = '8092'
const { server } = await import('./preview.mjs')
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH,
  args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] })
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'zh-CN',
    isMobile: true, hasTouch: true, permissions: ['microphone'] })
  const page = await context.newPage()
  await page.addInitScript(() => {
    window.AndroidBridge = {
      getApiKey: () => 'sk-synthetic',
      hasNativeSpeech() { throw new Error('OEM speech service must not be queried') },
    }
    const capture = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices)
    navigator.mediaDevices.getUserMedia = async opts => {
      if (window.denyMic) throw new DOMException('Denied', 'NotAllowedError')
      if (window.delayMic) await new Promise(resolve => { window.allowMic = resolve })
      const stream = await capture(opts)
      window.track = stream.getAudioTracks()[0]
      return stream
    }
  })
  let uploads = 0
  await page.route('https://api.deepseek.com/**', async route => {
    assert.equal(new URL(route.request().url()).pathname, '/v1/tools/asr')
    const body = route.request().postDataBuffer(), at = body.indexOf('RIFF')
    assert(at >= 0 && body.readUInt32LE(at + 40) > 1000)
    assert.equal(body.readUInt32LE(at + 24), 16000)
    assert.equal(body.readUInt16LE(at + 22), 1)
    uploads++
    await route.fulfill({ json: { text: '听写' } })
  })
  await page.goto('http://127.0.0.1:8092')
  const btn = name => page.getByRole('button', { name, exact: true })
  const draft = page.locator('textarea')
  await draft.fill('左右')
  await draft.evaluate(el => el.setSelectionRange(1, 1))
  await btn('语音输入').click()
  await btn('结束录音并转写').waitFor()
  await page.waitForTimeout(450)
  await btn('结束录音并转写').click()
  await page.waitForFunction(() => document.querySelector('textarea').value === '左听写右')
  assert.equal(await page.evaluate(() => window.track.readyState), 'ended')
  const cdp = await context.newCDPSession(page)
  for (const target of [draft, btn('语音输入')]) {
    await draft.fill('')
    const { x, y, width, height } = await target.boundingBox()
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x+width/2, y: y+height/2 }] })
    await btn('结束录音并转写').waitFor()
    await page.waitForTimeout(450)
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    await page.waitForFunction(() => document.querySelector('textarea').value === '听写')
  }
  await page.evaluate(() => { window.denyMic = true })
  await btn('语音输入').click()
  await page.getByText('没有麦克风权限，请在应用或网站权限设置中允许访问').waitFor()
  await page.evaluate(() => { window.denyMic = false; window.delayMic = true; window.track = null })
  await page.clock.install()
  await btn('语音输入').click()
  await btn('取消打开麦克风').waitFor()
  await page.clock.fastForward(18001)
  await btn('语音输入').waitFor()
  await page.evaluate(() => window.allowMic())
  await page.waitForFunction(() => window.track?.readyState === 'ended')
  assert.equal(uploads, 3)
  console.log('PASS direct microphone tap/hold, WAV, cursor, denied permission, timeout, late track release and no OEM service')
} finally {
  await browser.close()
  server.close()
}
