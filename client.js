// dsh-qq-console —— 大肥鱼QQ总控台（客户端半边）
//
// 六个标签：总览 / 群聊 / 人设 / 学习 / 账本 / 设置。
// 数据全部从宿主的同源接口 /api/qq-console 拿，页面自己不碰 3100 / 3000。
window.__ModuleLoader__.load({
  id: 'dsh-qq-console',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useState, useEffect, useCallback, useRef } = React

    const MODE_TEXT = {
      reserved2: '自主判断 · 会潜水',
      closed: '只做指定的事',
      social: '全程陪聊',
    }

    const WAKE_TEXT = {
      atMention: '被 @ 了',
      nameMention: '被叫名字',
      keyword: '说到关键词',
      question: '有人提问',
      probability: '随机搭话',
      replyCheck: '回复检查',
      private: '私聊消息',
      speaker: '指定的人说话',
      anyMessage: '任何消息',
      poke: '被拍一拍',
    }

    const STATUS_TEXT = {
      confirmed: '已确认',
      candidate: '待确认',
      rejected: '已拒绝',
    }

    const TABS = [
      ['overview', '总览'],
      ['groups', '群聊'],
      ['persona', '人设'],
      ['learning', '学习'],
      ['stickers', '表情包'],
      ['usage', '账本'],
      ['settings', '设置'],
    ]

    // 标签名 → 后端数据名（人设页的数据叫 roles，别混）
    const PART_OF = {
      overview: 'overview',
      groups: 'overview',
      persona: 'roles',
      learning: 'slang',
      stickers: 'stickers',
      usage: 'usage',
      settings: 'settings',
    }
    const partsFor = (tab) => (tab === 'persona' ? ['roles', 'simPrompt'] : [PART_OF[tab] || tab])

    // 所有字号都按 15px 基准写成 em，根节点一改全部跟着缩放（右上角 A−/A+）
    const em = (px) => `${Math.round((px / 15) * 1000) / 1000}em`

    const S = {
      root: {
        height: '100%',
        overflowY: 'auto',
        overflowX: 'hidden',
        background: 'var(--dsw-alias-bg-base)',
        color: 'var(--dsw-alias-label-primary)',
        boxSizing: 'border-box',
        fontSize: em(14),
        lineHeight: 1.55,
      },
      wrap: { maxWidth: 1040, margin: '0 auto', padding: '20px 28px 64px', display: 'flex', flexDirection: 'column', gap: 14 },
      header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 },
      title: { fontSize: em(21), fontWeight: 650, letterSpacing: 0.2 },
      sub: { fontSize: em(13), color: 'var(--dsw-alias-label-secondary)', marginTop: 1 },
      tabs: { display: 'flex', gap: 4, borderBottom: '1px solid var(--dsw-alias-border-l1)', paddingBottom: 0, flexWrap: 'wrap' },
      tab: (active) => ({
        appearance: 'none',
        border: 'none',
        borderBottom: active ? '2px solid var(--dsw-alias-brand-primary)' : '2px solid transparent',
        background: 'transparent',
        color: active ? 'var(--dsw-alias-brand-primary)' : 'var(--dsw-alias-label-secondary)',
        padding: '8px 14px',
        fontSize: em(14),
        fontWeight: active ? 600 : 400,
        cursor: 'pointer',
        fontFamily: 'inherit',
      }),
      card: {
        background: 'var(--dsw-alias-bg-layer-1)',
        border: '1px solid var(--dsw-alias-border-l1)',
        borderRadius: 12,
        padding: '14px 18px',
      },
      btn: {
        appearance: 'none',
        border: '1px solid var(--dsw-alias-border-l2)',
        background: 'var(--dsw-alias-bg-layer-1)',
        color: 'var(--dsw-alias-label-primary)',
        borderRadius: 8,
        padding: '6px 13px',
        fontSize: em(13),
        cursor: 'pointer',
        fontFamily: 'inherit',
        textDecoration: 'none',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        whiteSpace: 'nowrap',
      },
      btnMain: {
        appearance: 'none',
        border: 'none',
        background: 'var(--dsw-alias-brand-primary)',
        color: '#fff',
        borderRadius: 10,
        padding: '11px 24px',
        fontSize: em(15),
        fontWeight: 600,
        cursor: 'pointer',
        fontFamily: 'inherit',
        whiteSpace: 'nowrap',
      },
      btnStop: {
        appearance: 'none',
        border: '1px solid var(--dsw-alias-state-error-primary)',
        background: 'transparent',
        color: 'var(--dsw-alias-state-error-primary)',
        borderRadius: 10,
        padding: '11px 24px',
        fontSize: em(15),
        fontWeight: 600,
        cursor: 'pointer',
        fontFamily: 'inherit',
        whiteSpace: 'nowrap',
      },
      statRow: { display: 'flex', gap: 12, flexWrap: 'wrap' },
      stat: {
        flex: '1 1 170px',
        background: 'var(--dsw-alias-bg-layer-1)',
        border: '1px solid var(--dsw-alias-border-l1)',
        borderRadius: 12,
        padding: '11px 15px',
        minWidth: 160,
      },
      statLabel: { fontSize: em(12), color: 'var(--dsw-alias-label-secondary)' },
      statValue: { fontSize: em(17), fontWeight: 600, marginTop: 2, display: 'flex', alignItems: 'center', gap: 7 },
      dot: (color) => ({ width: 8, height: 8, borderRadius: 999, background: color, flexShrink: 0 }),
      sectionTitle: { fontSize: em(13), fontWeight: 600, color: 'var(--dsw-alias-label-secondary)', margin: '10px 2px 6px' },
      row: {
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '10px 14px',
        border: '1px solid var(--dsw-alias-border-l1)',
        background: 'var(--dsw-alias-bg-layer-1)',
        borderRadius: 10,
        marginBottom: 8,
      },
      rowName: { fontWeight: 600 },
      rowMeta: { fontSize: em(12), color: 'var(--dsw-alias-label-secondary)' },
      badge: (color) => ({
        fontSize: em(12),
        padding: '1px 8px',
        borderRadius: 999,
        background: 'var(--dsw-alias-bg-layer-2)',
        color: color || 'var(--dsw-alias-label-secondary)',
        whiteSpace: 'nowrap',
      }),
      activity: {
        margin: 0,
        fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace',
        fontSize: em(12),
        lineHeight: 1.7,
        color: 'var(--dsw-alias-label-secondary)',
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-all',
        maxHeight: 240,
        overflowY: 'auto',
      },
      note: { fontSize: em(13), color: 'var(--dsw-alias-state-success-primary)', padding: '8px 12px', borderRadius: 8, background: 'var(--dsw-alias-bg-layer-1)' },
      error: {
        fontSize: em(13),
        color: 'var(--dsw-alias-state-error-primary)',
        padding: '10px 14px',
        borderRadius: 8,
        border: '1px solid var(--dsw-alias-state-error-primary)',
        background: 'var(--dsw-alias-bg-layer-1)',
      },
      foot: { fontSize: em(12), color: 'var(--dsw-alias-label-secondary)', marginTop: 2 },
      pre: {
        margin: 0,
        fontFamily: 'inherit',
        fontSize: em(13),
        lineHeight: 1.7,
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
        color: 'var(--dsw-alias-label-primary)',
      },
    }

    function fmtNum(n) {
      const v = Number(n) || 0
      if (v >= 100000000) return (v / 100000000).toFixed(2) + ' 亿'
      if (v >= 10000) return (v / 10000).toFixed(1) + ' 万'
      return String(v)
    }

    function fmtTime(ms) {
      if (!ms) return '—'
      const d = new Date(Number(ms))
      const p = (x) => String(x).padStart(2, '0')
      return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
    }

    function Icon({ size = 20 }) {
      return h(
        'svg',
        { viewBox: '0 0 24 24', width: size, height: size, fill: 'none', 'aria-hidden': true, style: { display: 'block' } },
        h('path', {
          d: 'M12 4.2c-4.9 0-8.9 3.4-8.9 7.7 0 1.4.55 2.7 1.5 3.8 1.5 1.7 4.2 2.3 7.4 2.3s5.9-.6 7.4-2.3c.95-1.1 1.5-2.4 1.5-3.8 0-4.3-4-7.7-8.9-7.7Z',
          fill: 'currentColor',
        }),
        h('path', { d: 'M20.8 12.4c1.3.1 2.2 1 2.2 2.1 0 1.4-1.5 2.5-3.3 2.5', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round' }),
        h('circle', { cx: 8.4, cy: 10.4, r: 1.15, fill: 'var(--dsw-alias-sidebar-fill, rgba(0,0,0,0.55))' }),
      )
    }

    function Stat({ label, value, color }) {
      return h('div', { style: S.stat }, [
        h('div', { key: 'l', style: S.statLabel }, label),
        h('div', { key: 'v', style: S.statValue }, [color ? h('span', { key: 'd', style: S.dot(color) }) : null, h('span', { key: 't' }, value)]),
      ])
    }

    function Empty({ text }) {
      return h('div', { style: { ...S.card, ...S.rowMeta } }, text)
    }

    // 页面自己兜底：某个标签渲染炸了也不让整个面板白屏，直接显示中文原因。
    class Boundary extends React.Component {
      constructor(props) {
        super(props)
        this.state = { err: null }
      }
      static getDerivedStateFromError(err) {
        return { err }
      }
      componentDidCatch(err) {
        try {
          console.error('[大肥鱼QQ总控台]', err)
        } catch {}
      }
      render() {
        if (this.state.err) {
          return h('div', { style: S.error }, `这块出错了：${(this.state.err && this.state.err.message) || String(this.state.err)}（切别的标签还能用）`)
        }
        return this.props.children
      }
    }

    function LinkBtn({ href, children }) {
      if (!href) return null
      return h('a', { href, target: '_blank', rel: 'noreferrer', style: S.btn }, children)
    }

    const LEVELS = [
      ['quiet', '只被叫', 0, false],
      ['normal', '正常', 0.05, false],
      ['high', '活跃', 0.2, false],
      ['all', '全程陪聊', 0, true],
    ]

    function wakeLevel(wc) {
      if (!wc) return ''
      if (wc.mode === 'active' || wc.triggers?.anyMessage) return 'all'
      const p = Number(wc.triggers?.probability) || 0
      if (p >= 0.15) return 'high'
      if (p > 0) return 'normal'
      return 'quiet'
    }

    function TargetRow({ item, busy, onWake, isPrivate, onWakeLevel }) {
      const unread = typeof item.unread === 'number' ? item.unread : null
      const level = wakeLevel(item.wakeConfig)
      return h('div', { style: { ...S.row, flexDirection: 'column', alignItems: 'stretch', gap: 6 } }, [
        h('div', { key: 'main', style: { display: 'flex', alignItems: 'center', gap: 12 } }, [
          h('div', { key: 'i', style: { minWidth: 0, flex: 1 } }, [
            h('div', { key: 'n', style: S.rowName }, item.name),
            h(
              'div',
              { key: 'm', style: S.rowMeta },
              [
                isPrivate ? '私聊' : `群号 ${item.id}`,
                typeof item.members === 'number' ? ` · ${item.members} 人` : '',
                item.lastWakeReason ? ` · 上次唤醒：${WAKE_TEXT[item.lastWakeReason] || item.lastWakeReason}` : '',
                item.lastAiReplyAt ? ` · 上次说话：${fmtTime(item.lastAiReplyAt)}` : '',
              ].join(''),
            ),
          ]),
          unread !== null && unread > 0 ? h('span', { key: 'u', style: S.badge() }, `${unread} 条没看`) : null,
          h('button', { key: 'b', type: 'button', style: { ...S.btn, padding: '5px 12px' }, disabled: Boolean(busy), onClick: () => onWake(item.key) }, busy === 'wake' ? '叫醒中…' : '叫醒她'),
        ]),
        !isPrivate && onWakeLevel
          ? h(
              'div',
              { key: 'lv', style: { display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' } },
              [
                h('span', { key: 'l', style: { ...S.rowMeta, fontSize: em(11) } }, '什么情况下接话：'),
                ...LEVELS.map(([id, label, probability, active]) =>
                  h(
                    'button',
                    {
                      key: id,
                      type: 'button',
                      disabled: Boolean(busy),
                      style: {
                        ...S.btn,
                        padding: '2px 9px',
                        fontSize: em(12),
                        ...(level === id
                          ? {
                              background: 'var(--dsw-alias-brand-primary)',
                              borderColor: 'var(--dsw-alias-brand-primary)',
                              color: '#fff',
                              fontWeight: 600,
                            }
                          : { opacity: 0.85 }),
                      },
                      onClick: () => onWakeLevel(item.key, id, probability, active),
                    },
                    label,
                  ),
                ),
                h(
                  'span',
                  { key: 'cur', style: { ...S.rowMeta, fontSize: em(11), marginLeft: 2, color: 'var(--dsw-alias-brand-primary)' } },
                  `现在：${(LEVELS.find((row) => row[0] === level) || [null, '没读到'])[1]}`,
                ),
              ],
            )
          : null,
      ])
    }

    // ---------- 各标签页 ----------

    function Overview({ data, busy, onStart, onStop, onWake }) {
      if (!data) return h(Empty, { text: '正在读取…' })
      const online = Boolean(data.bridge?.online)
      const account = data.status?.snowluma?.accountOnline
      const dshReady = data.status?.dshReady
      const modeText = data.status?.mode ? MODE_TEXT[data.status.mode] || data.status.mode : '—'
      const lines = String(data.status?.activity || '').split('\n').filter(Boolean).slice(-14)

      return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 14 } }, [
        h(
          'div',
          {
            key: 'power',
            style: { ...S.card, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' },
          },
          [
            h('div', { key: 'l' }, [
              h('div', { key: 'a', style: { fontWeight: 600, fontSize: em(15) } }, online ? 'QQ 这一套是开着的' : 'QQ 这一套还没开'),
              h('div', { key: 'b', style: S.rowMeta }, online ? '在这个页面就能看、能关；DSH 和我这边不受影响' : '点一下就会自己起来，不用开网页也不用点桌面图标'),
            ]),
            online
              ? h('button', { key: 'b', type: 'button', style: S.btnStop, disabled: Boolean(busy), onClick: onStop }, busy === 'stop' ? '正在关…' : '关掉整套 QQ')
              : h('button', { key: 'b', type: 'button', style: S.btnMain, disabled: Boolean(busy), onClick: onStart }, busy === 'start' ? '正在启动…' : '启动整套 QQ'),
          ],
        ),
        data.diagnosis
          ? h('div', { key: 'diag', style: { ...S.card, borderColor: 'var(--dsw-alias-state-warn-primary)', color: 'var(--dsw-alias-state-warn-primary)' } }, data.diagnosis)
          : null,
        h('div', { key: 'stats', style: S.statRow }, [
          h(Stat, { key: '1', label: 'QQ 账号', value: account ? '在线' : '离线', color: account ? 'var(--dsw-alias-state-success-primary)' : 'var(--dsw-alias-state-idle-primary)' }),
          h(Stat, { key: '2', label: '和我这边', value: dshReady ? '已连上' : '没连上', color: dshReady ? 'var(--dsw-alias-state-success-primary)' : 'var(--dsw-alias-state-warn-primary)' }),
          h(Stat, { key: '3', label: '说话方式', value: modeText, color: 'var(--dsw-alias-brand-primary)' }),
          h(Stat, { key: '4', label: '放行的群', value: String(data.groups?.length ?? 0) + ' 个', color: 'var(--dsw-alias-brand-primary)' }),
        ]),
        data.bridge?.online === false && data.bridge?.error
          ? h('div', { key: 'be', style: S.error }, `桥接没应答：${data.bridge.error}`)
          : null,
        h('div', { key: 'act', style: S.card }, [
          h('div', { key: 't', style: S.sectionTitle }, '最近在干什么'),
          lines.length
            ? h('pre', { key: 'x', style: S.activity }, lines.join('\n'))
            : h('div', { key: 'x', style: S.rowMeta }, online ? '最近没有动静' : '开起来之后这里会显示'),
        ]),
      ])
    }

    function Groups({ data, busy, onWake, onWakeLevel }) {
      if (!data) return h(Empty, { text: '正在读取…' })
      return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 6 } }, [
        h('div', { key: 'g1', style: S.sectionTitle }, `群（${data.groups?.length ?? 0}）`),
        ...(data.groups?.length
          ? data.groups.map((g) => h(TargetRow, { key: g.key, item: g, busy, onWake, onWakeLevel }))
          : [h(Empty, { key: 'e', text: data.bridge?.online ? '没有放行的群' : '还没开' })]),
        data.privateChats?.length ? h('div', { key: 'g2', style: S.sectionTitle }, '私聊') : null,
        ...(data.privateChats || []).map((c) => h(TargetRow, { key: c.key, item: c, busy, onWake, isPrivate: true })),
        h('div', { key: 'tip', style: S.foot }, '“什么情况下接话”可以直接点，改完立刻生效，不用重启'),
      ])
    }

    function Persona({ data, busy, onSave, onSwitch, onCreate, onRename, onDelete, onRestore, sim, onSaveSim, onRestoreSim, needRestart }) {
      const [draft, setDraft] = useState('')
      const [simDraft, setSimDraft] = useState('')
      const [newOpen, setNewOpen] = useState(false)
      const [newName, setNewName] = useState('')
      const [newBody, setNewBody] = useState('')
      const [renameOf, setRenameOf] = useState('')
      const [renameTo, setRenameTo] = useState('')
      const cur = data?.content

      useEffect(() => {
        setDraft(cur ? cur.content : '')
      }, [cur && cur.name, cur && cur.content])

      useEffect(() => {
        setSimDraft(sim ? sim.content : '')
      }, [sim && sim.chars, sim && sim.content])

      if (!data) return h(Empty, { text: '正在读取…' })
      const list = data.summaries || []
      const limit = cur?.limits?.injectMaxChars || 0
      const chars = draft.length
      const over = limit > 0 && chars > limit
      const dirty = Boolean(cur) && draft !== cur.content
      const field = {
        padding: '5px 10px',
        borderRadius: 8,
        border: '1px solid var(--dsw-alias-border-l1)',
        background: 'var(--dsw-alias-bg-layer-2)',
        color: 'var(--dsw-alias-label-primary)',
        fontFamily: 'inherit',
        fontSize: em(13),
        width: 170,
        outline: 'none',
      }
      const area = {
        width: '100%',
        boxSizing: 'border-box',
        padding: '12px 14px',
        borderRadius: 10,
        border: '1px solid var(--dsw-alias-border-l1)',
        background: 'var(--dsw-alias-bg-layer-2)',
        color: 'var(--dsw-alias-label-primary)',
        fontFamily: 'inherit',
        fontSize: em(13),
        lineHeight: 1.75,
        resize: 'vertical',
        outline: 'none',
      }
      const small = { ...S.btn, padding: '3px 10px', fontSize: em(12) }

      return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 12 } }, [
        h('div', { key: 't', style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' } }, [
          h('span', { key: 'a', style: S.sectionTitle }, `人格卡（当前在用：${data.current || '没选'}）`),
          h('button', { key: 'b', type: 'button', style: small, onClick: () => setNewOpen((v) => !v) }, newOpen ? '收起' : '新建一张'),
        ]),
        newOpen
          ? h('div', { key: 'new', style: { ...S.card, display: 'flex', flexDirection: 'column', gap: 8 } }, [
              h('div', { key: 't', style: S.sectionTitle }, '新建人格卡'),
              h('div', { key: 'r', style: { display: 'flex', gap: 8, flexWrap: 'wrap' } }, [
                h('input', { key: 'n', value: newName, placeholder: '名字，比如 小鲸鱼', onChange: (e) => setNewName(e.target.value), style: field }),
                h(
                  'button',
                  {
                    key: 'b',
                    type: 'button',
                    style: S.btn,
                    disabled: Boolean(busy) || !newName.trim(),
                    onClick: async () => {
                      // 先等结果再清空：失败时写的内容还在，不用重打
                      const res = await onCreate(newName.trim(), newBody)
                      if (res === null || res?.ok === false) return
                      setNewOpen(false)
                      setNewName('')
                      setNewBody('')
                    },
                  },
                  '建好',
                ),
              ]),
              h('textarea', { key: 'b', value: newBody, placeholder: '先写个开头，建好之后还能改', onChange: (e) => setNewBody(e.target.value), style: { ...area, minHeight: 110 } }),
            ])
          : null,
        ...list.map((r) =>
          h('div', { key: r.name, style: { ...S.row, flexDirection: 'column', alignItems: 'stretch', gap: 6 } }, [
            h('div', { key: 'm', style: { display: 'flex', alignItems: 'center', gap: 10 } }, [
              h('div', { key: 'i', style: { flex: 1, minWidth: 0 } }, [
                h('div', { key: 'n', style: S.rowName }, r.name + (r.name === data.current ? '（正在用）' : '')),
                h(
                  'div',
                  { key: 'x', style: S.rowMeta },
                  `${r.chars} 字 · ${r.lines} 行 · 实际注入 ${r.injectedV2 ?? r.chars} 字` + (r.truncated ? ' · 超上限被截断了' : '') + (r.warnings ? ` · ${r.warnings} 条提醒` : ''),
                ),
              ]),
              r.name === data.current
                ? h('span', { key: 'b', style: S.badge('var(--dsw-alias-brand-primary)') }, '在用')
                : h('button', { key: 'u', type: 'button', style: { ...S.btn, padding: '4px 10px' }, disabled: Boolean(busy), onClick: () => onSwitch(r.name) }, '用这张'),
            ]),
            h('div', { key: 'o', style: { display: 'flex', gap: 6, flexWrap: 'wrap' } }, [
              h(
                'button',
                {
                  key: 'r',
                  type: 'button',
                  style: small,
                  onClick: () => {
                    setRenameOf(renameOf === r.name ? '' : r.name)
                    setRenameTo(r.name)
                  },
                },
                '改名',
              ),
              h('button', { key: 'd', type: 'button', style: small, disabled: Boolean(busy), onClick: () => onDelete(r.name) }, '删除'),
            ]),
            renameOf === r.name
              ? h('div', { key: 'rn', style: { display: 'flex', gap: 8, flexWrap: 'wrap' } }, [
                  h('input', { key: 'i', value: renameTo, onChange: (e) => setRenameTo(e.target.value), style: field }),
                  h(
                    'button',
                    {
                      key: 'ok',
                      type: 'button',
                      style: { ...S.btn, padding: '4px 10px' },
                      disabled: Boolean(busy) || !renameTo.trim() || renameTo === r.name,
                      onClick: () => {
                        onRename(r.name, renameTo.trim())
                        setRenameOf('')
                      },
                    },
                    '确定',
                  ),
                  h('button', { key: 'no', type: 'button', style: { ...S.btn, padding: '4px 10px' }, onClick: () => setRenameOf('') }, '取消'),
                ])
              : null,
          ]),
        ),
        cur
          ? h('div', { key: 'body', style: { ...S.card, display: 'flex', flexDirection: 'column', gap: 8 } }, [
              h('div', { key: 'head', style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' } }, [
                h('span', { key: 'a', style: { fontSize: em(13), fontWeight: 600, color: 'var(--dsw-alias-label-secondary)' } }, `${cur.name} · ${chars} 字 / 上限 ${limit}`),
                h(
                  'button',
                  { key: 'b', type: 'button', style: S.btnMain, disabled: Boolean(busy) || !dirty, onClick: () => onSave(cur.name, draft) },
                  busy === 'saveRole' ? '保存中…' : dirty ? '保存改动' : '没有改动',
                ),
              ]),
              over ? h('div', { key: 'w', style: { ...S.rowMeta, color: 'var(--dsw-alias-state-warn-primary)' } }, '超过注入上限了，多出来的部分不会发给模型') : null,
              h('textarea', { key: 'e', value: draft, readOnly: busy === 'saveRole', spellCheck: false, onChange: (event) => setDraft(event.target.value), style: { ...area, minHeight: 420 } }),
              h('div', { key: 'h', style: S.foot }, '保存前会自动把旧版本备份一份，改坏了能在下面翻回来'),
            ])
          : null,
        h('details', { key: 'bk', style: S.card }, [
          h('summary', { key: 's', style: { ...S.sectionTitle, cursor: 'pointer', margin: 0 } }, `备份（${data.backups?.length || 0} 份，最多显示 50）`),
          h('div', { key: 'h', style: { ...S.foot, marginTop: 6 } }, '恢复会把当时那份内容写回去；如果那张卡已经删了，会重新建出来。'),
          h(
            'div',
            { key: 'l', style: { display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 } },
            (data.backups || []).length
              ? (data.backups || []).map((b) =>
                  h('div', { key: b.file, style: { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' } }, [
                    h('span', { key: 'n', style: { flex: 1, minWidth: 0, fontSize: em(12.5) } }, `${b.role} · ${fmtTime(b.at)} · ${b.chars} 字`),
                    h('button', { key: 'b', type: 'button', style: small, disabled: Boolean(busy), onClick: () => onRestore(b.file) }, '恢复这一份'),
                  ]),
                )
              : [h('span', { key: 'e', style: S.rowMeta }, '还没有备份')],
          ),
        ]),
        h('details', { key: 'sim', style: S.card }, [
          h('summary', { key: 's', style: { ...S.sectionTitle, cursor: 'pointer', margin: 0 } }, `仿真提示词（她说话的行为规则 · ${sim?.chars || 0} 字）`),
          sim
            ? h('div', { key: 'b', style: { display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 } }, [
                h('div', { key: 'h', style: { display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'center' } }, [
                  h('span', { key: 'a', style: S.rowMeta }, `预设 ${sim.preset} · ${sim.chars} 字${sim.warnings?.length ? ` · ${sim.warnings.length} 条提醒` : ''}`),
                  h('div', { key: 'b', style: { display: 'flex', gap: 6 } }, [
                    h('button', { key: 'r', type: 'button', style: small, disabled: Boolean(busy), onClick: onRestoreSim }, '恢复默认'),
                    h(
                      'button',
                      { key: 's', type: 'button', style: S.btnMain, disabled: Boolean(busy) || simDraft === sim.content, onClick: () => onSaveSim(simDraft) },
                      busy === 'saveSimPrompt' ? '保存中…' : '保存',
                    ),
                  ]),
                ]),
                h('div', { key: 'w', style: S.foot }, '这是她在群里说话的总规则（分条、表情频率、搜索、看图…），不是人格卡。改完可能要重启 DSH 才生效。'),
                needRestart
                  ? h('div', { key: 'warn', style: { fontSize: em(13), fontWeight: 600, color: 'var(--dsw-alias-state-warn-primary)' } }, '已保存，但还没生效：关掉 DSH 再打开就生效了（桥接会自动重连）。')
                  : null,
                h('textarea', { key: 'e', value: simDraft, readOnly: busy === 'saveSimPrompt', spellCheck: false, onChange: (e) => setSimDraft(e.target.value), style: { ...area, minHeight: 360 } }),
              ])
            : h('div', { key: 'e', style: S.rowMeta }, '正在读取…'),
        ]),
      ])
    }

    function Learning({ slang, busy, onSlang, onSlangDelete, onAddSlang, onConfirm, onBatch, onResearch, onExtract, onWebLogin, onWebResearch }) {
      const [newWord, setNewWord] = useState('')
      const [newMeaning, setNewMeaning] = useState('')
      const [confirmOf, setConfirmOf] = useState('')
      const [confirmMeaning, setConfirmMeaning] = useState('')
      const [researchAck, setResearchAck] = useState(false)
      const [extractAck, setExtractAck] = useState(false)
      const [statusFilter, setStatusFilter] = useState('candidate')
      const [query, setQuery] = useState('')
      const [selected, setSelected] = useState([])
      const [batchMsg, setBatchMsg] = useState('')
      const [webState, setWebState] = useState('idle')
      const [webMsg, setWebMsg] = useState('')
      const [webLimit, setWebLimit] = useState(20)
      // 登录轮询的在飞标记：3 秒一轮，上一轮没回来就不要发下一轮
      const pollBusy = useRef(false)

      const checkWeb = async () => {
        setWebState('checking')
        setWebMsg('')
        const res = await onWebLogin()
        // 区分「请求/启动失败」和「浏览器起来了但没登录」：之前 ok:false 也显示成要登录
        if (!res || res.ok === false) {
          setWebState('error')
          setWebMsg((res && res.error) || '打不开浏览器，看看有没有被占用')
          return
        }
        if (res.loggedIn) {
          setWebState('ready')
          setWebMsg('')
        } else {
          setWebState('login')
          setWebMsg('请在打开的浏览器窗口里登录，登完这里会自动继续')
        }
      }

      useEffect(() => {
        if (webState !== 'login') return undefined
        // 轮询走独立请求：不经过全局 send，否则每 3 秒把 busy 设成 webLogin、
        // 反复弹「好了」，等待登录时页面上的按钮还被轮流禁用
        let startedCount = 0
        const timer = setInterval(() => {
          // 上一次还没回来就别再发：否则浏览器还没起来时会被连拉好几个窗口
          if (pollBusy.current) return
          pollBusy.current = true
          fetch('/api/qq-console', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ action: 'webLogin' }),
          })
            .then((r) => r.json())
            .then((body) => {
              if (!body) return
              if (body.loggedIn) {
                setWebState('ready')
                return
              }
              // 连着两轮都是「刚把浏览器拉起来」：说明窗口被用户关了，别再自动拉起
              startedCount = body.browserStarted ? startedCount + 1 : 0
              if (startedCount >= 2) {
                setWebState('idle')
                setWebMsg('登录窗口被关掉了，点「检查登录」重来')
              }
            })
            .catch(() => {})
            .finally(() => {
              pollBusy.current = false
            })
        }, 3000)
        return () => clearInterval(timer)
      }, [webState])

      const startWeb = async () => {
        setWebState('running')
        setWebMsg('')
        const res = await onWebResearch(webLimit)
        if (res && res.ok) {
          setWebState('done')
          // 没有候选词/全被敏感词过滤时后端只给 message、没有 total，别显示「0/undefined」
          if (!res.total && res.message) setWebMsg(String(res.message))
          else
            setWebMsg(
              `写回 ${res.done ?? 0}/${res.total ?? 0} 条` +
                (res.skippedCount ? `，跳过 ${res.skippedCount} 条含敏感词` : '') +
                (res.missed && res.missed.length ? `，没匹配上：${res.missed.join('、')}` : ''),
            )
        } else {
          setWebState('error')
          setWebMsg((res && res.error) || '研究失败')
        }
      }
      const small = { ...S.btn, padding: '3px 10px', fontSize: em(12) }
      const field = {
        padding: '5px 10px',
        borderRadius: 8,
        border: '1px solid var(--dsw-alias-border-l1)',
        background: 'var(--dsw-alias-bg-layer-2)',
        color: 'var(--dsw-alias-label-primary)',
        fontFamily: 'inherit',
        fontSize: em(13),
        outline: 'none',
      }

      const counts = slang?.counts || {}
      const entries = slang?.entries || []
      const q = query.trim().toLowerCase()
      const filtered = entries.filter((e) => {
        const st = e.status || 'candidate'
        if (statusFilter !== 'all' && st !== statusFilter) return false
        if (!q) return true
        return [e.content, e.meaning, e.usage, e.example].some((v) => String(v || '').toLowerCase().includes(q))
      })
      const selSet = new Set(selected)
      // 全选状态按「真正渲染出来的那些」算：筛选结果超过 200 时，
      // 全选只选了前 200，用全量判断会导致勾不上/取消不掉
      const visible = filtered.slice(0, 200)
      const picked = visible.filter((e) => selSet.has(e.id))
      const allChecked = visible.length > 0 && picked.length === visible.length

      const toggle = (id) => setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
      const batch = async (op) => {
        // 批量失败/跳过要如实显示：之前一律「好了」，部分没成功也看不出来
        const res = await onBatch(op, picked.map((e) => e.id))
        if (res === null || res?.ok === false) return
        const done = res.done ?? 0
        const skipped = res.skippedCount ?? 0
        setBatchMsg(
          skipped
            ? `完成 ${done} 条，跳过 ${skipped} 条${res.skipped && res.skipped.length ? `（${res.skipped.join('、')}${skipped > res.skipped.length ? '…' : ''}）` : ''}`
            : `完成 ${done} 条`,
        )
        setSelected([])
      }

      const tabs = [
        ['candidate', '候选中', counts.candidate || 0],
        ['confirmed', '已确认', counts.confirmed || 0],
        ['rejected', '已拒绝', counts.rejected || 0],
        ['all', '全部', counts.total || 0],
      ]

      return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 12 } }, [
        h('div', { key: 's', style: S.statRow }, [
          h(Stat, { key: '1', label: '黑话总数', value: slang ? String(counts.total ?? 0) : '…' }),
          h(Stat, { key: '2', label: '已确认', value: slang ? String(counts.confirmed ?? 0) : '…', color: 'var(--dsw-alias-state-success-primary)' }),
          h(Stat, { key: '3', label: '待确认', value: slang ? String(counts.candidate ?? 0) : '…', color: 'var(--dsw-alias-state-warn-primary)' }),
          h(Stat, { key: '4', label: '已拒绝', value: slang ? String(counts.rejected ?? 0) : '…' }),
        ]),
        h('div', { key: 'add', style: { ...S.card, display: 'flex', flexDirection: 'column', gap: 8 } }, [
          h('div', { key: 't', style: S.sectionTitle }, '手动加一条黑话'),
          h('div', { key: 'r', style: { display: 'flex', gap: 8, flexWrap: 'wrap' } }, [
            h('input', { key: 'w', value: newWord, placeholder: '黑话本身，比如 那没事了', onChange: (e) => setNewWord(e.target.value), style: { ...field, width: 200 } }),
            h('input', { key: 'm', value: newMeaning, placeholder: '什么意思（一句话）', onChange: (e) => setNewMeaning(e.target.value), style: { ...field, flex: '1 1 240px' } }),
            h(
              'button',
              {
                key: 'b',
                type: 'button',
                style: S.btn,
                disabled: Boolean(busy) || !newWord.trim(),
                onClick: async () => {
                  const res = await onAddSlang(newWord.trim(), newMeaning.trim())
                  if (res === null || res?.ok === false) return
                  setNewWord('')
                  setNewMeaning('')
                },
              },
              '加进去',
            ),
          ]),
        ]),
        h('div', { key: 'web', style: { ...S.card, display: 'flex', flexDirection: 'column', gap: 8 } }, [
          h('div', { key: 't', style: S.sectionTitle }, '用网页版 AI 研究（不花 token）'),
          h(
            'div',
            { key: 'd', style: S.rowMeta },
            '点一下会自动打开一个带调试端口的 Edge（独立 profile，不碰你日常那个），把候选词丢给网页版 DeepSeek 研究，结果自动写回。第一次要在弹出的窗口里登录一次。',
          ),
          h('div', { key: 'row', style: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' } }, [
            webState === 'idle' ? h('button', { key: 'b', type: 'button', style: S.btn, onClick: checkWeb }, '打开网页版并检查登录') : null,
            webState === 'checking' ? h('span', { key: 'b', style: S.rowMeta }, '正在打开浏览器…') : null,
            webState === 'login' ? h('span', { key: 'b', style: { ...S.rowMeta, color: 'var(--dsw-alias-state-warn-primary)' } }, webMsg) : null,
            webState === 'ready'
              ? h('div', { key: 'b', style: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' } }, [
                  h('span', { key: 'ok', style: { ...S.rowMeta, color: 'var(--dsw-alias-state-success-primary)' } }, '已登录'),
                  h('input', {
                    key: 'n',
                    value: String(webLimit),
                    onChange: (e) => setWebLimit(Math.min(50, Math.max(1, Number(e.target.value) || 1))),
                    style: { ...field, width: 60 },
                  }),
                  h('span', { key: 'u', style: S.rowMeta }, '条'),
                  h('button', { key: 'go', type: 'button', style: S.btnMain, disabled: Boolean(busy), onClick: startWeb }, busy === 'webResearch' ? '研究中…' : '开始研究'),
                ])
              : null,
            webState === 'running' ? h('span', { key: 'b', style: S.rowMeta }, '正在等网页回复（一般几十秒，最长等 4 分钟）…') : null,
            webState === 'done' ? h('span', { key: 'b', style: { ...S.rowMeta, color: 'var(--dsw-alias-state-success-primary)' } }, webMsg) : null,
            webState === 'error' ? h('span', { key: 'b', style: { ...S.rowMeta, color: 'var(--dsw-alias-state-error-primary)' } }, webMsg) : null,
            webState === 'done' || webState === 'error'
              ? h('button', { key: 'again', type: 'button', style: small, onClick: () => { setWebState('idle'); setWebMsg('') } }, '再来一次')
              : null,
          ]),
        ]),
        h('div', { key: 'nav', style: { display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' } }, [
          ...tabs.map(([id, label, count]) =>
            h(
              'button',
              {
                key: id,
                type: 'button',
                style: {
                  ...small,
                  borderColor: statusFilter === id ? 'var(--dsw-alias-brand-primary)' : undefined,
                  color: statusFilter === id ? 'var(--dsw-alias-brand-primary)' : undefined,
                  fontWeight: statusFilter === id ? 600 : 400,
                },
                onClick: () => {
                  setStatusFilter(id)
                  setSelected([])
                },
              },
              `${label} ${count}`,
            ),
          ),
          h('input', {
            key: 'q',
            value: query,
            placeholder: '搜词条或含义',
            onChange: (e) => setQuery(e.target.value),
            style: { ...field, flex: '1 1 180px', marginLeft: 4 },
          }),
        ]),
        h('div', { key: 'bulk', style: { display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' } }, [
          h(
            'label',
            { key: 'l', style: { ...S.rowMeta, display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' } },
            [
              h('input', {
                key: 'c',
                type: 'checkbox',
                checked: allChecked,
                onChange: () => setSelected(allChecked ? [] : filtered.slice(0, 200).map((e) => e.id)),
              }),
              `全选这一页（${Math.min(200, filtered.length)} 条）`,
            ],
          ),
          h('span', { key: 'n', style: { ...S.rowMeta, color: 'var(--dsw-alias-brand-primary)' } }, picked.length ? `已选 ${picked.length} 条` : ''),
          h(
            'button',
            { key: 'ok', type: 'button', style: small, disabled: Boolean(busy) || !picked.length, onClick: () => batch('confirm') },
            '确认选中的',
          ),
          h('button', { key: 'rj', type: 'button', style: small, disabled: Boolean(busy) || !picked.length, onClick: () => batch('reject') }, '拒绝选中的'),
          h('button', { key: 'del', type: 'button', style: small, disabled: Boolean(busy) || !picked.length, onClick: () => batch('delete') }, '删掉选中的'),
        ]),
        h('div', { key: 'tip', style: S.foot }, '批量确认会自动跳过没写含义的（没含义的词确认了也不会进她的脑子）；搜索和筛选只影响当前这一页。'),
        batchMsg ? h('div', { key: 'bm', style: { ...S.rowMeta, color: 'var(--dsw-alias-brand-primary)' } }, batchMsg) : null,
        h('div', { key: 'ai', style: { display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' } }, [
          h(
            'button',
            {
              key: 'r',
              type: 'button',
              style: { ...small, borderColor: researchAck ? 'var(--dsw-alias-state-warn-primary)' : undefined, color: researchAck ? 'var(--dsw-alias-state-warn-primary)' : undefined },
              disabled: Boolean(busy) || !picked.length,
              onClick: () => {
                if (!researchAck) {
                  setResearchAck(true)
                  return
                }
                setResearchAck(false)
                onResearch(picked.map((e) => e.id))
              },
            },
            researchAck ? `确认研究这 ${picked.length} 条？会花 token` : '研究选中的',
          ),
          h(
            'button',
            {
              key: 'x',
              type: 'button',
              style: { ...small, borderColor: extractAck ? 'var(--dsw-alias-state-warn-primary)' : undefined, color: extractAck ? 'var(--dsw-alias-state-warn-primary)' : undefined },
              disabled: Boolean(busy),
              onClick: () => {
                if (!extractAck) {
                  setExtractAck(true)
                  return
                }
                setExtractAck(false)
                onExtract()
              },
            },
            extractAck ? '确认提取？会花 token' : '立即提取候选',
          ),
          h('span', { key: 'n', style: S.foot }, '研究＝每个词跑一次 DSH（约 4 分钱、几十秒）；提取＝拿最近的群消息抽新词。都是后台排队跑，过一会儿刷新看。'),
        ]),
        filtered.length
          ? h(
              'div',
              { style: { display: 'flex', flexDirection: 'column', gap: 8 } },
              filtered.slice(0, 200).map((e) =>
                h(
                  'div',
                  { key: e.id, style: { ...S.card, padding: '10px 14px' } },
                  h('div', { key: 'h', style: { display: 'flex', alignItems: 'flex-start', gap: 8, flexWrap: 'wrap' } }, [
                    h('input', {
                      key: 'c',
                      type: 'checkbox',
                      checked: selSet.has(e.id),
                      onChange: () => toggle(e.id),
                      style: { marginTop: 3 },
                    }),
                    h('span', { key: 'w', style: { fontWeight: 600 } }, e.content),
                    h(
                      'span',
                      {
                        key: 's',
                        style: S.badge(
                          e.status === 'confirmed'
                            ? 'var(--dsw-alias-state-success-primary)'
                            : e.status === 'rejected'
                              ? 'var(--dsw-alias-state-idle-primary)'
                              : 'var(--dsw-alias-state-warn-primary)',
                        ),
                      },
                      STATUS_TEXT[e.status] || '候选中',
                    ),
                    e.count ? h('span', { key: 'n', style: S.badge() }, `出现 ${e.count} 次`) : null,
                    !e.meaning ? h('span', { key: 'm', style: { ...S.rowMeta, fontSize: em(11), opacity: 0.7 } }, '（还没写含义）') : null,
                  ]),
                  e.meaning ? h('div', { key: 'm', style: { ...S.rowMeta, marginTop: 4 } }, e.meaning) : null,
                  e.example ? h('div', { key: 'x', style: { ...S.rowMeta, opacity: 0.8, marginTop: 2 } }, `例：${e.example}`) : null,
                  h('div', { key: 'a', style: { display: 'flex', gap: 8, marginTop: 6, flexWrap: 'wrap' } }, [
                    e.status !== 'confirmed'
                      ? h(
                          'button',
                          {
                            key: 'c',
                            type: 'button',
                            style: small,
                            disabled: Boolean(busy),
                            onClick: () => {
                              if (e.meaning) {
                                onConfirm(e.id)
                                return
                              }
                              setConfirmOf(confirmOf === e.id ? '' : e.id)
                              setConfirmMeaning('')
                            },
                          },
                          '确认这条',
                        )
                      : null,
                    h('button', { key: 'rj', type: 'button', style: small, disabled: Boolean(busy), onClick: () => onSlang(e.id, 'rejected') }, '拒绝'),
                    h('button', { key: 'd', type: 'button', style: small, disabled: Boolean(busy), onClick: () => onSlangDelete(e.id) }, '删掉'),
                  ]),
                  e.status !== 'confirmed' && !e.meaning && confirmOf === e.id
                    ? h('div', { key: 'cm', style: { display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 } }, [
                        h('input', {
                          key: 'i',
                          value: confirmMeaning,
                          placeholder: '这句话什么意思？填了才能确认',
                          onChange: (ev) => setConfirmMeaning(ev.target.value),
                          style: { ...field, flex: '1 1 220px' },
                        }),
                        h(
                          'button',
                          {
                            key: 'ok',
                            type: 'button',
                            style: small,
                            disabled: Boolean(busy) || !confirmMeaning.trim(),
                            onClick: () => {
                              onConfirm(e.id, confirmMeaning.trim())
                              setConfirmOf('')
                              setConfirmMeaning('')
                            },
                          },
                          '填好并确认',
                        ),
                      ])
                    : null,
                ),
              ),
            )
          : h(Empty, { text: slang ? (q || statusFilter !== 'all' ? '没有符合条件的' : '这里空着') : '正在读取…' }),
        filtered.length > 200 ? h('div', { key: 'more', style: S.foot }, `只显示前 200 条（共 ${filtered.length} 条），用搜索缩小范围。`) : null,
      ])
    }

    function Stickers({ stickers, busy, onNoteSticker, onSync }) {
      const [noteOf, setNoteOf] = useState('')
      const [noteText, setNoteText] = useState('')
      const [opened, setOpened] = useState([])
      const [broken, setBroken] = useState([])
      const small = { ...S.btn, padding: '3px 10px', fontSize: em(12) }
      const field = {
        padding: '5px 10px',
        borderRadius: 8,
        border: '1px solid var(--dsw-alias-border-l1)',
        background: 'var(--dsw-alias-bg-layer-2)',
        color: 'var(--dsw-alias-label-primary)',
        fontFamily: 'inherit',
        fontSize: em(13),
        outline: 'none',
      }
      const imgStyle = {
        maxWidth: '100%',
        maxHeight: 150,
        objectFit: 'contain',
        borderRadius: 6,
        display: 'block',
        background: 'var(--dsw-alias-bg-layer-2)',
        margin: '2px 0',
      }
      // 预览图走宿主的缩略图接口（ffmpeg 取首帧、200px 宽），点一下才加载原图
      const thumb = (id) => `/api/qq-console/thumb?id=${encodeURIComponent(id)}`
      const renderImage = (s) => {
        const expanded = opened.includes(s.id)
        if (broken.includes(s.id)) return h('div', { key: 'img', style: { ...S.rowMeta, fontSize: em(12), opacity: 0.7 } }, '图挂了（QQ 上可能已经删了）')
        return h('img', {
          key: 'img',
          src: expanded ? s.url : thumb(s.id),
          loading: 'lazy',
          alt: '',
          title: expanded ? '点一下收起' : '点一下看大图（原图）',
          style: { ...imgStyle, cursor: 'pointer' },
          onClick: () => setOpened((prev) => (prev.includes(s.id) ? prev.filter((x) => x !== s.id) : [...prev, s.id])),
          // 缩略图挂了先退回原图（很多时候原图还能看），原图也挂才标死
          onError: (event) => {
            const el = event.currentTarget
            if (!el.dataset.orig && s.url) {
              el.dataset.orig = '1'
              el.src = s.url
              return
            }
            setBroken((prev) => (prev.includes(s.id) ? prev : [...prev, s.id]))
          },
        })
      }

      if (!stickers) return h(Empty, { text: '正在读取…' })

      return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 12 } }, [
        h('div', { key: 'h', style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' } }, [
          h('span', { key: 't', style: S.sectionTitle }, `表情包（${stickers.items.length} 个，最近用过的排前面）`),
          h('button', { key: 'b', type: 'button', style: S.btn, disabled: Boolean(busy), onClick: onSync }, busy === 'syncStickers' ? '同步中…' : '从 QQ 同步'),
        ]),
        h('div', { key: 'tip', style: S.foot }, '备注会进她挑表情时的判断，写清楚「长什么样、什么时候发」最有用。大图点一下才加载（省流量），小图直接显示。'),
        stickers.items.length
          ? h(
              'div',
              { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))', gap: 8 } },
              stickers.items.map((s) =>
                h('div', { key: s.id, style: { ...S.card, padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 6 } }, [
                  h('div', { key: 'h', style: { display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' } }, [
                    h('span', { key: 't', style: { fontSize: em(12), fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, (s.tags && s.tags[0]) || '表情'),
                    s.useCount ? h('span', { key: 'u', style: S.badge() }, `用过 ${s.useCount}`) : null,
                  ]),
                  renderImage(s),
                  h('div', { key: 'n', style: { ...S.rowMeta, maxHeight: 62, overflow: 'hidden' } }, s.note || '（没写备注）'),
                  noteOf === s.id
                    ? h('div', { key: 'e', style: { display: 'flex', flexDirection: 'column', gap: 6 } }, [
                        h('textarea', { key: 't', value: noteText, onChange: (ev) => setNoteText(ev.target.value), style: { ...field, width: '100%', minHeight: 70, boxSizing: 'border-box', resize: 'vertical' } }),
                        h('div', { key: 'b', style: { display: 'flex', gap: 6 } }, [
                          h(
                            'button',
                            {
                              key: 'ok',
                              type: 'button',
                              style: small,
                              disabled: Boolean(busy),
                              onClick: async () => {
                                const res = await onNoteSticker(s.id, noteText, s.tags)
                                if (res === null || res?.ok === false) return
                                setNoteOf('')
                              },
                            },
                            '保存',
                          ),
                          h('button', { key: 'no', type: 'button', style: small, onClick: () => setNoteOf('') }, '取消'),
                        ]),
                      ])
                    : h(
                        'button',
                        {
                          key: 'b',
                          type: 'button',
                          style: { ...small, alignSelf: 'flex-start' },
                          onClick: () => {
                            setNoteOf(s.id)
                            setNoteText(s.note || '')
                          },
                        },
                        '改备注',
                      ),
                ]),
              ),
            )
          : h(Empty, { text: '还没拉到表情，点右上角「从 QQ 同步」' }),
      ])
    }

    function Usage({ data, busy, onReset, hours, onHours }) {
      const [confirming, setConfirming] = useState(false)
      if (!data) return h(Empty, { text: '正在读取…' })
      const t = data.totals || {}
      const cost = Number(t.cost) || 0
      const hit = Number(t.cacheHitRate) || 0
      const series = data.series
      const buckets = series?.buckets || []
      const maxCost = Math.max(0.0001, ...buckets.map((b) => Number(b.cost) || 0))
      const peak = buckets.reduce((best, b) => (!best || (Number(b.cost) || 0) > (Number(best.cost) || 0) ? b : best), null)
      const small = { ...S.btn, padding: '2px 9px', fontSize: em(12) }
      const rangeLabel = (hValue) => (hValue >= 24 ? `${Math.round(hValue / 24)} 天` : `${hValue} 小时`)
      const fmtTick = (ms) => {
        if (!ms) return '—'
        const d = new Date(Number(ms))
        const p = (n) => String(n).padStart(2, '0')
        return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
      }

      return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 12 } }, [
        h('div', { style: S.statRow }, [
          h(Stat, { key: '1', label: '累计花费', value: `${data.symbol}${cost.toFixed(2)}`, color: 'var(--dsw-alias-brand-primary)' }),
          h(Stat, { key: '2', label: '回合 / 步数', value: `${t.turns ?? 0} / ${t.steps ?? 0}` }),
          h(Stat, { key: '3', label: '缓存命中', value: `${(hit * 100).toFixed(1)}%`, color: 'var(--dsw-alias-state-success-primary)' }),
          h(Stat, { key: '4', label: '总 token', value: fmtNum(t.totalTokens) }),
        ]),
        h('div', { key: 'note', style: S.foot }, data.nowTier ? `当前计价：${data.nowTier.tierLabel || data.nowTier.tier} · ${data.nowTier.label}` : ''),
        series
          ? h('div', { key: 'chart', style: S.card }, [
              h('div', { key: 't', style: { display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'center' } }, [
                h(
                  'span',
                  { key: 'a', style: S.sectionTitle },
                  `最近 ${rangeLabel(series.hours)} 的花费（每格 ${
                    (series.hours * 60) / Math.max(1, buckets.length) >= 1440
                      ? `${Math.round((series.hours * 60) / Math.max(1, buckets.length) / 1440)} 天`
                      : (series.hours * 60) / Math.max(1, buckets.length) >= 60
                        ? `${Math.round((series.hours * 60) / Math.max(1, buckets.length) / 60)} 小时`
                        : `${Math.round((series.hours * 60) / Math.max(1, buckets.length))} 分钟`
                  }）`,
                ),
                h(
                  'div',
                  { key: 'r', style: { display: 'flex', gap: 6, flexWrap: 'wrap' } },
                  [
                    [24, '24 小时'],
                    [168, '7 天'],
                    [720, '30 天'],
                  ].map(([hValue, label]) =>
                    h(
                      'button',
                      {
                        key: hValue,
                        type: 'button',
                        style: {
                          ...small,
                          borderColor: hours === hValue ? 'var(--dsw-alias-brand-primary)' : undefined,
                          color: hours === hValue ? 'var(--dsw-alias-brand-primary)' : undefined,
                          fontWeight: hours === hValue ? 600 : 400,
                        },
                        disabled: Boolean(busy),
                        onClick: () => onHours(hValue),
                      },
                      label,
                    ),
                  ),
                ),
                peak ? h('span', { key: 'b', style: S.rowMeta }, `最贵一格：${data.symbol}${(Number(peak.cost) || 0).toFixed(3)} · ${new Date(Number(peak.t)).toLocaleTimeString('zh-CN', { hour12: false }).slice(0, 5)}`) : null,
              ]),
              h(
                'div',
                { key: 'bars', style: { display: 'flex', alignItems: 'flex-end', gap: 2, height: 84, marginTop: 8 } },
                (buckets.length ? buckets : [{ t: Date.now(), cost: 0 }]).map((b, i) =>
                  h('div', {
                    key: i,
                    title: `${fmtTick(b.t)} · ${data.symbol}${(Number(b.cost) || 0).toFixed(3)}`,
                    style: {
                      flex: 1,
                      minWidth: 2,
                      height: `${Math.max(2, ((Number(b.cost) || 0) / maxCost) * 78)}px`,
                      background: 'var(--dsw-alias-brand-primary)',
                      opacity: 0.75,
                      borderRadius: 2,
                    },
                  }),
                ),
              ),
              h('div', { key: 'axis', style: { display: 'flex', justifyContent: 'space-between', marginTop: 4 } }, [
                h('span', { key: 'a', style: S.rowMeta }, fmtTick(series.from || (buckets[0] && buckets[0].t))),
                h('span', { key: 'b', style: S.rowMeta }, fmtTick(buckets.length ? buckets[Math.floor(buckets.length / 2)].t : null)),
                h('span', { key: 'c', style: S.rowMeta }, fmtTick(series.to || (buckets.length ? buckets[buckets.length - 1].t : null))),
              ]),
              h('div', { key: 'foot', style: { display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginTop: 6 } }, [
                h(
                  'span',
                  { key: 'o', style: S.rowMeta },
                  series.offChartCost > 0
                    ? `图外还有 ${data.symbol}${series.offChartCost.toFixed(2)}（这段时间之外的更早记录）`
                    : '这段时间的记录都在图上',
                ),
                data.consoleUsageUrl
                  ? h(
                      'a',
                      {
                        key: 'l',
                        href: data.consoleUsageUrl,
                        target: '_blank',
                        rel: 'noreferrer',
                        style: { color: 'var(--dsw-alias-brand-primary)', textDecoration: 'none', fontWeight: 600 },
                      },
                      '全部记录：去原控制台查看 ↗',
                    )
                  : null,
              ]),
            ])
          : null,
        h('div', { key: 't', style: S.sectionTitle }, '各群花得多少'),
        ...(data.conversations || []).map((c) => {
          const amount = Number(c.cost) || 0
          const pct = cost > 0 ? Math.max(2, (amount / cost) * 100) : 0
          return h(
            'div',
            { key: c.key, style: { ...S.card, padding: '10px 14px' } },
            h('div', { style: { display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' } }, [
              h('span', { key: 'k', style: { fontWeight: 600 } }, c.label || c.key),
              h('span', { key: 'v', style: S.rowMeta }, `${data.symbol}${amount.toFixed(2)} · ${c.turns} 回合 · 上次 ${fmtTime(c.lastAt)}`),
            ]),
            h('div', { key: 'bar', style: { height: 6, borderRadius: 999, background: 'var(--dsw-alias-bg-layer-2)', marginTop: 6, overflow: 'hidden' } }, [
              h('div', { key: 'f', style: { width: pct + '%', height: '100%', background: 'var(--dsw-alias-brand-primary)' } }),
            ]),
          )
        }),
        h('div', { key: 'reset', style: { ...S.card, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' } }, [
          h('div', { key: 'l' }, [
            h('div', { key: 't', style: S.sectionTitle }, '重置账本'),
            h('div', { key: 'a', style: S.rowMeta }, '把这份花费记录清零，明天重新算。记录删了就找不回来，DSH 那边的总花费不受影响。'),
          ]),
          h(
            'button',
            {
              key: 'b',
              type: 'button',
              style: confirming ? S.btnStop : S.btn,
              disabled: Boolean(busy),
              onClick: () => {
                if (!confirming) {
                  setConfirming(true)
                  return
                }
                setConfirming(false)
                onReset()
              },
            },
            busy === 'resetUsage' ? '清着…' : confirming ? '真的清空？再点一次' : '清空账本',
          ),
        ]),
      ])
    }

    function Settings({ data, busy, env, onToggleWake, onWhitelist, onSetSend, onEnvCheck }) {
      const [groups, setGroups] = useState([])
      const [privates, setPrivates] = useState([])
      const [groupInput, setGroupInput] = useState('')
      const [privateInput, setPrivateInput] = useState('')
      const [msg, setMsg] = useState('')
      const [perMinute, setPerMinute] = useState('')
      const [perHour, setPerHour] = useState('')
      const [maxChars, setMaxChars] = useState('')

      // 10 秒自动刷新会拿到新对象：引用变了但值没变时不要覆盖正在编辑的输入框
      const lastSendSig = useRef('')
      useEffect(() => {
        const send = data?.social?.send
        if (!send) return
        const sig = `${send.maxSendPerMinute ?? ''}|${send.maxSendPerHour ?? ''}|${send.maxMessageChars ?? ''}`
        if (lastSendSig.current === sig) return
        lastSendSig.current = sig
        setPerMinute(String(send.maxSendPerMinute ?? ''))
        setPerHour(String(send.maxSendPerHour ?? ''))
        setMaxChars(String(send.maxMessageChars ?? ''))
      }, [data?.social?.send])

      useEffect(() => {
        const allow = data?.whitelist?.allow
        if (!allow) return
        setGroups((allow.groups || []).map(String))
        setPrivates((allow.private || []).map(String))
      }, [data?.whitelist])

      if (!data) return h(Empty, { text: '正在读取…' })

      const social = data.social || {}
      const w = social.wake || {}
      const preSleepOff = w.preSleepWaitEnabled === false

      const commit = async (nextGroups, nextPrivates) => {
        const prevGroups = groups
        const prevPrivates = privates
        setGroups(nextGroups)
        setPrivates(nextPrivates)
        // 保存失败要把界面上的假状态撤回去，否则下次「加一个」会把整份假名单写进去
        const res = await onWhitelist(nextGroups, nextPrivates)
        if (!res || res.ok === false) {
          setGroups(prevGroups)
          setPrivates(prevPrivates)
        }
      }

      const addGroup = () => {
        const v = groupInput.trim()
        if (!/^\d{5,12}$/.test(v)) return setMsg('群号是纯数字，5~12 位')
        if (groups.includes(v)) return setMsg('这个群已经在里面了')
        setMsg('')
        setGroupInput('')
        commit([...groups, v], privates)
      }

      const addPrivate = () => {
        const v = privateInput.trim()
        if (!/^\d{5,12}$/.test(v)) return setMsg('QQ 号是纯数字，5~12 位')
        if (privates.includes(v)) return setMsg('这个号已经在里面了')
        setMsg('')
        setPrivateInput('')
        commit(groups, [...privates, v])
      }

      const field = {
        padding: '5px 10px',
        borderRadius: 8,
        border: '1px solid var(--dsw-alias-border-l1)',
        background: 'var(--dsw-alias-bg-layer-2)',
        color: 'var(--dsw-alias-label-primary)',
        fontFamily: 'inherit',
        fontSize: em(13),
        width: 170,
        outline: 'none',
      }

      const chip = (value, onRemove) =>
        h('span', { key: value, style: { ...S.badge(), display: 'inline-flex', alignItems: 'center', gap: 4, padding: '1px 4px 1px 9px' } }, [
          h('span', { key: 't' }, value),
          h(
            'button',
            {
              key: 'x',
              type: 'button',
              disabled: Boolean(busy),
              onClick: onRemove,
              style: { appearance: 'none', border: 'none', background: 'transparent', color: 'inherit', cursor: 'pointer', fontSize: em(14), lineHeight: 1, padding: '0 2px' },
            },
            '×',
          ),
        ])

      // 白名单没读到时（桥接没连上），页面上的 groups/privates 是空的；
      // 这时点「加进来」会把「只有新群」的数组整份提交，原白名单被覆盖丢失。
      const wlReady = Boolean(data?.whitelist?.allow)

      return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 12 } }, [
        h('div', { key: 'wl', style: S.card }, [
          h('div', { key: 't', style: S.sectionTitle }, '白名单 · 她能进的群'),
          wlReady ? null : h('div', { key: 'w', style: { ...S.rowMeta, color: 'var(--dsw-alias-state-warn-primary)', marginBottom: 8 } }, '白名单没读出来（可能桥接没连上），先别增删，等刷新后再试'),
          h('div', { key: 'chips', style: { display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 } }, groups.length ? groups.map((g) => chip(g, () => commit(groups.filter((x) => x !== g), privates))) : [h('span', { key: 'e', style: S.rowMeta }, '（空）')]),
          h('div', { key: 'add', style: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' } }, [
            h('input', { key: 'i', value: groupInput, placeholder: '群号，比如 123456789', onChange: (e) => setGroupInput(e.target.value), style: field }),
            h('button', { key: 'b', type: 'button', style: S.btn, disabled: Boolean(busy) || !wlReady, onClick: addGroup }, '加进来'),
          ]),
          h('div', { key: 'p', style: { ...S.sectionTitle, marginTop: 14 } }, '私聊'),
          h('div', { key: 'pc', style: { display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 } }, privates.length ? privates.map((p) => chip(p, () => commit(groups, privates.filter((x) => x !== p)))) : [h('span', { key: 'e', style: S.rowMeta }, '（空）')]),
          h('div', { key: 'pa', style: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' } }, [
            h('input', { key: 'i', value: privateInput, placeholder: 'QQ 号', onChange: (e) => setPrivateInput(e.target.value), style: field }),
            h('button', { key: 'b', type: 'button', style: S.btn, disabled: Boolean(busy) || !wlReady, onClick: addPrivate }, '加进来'),
          ]),
          msg ? h('div', { key: 'm', style: { ...S.rowMeta, marginTop: 8, color: 'var(--dsw-alias-state-warn-primary)' } }, msg) : null,
          h('div', { key: 'n', style: { ...S.foot, marginTop: 8 } }, '移出一个群，那个群里的她会一起被收掉；想加回来随时可以。改完立刻生效。'),
        ]),
        h('div', { key: 'sp', style: { ...S.card, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' } }, [
          h('div', { key: 'l' }, [
            h('div', { key: 't', style: S.sectionTitle }, '潜水前先观察'),
            h('div', { key: 'a', style: S.rowMeta }, preSleepOff ? '关着：她说想潜水就立刻睡，不再等' : `开着：想潜水前先安静观察 ${Math.round((Number(w.preSleepWaitMs) || 300000) / 1000 / 60)} 分钟`),
          ]),
          h(
            'button',
            { key: 'b', type: 'button', style: S.btn, disabled: Boolean(busy), onClick: () => onToggleWake(preSleepOff) },
            busy === 'setWake' ? '改着呢…' : preSleepOff ? '打开观察' : '关掉观察',
          ),
        ]),
        h('div', { key: 'sd', style: { ...S.card, display: 'flex', flexDirection: 'column', gap: 8 } }, [
          h('div', { key: 't', style: S.sectionTitle }, '发言节奏'),
          h('div', { key: 'r', style: { display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' } }, [
            h('label', { key: 'a', style: { ...S.rowMeta, display: 'flex', alignItems: 'center', gap: 6 } }, [
              '每分钟最多',
              h('input', { key: 'i', value: perMinute, onChange: (e) => setPerMinute(e.target.value), style: { ...field, width: 64 } }),
              '条',
            ]),
            h('label', { key: 'b', style: { ...S.rowMeta, display: 'flex', alignItems: 'center', gap: 6 } }, [
              '每小时最多',
              h('input', { key: 'i', value: perHour, onChange: (e) => setPerHour(e.target.value), style: { ...field, width: 72 } }),
              '条',
            ]),
            h('label', { key: 'c', style: { ...S.rowMeta, display: 'flex', alignItems: 'center', gap: 6 } }, [
              '单条最多',
              h('input', { key: 'i', value: maxChars, onChange: (e) => setMaxChars(e.target.value), style: { ...field, width: 72 } }),
              '字',
            ]),
            h(
              'button',
              {
                key: 's',
                type: 'button',
                style: S.btn,
                disabled: Boolean(busy),
                onClick: () =>
                  onSetSend({
                    maxSendPerMinute: Number(perMinute) || 0,
                    maxSendPerHour: Number(perHour) || 0,
                    maxMessageChars: Number(maxChars) || 0,
                  }),
              },
              '保存',
            ),
          ]),
          h('div', { key: 'b', style: S.foot }, '防止刷屏用的，改完立刻生效。'),
        ]),
        h('div', { key: 'env', style: S.card }, [
          h('div', { key: 't', style: S.sectionTitle }, '环境检查'),
          h('div', { key: 'd', style: S.rowMeta }, '装好之后先看这里：缺什么、该去哪补。'),
          h('div', { key: 'b', style: { display: 'flex', gap: 8, marginTop: 6 } }, [
            h('button', { key: 'b', type: 'button', style: S.btn, disabled: Boolean(busy), onClick: onEnvCheck }, busy === 'envCheck' ? '检查中…' : '检查一下'),
          ]),
          env?.items?.length
            ? h(
                'div',
                { key: 'l', style: { display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 } },
                env.items.map((it, i) =>
                  h('div', { key: i, style: { display: 'flex', gap: 6, alignItems: 'baseline', flexWrap: 'wrap' } }, [
                    h('span', { key: 'i', style: { minWidth: 18 } }, it.ok ? '✅' : it.required ? '❌' : '⚠️'),
                    h('span', { key: 'n', style: { fontSize: em(12.5), fontWeight: 600, minWidth: 96 } }, it.name),
                    h('span', { key: 'p', style: { ...S.rowMeta, wordBreak: 'break-all', flex: 1 } }, it.path || '—'),
                    it.ok ? null : h('span', { key: 'h', style: { fontSize: em(12), color: 'var(--dsw-alias-state-warn-primary)' } }, it.hint),
                  ]),
                ),
              )
            : null,
        ]),
        h('div', { key: 'logs', style: S.card }, [
          h('div', { key: 't', style: S.sectionTitle }, '排查用 · 最近出了什么事'),
          data.logs?.alerts?.length
            ? h(
                'div',
                { key: 'a', style: { display: 'flex', flexDirection: 'column', gap: 4 } },
                data.logs.alerts
                  .slice()
                  .reverse()
                  .slice(0, 8)
                  .map((alert, i) => h('div', { key: i, style: { fontSize: em(12.5), color: 'var(--dsw-alias-state-warn-primary)' } }, `${alert.time} ${alert.text}`)),
              )
            : h('div', { key: 'ok', style: S.rowMeta }, data.logs ? '最近 15 分钟没有异常' : '读不到日志（桥接还没跑过？）'),
          h('details', { key: 'd', style: { marginTop: 8 } }, [
            h('summary', { key: 's', style: { ...S.rowMeta, cursor: 'pointer' } }, `全部记录（原文，不翻译，最近 ${Math.min(80, data.logs?.count || 0)} 行）`),
            h(
              'div',
              { key: 'l', style: { display: 'flex', flexDirection: 'column', gap: 2, marginTop: 6, maxHeight: 300, overflowY: 'auto' } },
              (data.logs?.lines || [])
                .slice(-80)
                .reverse()
                .map((line, i) =>
                  h('div', { key: i, style: { ...S.rowMeta, fontFamily: 'monospace', fontSize: em(11), wordBreak: 'break-all' } }, `${line.time} ${line.raw}`),
                ),
            ),
          ]),
        ]),
      ])
    }

    function Page() {
      const [tab, setTab] = useState('overview')
      const [store, setStore] = useState({})
      const [error, setError] = useState(null)
      const [busy, setBusy] = useState('')
      const [note, setNote] = useState(null)
      const [simNeedRestart, setSimNeedRestart] = useState(false)
      const [fontSize, setFontSize] = useState(() => {
        try {
          const saved = Number(localStorage.getItem('qq-console-font'))
          return saved >= 12 && saved <= 24 ? saved : 15
        } catch {
          return 15
        }
      })
      const [usageHours, setUsageHours] = useState(24)
      const changeFont = (delta) => {
        const next = Math.min(24, Math.max(12, fontSize + delta))
        setFontSize(next)
        try {
          localStorage.setItem('qq-console-font', String(next))
        } catch {}
      }

      // 每个 part 记一个请求序号：慢的旧请求回来不能盖掉新的
      const seqRef = useRef({})
      const fetchPart = useCallback(async (part, extra) => {
        const seq = (seqRef.current[part] = (seqRef.current[part] || 0) + 1)
        const qs = new URLSearchParams({ part })
        if (extra) for (const [k, v] of Object.entries(extra)) if (v !== undefined && v !== null) qs.set(k, String(v))
        const res = await fetch('/api/qq-console?' + qs.toString(), { cache: 'no-store' })
        const body = await res.json()
        if (seqRef.current[part] !== seq) return
        if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`)
        setStore((prev) => ({ ...prev, [part]: body }))
      }, [])

      const load = useCallback(
        async (part, extra) => {
          try {
            await fetchPart(part, extra)
            setError(null)
          } catch (err) {
            setError(err?.message || String(err))
          }
        },
        [fetchPart],
      )

      useEffect(() => {
        if (tab === 'persona') {
          load('roles')
          load('simPrompt')
          return
        }
        if (tab === 'usage') {
          load('usage', { hours: usageHours })
          return
        }
        load(PART_OF[tab] || tab)
      }, [tab, usageHours, load])

      useEffect(() => {
        if (tab !== 'overview' && tab !== 'groups') return
        // 10 秒轮询只负责刷新数据：不碰 error，否则刚失败的操作提示会被一次成功刷新抹掉
        const timer = setInterval(() => {
          fetchPart('overview').catch(() => {})
        }, 10000)
        return () => clearInterval(timer)
      }, [tab, fetchPart])

      const send = useCallback(async (payload) => {
        setBusy(payload.action)
        setNote(null)
        try {
          const res = await fetch('/api/qq-console', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(payload),
          })
          const body = await res.json()
          // 先应用结果再判失败：启停接口就算 ok:false 也带着 steps 和 snapshot，
          // 之前先 throw 会把这些全丢掉，界面停在旧状态还只剩一句「操作没成功」。
          const failed = !res.ok || body?.ok === false
          if (body.snapshot) setStore((prev) => ({ ...prev, overview: body.snapshot }))
          if (body.part) setStore((prev) => ({ ...prev, [body.part]: body }))
          else if (body.data && body.data.part) setStore((prev) => ({ ...prev, [body.data.part]: body.data }))
          if (body.requiresRestart === true) setSimNeedRestart(true)
          if (Array.isArray(body.steps)) setNote(body.steps.map((s) => s.text).join('；'))
          else if (!failed) setNote('好了')
          if (failed) {
            setError(body?.error || '操作没成功')
            return body
          }
          setError(null)
          return body
        } catch (err) {
          setError(err?.message || String(err))
          return null
        } finally {
          // 只清自己设进去的那个：A 操作飞行中触发 B，A 结尾不能把 B 的 loading 抹掉
          setBusy((cur) => (cur === payload.action ? '' : cur))
        }
      }, [])

      const refresh = useCallback(() => {
        if (tab === 'usage') {
          load('usage', { hours: usageHours })
          return
        }
        for (const p of partsFor(tab)) load(p)
      }, [tab, usageHours, load])

      const overview = store.overview

      return h('div', { style: { ...S.root, fontSize: `${fontSize}px` } }, [
        h('div', { key: 'w', style: S.wrap }, [
          h('div', { key: 'h', style: S.header }, [
            h('div', { key: 'l' }, [
              h('div', { key: 'a', style: S.title }, '大肥鱼QQ总控台'),
              h(
                'div',
                { key: 'b', style: S.sub },
                overview?.bridge?.online
                  ? `在跑 · 角色「${overview.status?.role || '没设'}」 · ${MODE_TEXT[overview.status?.mode] || overview.status?.mode || ''}`
                  : '没开 · 点总览里的按钮就能起来',
              ),
            ]),
            h('div', { key: 'r', style: { display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' } }, [
              h('button', { key: 'fa', type: 'button', style: S.btn, title: '字小一点', onClick: () => changeFont(-1) }, 'A−'),
              h('button', { key: 'fb', type: 'button', style: S.btn, title: '字大一点', onClick: () => changeFont(1) }, 'A+'),
              h('button', { key: 'r', type: 'button', style: S.btn, onClick: refresh, disabled: Boolean(busy) }, '刷新'),
              h(LinkBtn, { key: 's', href: overview?.links?.snowluma }, 'SnowLuma 面板'),
              h(LinkBtn, { key: 'c', href: overview?.links?.console }, '原控制台'),
            ]),
          ]),
          h(
            'div',
            { key: 't', style: S.tabs },
            TABS.map(([id, label]) => h('button', { key: id, type: 'button', style: S.tab(tab === id), onClick: () => setTab(id) }, label)),
          ),
          error ? h('div', { key: 'e', style: S.error }, `出错了：${error}`) : null,
          note ? h('div', { key: 'n', style: S.note }, note) : null,
          h(Boundary, { key: 'body-' + tab }, [
            tab === 'overview'
              ? h(Overview, { key: 'p1', data: overview, busy, onStart: () => send({ action: 'start' }), onStop: () => send({ action: 'stop' }), onWake: (key) => send({ action: 'wake', key }) })
              : null,
            tab === 'groups'
              ? h(Groups, {
                  key: 'p2',
                  data: overview,
                  busy,
                  onWake: (key) => send({ action: 'wake', key }),
                  onWakeLevel: (key, id, probability, active) => send({ action: 'setGroupWake', key, mode: active ? 'active' : 'diving', probability }),
                })
              : null,
            tab === 'persona'
              ? h(Persona, {
                  key: 'p3',
                  data: store.roles,
                  busy,
                  sim: store.simPrompt,
                  onSave: (name, content) => send({ action: 'saveRole', name, content }),
                  onSwitch: (role) => send({ action: 'setRole', role }),
                  onCreate: (name, content) => send({ action: 'createRole', name, content }),
                  onRename: (from, to) => send({ action: 'renameRole', from, to }),
                  onDelete: (name) => send({ action: 'deleteRole', name }),
                  onRestore: (file) => send({ action: 'restoreBackup', file }),
                  onSaveSim: (content) => send({ action: 'saveSimPrompt', preset: store.simPrompt?.preset, content }),
                  onRestoreSim: () => send({ action: 'restoreSimPrompt', preset: store.simPrompt?.preset }),
                  needRestart: simNeedRestart,
                })
              : null,
            tab === 'learning'
              ? h(Learning, {
                  key: 'p4',
                  slang: store.slang,
                  busy,
                  onSlang: (id, status) => send({ action: 'slangStatus', id, status }),
                  onSlangDelete: (id) => send({ action: 'slangDelete', id }),
                  onAddSlang: (content, meaning) => send({ action: 'addSlang', content, meaning }),
                  onConfirm: (id, meaning) => send({ action: 'slangConfirm', id, meaning }),
                  onBatch: (op, ids) => send({ action: 'slangBatch', op, ids }),
                  onResearch: (ids) => send({ action: 'slangResearch', ids }),
                  onExtract: () => send({ action: 'slangExtract' }),
                  onWebLogin: () => send({ action: 'webLogin' }),
                  onWebResearch: (limit) => send({ action: 'webResearch', limit }),
                })
              : null,
            tab === 'stickers'
              ? h(Stickers, {
                  key: 'p4b',
                  stickers: store.stickers,
                  busy,
                  onNoteSticker: (stickerId, note, tags) => send({ action: 'noteSticker', stickerId, note, tags }),
                  onSync: () => send({ action: 'syncStickers' }),
                })
              : null,
            tab === 'usage'
              ? h(Usage, { key: 'p5', data: store.usage, busy, hours: usageHours, onHours: setUsageHours, onReset: () => send({ action: 'resetUsage' }) })
              : null,
            tab === 'settings'
              ? h(Settings, {
                  key: 'p6',
                  data: store.settings,
                  env: store.env,
                  busy,
                  onToggleWake: (enabled) => send({ action: 'setWake', preSleepWaitEnabled: enabled }),
                  onWhitelist: (groups, privateList) => send({ action: 'setWhitelist', groups, private: privateList }),
                  onSetSend: (values) => send({ action: 'setSend', ...values }),
                  onEnvCheck: () => send({ action: 'envCheck' }),
                })
              : null,
          ]),
          h('div', { key: 'f', style: S.foot }, '数据每 10 秒自动刷新一次'),
        ]),
      ])
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({ name: 'sidebar.panellist', id: 'qq-console', order: 30, label: '大肥鱼QQ' }, Icon))
        ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: 'qq-console' }, Page))
      },
    }
  },
})
