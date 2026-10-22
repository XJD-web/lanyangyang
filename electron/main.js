import { app, BrowserWindow, dialog, ipcMain, protocol } from 'electron'
import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs/promises'
import fsSync from 'node:fs' // 同步判断目录/盘符是否存在（全盘检测时用）
import { createWriteStream } from 'node:fs'
import { exec, execSync } from 'node:child_process'
import { promisify } from 'node:util'
import axios from 'axios'
import AdmZip from 'adm-zip'
import * as env from './env.js'
import { fetchVersions, canonicalToolKey } from './versions.js'

const execAsync = promisify(exec)

// 注册特权协议 app://：用它加载渲染页面，module 脚本即可在同安全上下文下加载，
// 避免 Vite 产物 `<script type="module" crossorigin>` 在 file:// 下被 CORS 拦截导致白屏。
// 必须在 app ready 之前注册。
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: {
      secure: true,
      standard: true,
      supportFetchAPI: true,
      bypassCSP: true,
    },
  },
])

// 简易延时工具，用于模拟异步过程（下载/解压耗时）
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// ===== 环境检测：多源探测 =====
// 工具 id -> 注册表 DisplayName 关键词（命中即视为已安装），用于 Windows 卸载表探测
const REG_KEYWORDS = {
  jdk: ['Java(TM) SE Development Kit', 'Java SE Development Kit', 'JDK', 'OpenJDK'],
  maven: ['Maven'],
  gradle: ['Gradle'],
  tomcat: ['Apache Tomcat'],
  python: ['Python'],
  miniconda: ['Miniconda', 'Anaconda'],
  anaconda: ['Anaconda', 'Miniconda'],
  nodejs: ['Node.js'],
  pnpm: ['pnpm'],
  yarn: ['Yarn'],
  mysql: ['MySQL'],
  postgresql: ['PostgreSQL'],
  redis: ['Redis'],
  mongodb: ['MongoDB'],
  mariadb: ['MariaDB'],
  docker: ['Docker Desktop'],
  kubectl: ['Kubernetes CLI', 'kubectl'],
  helm: ['Helm'],
  nginx: ['nginx'],
  rabbitmq: ['RabbitMQ'],
  zookeeper: ['ZooKeeper'],
  rocketmq: ['RocketMQ'],
  git: ['Git'],
  cmake: ['CMake'],
  mingw: ['MinGW', 'gcc'],
  vscode: ['Visual Studio Code'],
}
// 排除词：名称含这些词的项不算目标软件（避免 Git/Python 等误命中相关组件）
const REG_EXCLUDE = {
  python: ['launcher'],
  git: ['hub', 'desktop', 'credential', 'lfs', 'timeline', 'extensions'],
  jdk: ['auto updater', 'updater'],
  mongodb: ['compass'],
}

// 注册表查询缓存（60s），避免每次检测重复枚举卸载表
let _regCache = { at: 0, data: null }

// 执行一条 reg query 并返回原始文本（失败返回空串）
function runRegQuery(root) {
  try {
    return execSync(`reg query "${root}" /s`, {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 15000,
    })
  } catch (_) {
    return ''
  }
}

// 解析 reg query /s 输出为 { name, version, location } 列表
function parseUninstall(output) {
  const items = []
  const lines = output.split('\n')
  let cur = null
  for (const raw of lines) {
    const line = raw.trimEnd()
    if (/^HKEY_/i.test(line)) {
      if (cur) items.push(cur)
      cur = { name: '', version: '', location: '' }
      continue
    }
    if (!cur) continue
    const m = line.match(/^([A-Za-z0-9_ ]+?)\s+REG_(?:SZ|EXPAND_SZ)\s+(.*)$/)
    if (m) {
      const field = m[1].trim().toLowerCase()
      const val = m[2].trim()
      if (field === 'displayname') cur.name = val
      else if (field === 'displayversion') cur.version = val
      else if (field === 'installlocation') cur.location = val
    }
  }
  if (cur) items.push(cur)
  return items.filter((i) => i.name)
}

// 读取本机已安装软件（来自 Windows 卸载注册表项，含 32/64 位与当前用户），结果缓存 60s
async function getInstalledSoftware() {
  const now = Date.now()
  if (_regCache.data && now - _regCache.at < 60000) return _regCache.data
  const roots = [
    'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
    'HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
    'HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
  ]
  let all = []
  for (const r of roots) all = all.concat(parseUninstall(runRegQuery(r)))
  _regCache = { at: now, data: all }
  return all
}

// 根据工具 id 在注册表清单中匹配已安装项（优先带安装路径的项）
function matchRegistry(id, regList) {
  const kws = REG_KEYWORDS[id]
  if (!kws || !regList || !regList.length) return null
  const excl = REG_EXCLUDE[id] || []
  let best = null
  for (const item of regList) {
    const name = item.name.toLowerCase()
    if (excl.some((e) => name.includes(e))) continue
    if (kws.some((k) => name.includes(k.toLowerCase()))) {
      if (item.location) return item
      if (!best) best = item
    }
  }
  return best
}

// 通过 where.exe 判断命令是否在 PATH 中，返回首个可执行文件的完整路径
async function detectViaWhere(check) {
  try {
    const { stdout } = await execAsync(`where ${check} 2>&1`, { timeout: 5000 })
    const first = (stdout || '')
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean)[0]
    if (first && /\.(exe|cmd|bat|ps1|jar)$/i.test(first)) return first
    if (first) return first
  } catch (_) {
    /* 命令不在 PATH */
  }
  return null
}

// 从命令输出中解析出版本号（如 v20.18.0 / 17.0.2 / 2.47.0.windows.2）
function parseVersion(text) {
  if (!text) return null
  const candidates = text.match(/\d+\.\d+(?:\.\d+){0,3}/g) || []
  for (const c of candidates) {
    const major = Number(c.split('.')[0])
    if (major <= 299) return c // 过滤年份等异常数字
  }
  return null
}

// 尝试执行 <exe> --version 等获取真实版本号（兼容多种写法）
async function getVersion(check, exePath) {
  if (!check && !exePath) return null
  const targets = []
  if (exePath) targets.push(`"${exePath}" --version`)
  if (check) {
    targets.push(`${check} --version`, `${check} -version`, `${check} -v`, `${check} -V`)
  }
  for (const cmd of targets) {
    try {
      const { stdout, stderr } = await execAsync(`${cmd} 2>&1`, { timeout: 5000 })
      const v = parseVersion((stdout || stderr || '').trim())
      if (v) return v
    } catch (_) {
      /* 该写法不支持，尝试下一个 */
    }
  }
  return null
}

// ===== 主窗口创建逻辑 =====
const createWindow = () => {
  // 开发环境下窗口/任务栏图标取自 build/icon.ico；
  // 打包后 exe 图标由 electron-builder 内嵌，无需再指定（找不到即忽略）
  const devIcon = path.join(__dirname, '..', 'build', 'icon.ico')

  // 注册 app:// 协议处理器：将 app://<path> 映射到应用根目录下的文件
  // （开发：项目根；打包：app.asar 根）。解决 file:// 下 module 脚本被 CORS 拦截的白屏问题。
  protocol.registerFileProtocol('app', (request, callback) => {
    try {
      // request.url 形如 app://dist/index.html 或 app://./dist/index.html
      let rel = request.url.replace(/^app:\/\//, '')
      rel = rel.replace(/^\.?\//, '') // 去掉前导 ./ 或 /
      // __dirname 在开发为 electron/，打包为 dist-electron/；二者上溯一层均为应用根
      const filePath = path.join(__dirname, '..', rel)
      callback({ path: filePath })
    } catch (e) {
      callback({ error: -2 /* FAILED */ })
    }
  })

  const win = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 920,
    minHeight: 620,
    title: 'Lanyangyang',
    backgroundColor: '#f5f7fa',
    ...(fsSync.existsSync(devIcon) ? { icon: devIcon } : {}),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
    },
  })

  // 调试辅助：把渲染进程控制台错误与页面加载失败写入临时日志文件，便于排查白屏等偶发问题
  const renderLog = path.join(
    os.tmpdir(),
    `lanyangyang-render-${Date.now()}.log`
  )
  // 兼容两种事件签名：Electron<32 为 (event, level, message, line, sourceId)，
  // Electron>=32 为 (details 对象)。level：0 verbose/1 info/2 warning/3 error
  win.webContents.on('console-message', (...args) => {
    let level, message, line
    if (args[0] && typeof args[0] === 'object' && args[0].level !== undefined) {
      ;({ level, message, line } = args[0])
    } else {
      const [, lvl, msg, ln] = args
      level = lvl
      message = msg
      line = ln
    }
    const isErr = level === 3 || level === 'error'
    const isWarn = level === 2 || level === 'warning'
    if (isErr || isWarn) {
      try {
        fsSync.appendFileSync(
          renderLog,
          `[console:${level}] ${message} (line ${line})\n`
        )
      } catch (_) {}
    }
  })
  win.webContents.on('did-fail-load', (_e, code, desc, url) => {
    try {
      fsSync.appendFileSync(
        renderLog,
        `[did-fail-load] code=${code} desc=${desc} url=${url}\n`
      )
    } catch (_) {}
  })

  // 开发环境加载 Vite 本地服务，生产环境通过 app:// 协议加载打包后的页面
  if (process.env.VITE_DEV_SERVER_URL) {
    win.loadURL(process.env.VITE_DEV_SERVER_URL)
  } else {
    win.loadURL('app://dist/index.html')
  }
}

// ===== IPC: 选择工作空间（原生文件夹选择框）=====
ipcMain.handle('select-workspace', async () => {
  const result = await dialog.showOpenDialog({
    title: '选择工作空间（安装根目录）',
    properties: ['openDirectory', 'createDirectory'],
  })
  if (!result.canceled && result.filePaths.length) {
    return result.filePaths[0]
  }
  return null
})

// ===== 全盘盘符检测相关工具 =====

// 枚举本机所有“本地固定磁盘”盘符根路径，例如 ['C:\\', 'D:\\', 'E:\\']
// 优先用 wmic 读取，失败则退化为遍历 A~Z 探测是否存在
function getLogicalDrives() {
  try {
    const out = execSync('wmic logicaldisk where "drivetype=3" get caption', {
      encoding: 'utf8',
      windowsHide: true,
    })
    const drives = out
      .split('\n')
      .map((l) => l.trim().replace(/:$/, ':\\'))
      .filter((l) => /^[A-Z]:\\$/i.test(l))
    if (drives.length) return drives
  } catch (_) {
    /* 退化到下面的探测逻辑 */
  }
  const found = []
  for (const letter of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') {
    const root = `${letter}:\\`
    try {
      if (fsSync.existsSync(root)) found.push(root)
    } catch (_) {
      /* 忽略不可访问的盘 */
    }
  }
  return found
}

// 根据某个盘符，给出“最有可能安装开发工具的目录”作为扫描根
// 设计要点：
//   - 不盲目扫描整个 C:\（会卡死在 Windows/ProgramData），
//     而是扫描 Program Files、每个用户下的“已知安装位置”以及常见自定义目录；
//   - 其它盘（D:/E:…）通常体量较小，直接以盘根为起点扫描（深度受限）。
function candidateRootsForDrive(drive) {
  const roots = new Set()
  const add = (p) => {
    try {
      if (fsSync.existsSync(p)) roots.add(p)
    } catch (_) {
      /* 目录不可访问则跳过 */
    }
  }
  // 所有盘都扫 Program Files（含 32 位兼容目录）
  add(path.join(drive, 'Program Files'))
  add(path.join(drive, 'Program Files (x86)'))
  // 常见自定义安装根（用户常把开发环境装在这些目录）
  for (const c of [
    'env-tools', 'tools', 'dev', 'opt', 'software', 'sdk', 'apps',
    'portapps', 'env', 'green', 'Portable', 'programs',
  ]) {
    add(path.join(drive, c))
  }
  if (/^[Cc]:/i.test(drive)) {
    // C 盘：扫描每个用户下的若干“已知安装位置”（直接作为候选根，避免深扫整个用户目录）
    const userRoots = [
      ['AppData', 'Local', 'Programs'],          // Node/Python/等用户级安装
      ['AppData', 'Local', 'Microsoft', 'WindowsApps'], // Microsoft Store 应用别名
      ['miniconda3'], ['anaconda3'], ['Miniconda3'],     // Conda 常见位置
      ['scoop', 'shims'], ['scoop', 'apps'],              // Scoop 包管理器
      ['.cargo', 'bin'], ['go', 'bin'],                  // Rust / Go
      ['.env-tools'],                                    // 本应用自己的安装根（关键：绿色包/zip 装在这里）
    ]
    try {
      for (const u of fsSync.readdirSync(path.join(drive, 'Users'))) {
        const home = path.join(drive, 'Users', u)
        try {
          if (!fsSync.statSync(home).isDirectory()) continue
        } catch (_) {
          continue
        }
        for (const sub of userRoots) add(path.join(home, ...sub))
      }
    } catch (_) {}
    // 系统级常见根
    for (const p of ['C:\\Python', 'C:\\tools', 'C:\\opt', 'C:\\sdk', 'C:\\env', 'C:\\green', 'C:\\software']) {
      add(p)
    }
  } else {
    // 非系统盘直接以盘根为起点（深度受限，避免扫到网络挂载大目录）
    add(drive)
  }
  return [...roots]
}

// 异步深度优先搜索：在 root 下查找任意一个标志文件（markers 中的文件名）
// depth 控制递归深度；guard 为全局条目计数器，超过上限即放弃（防止卡死）
async function findMarker(root, markerNames, depth, guard) {
  if (depth < 0 || guard.count > guard.limit) return null
  let entries
  try {
    entries = await fs.readdir(root, { withFileTypes: true })
  } catch (_) {
    return null // 无权限或目录不存在
  }
  // 1) 先在当前目录直接匹配文件
  for (const e of entries) {
    guard.count++
    if (e.isFile() && markerNames.has(e.name.toLowerCase())) {
      return path.join(root, e.name)
    }
  }
  // 2) 再递归进入子目录
  if (depth > 0) {
    for (const e of entries) {
      if (e.isDirectory()) {
        const found = await findMarker(
          path.join(root, e.name),
          markerNames,
          depth - 1,
          guard
        )
        if (found) return found
        if (guard.count > guard.limit) return null
      }
    }
  }
  return null
}

// 根据命中文件的全路径与相对标记，反推出“安装根目录（HOME）”
// 例：marker='bin/java.exe' 命中于 C:\Program Files\Java\jdk-17\bin\java.exe
//     -> 回退一级得到 C:\Program Files\Java\jdk-17
function resolveHomeFromMarker(markerFullPath, markerRelList) {
  const lower = markerFullPath.toLowerCase().replace(/\//g, '\\')
  // 找到匹配的相对标记
  const rel = (markerRelList || []).find((m) =>
    lower.endsWith('\\' + m.toLowerCase().replace(/\//g, '\\'))
  )
  let dir = path.dirname(markerFullPath)
  if (rel) {
    // 相对标记里斜杠数量 = 需要向上回退的层级（bin/java.exe -> 回退 1 级）
    const ups = (rel.match(/[\/\\]/g) || []).length
    for (let i = 0; i < ups; i++) dir = path.dirname(dir)
  }
  return dir
}

// 全盘盘符扫描：在所有盘的候选根下查找标志文件
// 返回命中文件的完整路径，未找到返回 null
async function scanAllDrives(markers) {
  if (!markers || !markers.length) return null
  const markerNames = new Set(markers.map((m) => m.toLowerCase().replace(/\//g, '\\').split('\\').pop()))
  const guard = { count: 0, limit: 120000 } // 全局扫描条目上限，超出即放弃
  const drives = getLogicalDrives()
  for (const drive of drives) {
    const roots = candidateRootsForDrive(drive)
    // 不同候选根给予不同扫描深度：Program Files/自定义目录较深，用户目录较浅
    // 扁平目录（别名/脚本目录）浅扫即可；其余（Program Files、Programs、scoop/apps 等）深扫
    const depthOf = (r) =>
      /WindowsApps|miniconda3|anaconda3|Miniconda3|scoop[\\/]shims|\.cargo[\\/]bin|go[\\/]bin/i.test(r)
        ? 2
        : 4
    for (const r of roots) {
      const hit = await findMarker(r, markerNames, depthOf(r), guard)
      if (hit) return hit
      if (guard.count > guard.limit) return null
    }
  }
  return null
}

// ===== IPC: check-env 检测软件是否已安装 =====
// 两阶段检测：
//   1) 命令探测：执行 `<check> -version`，若命中说明已加入 PATH（最快）；
//      并尝试 `where <check>` 定位真实安装目录 HOME。
//   2) 全盘盘符扫描：当命令不在 PATH 时，遍历所有本地磁盘的候选安装目录，
//      查找工具的标志文件（如 bin/java.exe），命中即视为已安装并定位 HOME。
// 返回 { installed, output, path, via }
ipcMain.handle('check-env', async (_event, payload) => {
  // 兼容旧调用：直接传字符串 id
  const id = typeof payload === 'string' ? payload : payload?.id
  const check = typeof payload === 'string' ? null : payload?.check || null
  const markers = (typeof payload === 'object' && Array.isArray(payload?.markers) ? payload.markers : null)

  let home = null
  let via = null
  let output = ''
  let exePath = null
  let regVersion = null

  // —— 阶段 0：应用自身安装目录优先检测 ——
  // 本应用会把绿色包/zip 装到 %USERPROFILE%\.env-tools\<base>\<版本>\ 下。
  // 这类目录既不在 PATH（初次配置前/未重启进程时）、也没有注册表卸载项，
  // 若不专门检查，就会出现「明明装好了却显示未安装」。此处优先按已知路径判定。
  if (!home) {
    const candidates = []
    const pushDir = (d) => {
      if (d && !candidates.includes(d)) candidates.push(d)
    }
    if (payload && typeof payload === 'object') {
      pushDir(payload.installPath) // 前端记录的“安装到”路径（安装后即真实家目录）
      const baseHint = payload.base || canonicalToolKey(id, payload.name)
      pushDir(path.join(os.homedir(), '.env-tools', String(baseHint)))
    }
    pushDir(path.join(os.homedir(), '.env-tools'))

    const markerList = markers || []
    const exts = ['.exe', '.cmd', '.bat', '.ps1', '']
    const subdirs = ['bin', 'Scripts', ''] // 常见可执行目录
    for (const dir of candidates) {
      try {
        if (!fsSync.existsSync(dir)) continue
      } catch (_) {
        continue
      }
      let hitPath = null
      // a) 直接按 markers 的相对路径命中（如 bin/mvn.cmd）
      for (const m of markerList) {
        const p = path.join(dir, m.replace(/\//g, '\\'))
        if (fsSync.existsSync(p)) {
          hitPath = p
          break
        }
      }
      // b) 按命令名在 bin/ Scripts/ 根目录下尝试常见后缀
      if (!hitPath && check) {
        for (const sub of subdirs) {
          for (const ext of exts) {
            const p = path.join(dir, sub, check + ext)
            if (fsSync.existsSync(p)) {
              hitPath = p
              break
            }
          }
          if (hitPath) break
        }
      }
      if (hitPath) {
        home = resolveHomeFromMarker(
          hitPath,
          markerList.length ? markerList : [`${check}.exe`]
        )
        via = 'workspace'
        output = `应用安装目录检测到: ${hitPath}`
        break
      }
    }

    // c) 兜底：在 ~/.env-tools 内有界递归查找标志文件。
    //    覆盖“应用重启后前端 installPath 只算到 base 层（缺版本子目录）”的情况。
    //    搜索顺序优先 <base> 子目录，避免优先命中工作空间根目录下的历史残留副本。
    if (!home && markerList.length) {
      const markerNames = new Set(
        markerList.map((m) => m.toLowerCase().replace(/\//g, '\\').split('\\').pop())
      )
      const wsRoot = path.join(os.homedir(), '.env-tools')
      const baseHint = payload?.base || canonicalToolKey(id, payload?.name)
      const searchRoots = [path.join(wsRoot, String(baseHint)), wsRoot]
      for (const root of searchRoots) {
        const hit = await findMarker(root, markerNames, 5, { count: 0, limit: 20000 })
        if (hit) {
          home = resolveHomeFromMarker(hit, markerList)
          via = 'workspace'
          output = `应用安装目录检测到: ${hit}`
          break
        }
      }
    }
  }

  // —— 阶段 1：PATH 探测（最快，命令是否在环境变量中）——
  if (check) {
    exePath = await detectViaWhere(check)
    if (exePath) {
      home = resolveHomeFromMarker(exePath, markers || [`${check}.exe`])
      via = 'path'
      output = `PATH 中检测到: ${exePath}`
    }
  }

  // —— 阶段 2：Windows 注册表卸载项探测（最可靠，独立于 PATH）——
  try {
    const reg = await getInstalledSoftware()
    // 前端传的 id 可能是 'python-python' / 'database-mysql' 等，先归一化为注册表关键词 key
    const hit = matchRegistry(canonicalToolKey(id, payload?.name), reg)
    if (hit) {
      regVersion = hit.version || null
      if (hit.location) {
        home = hit.location
        via = 'registry'
        output = `注册表检测到: ${hit.name}`
      } else if (!home) {
        // 仅名称命中、无安装路径：仍判定已安装，但路径未知
        via = via || 'registry'
        output = `注册表检测到: ${hit.name}（无安装路径）`
      }
    }
  } catch (_) {
    /* 注册表不可用则跳过 */
  }

  // —— 阶段 3：全盘盘符扫描（不依赖 PATH/注册表，兜底）——
  if (!home && markers && markers.length) {
    const hit = await scanAllDrives(markers)
    if (hit) {
      home = resolveHomeFromMarker(hit, markers)
      via = 'disk'
      output = `全盘扫描命中: ${hit}`
    }
  }

  if (!home) {
    return {
      installed: false,
      output: '未检测到（PATH / 注册表 / 全盘扫描均未命中）',
      path: undefined,
      via: null,
      version: null,
    }
  }

  // 版本号：优先从可执行文件 --version 解析，其次用注册表 DisplayVersion
  let version = null
  if (exePath) version = await getVersion(check, exePath)
  if (!version && regVersion) version = regVersion

  return { installed: true, output, path: home, via, version: version || null }
})

// ===== IPC: get-versions 从官网实时获取版本列表 =====
// 返回 { ok: true, versions: [{ version, url }] }；抓取失败返回 { ok: false, error }，
// 由前端捕获后沿用内置默认版本列表（并打印「官网版本获取失败」日志）。
ipcMain.handle('get-versions', async (_event, payload = {}) => {
  const { id, name } = payload
  try {
    const versions = await fetchVersions(id, name)
    return { ok: true, versions }
  } catch (e) {
    return { ok: false, error: e.message }
  }
})

// ===== 字节数格式化（用于日志展示）=====
function formatBytes(bytes) {
  if (!bytes) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  return `${(bytes / Math.pow(1024, i)).toFixed(2)} ${units[i]}`
}

// 真实下载 + 解压：axios 流式下载 + adm-zip 解压
async function realInstall({ name, downloadUrl, targetPath, version, send }) {
  send('log-message', `[${name}] 开始下载: ${downloadUrl}`)

  // 先下载到系统临时目录，避免中途失败污染目标路径
  const tmpDir = path.join(app.getPath('temp'), 'lanyangyang', String(name))
  await fs.mkdir(tmpDir, { recursive: true })

  // 从 URL 推断文件名（兼容带查询参数 / 非法字符的情况）
  let fileName = `${name}.zip`
  try {
    const u = new URL(downloadUrl)
    const base = path.basename(u.pathname)
    if (base) fileName = base
  } catch (_) {
    // URL 解析失败时回退到默认文件名
  }
  const tmpFile = path.join(tmpDir, fileName)

  // 发起流式下载，按数据块累计字节实时计算并回传进度
  const response = await axios({
    method: 'GET',
    url: downloadUrl,
    responseType: 'stream',
  })
  const total = Number(response.headers['content-length']) || 0
  let loaded = 0
  await new Promise((resolve, reject) => {
    const writer = createWriteStream(tmpFile)
    response.data.on('data', (chunk) => {
      loaded += chunk.length
      // content-length 存在时计算百分比，否则回传已下载字节数供前端展示
      const progress = total > 0 ? Math.floor((loaded / total) * 100) : 0
      send('download-progress', { name, progress, loaded, total })
    })
    response.data.on('error', reject)
    writer.on('error', reject)
    writer.on('finish', resolve)
    response.data.pipe(writer)
  })

  send('log-message', `[${name}] 下载完成（${formatBytes(loaded)}），保存到 ${tmpFile}`)
  send('download-progress', { name, progress: 100, loaded, total })

  // 解压：.zip 用 adm-zip 解压；其它格式（如 .exe/.msi）直接移动到目标路径
  await fs.mkdir(targetPath, { recursive: true })
  let realHome = targetPath
  if (fileName.toLowerCase().endsWith('.zip')) {
    send('log-message', `[${name}] 正在解压 ...`)
    const zip = new AdmZip(tmpFile)
    zip.extractAllTo(targetPath, true) // true = 覆盖已存在文件
    // 官方压缩包几乎都含唯一顶层目录（如 apache-maven-3.10.0/），
    // 真正的“安装家目录”是它；扁平解压（无顶层目录/多个目录）则回退到 targetPath
    const entries = await fs.readdir(targetPath, { withFileTypes: true }).catch(() => [])
    const dirs = entries.filter((e) => e.isDirectory()).map((e) => e.name)
    if (dirs.length === 1) realHome = path.join(targetPath, dirs[0])
    send('log-message', `[${name}] 解压完成，已安装到 ${realHome}`)
  } else {
    const dest = path.join(targetPath, fileName)
    await fs.rename(tmpFile, dest)
    realHome = targetPath
    send('log-message', `[${name}] 已保存到 ${dest}`)
  }

  // 写入安装标记文件，便于后续检测/卸载
  await fs.writeFile(
    path.join(realHome, 'installed.json'),
    JSON.stringify({ name, version, installedAt: new Date().toISOString() }, null, 2)
  )

  // 清理临时目录
  await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {})
  return realHome
}

// 本地模拟安装（网络不可用时兜底，保证 UI 可演示）
async function simulateInstall({ name, targetPath, send }) {
  for (let progress = 0; progress <= 100; progress += 10) {
    await sleep(250)
    send('download-progress', { name, progress })
    if (progress < 100) send('log-message', `[${name}] 下载进度 ${progress}%`)
  }
  try {
    await fs.mkdir(targetPath, { recursive: true })
    await fs.writeFile(
      path.join(targetPath, 'installed.json'),
      JSON.stringify({ name, simulated: true, installedAt: new Date().toISOString() }, null, 2)
    )
  } catch (err) {
    send('log-message', `[${name}] 写入目标路径失败: ${err.message}`)
  }
  send('log-message', `[${name}] 解压完成（模拟），已安装到 ${targetPath}`)
  send('download-progress', { name, progress: 100 })
  return targetPath
}

// ===== IPC: run-install 下载并安装 =====
// 接收 { name, downloadUrl, targetPath, version }
// 优先走真实下载+解压；若失败（如示例占位地址不可达）则本地模拟兜底
ipcMain.handle('run-install', async (event, payload) => {
  const { name, downloadUrl, targetPath, version } = payload

  // 取出触发本次调用的渲染进程窗口，用于回传实时状态
  const win = BrowserWindow.fromWebContents(event.sender)
  const send = (channel, data) => {
    if (win && !win.isDestroyed()) win.webContents.send(channel, data)
  }

  try {
    const realHome = await realInstall({ name, downloadUrl, targetPath, version, send })
    return { success: true, path: realHome }
  } catch (err) {
    send('log-message', `[${name}] 真实下载失败（${err.message}），启用本地模拟流程`)
    const simHome = await simulateInstall({ name, targetPath, send })
    return { success: true, path: simHome, simulated: true }
  }
})

// 工具 id -> 环境变量名(envName) + 需加入 Path 的子目录(bin)
const ENV_MAP = {
  jdk: { envName: 'JAVA_HOME', bin: 'bin' },
  maven: { envName: 'MAVEN_HOME', bin: 'bin' },
  nodejs: { envName: null, bin: '' },
  pnpm: { envName: null, bin: '' },
  python: { envName: null, bin: 'Scripts' },
  miniconda: { envName: 'CONDA_HOME', bin: 'Scripts' },
  mysql: { envName: null, bin: 'bin' },
  redis: { envName: null, bin: '' },
  hadoop: { envName: 'HADOOP_HOME', bin: 'bin' },
  kafka: { envName: null, bin: 'bin' },
}

// ===== IPC: get-default-workspace 返回默认安装根目录 =====
// 默认落在当前用户目录下：C:\Users\<用户名>\.env-tools
ipcMain.handle('get-default-workspace', async () => {
  return path.join(os.homedir(), '.env-tools')
})

// ===== IPC: get-device-info 取本机标识，用于环境报告的设备名 =====
// 渲染进程没有 node:os，只能通过这里拿
ipcMain.handle('get-device-info', async () => {
  return {
    hostname: os.hostname(),
    platform: os.platform(),
    release: os.release(),
    arch: os.arch(),
    version: typeof os.version === 'function' ? os.version() : '',
    electron: process.versions.electron,
    app: app.getVersion(),
  }
})

// ===== IPC: save-report 导出环境报告为 JSON =====
// 用系统「另存为」对话框由用户选路径，避免静默写盘
ipcMain.handle('save-report', async (_event, payload) => {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const { canceled, filePath } = await dialog.showSaveDialog({
    title: '导出环境报告',
    defaultPath: `lanyangyang-report-${stamp}.json`,
    filters: [{ name: 'JSON', extensions: ['json'] }],
  })
  if (canceled || !filePath) return { success: false, canceled: true }
  try {
    await fs.writeFile(filePath, JSON.stringify(payload, null, 2), 'utf8')
    return { success: true, path: filePath }
  } catch (e) {
    return { success: false, error: e.message }
  }
})

// ===== IPC: config-env 一键配置环境变量（当前用户，HKCU，无需管理员）=====
ipcMain.handle('config-env', async (event, payload) => {
  const { id, name, installPath } = payload

  // 取出触发本次调用的渲染进程窗口，用于回传实时日志
  const win = BrowserWindow.fromWebContents(event.sender)
  const send = (channel, data) => {
    if (win && !win.isDestroyed()) win.webContents.send(channel, data)
  }

  if (process.platform !== 'win32') {
    send('log-message', `当前系统（${process.platform}）暂不支持自动配置环境变量`)
    return { success: false, error: 'unsupported platform' }
  }

  // —— 路径有效性校验（核心修复点）——
  // 旧逻辑直接使用前端传来的 installPath，当工作空间为占位值
  // （如 C:\Users\xxx\.env-tools）或目录不存在时，会把环境变量配到一个无效路径。
  // 这里要求路径必须存在，否则明确报错，避免“静默配错”。
  const PLACEHOLDER = /\\xxx\\/i // 占位用户名保护
  if (!installPath || PLACEHOLDER.test(installPath) || !fsSync.existsSync(installPath)) {
    const reason = !installPath
      ? '未提供安装路径'
      : PLACEHOLDER.test(installPath)
        ? '工作空间仍是占位路径（请在顶部设置正确的工作空间）'
        : `安装目录不存在: ${installPath}`
    send('log-message', `[${name}] 配置失败：${reason}`)
    return { success: false, error: reason }
  }

  // env 规则优先使用后端下发的 payload.env（{ name, bin }），
  // 未下发时回退到内置 ENV_MAP（兼容旧版前端），都没有则只追加 Path
  const map = payload.env && typeof payload.env === 'object' ? payload.env : ENV_MAP[id] || {}
  try {
    // 1) 设置 HOME 类变量（如 JAVA_HOME）。兼容新旧字段名 name / envName
    const envName = map.name || map.envName
    if (envName) {
      await env.setEnvVariable(envName, installPath)
      const ok = await env.verifyEnv(envName, installPath)
      if (!ok) throw new Error(`${envName} 写入后校验失败，可能被其它程序占用`)
      send('log-message', `[${name}] 已设置 ${envName} = ${installPath}`)
    }
    // 2) 将可执行目录追加到 Path（内部自动防重复）
    //    map.bin: 'bin' -> 追加 <安装目录>/bin
    //    map.bin: ''     -> 追加 <安装目录>（可执行文件在根目录，如 redis/kubectl/pnpm）
    //    map.bin: null   -> 不写入 Path（如 IDE 安装器、Docker）
    if (map.bin === null) {
      send('log-message', `[${name}] 无需写入 Path（可执行文件由安装器自行处理）`)
    } else {
      const binPath = map.bin ? path.join(installPath, map.bin) : installPath
      const added = await env.appendToPath(binPath)
      const ok = !added || (await env.verifyEnv('Path', binPath))
      if (!ok) throw new Error('Path 追加后校验失败')
      send(
        'log-message',
        added
          ? `[${name}] 已追加 ${binPath} 到 Path`
          : `[${name}] ${binPath} 已在 Path 中，已跳过`
      )
    }
    // 3) 广播变更，使新进程立即生效
    await env.broadcastEnvChange()
    send('log-message', `[${name}] 环境变量已配置，重启终端后完全生效`)
    return { success: true }
  } catch (e) {
    send('log-message', `[${name}] 配置环境变量失败: ${e.message}`)
    return { success: false, error: e.message }
  }
})

app.whenReady().then(createWindow)

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
