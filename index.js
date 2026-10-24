// dsh-qq-console —— 大肥鱼 QQ 总控台（宿主半边）
//
// 干三件事：
//   1. 在 DSH 自己的 HTTP 服务上开一个同源接口 /api/qq-console，替页面去问桥接和 OneBot
//      （浏览器直接跨端口会被同源策略挡，绕过去也没必要：同源接口顺带把 token 藏在宿主里）。
//   2. 开关整套 QQ：起/停 SnowLuma 和 qq-bridge，逻辑跟桌面那两个快捷方式一样，只是不弹网页。
//   3. 把状态拼成一份前端一次就能画完的快照。
//
// 不改桥接的代码、不改他的启动脚本，只调用它们。
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'

export const name = 'dsh-qq-console'
export const inject = ['webServer']

/** 路径一律「配置 → 环境变量 → 常见位置」三级探测，别人装在哪都能找到。 */
function firstExisting(candidates, probe) {
  for (const p of candidates) {
    if (!p) continue
    try {
      if (fs.existsSync(probe ? probe(p) : p)) return p
    } catch {}
  }
  return ''
}

/** 找 DSH 自带的 node：process.execPath 在 Electron 里是 Harness.exe，不能直接拿来跑脚本。 */
function detectNode() {
  const home = os.homedir()
  const base = path.join(home, '.dsh', 'dsh-runtimes')
  try {
    for (const dir of fs.readdirSync(base)) {
      const p = path.join(base, dir, 'dependencies', 'node', 'bin', 'node.exe')
      if (fs.existsSync(p)) return p
    }
  } catch {}
  return ''
}

function resolveRoots(cfg = {}) {
  const home = os.homedir()
  const bridge = firstExisting(
    [
      cfg.bridgeRoot,
      process.env.QQ_BRIDGE_ROOT,
      path.join(home, 'dsh', 'dsh-qq-bridge'),
      path.join(process.cwd(), 'dsh-qq-bridge'),
    ],
    (p) => path.join(p, 'qq-bridge-main', 'config.json'),
  )
  const snowluma = firstExisting(
    [cfg.snowlumaRoot, process.env.SNOWLUMA_ROOT, 'C:\\SnowLuma', path.join(home, 'SnowLuma')],
    (p) => path.join(p, 'index.mjs'),
  )
  return { bridge, snowluma, node: cfg.nodeExe || detectNode() }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function readJson(file) {
  try {
    let text = fs.readFileSync(file, 'utf8')
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1)
    return JSON.parse(text)
  } catch {
    return null
  }
}

/** 桥接配置每次现读：端口、令牌、白名单改了不用重装插件。 */
function readBridgeConfig(root) {
  const file = path.join(root, 'qq-bridge-main', 'config.json')
  const cfg = readJson(file) || {}
  return {
    configFile: file,
    port: Number(cfg.consolePort) || 3100,
    token: String(cfg.consoleToken || ''),
    onebotUrl: String(cfg.snowluma?.httpUrl || 'http://127.0.0.1:3000').replace(/\/+$/, ''),
    onebotToken: String(cfg.snowluma?.accessToken || ''),
    groups: Array.isArray(cfg.allow?.groups) ? cfg.allow.groups.map(String) : [],
    privateList: Array.isArray(cfg.allow?.private) ? cfg.allow.private.map(String) : [],
    ownerQQ: cfg.ownerQQ ? String(cfg.ownerQQ) : '',
  }
}

async function fetchJson(url, options = {}, timeoutMs = 4000) {
  const res = await fetch(url, { ...options, signal: AbortSignal.timeout(timeoutMs) })
  const text = await res.text()
  let data = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = { raw: text }
  }
  if (!res.ok) throw new Error((data && (data.error || data.message)) || `HTTP ${res.status}`)
  return data
}

/** 桥接的接口都要带 consoleToken（前缀 ? 或 & 看原路径有没有查询串）。 */
function bridgeUrl(cfg, pathname) {
  const sep = pathname.includes('?') ? '&' : '?'
  return `http://127.0.0.1:${cfg.port}${pathname}${sep}token=${encodeURIComponent(cfg.token)}`
}

async function bridgeJson(cfg, pathname, timeoutMs = 4000) {
  return fetchJson(bridgeUrl(cfg, pathname), {}, timeoutMs)
}

async function onebot(cfg, action, params = {}) {
  const headers = { 'content-type': 'application/json' }
  if (cfg.onebotToken) headers.authorization = `Bearer ${cfg.onebotToken}`
  const data = await fetchJson(
    `${cfg.onebotUrl}/${action}`,
    { method: 'POST', headers, body: JSON.stringify(params) },
    8000,
  )
  if (data && data.status === 'ok' && data.retcode === 0) return data.data
  throw new Error(`OneBot ${action} 失败：${JSON.stringify(data)?.slice(0, 200)}`)
}

function portOpen(port, timeoutMs = 700) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port })
    let settled = false
    const done = (value) => {
      if (settled) return
      settled = true
      try {
        socket.destroy()
      } catch {}
      resolve(value)
    }
    socket.setTimeout(timeoutMs)
    socket.once('connect', () => done(true))
    socket.once('error', () => done(false))
    socket.once('timeout', () => done(false))
  })
}

function spawnHidden(command, args, options = {}) {
  // 不 detached：detached 会带 DETACHED_PROCESS 标志，Windows 反而会给控制台程序
  // 单开一个可见的控制台（实测被 Windows Terminal 接管成一个窗口）。这里只用
  // windowsHide（CREATE_NO_WINDOW）+ stdio ignore，进程完全无窗口。
  const child = spawn(command, args, {
    windowsHide: true,
    stdio: 'ignore',
    ...options,
  })
  child.on('error', (error) => {
    try {
      console.warn('[dsh-qq-console] 起进程失败：', command, error?.message || error)
    } catch {}
  })
  child.unref()
  return child
}

/** 桥接自己的 node 运行时：优先 DSH 自带的 node，找不到再退回当前进程（Electron 主程序）。 */
const DEFAULT_NODE = detectNode()

function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function readLockPid(root) {
  try {
    const text = fs.readFileSync(path.join(root, 'qq-bridge-main', 'state', 'bridge.lock'), 'utf8')
    const pid = Number(String(text).trim())
    return Number.isInteger(pid) ? pid : null
  } catch {
    return null
  }
}

/** 把 config.json 的 DSH 地址对齐到当前这个 DSH（它每次启动端口都会变）。 */
function alignDshBaseUrl(root, origin) {
  const file = path.join(root, 'qq-bridge-main', 'config.json')
  let text = fs.readFileSync(file, 'utf8')
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1)
  const cfg = JSON.parse(text)
  // 只对齐地址；provider 只在缺省时补——别把用户自己配的 provider 无声覆盖掉
  cfg.dsh = { ...(cfg.dsh || {}), baseUrl: origin }
  if (!cfg.dsh.provider) cfg.dsh.provider = 'deepseek-account'
  fs.writeFileSync(file, JSON.stringify(cfg, null, 2), 'utf8')
  return cfg
}

/** netstat 找某个端口是谁在听（只认 127.0.0.1 的回环行）。 */
function listeningPid(port) {
  return new Promise((resolve) => {
    let child
    try {
      child = spawn('netstat', ['-ano'], { windowsHide: true })
    } catch {
      resolve(null)
      return
    }
    let out = ''
    child.stdout?.on('data', (chunk) => {
      out += chunk
    })
    child.on('close', () => {
      const re = new RegExp(`127\\.0\\.0\\.1:${port}\\s+\\S+\\s+LISTENING\\s+(\\d+)`, 'i')
      for (const line of out.split(/\r?\n/)) {
        const match = line.match(re)
        if (match) {
          resolve(Number(match[1]))
          return
        }
      }
      resolve(null)
    })
    child.on('error', () => resolve(null))
  })
}

/** 网页研究单飞锁：同一时刻只允许一轮。 */
let webResearchBusy = false

/** 启停互斥：同时点两次启动会起两份进程。 */
let lifecycleBusy = false

/** 起 SnowLuma + 桥接。不打开网页，也不依赖 PowerShell 脚本。 */
async function startAll(roots, origin) {
  const steps = []

  if (await portOpen(5099)) {
    steps.push({ ok: true, text: 'SnowLuma 已经在跑' })
  } else {
    const exe = path.join(roots.snowluma, 'node.exe')
    if (!fs.existsSync(exe)) throw new Error('找不到 SnowLuma 的 node.exe（装好 SnowLuma 后把 snowlumaRoot 指过去）')
    spawnHidden(exe, ['.\\index.mjs'], { cwd: roots.snowluma })
    steps.push({ ok: true, text: '正在启动 SnowLuma' })
    // 启动不等于起来了：等 5099 真的监听，起不来就明说，别让它恒为 ok
    let snowUp = false
    const snowDeadline = Date.now() + 30_000
    while (!snowUp && Date.now() < snowDeadline) {
      await sleep(1000)
      snowUp = await portOpen(5099)
    }
    if (!snowUp) throw new Error('SnowLuma 30 秒内没起来（看看它的日志或配置）')
  }

  const cfg = readBridgeConfig(roots.bridge)
  const bridgeUp = await portOpen(cfg.port)

  if (bridgeUp) {
    steps.push({ ok: true, text: 'QQ 桥接已经在跑' })
  } else {
    if (origin) alignDshBaseUrl(roots.bridge, origin)

    // 旧实例还占着锁就先收掉（DSH 换端口后它连的是老地址）。
    // 只杀确认是 node.exe 的进程：lock 文件可能残留，PID 也可能已被别的程序复用。
    const oldPid = readLockPid(roots.bridge)
    if (oldPid && pidAlive(oldPid)) {
      await killIfOurs(oldPid, /^node\.exe$/i, /bridge\.js/i)
      // taskkill 是异步的：等它真退出（最多 15 秒）再删锁，别固定睡一下就当它死了
      const dieBy = Date.now() + 15_000
      while (pidAlive(oldPid) && Date.now() < dieBy) await sleep(300)
      try {
        fs.rmSync(path.join(roots.bridge, 'qq-bridge-main', 'state', 'bridge.lock'), { force: true })
      } catch {}
    }

    const nodeExe = roots.node || DEFAULT_NODE
    if (!fs.existsSync(nodeExe)) throw new Error('找不到 Node 运行时（配置里填 nodeExe，或装一个 Node 22+）')
    const entry = path.join(roots.bridge, 'qq-bridge-main', 'src', 'bridge.js')
    if (!fs.existsSync(entry)) throw new Error('找不到桥接入口（确认 bridgeRoot 指向 qq-bridge 的解压目录）')
    spawnHidden(nodeExe, [entry], { cwd: path.join(roots.bridge, 'qq-bridge-main') })
    steps.push({ ok: true, text: '正在启动 QQ 桥接' })
  }

  const deadline = Date.now() + 60_000
  let ready = bridgeUp
  while (!ready && Date.now() < deadline) {
    await sleep(1200)
    try {
      await bridgeJson(readBridgeConfig(roots.bridge), '/api/status', 1500)
      ready = true
    } catch {}
  }
  steps.push(
    ready
      ? { ok: true, text: '桥接已就绪' }
      : { ok: false, text: '等了 60 秒桥接还没应答，看看原控制台或启动日志' },
  )
  return steps
}

/** 用 tasklist 查这个 PID 的映像名；查不到返回空。 */
function imageNameOf(pid) {
  return new Promise((resolve) => {
    let child
    try {
      child = spawn('tasklist', ['/FI', `PID eq ${Number(pid)}`, '/FO', 'CSV', '/NH'], { windowsHide: true })
    } catch {
      resolve('')
      return
    }
    let out = ''
    child.stdout?.on('data', (chunk) => {
      out += chunk
    })
    child.on('close', () => {
      const match = out.match(/^"([^"]+)"/m)
      resolve(match ? match[1] : '')
    })
    child.on('error', () => resolve(''))
  })
}

/** 用 PowerShell 查进程的启动命令行；查不到返回空串（超时 4 秒）。 */
function commandLineOf(pid) {
  return new Promise((resolve) => {
    let child
    try {
      child = spawn(
        'powershell',
        ['-NoProfile', '-NonInteractive', '-Command', `(Get-CimInstance Win32_Process -Filter "ProcessId=${Number(pid)}").CommandLine`],
        { windowsHide: true },
      )
    } catch {
      resolve('')
      return
    }
    let out = ''
    let settled = false
    const finish = (value) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try {
        child.kill()
      } catch {}
      resolve(value)
    }
    const timer = setTimeout(() => finish(''), 4000)
    child.stdout?.on('data', (chunk) => {
      if (out.length < 4000) out += chunk
    })
    child.on('close', () => finish(String(out).trim()))
    child.on('error', () => finish(''))
  })
}

/**
 * 只杀确认是自己那类进程的 PID：3100/5099 可能被别的程序占着，
 * 光看「端口上有进程」就 taskkill 会误杀别人的开发服务器。
 * 映像名（node.exe）不够——DSH 自己、任何 Node 开发服务器都叫这个；
 * 还要命令行里能看到我们启动它时用的入口（bridge.js / index.mjs）。
 */
async function killIfOurs(pid, allowedImage, marker, killed) {
  const image = await imageNameOf(pid)
  if (!image || !allowedImage.test(image)) return false
  const commandLine = await commandLineOf(pid)
  if (!commandLine || !marker.test(commandLine)) return false
  spawnHidden('taskkill', ['/PID', String(pid), '/T', '/F'])
  if (Array.isArray(killed)) killed.push(pid)
  return true
}

async function stopAll(roots) {
  const cfg = readBridgeConfig(roots.bridge)
  const pids = new Set()
  const killed = []
  const lockPid = readLockPid(roots.bridge)
  if (lockPid && pidAlive(lockPid)) pids.add(lockPid)
  const bridgePid = await listeningPid(cfg.port)
  if (bridgePid) pids.add(bridgePid)
  const snowPid = await listeningPid(5099)
  if (snowPid) pids.add(snowPid)

  for (const pid of pids) {
    const marker = pid === snowPid ? /index\.mjs|snowluma/i : /bridge\.js/i
    await killIfOurs(pid, /^node\.exe$/i, marker, killed)
  }

  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    await sleep(700)
    if (!(await portOpen(cfg.port)) && !(await portOpen(5099))) break
  }
  try {
    fs.rmSync(path.join(roots.bridge, 'qq-bridge-main', 'state', 'bridge.lock'), { force: true })
  } catch {}

  return {
    bridge: await portOpen(cfg.port),
    snowluma: await portOpen(5099),
    killed,
  }
}

async function snapshot(roots) {
  const cfg = readBridgeConfig(roots.bridge)
  const out = {
    bridge: { online: false, error: null },
    status: null,
    conversations: [],
    groups: [],
    links: {
      // 不带 token：它是桥接控制台的最高权限凭据，放进 URL 会进浏览器历史。
      // 需要 token 时用户自己去 config.json 拿（或用页面上的「设置」看）。
      console: `http://127.0.0.1:${cfg.port}/`,
      snowluma: 'http://127.0.0.1:5099',
    },
    at: Date.now(),
  }

  try {
    out.status = await bridgeJson(cfg, '/api/status', 2500)
    out.bridge.online = true
  } catch (error) {
    out.bridge.error = '连不上桥接（可能是没启动）'
    out.bridge.rawError = error?.message || String(error)
    out.diagnosis = diagnose(out)
    return out
  }

  // 上游 qq-bridge v0.2.0 的 /api/status 没有 snowluma 字段，界面会恒显示「离线」。
  // 取不到就直接问 OneBot（桥接本来就是靠它连 QQ 的），别让界面绑死在桥接字段上。
  if (!out.status || !out.status.snowluma) {
    const sl = { connected: false, accountOnline: false }
    try {
      const info = await onebot(cfg, 'get_login_info')
      sl.connected = true
      sl.accountOnline = Number(info?.user_id) > 0
    } catch {}
    out.status = { ...(out.status || {}), snowluma: sl }
  }

  try {
    const states = await bridgeJson(cfg, '/api/socialV2/states', 2500)
    out.conversations = Array.isArray(states?.conversations) ? states.conversations : []
  } catch {}

  // 群名和人数只有 OneBot 知道，失败就算了（退化成群号）
  const meta = new Map()
  try {
    const list = await onebot(cfg, 'get_group_list')
    if (Array.isArray(list)) {
      for (const item of list) if (item && item.group_id) meta.set(String(item.group_id), item)
    }
  } catch {}

  const byKey = new Map()
  for (const conv of out.conversations) if (conv && conv.key) byKey.set(String(conv.key), conv)

  out.groups = cfg.groups.map((id) => {
    const key = `group:${id}`
    const conv = byKey.get(key) || null
    const info = meta.get(id) || null
    return {
      key,
      id,
      name: info?.group_name || `群 ${id}`,
      members: typeof info?.member_count === 'number' ? info.member_count : null,
      unread: typeof conv?.unreadCount === 'number' ? conv.unreadCount : null,
      lastWakeReason: conv?.lastWakeReason ?? null,
      lastAiReplyAt: conv?.lastAiReplyAt ?? null,
      wakeConfig: conv?.wakeConfig ?? null,
    }
  })

  out.privateChats = cfg.privateList.map((id) => {
    const key = `private:${id}`
    const conv = byKey.get(key) || null
    return {
      key,
      id,
      name: id === cfg.ownerQQ ? `管理员（${id}）` : `私聊 ${id}`,
      unread: typeof conv?.unreadCount === 'number' ? conv.unreadCount : null,
      lastWakeReason: conv?.lastWakeReason ?? null,
      lastAiReplyAt: conv?.lastAiReplyAt ?? null,
    }
  })

  // 卡在等人确认的事（工具审批 / 提问），以及群里积压没回的信号
  try {
    const p = await bridgeJson(cfg, '/api/pending', 2000)
    out.pending = Array.isArray(p?.pending) ? p.pending : []
  } catch {
    out.pending = []
  }
  out.pendingRestart = restartStillPending(roots)
  out.diagnosis = diagnose(out)
  return out
}

/** 改完要重启 DSH 才生效的东西，写个标记；DSH 一重启，标记的写入时间就比进程启动还早，自动失效。 */
function restartMarkPath(roots) {
  return path.join(roots.bridge, 'qq-bridge-main', 'state', 'qq-console-restart.json')
}

function markRestartPending(roots, what) {
  try {
    const dir = path.join(roots.bridge, 'qq-bridge-main', 'state')
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(restartMarkPath(roots), JSON.stringify({ at: Date.now(), what }), 'utf8')
  } catch {}
}

function restartStillPending(roots) {
  try {
    const data = JSON.parse(fs.readFileSync(restartMarkPath(roots), 'utf8'))
    const startedAt = Date.now() - process.uptime() * 1000
    return Number(data?.at) > startedAt ? String(data?.what || '改动') : ''
  } catch {
    return ''
  }
}

// ---------- 网页版 AI 研究黑话（外包，省 token） ----------
// 用浏览器自动化操作已登录的 chat.deepseek.com：把候选词丢过去，收回 JSON 写回桥接。
// 浏览器是独立 profile（~/.dsh/qq-console/edge-agent），第一次登录后一直保持，
// 点按钮时自动拉起，不占用户日常那个 Edge。
// 调试用浏览器：独立 profile 放用户数据目录，不碰日常 Edge；可执行文件按常见位置探测。
const EDGE_EXE =
  firstExisting([
    process.env.EDGE_PATH,
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  ]) || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const AGENT_PROFILE = path.join(os.homedir(), '.dsh', 'qq-console', 'edge-agent')
/** 这个标记文件存在 = 9222 上那个浏览器是我们启动的（防止误操作别人的调试浏览器）。 */
const AGENT_MARK = path.join(os.homedir(), '.dsh', 'qq-console', '.agent-browser')
const CDP_PORT = 9222

async function cdpVersion(timeoutMs = 1500) {
  try {
    const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`, { signal: AbortSignal.timeout(timeoutMs) })
    return res.ok ? await res.json() : null
  } catch {
    return null
  }
}

async function ensureDebugBrowser() {
  if (await cdpVersion()) {
    // 9222 上已经有浏览器：必须确认是我们自己的那个
    // （有个标记文件就说明这个 profile 是我们启动过的），否则可能是用户自己开的
    // 调试浏览器或别的自动化工具——不能往里打字、导航别人的标签页。
    if (!fs.existsSync(AGENT_MARK)) {
      throw new Error('9222 端口上有别的调试浏览器在跑，先关掉它再用网页研究（不能用你的日常浏览器）')
    }
    return { started: false }
  }
  if (!fs.existsSync(EDGE_EXE)) throw new Error(`找不到 Edge：${EDGE_EXE}`)
  const child = spawn(
    EDGE_EXE,
    [`--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${AGENT_PROFILE}`, '--profile-directory=Default', 'about:blank'],
    { detached: true, stdio: 'ignore', windowsHide: false },
  )
  child.on('error', () => {})
  child.unref()
  const deadline = Date.now() + 25000
  while (Date.now() < deadline) {
    await sleep(800)
    if (await cdpVersion()) {
      try {
        fs.mkdirSync(path.dirname(AGENT_MARK), { recursive: true })
        fs.writeFileSync(AGENT_MARK, new Date().toISOString(), 'utf8')
      } catch {}
      return { started: true }
    }
  }
  throw new Error('浏览器 25 秒内没起来（端口被占或被安全策略拦）')
}

async function cdpConnect() {
  const list = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`).then((r) => r.json())
  const page = list.find((x) => x.type === 'page' && String(x.url).includes('deepseek')) || list.find((x) => x.type === 'page')
  if (!page) throw new Error('浏览器里没有可用标签页')
  const ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true })
    ws.addEventListener('error', () => reject(new Error('CDP 连接失败')), { once: true })
  })
  let nextId = 1
  const waiting = new Map()
  ws.addEventListener('message', (event) => {
    let msg
    try {
      msg = JSON.parse(event.data)
    } catch {
      return
    }
    if (msg.id && waiting.has(msg.id)) {
      const { resolve, reject } = waiting.get(msg.id)
      waiting.delete(msg.id)
      if (msg.error) reject(new Error(JSON.stringify(msg.error)))
      else resolve(msg.result)
    }
  })
  // 浏览器中途被关掉时，所有挂起的 send 必须立刻 reject，否则 Promise 永远不 settle，
  // 研究请求会永久挂起、页面一直 busy。
  const failAll = (reason) => {
    for (const { reject } of waiting.values()) reject(new Error(reason))
    waiting.clear()
  }
  ws.addEventListener('close', () => failAll('浏览器连接断了'))
  ws.addEventListener('error', () => failAll('浏览器连接出错'))
  const send = (method, params = {}, timeoutMs = 30000) =>
    new Promise((resolve, reject) => {
      const id = nextId++
      const timer = setTimeout(() => {
        waiting.delete(id)
        reject(new Error(`等浏览器回应用时（${method}）`))
      }, timeoutMs)
      const done = (fn) => (value) => {
        clearTimeout(timer)
        fn(value)
      }
      waiting.set(id, { resolve: done(resolve), reject: done(reject) })
      try {
        ws.send(JSON.stringify({ id, method, params }))
      } catch (error) {
        clearTimeout(timer)
        waiting.delete(id)
        reject(error)
      }
    })
  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    if (r.exceptionDetails) throw new Error('页面脚本异常')
    return r.result?.value
  }
  return { ws, send, evaluate }
}

/** 命令在不在 PATH 里（用在 ffmpeg 这种可能只配了 PATH 的情况）。 */
function commandInPath(command) {
  return new Promise((resolve) => {
    let child
    try {
      child = spawn('where', [String(command)], { windowsHide: true })
    } catch {
      resolve(false)
      return
    }
    child.on('close', (code) => resolve(code === 0))
    child.on('error', () => resolve(false))
  })
}

/**
 * 查 QQ 预设里有没有当前 DSH 不认识的提示词变量。
 * 上游 qq-bridge 的 preset 带 {{cwd}}，装的时候一点事没有，第一次「叫醒」才炸，而且错只发到 QQ。
 * 注释行不算（`#` 开头），免得把我们的说明文字误报成变量。
 */
function presetVariableCheck(roots) {
  const dir = path.join(roots.bridge, 'qq-bridge-main', 'dsh', 'agent-presets')
  const known = new Set(['provider', 'model'])
  const bad = []
  let checked = 0
  let names = []
  try {
    names = fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name)
  } catch {
    return { ok: false, detail: '找不到 dsh/agent-presets（桥接目录填对了吗）' }
  }
  for (const name of names) {
    let text = ''
    try {
      text = fs.readFileSync(path.join(dir, name, 'agent.cordis.yml'), 'utf8')
    } catch {
      continue
    }
    checked += 1
    for (const line of text.split(/\r?\n/)) {
      if (line.trim().startsWith('#')) continue
      for (const m of line.matchAll(/\{\{\s*([A-Za-z0-9_.-]+)\s*\}\}/g)) {
        if (!known.has(m[1])) bad.push(`${name}: {{${m[1]}}}`)
      }
    }
  }
  if (!checked) return { ok: false, detail: '一个预设文件都没读到' }
  if (bad.length) return { ok: false, detail: `有当前 DSH 不认识的变量：${[...new Set(bad)].join('、')}（删掉那行，重启 DSH）` }
  return { ok: true, detail: `${checked} 个预设都没问题` }
}

/** 环境自检：刚装插件的人最常问「我还缺什么」，这里一次列全。 */
async function envCheckData(roots) {
  const probe = (target, need) => {
    if (!target) return { ok: false, detail: '没探测到' }
    try {
      // 可能是命令名而不是路径（ffmpeg 走 PATH 时就是 'ffmpeg'）：
      // 直接 existsSync('ffmpeg') 必然 false，会误报「路径不存在」
      if (!/[\\/]/.test(target)) {
        return commandInPath(target).then((found) => (found ? { ok: true, detail: '' } : { ok: false, detail: 'PATH 里找不到' }))
      }
      if (!fs.existsSync(target)) return { ok: false, detail: '路径不存在' }
      if (need) {
        const inner = path.join(target, need)
        if (!fs.existsSync(inner)) return { ok: false, detail: `目录里找不到 ${need}` }
      }
      return { ok: true, detail: '' }
    } catch (error) {
      return { ok: false, detail: String(error?.message ?? error) }
    }
  }
  const items = [
    { key: 'bridge', name: 'QQ 桥接', required: true, hint: '去 GitHub 下载 qq-bridge，或在插件配置里填 bridgeRoot' },
    { key: 'snowluma', name: 'SnowLuma', required: true, hint: '去 GitHub 下载（EULA，需自己下），或填 snowlumaRoot' },
    { key: 'node', name: 'Node 运行时', required: true, hint: '默认用 DSH 自带的那个' },
    { key: 'ffmpeg', name: 'ffmpeg', required: false, hint: '缺了：表情包缩略图、动图拼图不可用' },
    { key: 'edge', name: 'Edge 浏览器', required: false, hint: '缺了：网页版研究不可用' },
    { key: 'profile', name: '网页研究登录状态', required: false, hint: '第一次用会在弹出的窗口里登录一次' },
  ]
  // probe 里可能走 where 查 PATH（返回 Promise），所以这里逐个 await
  const results = []
  for (const it of items) {
    const target =
      it.key === 'ffmpeg' ? FFMPEG
        : it.key === 'edge' ? EDGE_EXE
          : it.key === 'profile' ? AGENT_PROFILE
            : roots[it.key]
    const need = it.key === 'bridge' ? path.join('qq-bridge-main', 'config.json') : it.key === 'snowluma' ? 'index.mjs' : ''
    results.push({ ...it, path: target || '', ...(await probe(target, need)) })
  }
  // 预设变量单独查：这条不炸在安装时，炸在第一次「叫醒」，而且错只发到 QQ，控制台看不到
  results.push({
    key: 'preset',
    name: 'QQ 预设变量',
    required: true,
    hint: '用本仓库的 fork；上游 preset 带 {{cwd}}，装完第一次叫醒会报错',
    path: path.join(roots.bridge, 'qq-bridge-main', 'dsh', 'agent-presets'),
    ...presetVariableCheck(roots),
  })
  return { ok: true, part: 'env', items: results }
}

/** 打开网页版并检查登录态（没登录就把窗口停在登录页，让用户自己点）。 */
async function webLoginState() {
  const started = await ensureDebugBrowser()
  const client = await cdpConnect()
  try {
    await client.send('Page.enable')
    const current = String((await client.evaluate('location.href')) || '')
    if (!current.includes('chat.deepseek.com')) {
      await client.send('Page.navigate', { url: 'https://chat.deepseek.com/' })
      await sleep(5000)
    }
    const raw = await client.evaluate(`JSON.stringify({ url: location.href, token: !!localStorage.getItem('userToken'), title: document.title })`)
    const state = JSON.parse(raw || '{}')
    return {
      ok: true,
      part: 'web',
      browserStarted: started.started,
      url: state.url || '',
      loggedIn: Boolean(state.token) && !String(state.url || '').includes('sign_in'),
      title: state.title || '',
    }
  } finally {
    try {
      client.ws.close()
    } catch {}
  }
}

function buildSlangPrompt(items) {
  const lines = items.map((it, i) => {
    const ev = (it.evidence || [])
      .slice(0, 2)
      .map((e) => `${e.sender || '群友'}：${String(e.text || '').slice(0, 60)}`)
      .join('；')
    return `${i + 1}. ${it.content}${ev ? `\n   群聊原话：${ev}` : ''}`
  })
  return `你是网络黑话研究员。请研究下面这些 QQ 群里的黑话，结合给出的群聊原话判断真实含义。

要求：
1. 只输出一个 JSON 数组，不要任何解释、不要 markdown 代码块、不要多余文字
2. 每条格式：{"content":"原词原样","meaning":"一句话中文意思","usage":"什么场合怎么用","example":"一个自然的例句"}
3. 拿不准的把 meaning 写成「不确定」，不要编造
4. content 必须和原词一字不差

词条：
${lines.join('\n')}`
}

function parseSlangJson(text) {
  let s = String(text || '').trim()
  s = s.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim()
  const start = s.indexOf('[')
  const end = s.lastIndexOf(']')
  if (start >= 0 && end > start) s = s.slice(start, end + 1)
  return JSON.parse(s)
}

/** 跑一轮网页研究：填词 → 回车 → 等回复 → 解析 → 写回桥接。 */
// 网页版有内容审核：证据里出现成人/政治/违法类词，整批都会被「这个问题我暂时无法回答」挡掉。
// 所以导出前先把这类词条挑出去，单独告诉用户手动处理，别让它拖累整批。
const WEB_SENSITIVE_WORDS = [
  '涩图', '黄图', '色情', '裸', '约炮', '性爱', '做爱', 'p站', 'pixiv', 'r18',
  '翻墙', '政治', '习近平', '共产党', '法轮', '六四', '台独', '港独',
  '毒品', '赌博', '自杀', '枪',
]

function isWebSensitive(item) {
  const text = [item.content, ...(item.evidence || []).map((e) => e.text || '')].join(' ').toLowerCase()
  return WEB_SENSITIVE_WORDS.some((w) => text.includes(String(w).toLowerCase()))
}

async function runWebResearch(roots, limit) {
  const all = await bridgeJson(readBridgeConfig(roots.bridge), '/api/slang', 8000)
  const entries = Array.isArray(all?.entries) ? all.entries : []
  const candidates = entries.filter((e) => e.status === 'candidate' && !String(e.meaning || '').trim())
  // 敏感词条单独拎出来，不发给网页版
  const sensitive = candidates.filter((e) => isWebSensitive(e))
  const safe = candidates.filter((e) => !isWebSensitive(e))
  const want = Math.min(50, Math.max(1, Number(limit) || 10))
  const items = safe.slice(0, want)
  const sensitiveNote = sensitive.length ? `跳过 ${sensitive.length} 条含敏感词的：${sensitive.slice(0, 5).map((e) => e.content).join('、')}${sensitive.length > 5 ? '…' : ''}` : ''
  if (!items.length) {
    return { ok: true, part: 'web', done: 0, skipped: sensitive.map((e) => e.content).slice(0, 20), message: sensitiveNote || '没有需要研究的候选词' }
  }

  // 先过归属检查：9222 上要是别人开的调试浏览器，不能往里打字、导航别人的标签页
  await ensureDebugBrowser()
  const client = await cdpConnect()
  let reply = ''
  try {
    await client.send('Page.enable')
    await client.send('Page.navigate', { url: 'https://chat.deepseek.com/' })
    await sleep(6000)
    const before = await client.evaluate(`document.querySelectorAll('.ds-markdown').length`)
    const prompt = buildSlangPrompt(items)
    const filled = await client.evaluate(`
      (() => {
        const ta = document.querySelector('textarea')
        if (!ta) return 'no-textarea'
        ta.focus()
        const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set
        setter.call(ta, ${JSON.stringify(prompt)})
        ta.dispatchEvent(new Event('input', { bubbles: true }))
        return 'filled'
      })()
    `)
    if (filled !== 'filled') throw new Error('找不到输入框（网页结构可能变了）')
    await sleep(800)
    await client.evaluate(`
      (() => {
        const ta = document.querySelector('textarea')
        for (const t of ['keydown','keypress','keyup']) {
          ta.dispatchEvent(new KeyboardEvent(t, { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true }))
        }
        return 'sent'
      })()
    `)

    let last = ''
    let stable = 0
    const deadline = Date.now() + 240000
    while (Date.now() < deadline) {
      await sleep(2500)
      const count = await client.evaluate(`document.querySelectorAll('.ds-markdown').length`)
      const text = await client.evaluate(`
        (() => {
          const nodes = [...document.querySelectorAll('.ds-markdown')]
          return nodes.length ? nodes[nodes.length - 1].innerText : ''
        })()
      `)
      if (count > before && text && String(text).length > 10) {
        if (text === last) stable += 1
        else {
          stable = 0
          last = text
        }
        if (stable >= 2) break
      }
    }
    reply = last
  } finally {
    try {
      client.ws.close()
    } catch {}
  }

  if (!reply) return { ok: false, error: '网页没有回复（可能被限流或页面变了）' }

  // 内容审核拦截：网页版对敏感内容回固定话术，不是模型坏了，也不是 JSON 解析问题
  if (/暂时无法回答|换个话题再聊聊|无法回答这个问题/.test(reply)) {
    return {
      ok: false,
      error: `网页版拒绝回答（内容审核拦了）。这批里可能还有没过滤到的敏感词，减少条数或换一批再试${sensitiveNote ? `。${sensitiveNote}` : ''}`,
    }
  }

  let rows
  try {
    rows = parseSlangJson(reply)
  } catch {
    try {
      fs.writeFileSync(path.join(roots.bridge, 'qq-bridge-main', 'state', 'web-research-raw.txt'), reply, 'utf8')
    } catch {}
    return { ok: false, error: `网页返回的不是 JSON，原文已存 state/web-research-raw.txt（${reply.length} 字）` }
  }
  if (!Array.isArray(rows) || !rows.length) return { ok: false, error: '网页返回的 JSON 是空的' }

  const cfgb = readBridgeConfig(roots.bridge)
  const byContent = new Map(items.map((it) => [String(it.content).trim(), it]))
  let written = 0
  const missed = []
  for (const row of rows) {
    const key = String(row?.content ?? '').trim()
    const target = byContent.get(key)
    if (!target) {
      missed.push(key)
      continue
    }
    if (!row?.meaning) continue
    try {
      const res = await fetchJson(
        bridgeUrl(cfgb, `/api/slang/${encodeURIComponent(target.id)}`),
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            meaning: String(row.meaning).slice(0, 200),
            usage: String(row.usage || '').slice(0, 200),
            example: String(row.example || '').slice(0, 200),
          }),
        },
        10000,
      )
      if (res?.ok) written += 1
      else missed.push(key)
    } catch {
      missed.push(key)
    }
  }
  return {
    ok: true,
    part: 'web',
    done: written,
    total: items.length,
    skipped: sensitive.map((e) => e.content).slice(0, 20),
    skippedCount: sensitive.length,
    missed: missed.slice(0, 10),
    replyChars: reply.length,
    data: await refreshSafe(() => slangData(roots)),
  }
}

async function simPromptData(roots) {
  const cfg = readBridgeConfig(roots.bridge)
  let preset = 'qq-chat-v2'
  try {
    const sc = await bridgeJson(cfg, '/api/socialV2/config', 3000)
    preset = String(sc?.config?.agentPreset || preset)
  } catch {}
  const r = await bridgeJson(cfg, `/api/preset/sim-prompt?preset=${encodeURIComponent(preset)}`, 8000)
  return {
    ok: true,
    part: 'simPrompt',
    preset,
    content: r?.content ?? '',
    chars: r?.chars ?? 0,
    warnings: r?.warnings ?? [],
    status: r?.status ?? null,
    presets: r?.presets ?? [],
  }
}

/** 人格卡名字会直接拼进路径：只允许安全字符，挡住 `..\` 之类的路径穿越。 */
function safeRoleName(name) {
  const s = String(name ?? '').trim()
  if (!s) throw new Error('名字不能为空')
  if (s === '.' || s === '..') throw new Error('名字不合法')
  if (/[\\/:*?"<>|\u0000-\u001f]/.test(s)) throw new Error('名字里有不允许的字符')
  return s
}

/** 把某张人格卡复制一份到 state/role-backups/，返回备份路径；文件不存在就返回空串。 */
function backupRole(roots, roleName) {
  const safe = safeRoleName(roleName)
  const roleFile = path.join(roots.bridge, 'qq-bridge-main', 'roles', `${safe}.md`)
  if (!fs.existsSync(roleFile)) return ''
  const dir = path.join(roots.bridge, 'qq-bridge-main', 'state', 'role-backups')
  fs.mkdirSync(dir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const dest = path.join(dir, `${safe}-${stamp}.md`)
  fs.copyFileSync(roleFile, dest)
  // Windows 上 copyFile 会把源文件的修改时间一起抄过来。不改的话备份列表显示的是
  // 「角色卡最后修改时间」，不是「备份时间」，同一张卡的备份还会挤在同一刻。
  try {
    const now = new Date()
    fs.utimesSync(dest, now, now)
  } catch {}
  // 备份会无上限增长：每次保存/删除/恢复都写一份，只留最近 50 份。
  // 排序必须按文件名里的时间戳：按整串文件名排等于按角色名的字排序，
  // ASCII 名字会排在中文前面先被删，新写的也可能当场被删。
  try {
    const all = fs.readdirSync(dir).filter((file) => file.endsWith('.md'))
    // 认不出时间的（用户自己改过名之类）排最后，先删能认出时间的
    const stampOrLast = (file) => backupStampMs(file) || Number.MAX_SAFE_INTEGER
    all.sort((a, b) => stampOrLast(a) - stampOrLast(b) || a.localeCompare(b))
    while (all.length > 50) {
      const oldest = all.shift()
      try {
        fs.unlinkSync(path.join(dir, oldest))
      } catch {}
    }
  } catch {}
  return dest
}

/** 从备份文件名里取时间（`角色名-2026-10-24T05-03-00-123Z.md`），取不到返回 0。 */
function backupStampMs(file) {
  const m = String(file).match(/-(\d{4}-\d{2}-\d{2})T([\d-]+)Z\.md$/)
  if (!m) return 0
  const clock = m[2].replace(/^(\d{2})-(\d{2})-(\d{2})-(\d{3})$/, '$1:$2:$3.$4')
  const t = Date.parse(`${m[1]}T${clock}Z`)
  return Number.isFinite(t) ? t : 0
}

async function backupsData(roots) {
  const dir = path.join(roots.bridge, 'qq-bridge-main', 'state', 'role-backups')
  let files = []
  try {
    files = fs.readdirSync(dir).filter((file) => file.endsWith('.md'))
  } catch {}
  const items = files
    .map((file) => {
      const full = path.join(dir, file)
      let at = 0
      let chars = 0
      try {
        at = fs.statSync(full).mtimeMs
      } catch {}
      try {
        chars = fs.readFileSync(full, 'utf8').length
      } catch {}
      const m = file.match(/^(.+?)-(\d{4}-\d{2}-\d{2}T[\d-]+Z)\.md$/)
      // 老备份是「补 utimes 之前」写的，mtime 抄的是角色卡的时间；有文件名时间就以文件名为准
      const stamped = backupStampMs(file)
      if (stamped) at = stamped
      return { file, role: m ? m[1] : file.replace(/\.md$/, ''), at, chars }
    })
    .sort((a, b) => b.at - a.at)
    .slice(0, 50)
  return { ok: true, part: 'backups', items }
}

async function rolesData(roots) {
  const cfg = readBridgeConfig(roots.bridge)
  const list = await bridgeJson(cfg, '/api/roles', 3000)
  let content = null
  if (list?.current) {
    try {
      content = await bridgeJson(cfg, `/api/roles/content?name=${encodeURIComponent(list.current)}`, 3000)
    } catch {}
  }
  return { ok: true, part: 'roles', ...list, content, backups: (await backupsData(roots)).items }
}

async function slangData(roots) {
  const cfg = readBridgeConfig(roots.bridge)
  const all = await bridgeJson(cfg, '/api/slang', 6000)
  const entries = Array.isArray(all?.entries) ? all.entries : []
  const counts = { total: entries.length, confirmed: 0, candidate: 0, rejected: 0 }
  for (const e of entries) {
    if (e.status === 'confirmed') counts.confirmed += 1
    else if (e.status === 'rejected') counts.rejected += 1
    else counts.candidate += 1
  }
  const list = entries
    .slice()
    .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))
    .slice(0, 400)
    .map((e) => ({
      id: e.id,
      content: e.content,
      meaning: e.meaning,
      usage: e.usage,
      example: e.example,
      status: e.status,
      count: e.count,
      updatedAt: e.updatedAt,
    }))
  return { ok: true, part: 'slang', counts, shown: list.length, entries: list }
}

/** ffmpeg：环境变量 → 本机常见位置 → PATH 里的 ffmpeg（表情缩略图、动图抽帧用）。 */
let FFMPEG =
  firstExisting([
    process.env.FFMPEG_PATH,
    'C:\\ffmpeg\\bin\\ffmpeg.exe',
  ]) || 'ffmpeg'
const THUMB_WIDTH = 200
const stickerUrlIndex = new Map()
const thumbJobs = new Map()

function thumbDir(roots) {
  return path.join(roots.bridge, 'qq-bridge-main', 'state', 'qq-console-thumbs')
}

/** 用 ffmpeg 从 stdin 吃原图、只取第一帧、缩到 200px 宽，吐 JPEG 到 stdout。
 *  必须带超时：碰到坏图 ffmpeg 会一直等，浏览器每个源只有 6 个连接，会把轮询一起堵死。 */
function ffmpegFirstFrame(buf, timeoutMs = 20_000) {
  return new Promise((resolve, reject) => {
    let child
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      try {
        child?.kill()
      } catch {}
      reject(new Error('ffmpeg 超时（20 秒没出图）'))
    }, timeoutMs)
    const done = (fn, value) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      fn(value)
    }
    try {
      child = spawn(
        FFMPEG,
        ['-hide_banner', '-loglevel', 'error', '-i', 'pipe:0', '-frames:v', '1', '-vf', `scale=${THUMB_WIDTH}:-1`, '-f', 'image2pipe', '-vcodec', 'mjpeg', 'pipe:1'],
        { windowsHide: true },
      )
    } catch (error) {
      done(reject, error)
      return
    }
    const chunks = []
    let errText = ''
    child.stdout.on('data', (chunk) => chunks.push(chunk))
    child.stderr.on('data', (chunk) => {
      if (errText.length < 400) errText += String(chunk).slice(0, 200)
    })
    child.on('error', (error) => done(reject, error))
    child.on('close', (code) => {
      if (code === 0 && chunks.length) done(resolve, Buffer.concat(chunks))
      else done(reject, new Error(`ffmpeg 退出码 ${code} ${errText}`))
    })
    child.stdin.on('error', () => {})
    child.stdin.end(buf)
  })
}

async function resolveStickerUrl(roots, id) {
  if (stickerUrlIndex.has(id)) return stickerUrlIndex.get(id)
  try {
    const cfg = readBridgeConfig(roots.bridge)
    const r = await bridgeJson(cfg, '/api/stickers?count=60', 6000)
    for (const s of r?.stickers || []) if (s?.id && s?.url) stickerUrlIndex.set(String(s.id), String(s.url))
  } catch {}
  return stickerUrlIndex.get(id) || ''
}

function sendJpeg(res, buf) {
  res.writeHead(200, {
    'content-type': 'image/jpeg',
    'cache-control': 'public, max-age=86400',
    'content-length': buf.length,
  })
  res.end(buf)
}

function thumbHandler(roots) {
  return async (req, res) => {
    try {
      const url = new URL(req.url || '/', 'http://127.0.0.1')
      const id = String(url.searchParams.get('id') || '')
      if (!id || !/^[A-Za-z0-9_-]{1,200}$/.test(id)) {
        res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' })
        res.end('表情 id 不对')
        return
      }
      const file = path.join(thumbDir(roots), `${id}.jpg`)
      try {
        if (fs.existsSync(file)) {
          sendJpeg(res, fs.readFileSync(file))
          return
        }
      } catch {}
      const src = await resolveStickerUrl(roots, id)
      if (!src) {
        res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
        res.end('找不到这张表情')
        return
      }
      let job = thumbJobs.get(id)
      if (!job) {
        job = (async () => {
          const r = await fetch(src, { signal: AbortSignal.timeout(30000) })
          if (!r.ok) throw new Error(`下载失败 HTTP ${r.status}`)
          const buf = Buffer.from(await r.arrayBuffer())
          return ffmpegFirstFrame(buf)
        })().finally(() => thumbJobs.delete(id))
        thumbJobs.set(id, job)
      }
      const jpg = await job
      try {
        fs.mkdirSync(thumbDir(roots), { recursive: true })
        fs.writeFileSync(file, jpg)
      } catch {}
      sendJpeg(res, jpg)
    } catch (error) {
      res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' })
      res.end('缩略图生成失败：' + (error?.message || String(error)))
    }
  }
}

async function stickerData(roots) {
  const cfg = readBridgeConfig(roots.bridge)
  const r = await bridgeJson(cfg, '/api/stickers?count=60', 8000)
  const stickers = Array.isArray(r?.stickers) ? r.stickers : []
  for (const s of stickers) if (s?.id && s?.url) stickerUrlIndex.set(String(s.id), String(s.url))
  const items = await Promise.all(
    stickers.map(async (s) => ({
      id: s.id,
      note: s.localNote || s.desc || '',
      tags: Array.isArray(s.tags) ? s.tags : [],
      useCount: s.useCount || 0,
      url: s.url || '',
    })),
  )
  return { ok: true, part: 'stickers', total: r?.total ?? stickers.length, items }
}

/** 会话 key → 给人看的名字：群用群名，私聊用「私聊（管理员）」，内部会话翻成中文。 */
function labelForSessionKey(key, names, ownerQQ) {
  const g = /^group:(\d+)$/.exec(String(key))
  if (g) return names.get(g[1]) || `群 ${g[1]}`
  const p = /^private:(\d+)$/.exec(String(key))
  if (p) return String(p[1]) === String(ownerQQ || '') ? '私聊（管理员）' : `私聊 ${p[1]}`
  if (String(key).startsWith('internal:')) return `内部 · ${String(key).slice(9)}`
  return String(key)
}

async function usageData(roots, hours) {
  const cfg = readBridgeConfig(roots.bridge)
  const windowHours = Math.min(2160, Math.max(1, Math.round(Number(hours) || 24)))
  const buckets = windowHours <= 24 ? 24 : windowHours <= 168 ? 28 : 30
  const [r, s, groupList] = await Promise.all([
    bridgeJson(cfg, '/api/tokens/summary?limit=50', 6000),
    bridgeJson(cfg, `/api/tokens/series?hours=${windowHours}&buckets=${buckets}`, 8000).catch(() => null),
    onebot(cfg, 'get_group_list').catch(() => null),
  ])
  const names = new Map()
  if (Array.isArray(groupList)) {
    for (const g of groupList) if (g && g.group_id) names.set(String(g.group_id), String(g.group_name || ''))
  }
  return {
    ok: true,
    part: 'usage',
    currency: r?.currency || 'CNY',
    symbol: r?.symbol || '¥',
    // 原控制台的令牌页支持 #usage 深链，图外那部分直接跳过去看
    // 同样不带 token（见 snapshot 里的说明）
    consoleUsageUrl: `http://127.0.0.1:${cfg.port}/`,
    totals: r?.totals ?? null,
    nowTier: r?.nowTier ?? null,
    hours: windowHours,
    series: s
      ? {
          hours: s.hours || 24,
          from: s.from ?? null,
          to: s.to ?? null,
          offChartCost: Number(s.offChartCost) || 0,
          buckets: (Array.isArray(s.buckets) ? s.buckets : []).map((b) => ({ t: b.t, cost: Number(b.cost) || 0 })),
        }
      : null,
    conversations: Array.isArray(r?.conversations)
      ? r.conversations.map((c) => ({
          key: c.key,
          label: labelForSessionKey(c.key, names, cfg.ownerQQ),
          cost: c.cost,
          turns: c.turns,
          steps: c.steps,
          lastAt: c.lastAt,
          totalTokens: (c.buckets?.cacheMiss || 0) + (c.buckets?.cacheHit || 0) + (c.buckets?.output || 0),
        }))
      : [],
  }
}

async function settingsData(roots) {
  const cfg = readBridgeConfig(roots.bridge)
  const [wl, sc, logs] = await Promise.all([
    bridgeJson(cfg, '/api/whitelist', 3000).catch(() => null),
    bridgeJson(cfg, '/api/socialV2/config', 3000).catch(() => null),
    logsData(roots).catch(() => null),
  ])
  return { ok: true, part: 'settings', whitelist: wl, social: sc?.config ?? null, logs }
}

/** 把日志里常见的英文报错翻成人话；翻不到的保留原文。 */
const LOG_RULES = [
  [/SnowLuma 错误: \{"name":"SnowLumaConnectionError"\}/g, '连不上 SnowLuma（SnowLumaConnectionError）'],
  [/SnowLuma WS 连接已更新/g, 'SnowLuma 长连接已更新'],
  [/close code=(\d+)/g, '断开（代码 $1）'],
  [/ECONNRESET/g, '连接被对面掐断'],
  [/ETIMEDOUT|timed out/gi, '超时'],
  [/EADDRINUSE/g, '端口被占用'],
  [/ENOENT/g, '找不到文件'],
  [/EACCES/g, '没有权限'],
  [/retcode=1401/g, '密钥失效（1401）'],
  [/\b401\b/g, '密钥不对（401）'],
  [/WebSocket|websocket/g, '长连接'],
  [/OneBot/g, 'QQ 接口'],
  [/snapshot/g, '会话快照'],
  [/baseline/g, '基线数据'],
]

function translateLogLine(text) {
  let out = String(text)
  for (const [re, to] of LOG_RULES) out = out.replace(re, to)
  return out
}

async function logsData(roots) {
  const file = path.join(roots.bridge, 'qq-bridge-main', 'state', 'bridge.log')
  let text = ''
  try {
    // 日志只取尾部：整天跑下来 bridge.log 会涨到几十 MB，整份读进内存会卡事件循环
    const stat = fs.statSync(file)
    const TAIL_BYTES = 2 * 1024 * 1024
    if (stat.size > TAIL_BYTES) {
      const fd = fs.openSync(file, 'r')
      try {
        const buf = Buffer.alloc(TAIL_BYTES)
        fs.readSync(fd, buf, 0, TAIL_BYTES, stat.size - TAIL_BYTES)
        text = buf.toString('utf8')
      } finally {
        fs.closeSync(fd)
      }
      // 第一行多半被从中间截断，丢掉
      const nl = text.indexOf('\n')
      if (nl >= 0) text = text.slice(nl + 1)
    } else {
      text = fs.readFileSync(file, 'utf8')
    }
  } catch {
    return { ok: true, part: 'logs', count: 0, lines: [], error: '还没有日志文件（桥接还没跑过？）' }
  }
  const raw = text.split(/\r?\n/).filter(Boolean).slice(-240)
  const lines = raw.map((line) => {
    const m = line.match(/^(\d{2}:\d{2}:\d{2})\s+\[([^\]]+)\]\s*(.*)$/)
    if (!m) return { time: '', scope: '', text: translateLogLine(line), raw: line }
    return { time: m[1], scope: m[2], text: translateLogLine(m[3]), raw: line }
  })
  // 只挑“最近 15 分钟里可能出事”的行：给不懂英文的人看的是一句结论，不是逐行正文。
  // 老异常不翻出来，免得一直挂着“出事了”的样子。
  const alertRe = /(断开|失败|错误|超时|被占用|无法|拒绝|异常|未连接|degraded|timeout|ECONN|EADDR|401|1401|crash|panic)/i
  const now = new Date()
  const nowSec = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds()
  const toSec = (t) => {
    const [h, m, s] = String(t).split(':').map(Number)
    return (h || 0) * 3600 + (m || 0) * 60 + (s || 0)
  }
  const cutoff = nowSec - 15 * 60
  // 凌晨 0:00–0:15：昨天 23:5x 的日志时间戳（85800 秒）大于 nowSec+300，会被当成「未来」丢掉。
  // 日志行只有 HH:MM:SS 没有日期，跨午夜判断不了，这时干脆不做「未来」过滤。
  const earlyMorning = nowSec < 20 * 60
  const filtered = lines
    .filter((line) => line.time && alertRe.test(line.raw) && !/错误: \{\}\s*$/.test(line.raw))
    .filter((line) => {
      const sec = toSec(line.time)
      if (!earlyMorning && sec > nowSec + 300) return false
      return cutoff < 0 ? true : sec >= cutoff
    })

  // 同一种毛病（重连风暴会刷几十条）只留最新一条，最多 6 类
  const seen = new Set()
  const picked = []
  for (let i = filtered.length - 1; i >= 0 && picked.length < 6; i -= 1) {
    const line = filtered[i]
    const key = line.text.replace(/\d+/g, '#')
    if (seen.has(key)) continue
    seen.add(key)
    picked.push({ time: line.time, text: line.text })
  }
  picked.reverse()
  return { ok: true, part: 'logs', count: lines.length, alerts: picked, lines }
}

/**
 * 写成功之后的刷新：刷新失败只是界面旧了，不能把「已经写进去了」报成「保存失败」，
 * 否则用户会把同一份内容再存一次（新建人格卡还会撞「已存在」）。
 */
async function refreshSafe(fn, fallback = null) {
  try {
    return await fn()
  } catch {
    return fallback
  }
}

/** 按当前状态给一句中文诊断；没问题就返回空串。 */
function diagnose(out) {
  if (!out.bridge.online) return '桥接没在跑。点上面的「启动整套 QQ」。'
  const s = out.status || {}
  const sl = s.snowluma || {}
  if (s.dshReady === false) {
    return '桥接连不上这个 DSH（大概率是 DSH 重启过、端口变了）。点「关掉整套 QQ」再点「启动整套 QQ」就会重新对齐。'
  }
  if (sl.accountOnline === false) return '桥接活着，但 QQ 账号没连上：确认 QQ 客户端登着、SnowLuma 开着。'
  if (Array.isArray(out.pending) && out.pending.length > 0) {
    const kinds = out.pending.map((p) => (p.kind === 'approval' ? '工具审批' : '她的提问'))
    return `有 ${out.pending.length} 件事在等她确认（${kinds.join('、')}），她正卡在那儿。点右上角「原控制台」→ 会话与审批 处理。`
  }
  const stuck = (out.groups || []).filter(
    (g) => Number(g.unread || 0) >= 5 && (!g.lastAiReplyAt || Date.now() - Number(g.lastAiReplyAt) > 30 * 60 * 1000),
  )
  if (stuck.length) return `${stuck.map((g) => g.name).join('、')} 积了 5 条以上没回、而且半小时没说话，可能卡住了。去「日志」或原控制台看看。`
  if (sl.connected === false) return 'SnowLuma 在，但长连接还没建立（刚启动的话等几秒；一直这样去 SnowLuma 面板看）。'
  if (out.pendingRestart) return `刚改过${out.pendingRestart}，要重启 DSH 才生效（关掉 DSH 再打开；QQ 桥接会自动重连，不用管）。`
  return ''
}

async function collect(part, roots, url) {
  if (part === 'roles') return rolesData(roots)
  if (part === 'slang') return slangData(roots)
  if (part === 'stickers') return stickerData(roots)
  if (part === 'usage') return usageData(roots, url?.searchParams.get('hours'))
  if (part === 'settings') return settingsData(roots)
  if (part === 'logs') return logsData(roots)
  if (part === 'backups') return backupsData(roots)
  if (part === 'simPrompt') return simPromptData(roots)
  return snapshot(roots)
}

async function action(body, roots, origin) {
  const name = String(body?.action || '')

  if (name === 'start') {
    // 启停互斥：两个请求同时进来会各自 spawn 一份 SnowLuma/桥接并并发写 config.json
    if (lifecycleBusy) return { ok: false, error: '正在启动或停止中，等一下再试' }
    lifecycleBusy = true
    try {
      const steps = await startAll(roots, origin)
      return { ok: steps.every((step) => step.ok), steps, snapshot: await snapshot(roots) }
    } finally {
      lifecycleBusy = false
    }
  }

  if (name === 'stop') {
    if (lifecycleBusy) return { ok: false, error: '正在启动或停止中，等一下再试' }
    lifecycleBusy = true
    try {
      const left = await stopAll(roots)
      const ok = !left.bridge && !left.snowluma
      return {
        ok,
        steps: [
        {
          ok,
          text: ok
            ? 'SnowLuma 和桥接都停了'
            : `还有进程没停（桥接=${left.bridge}，SnowLuma=${left.snowluma}），可以再点一次或去原控制台看`,
        },
      ],
      snapshot: await snapshot(roots),
      }
    } finally {
      lifecycleBusy = false
    }
  }

  if (name === 'wake') {
    const cfg = readBridgeConfig(roots.bridge)
    const key = String(body?.key || '')
    if (!key) return { ok: false, error: '缺少 key' }
    const result = await fetchJson(
      bridgeUrl(cfg, '/api/socialV2/wake'),
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key, reason: 'console' }) },
      20_000,
    )
    // 桥接用 2xx 回 { ok:false, error } 也是有的（比如该接口仅 reserved2 可用），不能当成功
    if (result?.ok === false) return { ok: false, error: result.error || '叫醒失败' }
    return { ok: true, result, snapshot: await snapshot(roots) }
  }

  if (name === 'saveRole') {
    let roleName = ''
    try {
      roleName = safeRoleName(body?.name)
    } catch (error) {
      return { ok: false, error: String(error?.message || error) }
    }
    const content = String(body?.content ?? '')
    if (!roleName) return { ok: false, error: '没说是哪个人格' }
    // 先备份再改：桥接自己的 update 不备份，这一层必须由我们兜住
    let backup = ''
    try {
      backup = backupRole(roots, roleName)
    } catch (error) {
      return { ok: false, error: `备份失败，没敢改：${error?.message || error}` }
    }
    const cfg = readBridgeConfig(roots.bridge)
    const result = await fetchJson(
      bridgeUrl(cfg, '/api/roles/update'),
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: roleName, content }) },
      10000,
    )
    if (result?.ok === false) return { ok: false, error: result.error || '保存失败' }
    return { ok: true, backup, chars: result?.chars, warnings: result?.warnings, data: await refreshSafe(() => rolesData(roots)) }
  }

  if (name === 'setWake') {
    const cfg = readBridgeConfig(roots.bridge)
    const enabled = body?.preSleepWaitEnabled !== false
    const result = await fetchJson(
      bridgeUrl(cfg, '/api/socialV2/config'),
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ wake: { preSleepWaitEnabled: enabled } }),
      },
      10000,
    )
    return { ok: result?.ok !== false, data: await refreshSafe(() => settingsData(roots)) }
  }

  if (name === 'slangConfirm') {
    const cfg = readBridgeConfig(roots.bridge)
    const id = String(body?.id || '')
    if (!id) return { ok: false, error: '缺少 id' }
    const payload = {}
    if (body?.meaning !== undefined) payload.meaning = String(body.meaning)
    if (body?.usage !== undefined) payload.usage = String(body.usage)
    let result
    try {
      result = await fetchJson(
        bridgeUrl(cfg, `/api/slang/${encodeURIComponent(id)}/confirm`),
        { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) },
        10000,
      )
    } catch (error) {
      return { ok: false, error: error?.message || '确认失败' }
    }
    if (result?.ok === false) return { ok: false, error: result.error || '确认失败' }
    return { ok: true, data: await refreshSafe(() => slangData(roots)) }
  }

  if (name === 'slangStatus' || name === 'slangDelete') {
    const cfg = readBridgeConfig(roots.bridge)
    const id = String(body?.id || '')
    if (!id) return { ok: false, error: '缺少 id' }
    const target = bridgeUrl(cfg, `/api/slang/${encodeURIComponent(id)}`)
    const result =
      name === 'slangDelete'
        ? await fetchJson(target, { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: '{}' }, 10000)
        : await fetchJson(
            target,
            {
              method: 'PATCH',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ status: String(body?.status || 'confirmed') }),
            },
            10000,
          )
    return { ok: result?.ok !== false, data: await refreshSafe(() => slangData(roots)) }
  }

  if (name === 'setWhitelist') {
    const cfg = readBridgeConfig(roots.bridge)
    const groups = Array.isArray(body?.groups) ? body.groups.map(String) : []
    const privateList = Array.isArray(body?.private) ? body.private.map(String) : []
    const result = await fetchJson(
      bridgeUrl(cfg, '/api/whitelist'),
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ allow: { groups, private: privateList } }),
      },
      10000,
    )
    if (result?.ok === false) return { ok: false, error: result.error || '白名单没保存成功' }
    return { ok: true, data: await refreshSafe(() => settingsData(roots)), snapshot: await snapshot(roots) }
  }

  if (name === 'setGroupWake') {
    const cfg = readBridgeConfig(roots.bridge)
    const key = String(body?.key || '')
    if (!key) return { ok: false, error: '缺少 key' }
    const active = body?.mode === 'active'
    const result = await fetchJson(
      bridgeUrl(cfg, '/api/socialV2/wake-config'),
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          key,
          config: { mode: active ? 'active' : 'diving', triggers: { probability: Number(body?.probability) || 0 } },
        }),
      },
      15000,
    )
    if (result?.ok === false) return { ok: false, error: result.error || '唤醒档位没改成功' }
    return { ok: true, snapshot: await snapshot(roots) }
  }

  if (name === 'setRole') {
    const cfg = readBridgeConfig(roots.bridge)
    const result = await fetchJson(
      bridgeUrl(cfg, '/api/role'),
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ role: String(body?.role || '') }) },
      10000,
    )
    if (result?.ok === false) return { ok: false, error: result.error || '切换失败' }
    return { ok: true, data: await refreshSafe(() => rolesData(roots)) }
  }

  if (name === 'createRole' || name === 'renameRole' || name === 'deleteRole') {
    const cfg = readBridgeConfig(roots.bridge)
    let target = ''
    let payload = {}
    if (name === 'createRole') {
      target = '/api/roles/create'
      payload = { name: String(body?.name || ''), content: String(body?.content || '') }
    } else if (name === 'renameRole') {
      target = '/api/roles/rename'
      payload = { from: String(body?.from || ''), to: String(body?.to || '') }
    } else {
      target = '/api/roles/delete'
      payload = { name: String(body?.name || '') }
      try {
        backupRole(roots, payload.name)
      } catch (error) {
        return { ok: false, error: `备份失败，没删：${error?.message || error}` }
      }
    }
    const result = await fetchJson(
      bridgeUrl(cfg, target),
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) },
      10000,
    )
    if (result?.ok === false) return { ok: false, error: result.error || '没成功' }
    return { ok: true, data: await refreshSafe(() => rolesData(roots)), backups: await refreshSafe(() => backupsData(roots)) }
  }

  if (name === 'restoreBackup') {
    const file = String(body?.file || '')
    if (!/^[^\\/]+\.md$/.test(file)) return { ok: false, error: '文件名不对' }
    const dir = path.join(roots.bridge, 'qq-bridge-main', 'state', 'role-backups')
    const src = path.join(dir, file)
    if (!fs.existsSync(src)) return { ok: false, error: '找不到这个备份' }
    const m = file.match(/^(.+?)-(\d{4}-\d{2}-\d{2}T[\d-]+Z)\.md$/)
    let roleName = m ? m[1] : file.replace(/\.md$/, '')
    try {
      roleName = safeRoleName(roleName)
    } catch (error) {
      return { ok: false, error: `备份文件名不合法：${error?.message || error}` }
    }
    try {
      backupRole(roots, roleName)
    } catch (error) {
      return { ok: false, error: `恢复前备份失败：${error?.message || error}` }
    }
    fs.copyFileSync(src, path.join(roots.bridge, 'qq-bridge-main', 'roles', `${roleName}.md`))
    return { ok: true, role: roleName, data: await refreshSafe(() => rolesData(roots)), backups: await refreshSafe(() => backupsData(roots)) }
  }

  if (name === 'addSlang') {
    const cfg = readBridgeConfig(roots.bridge)
    const result = await fetchJson(
      bridgeUrl(cfg, '/api/slang'),
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          content: String(body?.content || ''),
          meaning: String(body?.meaning || ''),
          usage: String(body?.usage || ''),
          example: String(body?.example || ''),
          status: body?.candidate ? 'candidate' : 'confirmed',
        }),
      },
      10000,
    )
    if (result?.ok === false) return { ok: false, error: result.error || '没加上' }
    return { ok: true, data: await refreshSafe(() => slangData(roots)) }
  }

  if (name === 'noteSticker') {
    const cfg = readBridgeConfig(roots.bridge)
    const result = await fetchJson(
      bridgeUrl(cfg, '/api/stickers/note'),
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          stickerId: String(body?.stickerId || ''),
          note: String(body?.note || ''),
          tags: Array.isArray(body?.tags) ? body.tags.map(String) : [],
        }),
      },
      10000,
    )
    if (result?.ok === false) return { ok: false, error: result.error || '备注没保存' }
    return { ok: true, data: await refreshSafe(() => stickerData(roots)) }
  }

  if (name === 'resetUsage') {
    const cfg = readBridgeConfig(roots.bridge)
    const result = await fetchJson(bridgeUrl(cfg, '/api/tokens/reset'), { method: 'POST' }, 10000)
    if (result?.ok === false) return { ok: false, error: result.error || '重置失败' }
    return { ok: true, data: await refreshSafe(() => usageData(roots)) }
  }

  if (name === 'setSend') {
    const cfg = readBridgeConfig(roots.bridge)
    const send = {}
    for (const key of ['maxSendPerMinute', 'maxSendPerHour', 'maxMessageChars']) {
      if (body?.[key] !== undefined) send[key] = Number(body[key])
    }
    const result = await fetchJson(
      bridgeUrl(cfg, '/api/socialV2/config'),
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ send }) },
      10000,
    )
    if (result?.ok === false) return { ok: false, error: result.error || '没保存' }
    return { ok: true, data: await refreshSafe(() => settingsData(roots)) }
  }

  if (name === 'slangBatch') {
    const cfg = readBridgeConfig(roots.bridge)
    const ids = Array.isArray(body?.ids) ? body.ids.map(String) : []
    const op = String(body?.op || '')
    if (!ids.length) return { ok: false, error: '没选东西' }
    if (op !== 'confirm' && op !== 'delete' && op !== 'reject') return { ok: false, error: '不支持的操作' }
    const all = await bridgeJson(cfg, '/api/slang', 6000)
    const byId = new Map((all?.entries || []).map((e) => [String(e.id), e]))
    let done = 0
    const skipped = []
    for (const id of ids) {
      const entry = byId.get(id)
      if (!entry) {
        skipped.push('找不到的词')
        continue
      }
      if (op === 'confirm' && !String(entry.meaning || '').trim()) {
        skipped.push(String(entry.content || '').slice(0, 20))
        continue
      }
      try {
        let result
        if (op === 'delete') {
          result = await fetchJson(
            bridgeUrl(cfg, `/api/slang/${encodeURIComponent(id)}`),
            { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: '{}' },
            10000,
          )
        } else if (op === 'reject') {
          result = await fetchJson(
            bridgeUrl(cfg, `/api/slang/${encodeURIComponent(id)}`),
            { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ status: 'rejected' }) },
            10000,
          )
        } else {
          result = await fetchJson(
            bridgeUrl(cfg, `/api/slang/${encodeURIComponent(id)}/confirm`),
            { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' },
            10000,
          )
        }
        // 桥接用 2xx 回 { ok:false } 也算失败：之前这里不看返回值，失败也被计进 done
        if (result?.ok === false) {
          skipped.push(String(entry.content || '').slice(0, 20))
          continue
        }
        done += 1
      } catch {
        skipped.push(String(entry.content || '').slice(0, 20))
      }
    }
    return { ok: true, done, skipped: skipped.slice(0, 8), skippedCount: skipped.length, data: await refreshSafe(() => slangData(roots)) }
  }

  if (name === 'saveSimPrompt') {
    const cfg = readBridgeConfig(roots.bridge)
    const preset = String(body?.preset || 'qq-chat-v2')
    let result
    try {
      result = await fetchJson(
        bridgeUrl(cfg, '/api/preset/sim-prompt'),
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ preset, content: String(body?.content ?? '') }),
        },
        15000,
      )
    } catch (error) {
      return { ok: false, error: error?.message || '保存失败' }
    }
    if (result?.ok === false) return { ok: false, error: result.error || '保存失败' }
    const needsRestart = result?.requiresRestart === true
    if (needsRestart) markRestartPending(roots, '仿真提示词')
    return {
      ok: true,
      chars: result?.chars,
      warnings: result?.warnings ?? [],
      requiresRestart: needsRestart,
      steps: [
        needsRestart
          ? { ok: true, text: '仿真提示词已保存 —— 要重启 DSH 才生效（关掉 DSH 再打开，桥接会自动重连）' }
          : result?.unchanged === true
            ? { ok: true, text: '内容没变，没有改动' }
            : { ok: true, text: '已保存，不用重启' },
      ],
      data: await refreshSafe(() => simPromptData(roots)),
    }
  }

  if (name === 'restoreSimPrompt') {
    const cfg = readBridgeConfig(roots.bridge)
    const preset = String(body?.preset || 'qq-chat-v2')
    let result
    try {
      result = await fetchJson(
        bridgeUrl(cfg, '/api/preset/sim-prompt/restore'),
        { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ preset }) },
        15000,
      )
    } catch (error) {
      return { ok: false, error: error?.message || '恢复失败' }
    }
    if (result?.ok === false) return { ok: false, error: result.error || '恢复失败' }
    return { ok: true, data: await refreshSafe(() => simPromptData(roots)) }
  }

  if (name === 'syncStickers') {
    const cfg = readBridgeConfig(roots.bridge)
    let result
    try {
      result = await fetchJson(
        bridgeUrl(cfg, '/api/stickers/sync'),
        { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' },
        40000,
      )
    } catch (error) {
      return { ok: false, error: error?.message || '同步失败' }
    }
    if (result?.ok === false) return { ok: false, error: result.error || '同步失败' }
    return { ok: true, total: result?.total, data: await refreshSafe(() => stickerData(roots)) }
  }

  if (name === 'slangResearch' || name === 'slangExtract') {
    const cfg = readBridgeConfig(roots.bridge)
    const pathname = name === 'slangResearch' ? '/api/slang/research' : '/api/slang/extract'
    const payload = name === 'slangResearch' ? { ids: Array.isArray(body?.ids) ? body.ids.map(String) : [] } : {}
    let result
    try {
      result = await fetchJson(
        bridgeUrl(cfg, pathname),
        { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) },
        20000,
      )
    } catch (error) {
      return { ok: false, error: error?.message || '没排上' }
    }
    if (result?.ok === false) return { ok: false, error: result.error || '没排上' }
    return { ok: true, count: result?.count ?? null, key: result?.key ?? null }
  }

  if (name === 'envCheck') {
    return envCheckData(roots)
  }

  if (name === 'webLogin') {
    return await webLoginState()
  }

  if (name === 'webResearch') {
    // 单飞：并发跑会各自把同一标签页导航到 chat.deepseek.com、互相覆盖输入框，
    // 还会把 N 份 prompt 一起打到已登录的网页版账号上（限流/风控）。
    if (webResearchBusy) return { ok: false, error: '已经有一轮研究在跑，等它跑完再点' }
    webResearchBusy = true
    try {
      return await runWebResearch(roots, body?.limit)
    } finally {
      webResearchBusy = false
    }
  }

  if (name === 'refresh') {
    return { ok: true, snapshot: await snapshot(roots) }
  }

  return { ok: false, error: `不认识的 action：${name}` }
}

function json(res, status, value) {
  const text = JSON.stringify(value)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(text),
  })
  res.end(text)
}

/**
 * 同源校验：DSH 的 webServer 路由没有鉴权，任何网页都能往 127.0.0.1 发跨站表单。
 * 浏览器会带 Sec-Fetch-Site（跨站表单是 cross-site），同源 fetch 是 same-origin；
 * 没有这个头的本机程序（curl/脚本）不拦——它本来就能直接读文件，拦它没有意义。
 */
function rejectCrossSite(req, getOrigin) {
  const site = String(req.headers['sec-fetch-site'] || '').toLowerCase()
  if (site && site !== 'same-origin' && site !== 'none') return '跨站请求被拒'
  const origin = String(req.headers.origin || '')
  if (origin) {
    const allowed = String(getOrigin() || '').replace(/\/+$/, '')
    if (allowed && origin !== allowed) return '来源不匹配'
  }
  return ''
}

async function handle(req, res, roots, getOrigin) {
  try {
    const url = new URL(req.url || '/', 'http://127.0.0.1')

    if (url.pathname !== '/api/qq-console' && url.pathname !== '/api/qq-console/') {
      json(res, 404, { ok: false, error: '没有这个接口' })
      return
    }

    const crossSite = rejectCrossSite(req, getOrigin)
    if (crossSite) {
      json(res, 403, { ok: false, error: crossSite })
      return
    }

    if (req.method === 'GET') {
      json(res, 200, await collect(url.searchParams.get('part') || 'overview', roots, url))
      return
    }

    if (req.method === 'POST') {
      // 只收 JSON：跨站表单只能发 text/plain 之类，这条把第 1 条那个绕过方式直接堵死
      const contentType = String(req.headers['content-type'] || '')
      if (!contentType.toLowerCase().includes('application/json')) {
        json(res, 415, { ok: false, error: '请求必须是 application/json' })
        return
      }
      // 用 Buffer 收再一次性解码：逐块 raw += chunk 会把跨块的 UTF-8 中文切成乱码，
      // 保存较长的人格卡/提示词时就是在这里静默写坏的。
      const chunks = []
      let total = 0
      for await (const chunk of req) {
        chunks.push(chunk)
        total += chunk.length
        if (total > 1_000_000) throw new Error('请求体太大')
      }
      const raw = Buffer.concat(chunks).toString('utf8')
      let body = {}
      try {
        body = raw ? JSON.parse(raw) : {}
      } catch {
        throw new Error('请求体不是合法 JSON')
      }
      json(res, 200, await action(body, roots, getOrigin()))
      return
    }

    json(res, 405, { ok: false, error: '只支持 GET 和 POST' })
  } catch (error) {
    json(res, 500, { ok: false, error: error?.message || String(error) })
  }
}

export function apply(ctx, config) {
  const cfg = config && typeof config === 'object' ? config : {}
  if (cfg.ffmpegPath) FFMPEG = String(cfg.ffmpegPath)
  const roots = resolveRoots(cfg)
  const getOrigin = () => {
    try {
      return ctx.webServer.getOrigin()
    } catch {
      return ''
    }
  }

  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'exact',
        path: '/api/qq-console',
        handler: (req, res) => handle(req, res, roots, getOrigin),
      }),
    'dsh-qq-console: same-origin console api',
  )

  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'exact',
        path: '/api/qq-console/thumb',
        handler: thumbHandler(roots),
      }),
    'dsh-qq-console: sticker thumbnails',
  )
}
