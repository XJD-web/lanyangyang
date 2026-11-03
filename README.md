# 懒羊羊 · 开发环境极速装配工具

> 一台刚装好的 Windows，从「什么都没有」到「能跑起第一个 Java 项目」，手工做要两个小时：逐个找官网、下载、解压、配 `JAVA_HOME`、把 `bin` 塞进 `PATH`、开新终端验证。这个工具把这套流程做成一次点击。

桌面端（Electron + Vue 3）负责下载、解压、写环境变量、检测本机已装环境；服务端（Node.js + Express）维护软件清单与环境报告。内置 **8 大类 35 款软件、53 个版本**。

---

## 它解决什么问题

配环境真正的成本不在「下载」，而在这几件事：

1. **找版本**：同一个 JDK 有 8/11/17/21，官网入口分散，学生下错版本是常态。
2. **配环境变量**：`JAVA_HOME` 指向哪一层目录、`PATH` 里该放 `bin` 还是根目录，教程各说各话。
3. **判断「装没装」**：只看 `PATH` 会漏掉装完没配环境变量的，只看注册表会漏掉绿色解压版的。
4. **验证**：配完不验证，往往到写代码那天才发现 `javac` 不存在。

对应地，这个工具做四件事：给固定版本清单、自动写环境变量并回读校验、三路探测已装环境、装完即跑 `--version` 验证。

## 功能

| 能力 | 说明 |
| --- | --- |
| 软件清单 | 8 大类 35 款、53 个版本，来自后端接口，接口挂了自动降级为本地内置清单 |
| 一键安装 | 流式下载 + 实时进度（按 `content-length` 算百分比），zip 自动解压，exe/msi 落盘 |
| 环境变量 | 自动写 `JAVA_HOME` 等 HOME 变量并把 `bin` 追加进用户级 `PATH`，写完回读校验 |
| 环境检测 | 注册表卸载表 / `PATH` 的 `where` / 全盘标志文件三路探测，标注命中来源 |
| 版本识别 | 优先执行 `<exe> --version` 解析真实版本，失败回退注册表 `DisplayVersion` |
| 环境报告 | 桌面端检测结果上传服务端，网页端可查看，绕开浏览器读不到 `PATH` 的限制 |
| 部署 | 一键脚本装 Node 20、注册 systemd、接管 80 端口，`nginx -t` 失败自动回滚 |

## 技术架构

```
┌─────────────────────────────────────────────┐
│  Electron 主进程 (electron/)                 │
│  · app:// 特权协议 → 加载渲染层              │
│  · 三路探测 / 下载解压 / 写环境变量 (IPC)     │
└───────────────┬─────────────────────────────┘
                │ ipcRenderer.invoke
┌───────────────▼─────────────────────────────┐
│  Vue 3 渲染层 (src/)                         │
│  · App / ToolCard / EnvReport / LogConsole   │
└───────────────┬─────────────────────────────┘
                │ Axios
┌───────────────▼─────────────────────────────┐
│  Express API (server/)  →  systemd + Nginx   │
│  · /api/softwares · /api/stats · /api/health │
│  · /api/reports（环境报告，落盘 JSON）        │
└─────────────────────────────────────────────┘
```

## 几个关键实现

### 1. `file://` 下 ES Module 被 CORS 拦截导致白屏

Vite 产物是 `<script type="module" crossorigin>`。Electron 用 `loadFile()` 走 `file://` 协议时，模块脚本会被当作跨域请求拦掉，页面白屏且控制台只有一条含糊的 CORS 报错。

解法是在 app ready **之前**注册一个特权协议，用它加载渲染层：

```js
protocol.registerSchemesAsPrivileged([{
  scheme: 'app',
  privileges: { secure: true, standard: true, supportFetchAPI: true, bypassCSP: true },
}])
```

`standard: true` 让 `app://` 具备正常 origin 语义，模块脚本才允许加载。注册时机必须在 `app.whenReady()` 之前，之后注册无效。

### 2. 「装没装」的三路探测

单一数据源都不可靠，所以并行查三处再合并：

- **注册表**：读 `HKLM/HKCU` 卸载表，按 `DisplayName` 关键词匹配（如 JDK、Maven、Node.js），并配 `REG_EXCLUDE` 排除项避免误命中。
- **`PATH`**：`where <cmd>` 找可执行文件，命中即认为可用（覆盖绿色版、手动配过的）。
- **标志文件**：全盘扫描特征目录（如 `apache-maven-*`），解决「解压了但没配 `PATH`」的情况——这是前两路都会漏的。

结果带 `via` 字段标明来源（`registry` / `path` / `scan`），前端据此提示用户「已安装但未配置环境变量」。

### 3. 写环境变量：为什么不用 `setx`

`setx` 有 1024 字符上限，且 `reg.exe` 的命令行引号转义极易出错。这里走 .NET API：

```js
[Environment]::SetEnvironmentVariable('JAVA_HOME', '<path>', 'User')
```

好处是写 HKCU 无需管理员权限、无长度限制、写入后系统自动广播 `WM_SETTINGCHANGE`。另外两点细节：

- 追加 `PATH` 时若原值含 `%VAR%`，必须用 `-Type ExpandString` 写回，否则 `REG_SZ` 会把变量展开成死值。
- 写完立刻同步刷新 `process.env.PATH`，否则本次进程内的 `where` 仍读旧值，要重启应用才生效。

### 4. 版本清单与安装结果

- 下载走 `axios` 的 `responseType: 'stream'`，按块累计字节推进度，避免大文件进内存。
- 官方压缩包几乎都含唯一顶层目录（`apache-maven-3.10.0/`），解压后若只得到一个目录，则把「家目录」指向它，否则回退到目标路径——`JAVA_HOME` 指错一层是新手最常见的坑。
- 落地后写 `installed.json` 记录名称/版本/时间，供后续检测与卸载使用。

## 目录结构

```
electron/          主进程：协议注册、三路探测、下载解压、IPC
  main.js          870 行，核心逻辑
  env.js           环境变量读写、PATH 追加、WM_SETTINGCHANGE 广播
  versions.js      53 个版本的元数据与下载地址
src/               Vue 3 渲染层
  components/      ToolCard / EnvReport / LogConsole
server/            Express API（softwares.js 是 35 款软件清单）
deploy/            install.sh（systemd + Nginx）、service、nginx conf、前端发布脚本
scripts/           探测与自检脚本（Node / PowerShell）
```

## 快速开始

```bash
# 1. 后端（终端 A）：默认 3000 端口
cd server && npm i && npm start

# 2. 桌面端（终端 B）
npm i
npm run dev        # Vite + Electron 热更新

# 3. 打包 Windows 安装包 → release/
npm run dist:win
```

服务端地址通过 `.env.production` 的 `VITE_API_BASE` 注入，**构建期写死进安装包**。已安装的客户端可免重打包，在 DevTools 里覆盖：

```js
localStorage.setItem('lyy_api_base', 'http://your-server-address')
```

## 部署

```bash
tar xzf lanyangyang-api.tar.gz && cd lanyangyang-api && bash install.sh
```

脚本依次做：装 Node 20（官方二进制，不改 apt 源）→ 复制到 `/opt` → 装依赖（npm 失败自动切国内镜像）→ 注册 systemd（开机自启 + 崩溃重启）→ 本地健康检查 → 接管 80 端口。

接管 80 时只移走「占用 80 的 `default_server`」那一个配置，已有的域名站点和 SSL 不动；`nginx -t` 不通过就自动还原，并生成 `/root/lanyangyang-rollback.sh`。可用 `SKIP_NGINX=1` 只装后端。

`deploy/nginx-lanyangyang.conf` 里的域名是占位符，替换成自己的再用。

## 已知限制

- **仅支持 Windows**：探测逻辑依赖 Windows 注册表、`where`、盘符遍历。
- **需要管理员权限**：安装包 `requestedExecutionLevel` 为 `requireAdministrator`，用于向受保护目录写入。
- **只自动解压 zip**：`.exe` / `.msi` 仅保存到目标目录，需用户自行执行安装向导。
- **环境报告存储为本地 JSON 文件**，未接数据库，单机上限 100 份（`MAX_REPORTS` 可调）。

## 技术栈

Electron 31 · Vue 3（Composition API）· Vite 5 · Element Plus · Axios · adm-zip · Node.js · Express 5 · systemd · Nginx · Let's Encrypt

## License

MIT
