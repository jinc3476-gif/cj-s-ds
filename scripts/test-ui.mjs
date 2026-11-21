import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'

// Uses an isolated browser context and synthetic keys. No paid API requests.
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE
  ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright')
process.env.PORT ??= '8091'
const { server } = await import('./preview.mjs')
const output = resolve(import.meta.dirname, '../artifacts/qa')
mkdirSync(output, { recursive: true })
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, headless: true })
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: 'zh-CN', isMobile: true, hasTouch: true })
const history = JSON.parse(readFileSync(new URL('../release-history.json', import.meta.url), 'utf8'))
const version = history[0].version
const page = await context.newPage()
const errors = []
const requests = []
const results = []
let holdNext = false
let rejectNext = false
page.on('pageerror', e => errors.push(e.message))
await page.addInitScript(version => {
  window.AndroidBridge = {
    getApiKey: () => localStorage.getItem('synthetic-native-key') ?? '',
    setApiKey: key => { localStorage.setItem('synthetic-native-key', key); return true },
    saveDownload: (name, base64) => { window.testDownload = { name, base64, length: base64.length } },
    getAppVersion: () => version,
    isUpdateConfigured: () => window.testUpdateConfigured ?? false,
    checkForUpdate: () => { window.testUpdateChecks = (window.testUpdateChecks ?? 0) + 1 },
  }
}, version)
const events = text => [
  { type: 'message_start', message: { id: 'mock-message', role: 'assistant', content: [] } },
  { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
  { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } },
  { type: 'content_block_stop', index: 0 },
  { type: 'message_delta', delta: { stop_reason: 'end_turn', title: '读懂一份资料' } },
  { type: 'message_stop' },
].map(e => 'event: ' + e.type + '\ndata: ' + JSON.stringify(e) + '\n\n').join('')
await context.route('https://api.deepseek.com/**', async route => {
  const req = route.request()
  const url = new URL(req.url())
  const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' }
  if (url.pathname === '/user/balance') {
    await route.fulfill({
      status: 200,
      headers,
      contentType: 'application/json',
      body: JSON.stringify({
        is_available: true,
        balance_infos: [{ currency: 'CNY', total_balance: '12.34', granted_balance: '0.00', topped_up_balance: '12.34' }],
      }),
    })
    return
  }
  if (url.pathname === '/models') {
    const invalid = req.headers().authorization?.includes('invalid')
    await route.fulfill({ status: invalid ? 401 : 200, headers, contentType: 'application/json', body: JSON.stringify(invalid ? { error: { message: 'Invalid key' } } : { data: [{ id: 'deepseek-flash' }] }) })
    return
  }
  if (url.pathname.endsWith('/files')) {
    requests.push({ path: url.pathname, file: true, multipart: req.postDataBuffer()?.toString().includes('sample.txt') })
    await route.fulfill({ status: 200, headers, contentType: 'application/json', body: JSON.stringify({ id: 'file-test-001', filename: 'sample.txt', bytes: 20 }) })
    return
  }
  if (url.pathname.endsWith('/messages')) {
    const body = req.postDataJSON()
    requests.push({ path: url.pathname, body })
    if (holdNext) { holdNext = false; await delay(2000) }
    if (rejectNext) {
      rejectNext = false
      await route.fulfill({ status: 401, headers, contentType: 'application/json', body: JSON.stringify({ error: { message: 'Invalid key' } }) }).catch(() => {})
      return
    }
    const count = requests.filter(r => r.body).length
    const reply = count === 1
      ? '当然可以。我们可以先从三个问题开始：\n\n1. 你希望解决什么问题？\n2. 这个想法会帮助谁？\n3. 第一步可以做多小？\n\n把想法告诉我，我们一起梳理。'
      : '我记得前面的内容。接下来可以把目标拆成一个今天就能完成的小步骤。'
    await route.fulfill({ status: 200, headers, contentType: 'text/event-stream', body: events(reply) }).catch(() => {})
    return
  }
  throw new Error('Unexpected API request: ' + url.pathname)
})
async function visible(locator) { await locator.waitFor({ state: 'visible', timeout: 10000 }) }
const button = name => page.getByRole('button', { name, exact: true })
const setting = name => page.locator(`button[data-setting="${name}"]`)
async function check(name, fn) { await fn(); results.push(name); console.log('PASS ' + name) }
async function noOverflow() {
  const layout = await page.evaluate(() => ({ width: innerWidth, body: document.documentElement.scrollWidth }))
  assert(layout.body <= layout.width + 1, JSON.stringify(layout))
}
try {
  await page.goto(`http://127.0.0.1:${process.env.PORT}`)
  await check('首次启动展示 API Key 设置', async () => {
    await visible(page.getByRole('dialog', { name: '账号管理', exact: true }))
    await button('返回').click()
    await visible(page.getByRole('dialog', { name: '设置', exact: true }))
    await page.screenshot({ path: resolve(output, '01-settings.png') })
  })
  await check('更新服务未配置时显示真实状态', async () => {
    await setting('version').click()
    await visible(page.getByText(`当前版本 ${version} · 更新服务尚未启用`, { exact: true }))
    assert(await button('检查更新').isDisabled())
    await noOverflow()
    await page.screenshot({ path: resolve(output, '01a-update-settings.png') })
  })
  await check('配置发布地址后能调用原生更新入口', async () => {
    await page.evaluate(() => { window.testUpdateConfigured = true })
    await button('返回').click()
    await setting('version').click()
    await visible(page.getByText(`当前版本 ${version} · 启动时自动检查更新`, { exact: true }))
    await button('检查更新').click()
    assert.equal(await page.evaluate(() => window.testUpdateChecks), 1)
    await button('返回').click()
    await setting('account').click()
  })
  await check('拒绝无效 Key；有效 Key 校验后保存至原生桥接', async () => {
    const keyInput = page.locator('input[type=password]')
    for (const [label, path] of [['注册 / 登录', 'sign_in'], ['创建 API Key', 'api_keys'], ['充值', 'top_up']]) {
      const link = page.getByRole('link', { name: label, exact: true })
      await visible(link)
      assert.equal(await link.getAttribute('href'), `https://platform.deepseek.com/${path}`)
      assert.equal(await link.getAttribute('target'), '_blank')
    }
    await page.screenshot({ path: resolve(output, 'account-review.png') })
    await keyInput.fill('sk-invalid-synthetic')
    await page.getByRole('button', { name: '确定', exact: true }).click()
    await visible(page.getByText('API Key 无效，请检查后重试', { exact: true }))
    await keyInput.fill('sk-test-synthetic-only')
    await page.getByRole('button', { name: '确定', exact: true }).click()
    await keyInput.waitFor({ state: 'detached' })
    assert.equal(await page.evaluate(() => localStorage.getItem('chat-demo:api-key')), null)
    assert.equal(await page.evaluate(() => window.AndroidBridge.getApiKey()), 'sk-test-synthetic-only')
    await button('返回').click()
    await visible(setting('account').getByText('已配置'))
    await page.screenshot({ path: resolve(output, '01-settings.png') })
    await page.getByRole('button', { name: '关闭', exact: true }).click()
  })
  await check('右上角铃铛可离线查看本版和历次更新，Android 返回保留草稿', async () => {
    await page.locator('textarea').fill('保留我的草稿')
    await context.setOffline(true)
    try {
      await button('更新记录').click()
      const dialog = page.getByRole('dialog', { name: '更新记录' })
      await visible(dialog)
      for (const release of history) {
        await visible(dialog.getByRole('heading', { name: new RegExp(release.version.replaceAll('.', '\\.')) }))
        assert(await dialog.getByText(release['zh-CN'][0], { exact: true }).count())
      }
      await page.screenshot({ path: resolve(output, '01b-release-history.png') })
      assert.equal(await page.evaluate(() => window.handleAndroidBack()), true)
      assert.equal(await page.locator('textarea').inputValue(), '保留我的草稿')
    } finally { await context.setOffline(false) }
    await page.locator('textarea').fill('')
  })
  await check('手机首页为纯白色，仅显示一句问候', async () => {
    await visible(page.getByRole('heading', { name: '想法，从这里开始', exact: true }))
    assert.equal(await page.evaluate(() => getComputedStyle(document.body).backgroundColor), 'rgb(255, 255, 255)')
    assert.equal(await page.getByText('帮我梳理一个想法', { exact: false }).count(), 0)
    await noOverflow()
    await page.screenshot({ path: resolve(output, '02-home.png') })
    await page.locator('textarea').fill('帮我梳理一个想法')
  })
  await check('官方 Messages 流式协议与搜索声明', async () => {
    await page.getByRole('button', { name: '智能搜索', exact: true }).click()
    await page.getByRole('button', { name: '深度思考', exact: true }).click()
    await page.getByRole('button', { name: '发送', exact: true }).click()
    await visible(page.getByText('把想法告诉我，我们一起梳理。', { exact: false }))
    const req = requests.find(r => r.body)
    assert.equal(req.path, '/anthropic/v1/messages')
    assert.equal(req.body.model, 'deepseek-flash')
    assert.equal(req.body.stream, true)
    assert.equal(req.body.thinking.type, 'enabled')
    assert(req.body.tools.some(t => t.type?.includes('search') || t.name?.includes('search')))
    await page.screenshot({ path: resolve(output, '03-chat.png') })
  })
  await check('第二轮携带完整多轮上下文', async () => {
    await page.locator('textarea').fill('你还记得前面的内容吗？')
    await page.getByRole('button', { name: '发送', exact: true }).click()
    await visible(page.getByText('我记得前面的内容。', { exact: false }))
    const body = requests.filter(r => r.body).at(-1).body
    assert(body.messages.length >= 3)
    assert(body.messages.some(m => m.role === 'assistant'))
  })
  await check('刷新后聊天和 Key 仍可恢复', async () => {
    await page.reload()
    await page.getByRole('button', { name: '打开边栏', exact: true }).click()
    await page.getByText('读懂一份资料', { exact: true }).click()
    await visible(page.getByText('我记得前面的内容。', { exact: false }))
    assert.equal(await page.getByRole('dialog').count(), 0)
  })
  await check('文件上传使用官方 Files 接口', async () => {
    await page.locator('input[type=file]').first().setInputFiles({ name: 'sample.txt', mimeType: 'text/plain', buffer: Buffer.from('This is a test attachment.') })
    await visible(page.getByText('sample.txt', { exact: true }))
    await page.locator('textarea').fill('请读这个文件')
    await page.getByRole('button', { name: '发送', exact: true }).click()
    await page.getByRole('button', { name: '语音输入', exact: true }).waitFor({ state: 'visible' })
    const file = requests.find(r => r.file)
    assert.equal(file.path, '/anthropic/v1/files')
    assert.equal(file.multipart, true)
    const body = requests.filter(r => r.body).at(-1).body
    assert(JSON.stringify(body).includes('file-test-001'))
  })
  await check('停止生成能解除等待状态', async () => {
    holdNext = true
    await page.locator('textarea').fill('测试停止生成')
    await page.getByRole('button', { name: '发送', exact: true }).click()
    await page.getByRole('button', { name: '停止生成', exact: true }).click()
    await visible(page.getByRole('button', { name: '语音输入', exact: true }))
  })
  await check('返回键关闭侧栏，历史可导出到原生保存器', async () => {
    await page.getByRole('button', { name: '打开边栏', exact: true }).click()
    const current = page.locator('[aria-current="page"]:visible')
    await visible(current)
    assert.match(await current.evaluate(el => getComputedStyle(el, '::before').backgroundImage), /linear-gradient/)
    await page.screenshot({ path: resolve(output, 'spectrum-sidebar.png'), animations: 'disabled' })
    assert.equal(await page.evaluate(() => window.handleAndroidBack()), true)
    await page.getByRole('button', { name: '打开边栏', exact: true }).click()
    await page.getByRole('button', { name: '设置', exact: true }).click()
    await setting('data').click()
    await page.getByRole('button', { name: '下载', exact: true }).click()
    await page.waitForFunction(() => window.testDownload?.length > 0)
    assert((await page.evaluate(() => window.testDownload.name)).endsWith('.zip'))
  })
  await check('320px 窄屏及深色主题不横向溢出', async () => {
    await page.setViewportSize({ width: 320, height: 740 })
    await noOverflow()
    await page.screenshot({ path: resolve(output, '04-narrow-settings.png') })
    await button('返回').click()
    await setting('appearance').click()
    await page.getByRole('radio', { name: '深色', exact: true }).click()
    await page.screenshot({ path: resolve(output, 'spectrum-theme.png'), animations: 'disabled' })
    await button('返回').click()
    await page.getByRole('button', { name: '关闭', exact: true }).click()
    await page.setViewportSize({ width: 390, height: 844 })
    await page.getByRole('button', { name: '打开边栏', exact: true }).click()
    await page.getByRole('button', { name: '开启新对话', exact: true }).first().click()
    await visible(page.getByRole('heading', { name: '想法，从这里开始', exact: true }))
    await page.screenshot({ path: resolve(output, '05-dark-home.png') })
    await noOverflow()
  })
  await check('项目重命名、草稿与记忆隔离、跨对话回忆和刷新恢复', async () => {
    const drawer = () => button('打开边栏').click()
    const draft = page.locator('main textarea')
    const create = async (name, memory) => {
      await drawer()
      await button('创建项目').click()
      await page.getByLabel('项目名称').fill(name)
      await page.getByLabel('项目记忆（仅在本项目共享）').fill(memory)
      await button('确定').click()
      await visible(page.getByRole('heading', { name, exact: true }))
    }
    const send = async text => {
      const count = requests.filter(r => r.body).length
      await draft.fill(text)
      await button('发送').click()
      await visible(page.getByText('我记得前面的内容。', { exact: false }).last())
      assert.equal(requests.filter(r => r.body).length, count + 1)
      return JSON.stringify(requests.filter(r => r.body).at(-1).body)
    }
    await draft.fill('ordinary-draft')
    await create('项目 A', 'memory-A')
    assert.equal(await draft.inputValue(), '')
    assert.match(await send('question-A1'), /memory-A/)
    await button('新建项目对话').click()
    assert.match(await send('question-A2'), /question-A1/)
    await create('项目 B', 'memory-B')
    const b = await send('question-B')
    assert.match(b, /memory-B/)
    assert.doesNotMatch(b, /memory-A|question-A/)
    await drawer()
    await page.locator('details[open]').getByRole('button', { name: '项目操作', exact: true }).click()
    await page.getByRole('menuitem', { name: '编辑项目', exact: true }).click()
    await page.getByLabel('项目名称').fill('更名项目 B')
    await button('确定').click()
    await visible(page.locator('summary').getByText('更名项目 B', { exact: true }))
    await page.screenshot({ path: resolve(output, 'projects-review.png') })
    await button('开启新对话').first().click()
    assert.equal(await draft.inputValue(), 'ordinary-draft')
    assert.doesNotMatch(await send('ordinary-question'), /memory-[AB]|question-[AB]/)
    await page.reload()
    await drawer()
    await page.locator('summary').filter({ hasText: '更名项目 B' }).click()
    await button('新建项目对话').click()
    const restored = await send('after-reload')
    assert.match(restored, /memory-B/)
    assert.match(restored, /question-B/)
    assert.doesNotMatch(restored, /memory-A|ordinary-question/)
    await drawer()
    await button('设置').click()
    await setting('data').click()
    await button('下载').click()
    await page.waitForFunction(() => window.testDownload?.length > 0)
    const archive = await page.evaluate(() => window.testDownload)
    await page.locator('input[accept*=".zip"]').setInputFiles({
      name: archive.name, mimeType: 'application/zip', buffer: Buffer.from(archive.base64, 'base64')
    })
    await button('确认导入').click()
    await visible(page.getByText(/已导入 \d+ 个对话/))
    await button('返回').click()
    await button('关闭').click()
    await drawer()
    await page.locator('summary').filter({ hasText: '更名项目 B' }).click()
    await button('新建项目对话').click()
    const imported = await send('after-import')
    assert.match(imported, /memory-B/)
    assert.match(imported, /question-B/)
    assert.doesNotMatch(imported, /memory-A|ordinary-question/)
  })
  assert.deepEqual(errors, [])
  results.push('无浏览器运行时异常')
  writeFileSync(resolve(output, 'results.json'), JSON.stringify({ passed: results, pageErrors: errors, apiRequests: requests.map(r => ({ path: r.path, messageCount: r.body?.messages.length })) }, null, 2))
} catch (error) {
  await page.screenshot({ path: resolve(output, 'failure.png') }).catch(() => {})
  writeFileSync(resolve(output, 'failure.txt'), String(error.stack) + '\n' + await page.locator('body').innerText())
  throw error
} finally {
  await context.close()
  await browser.close()
  server.close()
}
