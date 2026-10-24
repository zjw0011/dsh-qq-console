// 控制台接口自检：不需要 DSH、不需要真桥接。
// ① 本机有真实桥接目录时，跑一遍环境检查（含 QQ 预设变量那条）；
// ② 造一个「上游式」桥接（/api/status 没有 snowluma）+ 一个在线的 OneBot，
//    确认插件会自己问 OneBot 兜底，而不是把 QQ 账号显示成离线。

import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import http from 'node:http'
import { Readable } from 'node:stream'

const mod = await import(new URL('../index.js', import.meta.url))

function makeCtx(store) {
  return {
    effect: (fn) => fn(),
    webServer: {
      register: ({ path: p, handler }) => {
        store[p] = handler
        return () => {}
      },
      getOrigin: () => 'http://127.0.0.1:11353',
    },
  }
}

function post(handler, body) {
  return new Promise((resolve) => {
    const req = Readable.from([Buffer.from(JSON.stringify(body), 'utf8')])
    req.method = 'POST'
    req.url = '/api/qq-console'
    req.headers = { 'content-type': 'application/json' }
    const res = {
      writeHead() {},
      end(text) {
        resolve(JSON.parse(text))
      },
    }
    handler(req, res)
  })
}

function get(handler, url) {
  return new Promise((resolve) => {
    const req = { method: 'GET', url, headers: {} }
    const res = {
      writeHead() {},
      end(text) {
        resolve(JSON.parse(text))
      },
    }
    handler(req, res)
  })
}

let failed = 0
const check = (name, ok, detail = '') => {
  if (!ok) failed += 1
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`)
}

// ① 真实目录（装了这套东西的机器上才有；CI 里跳过）
const realRoot = process.env.QQ_BRIDGE_ROOT || ''
if (realRoot && fs.existsSync(path.join(realRoot, 'qq-bridge-main', 'config.json'))) {
  const routes = {}
  mod.apply(makeCtx(routes), { bridgeRoot: realRoot })
  const env = await post(routes['/api/qq-console'], { action: 'envCheck' })
  const items = Array.isArray(env.items) ? env.items : []
  const preset = items.find((i) => i.key === 'preset')
  check('环境检查能跑', items.length >= 7, `${items.length} 项`)
  check('预设变量检查在结果里', Boolean(preset), preset?.detail || '')
  check('当前预设没有不认识的变量', preset?.ok === true, preset?.detail || '')
} else {
  console.log('SKIP 真实桥接目录（这台机器没有）')
}

// ② 上游式桥接 + 在线 OneBot → 兜底
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-console-test-'))
const bridgePort = 31999
const onebotPort = 31998
fs.mkdirSync(path.join(tmp, 'qq-bridge-main', 'state'), { recursive: true })
fs.writeFileSync(
  path.join(tmp, 'qq-bridge-main', 'config.json'),
  JSON.stringify({
    consolePort: bridgePort,
    consoleToken: 'test-token',
    snowluma: { httpUrl: `http://127.0.0.1:${onebotPort}`, accessToken: '' },
    allow: { groups: ['10001'], private: [] },
    ownerQQ: 10001,
    dsh: { baseUrl: 'http://127.0.0.1:1' },
  }),
  'utf8',
)

const bridgeSrv = http.createServer((req, res) => {
  const pathname = new URL(req.url, 'http://x').pathname
  const body = pathname === '/api/status'
    ? { mode: 'reserved2', dshReady: true, role: '测试', allowGroups: [], allowPrivate: [] }
    : pathname.includes('states') ? { conversations: [] } : {}
  res.writeHead(200, { 'content-type': 'application/json' })
  res.end(JSON.stringify(body))
})
const onebotSrv = http.createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'application/json' })
  res.end(JSON.stringify({ status: 'ok', retcode: 0, data: { user_id: 10001, nickname: '测试号' } }))
})
await new Promise((r) => bridgeSrv.listen(bridgePort, '127.0.0.1', r))
await new Promise((r) => onebotSrv.listen(onebotPort, '127.0.0.1', r))
try {
  const routes = {}
  mod.apply(makeCtx(routes), { bridgeRoot: tmp })
  const snap = await get(routes['/api/qq-console'], '/api/qq-console?part=overview')
  check('桥接没雪字段时用 OneBot 兜底', snap.status?.snowluma?.accountOnline === true, JSON.stringify(snap.status?.snowluma))
  check('兜底后不会误报离线', !String(snap.diagnosis || '').includes('没连上'), String(snap.diagnosis || '（没有提示）'))
} finally {
  bridgeSrv.close()
  onebotSrv.close()
  fs.rmSync(tmp, { recursive: true, force: true })
}

if (failed) {
  console.log(`\n${failed} 项没过`)
  process.exit(1)
}
console.log('\n接口自检通过')
