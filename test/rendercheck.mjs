// 大肥鱼QQ总控台 · 渲染自检：mock 一个最小 React，把七个标签逐个空跑一遍。
// 抓的是「未定义变量 / 签名漏参数 / 用错字段」这类只有在浏览器里才会炸的错误。
import fs from 'node:fs'
import vm from 'node:vm'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SRC = path.join(HERE, '..', 'client.js')
const src = fs.readFileSync(SRC, 'utf8')
const now = Date.now()

const overview = {
  bridge: { online: true, error: null },
  status: { mode: 'reserved2', role: '大肥鱼', dshReady: true, snowluma: { accountOnline: true, connected: true }, activity: '[22:00] 测试\n[22:01] 又一条' },
  groups: [
    { key: 'group:1', id: '1', name: '测试群', members: 3, unread: 2, lastWakeReason: 'atMention', lastAiReplyAt: now, wakeConfig: { mode: 'diving', triggers: { probability: 0.05 } } },
  ],
  privateChats: [{ key: 'private:2', id: '2', name: '管理员（2）', unread: 0, lastWakeReason: 'private', lastAiReplyAt: now }],
  links: { console: 'http://127.0.0.1:3100/', snowluma: 'http://127.0.0.1:5099/' },
  diagnosis: '',
  pending: [],
  pendingRestart: '',
  at: now,
}

const store = {
  overview,
  roles: {
    ok: true,
    current: '大肥鱼',
    roles: ['大肥鱼'],
    summaries: [{ name: '大肥鱼', chars: 1457, lines: 88, injectedV2: 1456, truncated: false, warnings: 0 }],
    content: { name: '大肥鱼', content: '角色卡内容', chars: 1457, limits: { injectMaxChars: 2600 }, warnings: [] },
    backups: [{ file: 'a.md', role: '大肥鱼', at: now, chars: 1457 }],
  },
  simPrompt: { ok: true, preset: 'qq-chat-v2', content: '规则文本', chars: 4, warnings: [], status: {}, presets: [] },
  slang: {
    ok: true,
    counts: { total: 2, confirmed: 1, candidate: 1, rejected: 0 },
    entries: [
      { id: '1', content: '那没事了', meaning: '算了', usage: '', example: '', status: 'confirmed', count: 3, updatedAt: '2026-10-22T10:00:00Z' },
      { id: '2', content: '套条', meaning: '', usage: '', example: '', status: 'candidate', count: 1, updatedAt: '2026-10-22T11:00:00Z' },
    ],
  },
  stickers: {
    ok: true,
    total: 2,
    items: [
      { id: 's1', note: '白饭', tags: ['白饭'], useCount: 3, url: 'https://example.invalid/1.gif', size: 1000 },
      { id: 's2', note: '', tags: [], useCount: 0, url: 'https://example.invalid/2.gif', size: 5000000 },
    ],
  },
  usage: {
    ok: true,
    symbol: '¥',
    currency: 'CNY',
    hours: 24,
    totals: { cost: 9.8, turns: 234, steps: 1718, cacheHitRate: 0.99, totalTokens: 276233875 },
    nowTier: { tierLabel: '空闲时段', label: 'V4.1-Flash' },
    series: { hours: 24, from: now - 86400000, to: now, offChartCost: 1.7, buckets: Array.from({ length: 24 }, (_, i) => ({ t: now - i * 3600000, cost: i * 0.01 })) },
    conversations: [{ key: 'group:1', label: '测试群', cost: 6.6, turns: 86, lastAt: now }],
    consoleUsageUrl: 'http://127.0.0.1:3100/?token=x#usage',
  },
  settings: {
    ok: true,
    whitelist: { allow: { groups: ['1'], private: ['2'] }, ownerQQ: '2' },
    social: { wake: { preSleepWaitEnabled: true, preSleepWaitMs: 300000 }, send: { maxSendPerMinute: 4, maxSendPerHour: 60, maxMessageChars: 200 } },
    logs: { count: 2, alerts: [{ time: '22:00', text: '断开一次' }], lines: [{ time: '22:00', raw: '原始行' }] },
  },
}

function makeSandbox() {
  let mod
  const sandbox = {
    window: { __ModuleLoader__: { load: (o) => (mod = o) } },
    console: { log() {}, warn() {}, error() {}, info() {} },
    localStorage: { getItem: () => null, setItem() {} },
    fetch: async () => ({ ok: true, json: async () => ({}) }),
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    URLSearchParams,
    Date,
    Math,
    JSON,
    Number,
    String,
    Array,
    Object,
    Promise,
    Error,
    encodeURIComponent,
    parseInt,
    parseFloat,
    isNaN,
  }
  sandbox.globalThis = sandbox
  vm.createContext(sandbox)
  vm.runInContext(src, sandbox)
  return { sandbox, getMod: () => mod }
}

function renderTab(tab) {
  const { getMod } = makeSandbox()
  const mod = getMod()
  let counter = 0
  const React = {
    createElement: (type, props, ...children) => {
      const safe = { ...(props || {}) }
      safe.children = children
      return { type, props: safe, children }
    },
    useState: (init) => {
      counter += 1
      if (counter === 1) return [tab, () => {}]
      if (counter === 2) return [store, () => {}]
      return [typeof init === 'function' ? init() : init, () => {}]
    },
    useEffect: () => {},
    useCallback: (fn) => fn,
    // 空跑时 ref 只需要一个稳定的 .current 容器
    useRef: (init) => ({ current: init }),
    Fragment: 'Fragment',
    Component: class {
      constructor(props) {
        this.props = props
        this.state = {}
      }
      setState() {}
    },
  }

  const regs = []
  const ctx = { slots: { inject: (_k, cb) => cb(), register: (opts, comp) => regs.push({ opts, comp }) } }
  const api = mod.factory((name) => {
    if (name === 'react') return React
    throw new Error(`未知模块 ${name}`)
  })
  api.apply(ctx)
  const main = regs.find((r) => r.opts && r.opts.name === 'main')
  if (!main) throw new Error('main 面板没注册')

  const out = []
  const render = (node) => {
    if (node === null || node === undefined || node === false || node === true) return
    if (typeof node === 'string' || typeof node === 'number') {
      out.push(String(node))
      return
    }
    if (Array.isArray(node)) {
      for (const child of node) render(child)
      return
    }
    const { type, props, children } = node
    if (typeof type === 'function') {
      if (type.prototype && typeof type.prototype.render === 'function') {
        const inst = new type(props)
        render(inst.render())
        return
      }
      render(type(props))
      return
    }
    for (const child of children || []) render(child)
  }
  render(main.comp({}))
  return out.join('')
}

let failed = 0
for (const tab of ['overview', 'groups', 'persona', 'learning', 'stickers', 'usage', 'settings']) {
  try {
    const text = renderTab(tab)
    console.log(`  ${tab.padEnd(9)} OK   渲染出 ${text.length} 字`)
  } catch (error) {
    failed += 1
    console.log(`  ${tab.padEnd(9)} 失败 ${error && error.message}`)
  }
}
console.log(failed ? `\n有 ${failed} 个标签炸了` : '\n七个标签全部通过')
process.exit(failed ? 1 : 0)
