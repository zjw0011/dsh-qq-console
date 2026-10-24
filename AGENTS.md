# 给接手安装的 AI

这份文件是给「另一台机器上被派来装这个插件」的 AI 看的。人照着 README 点，真正卡住的是网络、git 和依赖顺序。**先读完这一页再动手，别自己重走一遍**——有人在这上面烧了 20 分钟。

## 一、先测三条线，再决定走哪条

PowerShell 跑这三条，**别先改代理**：

```powershell
Test-NetConnection github.com -Port 443 -InformationLevel Quiet
curl.exe -sI --max-time 8 https://registry.npmjs.org/ | Select-Object -First 1
curl.exe -sI --max-time 8 https://registry.npmmirror.com/ | Select-Object -First 1
```

- GitHub 通 → 走官方源，最省事
- 只有 npmmirror 通 → 走 npm 包 / 镜像（见第四节）
- 三条全不通 → 先修网络。修不了就停下来告诉人，别硬试

## 二、失败对照表

| 你看到的 | 真相 | 该怎么办 |
|---|---|---|
| `ERR_PNPM_GIT_RESOLVE_FAILED`、`git ls-remote failed`、`'git' 不是内部或外部命令` | 本机没有 git，`github:` 规格**一定**失败 | 换 tarball 或本地目录。别为了装一个插件去装 git |
| `ECONNRESET`、`SSLEOFError`、`TLS reset`（codeload、api.github.com、各种 ghproxy 全挂） | 出网被代理/线路掐了 | 换国内源；`--offline` **无效**，别试（pnpm 仍会 HEAD 远程 tarball） |
| `postinstall: node scripts/patch-snowluma-sdk.mjs` 报 `'node' is not recognized` | DSH 自带的 node 不在 PATH | 用绝对路径补跑一次，**这个脚本不能跳**（它修 `@snowluma/sdk` 的 ESM 打包问题）：`& "C:\Users\<你>\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe" scripts/patch-snowluma-sdk.mjs` |
| 第一次「叫醒」收到 `unknown prompt variable "{{cwd}}"` | 装的是**上游** qq-bridge，它的 preset 带 `{{cwd}}` | 删掉 4 个 preset 文件里的 `suffix: Your working directory is {{cwd}}.`，然后**重启 DSH**（preset 只在启动时加载）。文件清单见 `INSTALL.md` 第三节 |
| 总控台「QQ 账号」恒显示离线 | 上游 `/api/status` 没有 `snowluma` 字段 | 1.0.1 起插件会自己问 OneBot 兜底；1.0.0 及更早要自己补桥接 |
| 叫醒提示成功、群里却没动静 | 被唤醒限流挡住了（1 分钟 / 12 小时），接口仍回 `ok:true` | 别连点；调 `socialV2.wake.maxWakePerMinute` 再试 |
| `dsh plugin install` 一直卡在 codeload 的 HEAD | 依赖规格是远程 tarball，每次 install 都要回源 | 换 npm 包或 `file:` 本地目录 |
| 控制台中文变乱码 | 控制台代码页 GBK | 不影响功能；别用 cmd 看日志，用总控台或 `chcp 65001` |

## 三、三种装法（按网络好坏排）

```powershell
# 1) npm 包（最省心，国内自动走镜像）
dsh plugin --profile desktop add dsh-qq-console@1.0.2

# 2) 固定版本 tarball（只用 HTTPS，不需要 git，也不回源 HEAD）
dsh plugin --profile desktop add https://github.com/zjw0011/dsh-qq-console/archive/refs/tags/v1.0.2.tar.gz

# 3) 本地目录（完全离线；把仓库下下来拷过去）
dsh plugin --profile desktop add file:D:\path\to\dsh-qq-console
```

## 四、国内源对照表

| 缺什么 | 官方 | 国内可用 |
|---|---|---|
| 本插件 / npm 依赖 | registry.npmjs.org | `registry.npmmirror.com`（自动同步） |
| SnowLuma | GitHub Release | `gitcode.com/gh_mirrors/sn/SnowLuma/releases`（**第三方镜像，EULA 不允许转载**，下完自己核大小） |
| qq-bridge | GitHub（用配套 fork） | `gitcode.com/gh_mirrors/qq/qq-bridge`（镜像的是**上游**，装完照对照表删 `{{cwd}}`） |
| git（可选） | git-scm.com | `registry.npmmirror.com/-/binary/git-for-windows/` 的 MinGit zip（免安装） |

## 五、别做这些

- 别为了装插件死磕代理、换十几个 ghproxy / jsdelivr 镜像（实测能烧掉 20 分钟）
- 别指望 `--offline` 或 `--prefer-offline` 能绕过远程 tarball
- 别把 SnowLuma 打进任何分发包（它的许可不允许）
- 别把 `consoleToken` 放进 URL、截图或聊天记录；装完让用户去控制台「访问与安全」重新生成一次
- 别把 `D:\` 这种绝对路径写死进配置后又去移动目录（`link:` 装法移动就断）

## 六、装完就算完了的三步

1. 总控台「设置 → 环境检查」，点「检查一下」（1.0.1 起会查 QQ 预设变量，能提前抓出 `{{cwd}}` 那种坑）
2. 填 `ownerQQ`、`allow.groups`（不填：一条消息都不回、审批全不可用）
3. 点一次「叫醒」验证链路（注意限流）

完整步骤、配置项、常见问题：见 [INSTALL.md](INSTALL.md)。
