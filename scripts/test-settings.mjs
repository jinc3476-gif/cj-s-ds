import assert from 'node:assert/strict'
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE
  ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright')
process.env.PORT = '8097'
const { server } = await import('./preview.mjs')
const output = resolve(import.meta.dirname, '../artifacts/qa')
mkdirSync(output, { recursive: true })
let browser
try {
  browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, headless: true })
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, locale: 'zh-CN', isMobile: true, hasTouch: true })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('http://127.0.0.1:8097')
  const dialog = (name) => page.getByRole('dialog', { name, exact: true })
  const row = (name) => page.locator(`[data-setting="${name}"]`)
  const back = () => page.getByRole('button', { name: '返回', exact: true }).click()
  async function measureEntry(direction) {
    const offsets = await page.locator('[role="dialog"] .quovia-page-enter:visible').evaluate(node => {
      const animation = node.getAnimations()[0]
      animation.pause()
      const positions = [0, 150].map(time => {
        animation.currentTime = time
        return Math.round(new DOMMatrix(getComputedStyle(node).transform).m41)
      })
      animation.finish()
      return positions
    })
    assert.equal(offsets[0], direction * 150)
    assert(direction * offsets[1] > 0 && direction * offsets[1] < 150, `offsets: ${offsets}`)
    console.log('Settings entry offset at 0ms / 150ms:', offsets)
  }
  await dialog('账号管理').waitFor()
  await back()
  await measureEntry(-1)
  assert.equal(await page.getByRole('heading', { level: 2 }).allTextContents().then((items) => items.join(' / ')), '账户 / 应用 / 语音 / 关于')
  assert.equal(await dialog('设置').getByRole('button').count(), 11)
  await page.screenshot({ path: resolve(output, 'settings-390.png') })
  await row('personalization').click()
  await measureEntry(1)
  assert.equal((await dialog('个性化').innerText()).trim(), '个性化')
  await page.evaluate(() => window.handleAndroidBack())
  await row('font').click()
  await page.getByRole('button', { name: '对话字号' }).click()
  await page.getByRole('option', { name: '大', exact: true }).click()
  await back()
  assert.match(await row('font').innerText(), /大/)
  await page.reload()
  await dialog('账号管理').waitFor()
  await back()
  assert.match(await row('font').innerText(), /大/)
  assert.equal(await page.evaluate(() => getComputedStyle(document.body).getPropertyValue('--chat-font-size').trim()), '20px')
  await row('appearance').click()
  await page.getByRole('radio', { name: '深色' }).click()
  await back()
  assert.match(await row('appearance').innerText(), /深色/)
  await page.screenshot({ path: resolve(output, 'settings-dark.png') })
  await row('data').click()
  await page.getByRole('button', { name: '删除', exact: true }).click()
  await page.evaluate(() => window.handleAndroidBack())
  await dialog('数据管理').waitFor()
  await back()
  await row('language').click()
  await page.getByRole('button', { name: '语言', exact: true }).click()
  await page.getByRole('option', { name: 'English' }).click()
  await page.getByRole('button', { name: 'Back', exact: true }).click()
  await page.setViewportSize({ width: 320, height: 600 })
  await dialog('Settings').waitFor()
  await page.emulateMedia({ reducedMotion: 'reduce' })
  assert(await page.evaluate(() => [...document.querySelectorAll('[data-setting]')].every((element) => element.scrollWidth <= element.clientWidth + 1)))
  await row('privacy').click()
  assert.equal(await page.locator('[role="dialog"] .quovia-page-enter:visible').evaluate(node => node.getAnimations().length), 0)
  await page.getByRole('link', { name: 'MIT License' }).waitFor()
  await page.getByRole('button', { name: 'Back' }).click()
  await row('version').click()
  assert(await page.getByRole('button', { name: 'Check for updates', exact: true }).isDisabled())
  assert.deepEqual(errors, [])
  console.log('PASS: grouped settings, blank personalization, back navigation, persisted chat text size, theme, language, data confirmation, privacy, version and 320px layout')
} finally {
  await browser?.close()
  server.close()
}
