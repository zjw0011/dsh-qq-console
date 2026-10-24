# 安装指南

> **给接手安装的 AI：先读 [AGENTS.md](AGENTS.md)。** 那页是失败对照表——没 git、GitHub 连不上、postinstall 报错、叫醒报 `{{cwd}}`、恒显示离线，一条条对应怎么办。看完再回来按下面的步骤走。
>
> 装过的人里最慢那个花了 40 分钟，其中约 20 分钟全耗在「GitHub 连不上、反复换代理」上。
> 下面第一节就是给这种情况写的：先测线，再动手。

## 零、给接手安装的 AI 的 60 秒速查

1. **先测网络，别死磕代理。** PowerShell 跑这三条，哪条通就走哪条：

   ```powershell
   Test-NetConnection github.com -Port 443 -InformationLevel Quiet
   curl.exe -sI --max-time 8 https://registry.npmjs.org/ | Select-Object -First 1
   curl.exe -sI --max-time 8 https://registry.npmmirror.com/ | Select-Object -First 1
   ```

   - GitHub 通 → 走官方源（最省事）
   - 只有 npmmirror 通 → 用 npm 包 + 国内镜像（见第二节）
   - 都不通 → 先修网络，装不了

2. **本机没有 `git` 时，`dsh plugin add github:xxx` 一定失败**（报 `ERR_PNPM_GIT_RESOLVE_FAILED`），直接换 npm 包或本地目录，别在 git 上耗。

3. **桥接必须用本仓库的 fork。** 上游 `Derpyu520/qq-bridge` 的 preset 里有 `{{cwd}}`、`/api/status` 里没有 `snowluma`，装完第一次「叫醒」就会炸。只能拿到上游时，按第三节打两处补丁。

4. **`pnpm install` 的 postinstall 报 `'node' is not recognized` 是正常的**（DSH 自带的 node 不在 PATH 里），用绝对路径补跑一次，这个脚本不能跳：

   ```powershell
   & "C:\Users\<你>\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe" scripts/patch-snowluma-sdk.mjs
   ```

5. **装完先点「设置 → 环境检查」**，有红叉就按提示补，别等出问题再找。

## 一、你需要先有

| 组件 | 必须？ | 从哪来 |
|---|---|---|
| **DeepSeek Harness（DSH）** | 必须 | 已装好、能开网页界面 |
| **SnowLuma** | 必须 | [GitHub Release](https://github.com/SnowLuma/SnowLuma/releases) —— **EULA，本插件不能帮你下**，也不能打包转发 |
| **qq-bridge** | 必须 | 本仓库配套的 [fork](https://github.com/zjw0011/qq-bridge-fork)；上游也能跑，但要打第三节那两处补丁 |
| **Node 22.13+** | 必须 | 用 DSH 自带的就行 |
| **ffmpeg** | 可选 | 缺了：表情包缩略图、动图拼图不可用 |
| **Edge** | 可选 | 缺了：网页版研究不可用 |

## 二、国内源对照表

网络正常时全部忽略。GitHub 不通时按这张表换源——**换源不要改插件代码，只换下载地址**。

| 缺什么 | 官方 | 国内可用 |
|---|---|---|
| 本插件（npm 包） | `registry.npmjs.org` | `registry.npmmirror.com`（自动同步，推荐） |
| SnowLuma | GitHub Release | `gitcode.com/gh_mirrors/sn/SnowLuma/releases`（**第三方镜像**，下完自己看大小对不对） |
| qq-bridge | GitHub（fork） | `gitcode.com/gh_mirrors/qq/qq-bridge`（镜像的是**上游**，不是 fork，装完照第三节补） |
| git（可选） | git-scm.com | `registry.npmmirror.com/-/binary/git-for-windows/` 里的 MinGit zip（免安装） |
| npm 依赖（152 个） | `registry.npmjs.org` | `npm config set registry https://registry.npmmirror.com` |

> 镜像站都是第三方转发，不是我们发的。能走官方就走官方；走镜像的，至少核一下文件大小/哈希。

## 三、装 qq-bridge

### 方案 A：fork（推荐）

把 `qq-bridge-main` 放到一个目录（比如 `C:\qq-bridge`），然后：

```powershell
cd C:\qq-bridge\qq-bridge-main
npm install
& "<DSH 自带 node 的绝对路径>" scripts/patch-snowluma-sdk.mjs
```

### 方案 B：上游 + 手工补丁

用上游 v0.2.0 时，装完必须补两处，否则「叫醒」必失败：

1. 删掉预设里的 `{{cwd}}`（共 4 个文件，`#` 注释行里的不用动）：

   ```
   dsh\agent-presets\qq-chat\agent.cordis.yml
   dsh\agent-presets\qq-chat-v2\agent.cordis.yml
   plugins\qq-agent-presets\presets\qq-chat.patch.yml
   plugins\qq-agent-presets\presets\qq-chat-v2.patch.yml
   ```

   要删的是这一行：`suffix: Your working directory is {{cwd}}.`

2. `/api/status` 缺 `snowluma` 字段（总控台会恒显示「离线」）。插件 1.0.1 起会自己问 OneBot 兜底，**这一处不用改了**；1.0.0 及更早要自己补桥接。

> preset 只在 DSH 启动时加载，改完必须重启 DSH。

## 四、改 `config.json`

从 `config.example.json` 复制一份，填：

- `snowluma.homeDir` → 你的 SnowLuma 目录
- `snowluma.httpUrl` / `wsUrl` → 默认 `http://127.0.0.1:3000` / `ws://127.0.0.1:3001`
- `ownerQQ` → 你的 QQ 号（不填：审批、管理命令、封闭 agent 模式全不可用）
- `allow.groups` → 允许它进的群（不填：一条消息都不回）
- `dsh.baseUrl` → 你的 DSH 地址（端口每次启动都会变，由插件启动桥接时自动对齐）
- `consoleToken` → 自己设一串，插件读同一份配置

## 五、装插件

三选一，按网络情况：

```powershell
# 1) npm 包（推荐，国内自动走镜像）
dsh plugin --profile desktop add dsh-qq-console

# 2) GitHub 源（要有 git）
dsh plugin --profile desktop add github:zjw0011/dsh-qq-console

# 3) 本地目录（最稳，完全离线）
dsh plugin --profile desktop add file:D:\path\to\dsh-qq-console
```

## 六、打开总控台，跑环境检查

左边栏点「大肥鱼QQ」→ 设置 → **环境检查** → 「检查一下」。

会查这些：桥接目录、SnowLuma、Node、ffmpeg、Edge、网页研究登录态，以及 **QQ 预设里有没有当前 DSH 不认识的变量**（就是第三节那个坑，装完当场报，不用等第一次叫醒）。

- 全绿 → 接着填白名单和白名单里的群
- 红叉 → 按提示补

## 七、常踩的坑

| 现象 | 原因 | 怎么办 |
|---|---|---|
| 叫醒后 QQ 收到 `unknown prompt variable "{{cwd}}"` | 用了上游 preset | 第三节方案 B 第 1 条，删完重启 DSH |
| 总控台 QQ 账号恒「离线」 | 上游 `/api/status` 没 `snowluma` | 升到插件 1.0.1；或自己给桥接补字段 |
| 叫醒显示成功，群里没动静 | 被唤醒频率限制（1 分钟 / 12 小时）挡住了，接口仍返回成功 | 调 `socialV2.wake.maxWakePerMinute`；测试别连点 |
| `dsh plugin install` 卡在 codeload | 依赖是远程 tarball，每次 install 都要 HEAD 一次 | 换 npm 包或 `file:` 本地目录 |
| postinstall 报找不到 `node` | DSH 的 node 不在 PATH | 用绝对路径补跑，见第零节第 4 条 |
| DSH 重启后 QQ 不自己起 | 桥接是插件的子进程，跟着 DSH 一起没了 | 总控台点「启动整套 QQ」 |
| 控制台中文变乱码 | 控制台代码页是 GBK | 不影响功能；看日志用总控台，别用 cmd |
