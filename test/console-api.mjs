// 控制台接口自检：不需要 DSH、不需要真桥接。
// ① 本机有真实桥接目录时，跑一遍环境检查（含 QQ 预设变量那条）——逐项核对 key 和 ok，不数条数；
// ② 造一个「上游式」桥接（/api/status 没有 snowluma）+ 一个在线的 OneBot：
//    mock 会校验令牌/方法/路径，确认插件走 OneBot 兜底、群名单真的用上 OneBot 元数据；
// ③ 换错令牌再请求一次：桥接 401 必须变成「离线」，不能假装成功。

import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import http from 'node:http'
import { Readable } from 'node:stream'

const mod = await import(new URL('../index.js', import.meta.url))

const CONSOLE_TOKEN = 'test-token'
const BOT_TOKEN = 'bot-token'
const ENV_KEYS = ['bridge', 'snowluma', 'node', 'ffmpeg', 'edge', 'profile', 'preset']

function makeCtx(store) {
  return {
    effect: (fn) => fn(),
    webServer: {
      register: ({ path: p, handler }) => {
        store[p] = handler
        return () => {}
      },
      getOrigin: () => 'http://127.0.0.1:0',
    },
  }
}

// 直接调 handler：带超时；handler 抛错或回不出 JSON 就 reject，不假装成功
function call(handler, req, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('handler 超时')), timeoutMs)
    const res = {
      statusCode: 0,
      headers: {},
      writeHead(status, headers) {
        this.statusCode = status
        this.headers = headers || {}
      },
      end(text) {
        clearTimeout(timer)
        try {
          resolve({ status: this.statusCode || 200, body: text ? JSON.parse(String(text)) : null })
        } catch (error) {
          reject(error)
        }
      },
    }
    Promise.resolve()
      .then(() => handler(req, res))
      .catch((error) => {
        clearTimeout(timer)
        reject(error)
      })
  })
}

function get(handler, url) {
  return call(handler, { method: 'GET', url, headers: {} })
}

function post(handler, body) {
  const req = Readable.from([Buffer.from(JSON.stringify(body), 'utf8')])
  req.method = 'POST'
  req.url = '/api/qq-console'
  req.headers = { 'content-type': 'application/json' }
  return call(handler, req)
}

let failed = 0
const check = (name, ok, detail = '') => {
  if (!ok) failed += 1
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`)
}
const keysOf = (value) => (Array.isArray(value) ? value.map((item) => item.key).join(',') : '')

// ① 真实目录（装了这套东西的机器上才有；CI 里跳过）
const realRoot = process.env.QQ_BRIDGE_ROOT || ''
if (realRoot && fs.existsSync(path.join(realRoot, 'qq-bridge-main', 'config.json'))) {
  const routes = {}
  mod.apply(makeCtx(routes), { bridgeRoot: realRoot })
  const env = (await post(routes['/api/qq-console'], { action: 'envCheck' })).body
  const items = Array.isArray(env?.items) ? env.items : []
  const preset = items.find((item) => item.key === 'preset')
  check('环境检查按固定 7 个 key 返回', keysOf(items) === ENV_KEYS.join(','), keysOf(items))
  check('每项都带布尔 ok', items.length === ENV_KEYS.length && items.every((item) => typeof item.ok === 'boolean'))
  check('真实目录里预设检查是绿的', preset?.ok === true, preset?.detail || '')
} else {
  console.log('SKIP 真实桥接目录（这台机器没有）')
}

// ② 上游式桥接 + 在线 OneBot → 兜底
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-console-test-'))
fs.mkdirSync(path.join(tmp, 'qq-bridge-main', 'state'), { recursive: true })

const bridgeSeen = []
const bridgeRoutes = new Map([
  ['/api/status', { mode: 'reserved2', dshReady: true, role: '测试', allowGroups: ['10001'], allowPrivate: [] }],
  ['/api/socialV2/states', { conversations: [] }],
  ['/api/pending', { pending: [] }],
])
const bridgeSrv = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x')
  const token = url.searchParams.get('token') || ''
  const seen = { method: req.method, path: url.pathname, token, status: 0 }
  bridgeSeen.push(seen)
  const reply = (status, body) => {
    seen.status = status
    res.writeHead(status, { 'content-type': 'application/json' })
    res.end(JSON.stringify(body))
  }
  if (token !== CONSOLE_TOKEN) return reply(401, { error: 'unauthorized' })
  if (req.method !== 'GET') return reply(405, { error: 'method not allowed' })
  if (!bridgeRoutes.has(url.pathname)) return reply(404, { error: 'not found' })
  reply(200, bridgeRoutes.get(url.pathname))
})

const onebotSeen = []
const onebotReplies = new Map([
  ['get_login_info', { user_id: 10001, nickname: '测试号' }],
  ['get_group_list', [{ group_id: 10001, group_name: '测试群', member_count: 7 }]],
])
const onebotSrv = http.createServer((req, res) => {
  const action = new URL(req.url, 'http://x').pathname.replace(/^\//, '')
  const auth = String(req.headers.authorization || '')
  onebotSeen.push({ method: req.method, action, auth })
  const reply = (data) => {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify(data))
  }
  if (req.method !== 'POST' || !onebotReplies.has(action)) return reply({ status: 'failed', retcode: 404, data: null })
  if (auth !== `Bearer ${BOT_TOKEN}`) return reply({ status: 'failed', retcode: 401, data: null })
  reply({ status: 'ok', retcode: 0, data: onebotReplies.get(action) })
})

const listen = (server) => new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)))
const close = (server) => new Promise((resolve) => server.close(resolve))
const bridgePort = await listen(bridgeSrv)
const onebotPort = await listen(onebotSrv)

const writeConfig = (overrides = {}) => {
  fs.writeFileSync(
    path.join(tmp, 'qq-bridge-main', 'config.json'),
    JSON.stringify({
      consolePort: bridgePort,
      consoleToken: CONSOLE_TOKEN,
      snowluma: { httpUrl: `http://127.0.0.1:${onebotPort}`, accessToken: BOT_TOKEN },
      allow: { groups: ['10001'], private: [] },
      ownerQQ: 10001,
      dsh: { baseUrl: 'http://127.0.0.1:1' },
      ...overrides,
    }),
    'utf8',
  )
}

try {
  writeConfig()
  const routes = {}
  mod.apply(makeCtx(routes), { bridgeRoot: tmp })
  const snap = (await get(routes['/api/qq-console'], '/api/qq-console?part=overview')).body

  check('桥接没雪字段时用 OneBot 兜底', snap?.status?.snowluma?.accountOnline === true, JSON.stringify(snap?.status?.snowluma))
  check('群名单用上了 OneBot 的元数据', snap?.groups?.[0]?.name === '测试群' && snap.groups[0]?.members === 7, JSON.stringify(snap?.groups?.[0]))
  check(
    '兜底后不会误报离线',
    !String(snap?.diagnosis || '').includes('没连上') && !String(snap?.diagnosis || '').includes('账号没连上'),
    String(snap?.diagnosis || '（没有提示）'),
  )

  const badBridge = bridgeSeen.filter((item) => item.status !== 200 || item.method !== 'GET' || !bridgeRoutes.has(item.path))
  check('桥接请求的方法/路径/令牌都被校验通过', badBridge.length === 0, JSON.stringify(badBridge))
  check('概览确实请求了 /api/status', bridgeSeen.some((item) => item.path === '/api/status'))

  const badOnebot = onebotSeen.filter((item) => item.method !== 'POST' || item.auth !== `Bearer ${BOT_TOKEN}` || !onebotReplies.has(item.action))
  check('OneBot 调用都是 POST 且带 Bearer 令牌', badOnebot.length === 0, JSON.stringify(badOnebot))
  check('兜底问过 OneBot 登录信息', onebotSeen.some((item) => item.action === 'get_login_info'))
  check('群列表问过 OneBot', onebotSeen.some((item) => item.action === 'get_group_list'))

  // 环境检查：逐项核对 key 与语义，再验证「缺东西时真的会报红」
  const env = (await post(routes['/api/qq-console'], { action: 'envCheck' })).body
  const items = Array.isArray(env?.items) ? env.items : []
  const byKey = new Map(items.map((item) => [item.key, item]))
  check('环境检查按固定 7 个 key 返回', keysOf(items) === ENV_KEYS.join(','), keysOf(items))
  check('每项都带布尔 ok', items.length === ENV_KEYS.length && items.every((item) => typeof item.ok === 'boolean'))
  check('桥接目录存在 → bridge 通过', byKey.get('bridge')?.ok === true, byKey.get('bridge')?.detail || '')
  check('没给 SnowLuma 目录 → snowluma 报红', byKey.get('snowluma')?.ok === false, byKey.get('snowluma')?.detail || '')
  check(
    '预设目录缺失 → preset 明确报缺',
    byKey.get('preset')?.ok === false && String(byKey.get('preset')?.detail || '').includes('agent-presets'),
    byKey.get('preset')?.detail || '',
  )

  const unknown = (await post(routes['/api/qq-console'], { action: 'nope' })).body
  check('不认识的 action 有明确报错', unknown?.ok === false && String(unknown?.error || '').includes('不认识的 action'), String(unknown?.error || ''))

  // 令牌不对：桥接 401，界面必须如实报离线，不能假装成功
  writeConfig({ consoleToken: 'wrong-token' })
  const denied = (await get(routes['/api/qq-console'], '/api/qq-console?part=overview')).body
  const wrongTokenSeen = bridgeSeen.filter((item) => item.token === 'wrong-token')
  check(
    '错令牌请求确实打到桥接并拿到 401',
    wrongTokenSeen.length === 1 && wrongTokenSeen[0].path === '/api/status' && wrongTokenSeen[0].status === 401,
    JSON.stringify(wrongTokenSeen),
  )
  check('令牌不对时桥接拒绝 → 概览如实报离线', denied?.bridge?.online === false && Boolean(denied?.bridge?.error), JSON.stringify(denied?.bridge))
  check('令牌不对时诊断给出「桥接没在跑」', String(denied?.diagnosis || '').includes('桥接没在跑'), String(denied?.diagnosis || ''))
} finally {
  await Promise.all([close(bridgeSrv), close(onebotSrv)])
  fs.rmSync(tmp, { recursive: true, force: true })
}

if (failed) {
  console.log(`\n${failed} 项没过`)
  process.exit(1)
}
console.log('\n接口自检通过')
