<script setup>
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { ElMessage } from 'element-plus'
import { InfoFilled, FolderOpened, Search, DataAnalysis } from '@element-plus/icons-vue'
import axios from 'axios'
import ToolCard from './components/ToolCard.vue'
import LogConsole from './components/LogConsole.vue'
import EnvReport from './components/EnvReport.vue'
import { categories, fallbackTools } from './data/tools.js'
import { apiUrl } from './api.js'

// ===== 顶部状态 =====
// 当前工作空间（安装根目录）。默认空，挂载时由主进程解析为
// 真实用户目录 C:\Users\<用户名>\.env-tools（修复旧版占位路径 C:\Users\xxx\... 导致配置失败）
const workspace = ref('')

// 本地偏好记忆（对齐 vfaner/murig 的“记住上次选择”）：工作空间 + 各工具上次选的版本
const LS_WS = 'lyy_workspace'
const LS_VER = 'lyy_versions'
function loadSavedVersions() {
  try {
    return JSON.parse(localStorage.getItem(LS_VER) || '{}')
  } catch (_) {
    return {}
  }
}
function saveVersion(id, version) {
  const m = loadSavedVersions()
  m[id] = version
  localStorage.setItem(LS_VER, JSON.stringify(m))
}

// 渲染进程无 node:path，这里做一个安全的路径拼接（统一用反斜杠）
function joinPath(a, b) {
  return (a || '').replace(/[\\/]$/, '') + '\\' + (b || '').replace(/^[\\/]/, '')
}

// 把 Vue 响应式对象/数组转成纯 JSON 再通过 IPC 传递。
// 原因：ref/reactive 生成的是 Proxy，contextBridge 与 ipcRenderer 的结构化克隆
// 无法克隆 Proxy，会抛出 "An object could not be cloned."。JSON 往返可彻底剥离响应式。
function toPlain(v) {
  try {
    return JSON.parse(JSON.stringify(v))
  } catch (_) {
    return v
  }
}

// ===== 软件清单 =====
// 默认使用本地静态清单（fallbackTools），挂载时尝试从后端 API 拉取最新列表覆盖
// 用 ref 包裹，保证 API 返回数据后可整体替换并触发响应式更新
// 默认使用本地静态清单（fallbackTools），挂载时尝试从后端 API 拉取最新列表覆盖。
// 用 map 归一化：清除原始数据里可能残留的“已安装”标记与占位路径，
// 避免未安装却显示绿色对钩、或把环境配到 C:\Users\xxx\... 占位目录。
const tools = ref(
  fallbackTools.map((t) => ({
    ...t,
    status: 'notInstalled',
    progress: 0,
    installPath: '',
    env: t.env || null,
    check: t.check || null,
    markers: t.env?.markers || [],
    realPath: false,
  }))
)

// 后端地址统一在 src/api.js 里解析（App 与 EnvReport 共用同一套优先级规则）：
//   localStorage['lyy_api_base'] > 同源相对路径 > VITE_API_BASE > 本地 127.0.0.1:3000

// 是否运行在桌面客户端（Electron）里：浏览器直接打开网页版时没有 electronAPI，
// 安装/检测/配置环境变量这些「操作本机」的能力都不可用，只能浏览清单。
const isDesktop = typeof window !== 'undefined' && !!window.electronAPI

// 在 Electron 里却没拿到 electronAPI，说明 preload 预加载脚本没生效（装坏了 / 缺少文件）。
// 这种情况和「网页版」要区分开，否则用户会以为是正常的网页限制。
const preloadBroken =
  typeof navigator !== 'undefined' && /Electron/i.test(navigator.userAgent) && !isDesktop

// 后端分组 key -> 前端分类 key 的映射
const API_CATEGORY_MAP = {
  java: 'java',
  python: 'python',
  frontend: 'frontend',
  database: 'database',
  bigdata: 'bigdata',
  container: 'container',
  middleware: 'middleware',
  tools: 'tools',
}

// 从后端 /api/softwares 拉取软件清单并渲染到卡片列表
// 接口约定返回结构：{ java: [{ name, version, url, path }], python: [...], ... }
async function loadTools() {
  try {
    const res = await axios.get(apiUrl('/api/softwares'), { timeout: 5000 })
    const grouped = res.data || {}
    const list = []
    for (const [groupKey, items] of Object.entries(grouped)) {
      // 将后端分组（java/python/...）映射到前端分类 key
      const category = API_CATEGORY_MAP[groupKey] || groupKey
      for (const item of items || []) {
        // 安装子目录：后端返回的是相对路径（如 'jdk'），运行时拼接到用户选择的工作空间下，
        // 这样同一份云端清单可适配任意客户机的本地路径（客户端无关）
        const base = item.path || `${groupKey}-${item.name}`
        const downloads = item.downloads || {}
        // 恢复“上次选的版本”（murig 风格偏好记忆）
        const savedVer = loadSavedVersions()[`${groupKey}-${item.name}`.toLowerCase()]
        const defVersion = savedVer || item.version || ''
        list.push({
          id: `${groupKey}-${item.name}`.toLowerCase(),
          name: item.name,
          category,
          base, // 安装子目录（相对工作空间），用于安装/配置时动态拼接真实路径
          desc: item.name,
          status: 'notInstalled', // 默认未安装，安装成功后置为 installed
          versions: item.versions?.length
            ? item.versions
            : item.version
              ? [item.version]
              : [],
          selectedVersion: defVersion,
          installPath: joinPath(workspace.value, base), // 工作空间 + 安装子目录（动态计算）
          downloadUrl: downloads[defVersion] || item.url || '', // 优先按版本取下载地址
          downloads, // 版本 -> 下载地址 映射，供切换版本时使用
          env: item.env || null, // 一键配置环境变量时使用的规则（{ name, bin }），透传给主进程
          check: item.check || null, // 「检测已装环境」的命令行可执行名（如 'java'）
          markers: item.env?.markers || [], // 全盘盘符扫描的标志文件，透传给主进程
          realPath: false, // 标记 installPath 是否已被「安装/检测」写入真实路径
          progress: 0,
        })
      }
    }
    if (list.length) {
      tools.value = list
      appendLog(`已从后端加载 ${list.length} 个软件`)
    } else {
      appendLog('后端返回为空，沿用本地静态清单')
    }
  } catch (e) {
    // 后端未启动/不可达时回退到本地静态清单（不影响使用，工具仍可正常下载安装）。
    // 用「提示」而非「报错」的语气，避免用户误以为程序出错。
    appendLog(
      `未连接后端服务（${e.message}），已使用本地内置清单（${tools.value.length} 个工具）` +
        `；如需 35 个工具的云端清单，请运行 npm run server 或配置 VITE_API_BASE`
    )
  }
}

// 从各官网实时抓取版本列表（对应「正在从各官网获取最新版本列表…」）
// 抓取成功则替换卡片版本下拉框与下载地址映射；失败则保留内置默认列表并打日志。
async function fetchAllVersions() {
  if (!window.electronAPI?.getVersions) return
  appendLog('正在从各官网获取最新版本列表…')
  for (const tool of tools.value) {
    try {
      const res = await window.electronAPI.getVersions({ id: tool.id, name: tool.name })
      if (res?.ok && Array.isArray(res.versions) && res.versions.length) {
        // 版本数组 -> 下拉框选项；同时建立 版本->下载地址 映射
        const downloads = {}
        for (const v of res.versions) downloads[v.version] = v.url
        tool.versions = res.versions.map((v) => v.version)
        tool.downloads = downloads
        // 当前选中版本若不在新列表中，自动切到最新版本
        if (!tool.versions.includes(tool.selectedVersion)) {
          tool.selectedVersion = tool.versions[0]
        }
        appendLog(`[${tool.name}] 已从官网获取 ${res.versions.length} 个版本`)
      } else {
        appendLog(`[${tool.name}] 官网版本获取失败，使用内置默认列表`)
      }
    } catch (e) {
      appendLog(`[${tool.name}] 官网版本获取失败，使用内置默认列表`)
    }
  }
  appendLog('版本列表获取完成。')
}

// ===== 分类 Tab =====
const activeCategory = ref('all')
// 根据当前分类过滤工具列表（全部 = 不过滤）；与上方 Tab 实时联动
const filteredTools = computed(() =>
  activeCategory.value === 'all'
    ? tools.value
    : tools.value.filter((t) => t.category === activeCategory.value)
)

// ===== 关于弹窗 =====
const aboutVisible = ref(false)

// ===== 工作空间选择（调用 Electron 原生文件夹对话框）=====
const handleSelectWorkspace = async () => {
  try {
    if (window.electronAPI && window.electronAPI.selectWorkspace) {
      const path = await window.electronAPI.selectWorkspace()
      if (path) {
        workspace.value = path
        appendLog(`工作空间已切换: ${path}`)
      }
    } else {
      ElMessage.info('请在桌面端（Electron）环境中运行以选择安装路径')
    }
  } catch (e) {
    appendLog(`选择工作空间失败: ${e.message}`)
  }
}

// ===== 运行日志 =====
const logs = ref(['[Lanyangyang] 初始化完成，等待操作 ...'])
function appendLog(line) {
  const time = new Date().toLocaleTimeString('zh-CN', { hour12: false })
  logs.value.push(`[${time}] ${line}`)
}

// ===== 工具操作 =====
// 防重复点击：记录正在安装中的工具 id
const installingIds = new Set()

// 通过 IPC 调用主进程 run-install，并接收实时进度与日志
async function handleInstall(tool) {
  // 网页版没有主进程，无法解压/写环境变量，直接提示改用桌面客户端
  if (!isDesktop) {
    appendLog(`✗ 网页版无法安装 ${tool.name}：安装需要写入本机文件与环境变量，请下载桌面客户端`)
    ElMessage.warning('安装开发环境需读写本机磁盘并修改系统环境变量，请在桌面客户端中操作')
    return
  }
  if (installingIds.has(tool.id)) return
  installingIds.add(tool.id)
  appendLog(`开始下载并安装 ${tool.name}（${tool.selectedVersion}）...`)
  // 安装目标路径：工作空间 + 安装子目录（后端下发的 base，没有则回退到工具 id，
  // 保证每个工具落入自己的工作目录，避免都解压到工作空间根目录互相覆盖）
  const base = tool.base || tool.id
  const targetPath = joinPath(workspace.value, base)
  // 下载地址优先级：当前选中版本对应的地址 > 后端默认地址 > 占位地址（触发主进程模拟兜底）
  const downloadUrl =
    (tool.downloads && tool.downloads[tool.selectedVersion]) ||
    tool.downloadUrl ||
    `https://mirrors.lanyangyang.dev/${tool.id}/${tool.selectedVersion}.zip`
  try {
    const result = await window.electronAPI.runInstall({
      name: tool.name,
      id: tool.id,
      downloadUrl,
      targetPath,
      version: tool.selectedVersion,
    })
    tool.status = 'installed' // 安装成功 -> 状态标签变绿「✓ 已配置」
    tool.progress = 100
    // 关键修复：把真实安装路径回写，供「配置环境变量」使用（旧版未回写，导致配置了占位路径）
    tool.installPath = result.path || targetPath
    tool.realPath = true // 标记这是真实路径，工作空间变更时不再被覆盖
    appendLog(`✓ ${tool.name} 安装完成: ${tool.installPath}`)
  } catch (e) {
    appendLog(`✗ ${tool.name} 安装失败: ${e.message}`)
  } finally {
    installingIds.delete(tool.id)
  }
}

// 通过 IPC 调用 check-env，批量检测已安装的开发环境
// 检测分两阶段：① 命令是否在 PATH 中；② 全盘盘符扫描标志文件（不依赖 PATH）
async function handleDetectEnv() {
  // 网页版无法读取本机 PATH / 注册表 / 磁盘，检测能力仅在桌面端可用
  if (!isDesktop) {
    ElMessage.warning('环境检测需要读取本机 PATH 与磁盘，请在桌面客户端中操作')
    return
  }
  appendLog('开始检测已安装的开发环境（含全盘盘符扫描）...')
  // 防御：即使 electronAPI 存在但缺 checkEnv（preload 版本不匹配），也只报一次错，
  // 避免像以前那样 30 多个工具逐个抛「Cannot read properties of undefined」
  if (typeof window.electronAPI?.checkEnv !== 'function') {
    appendLog('✗ 检测不可用：客户端缺少环境检测接口，请重新安装最新版客户端')
    ElMessage.error('客户端环境检测接口缺失，请重新下载安装')
    return
  }
  for (const tool of tools.value) {
    try {
      if (typeof window.electronAPI?.checkEnv !== 'function') {
        appendLog('✗ 检测中断：环境检测接口不可用')
        break
      }
      // 注意：必须用 toPlain 剥离响应式，否则 markers（Proxy 数组）无法通过 IPC 克隆
      const res = await window.electronAPI.checkEnv(
        toPlain({
          id: tool.id,
          name: tool.name,
          check: tool.check,
          markers: tool.markers,
          // 传入已知安装目录，主进程可优先在其中找 bin/<cmd>，避免“自己装的却检测不到”
          installPath: tool.installPath,
          base: tool.base || tool.id,
        })
      )
      if (res.installed) {
        tool.status = 'installed'
        tool.progress = 100
        // 记录检测到的真实已装版本，便于卡片展示
        tool.installedVersion = res.version || null
        // 记录检测来源（path/registry/workspace/disk），环境报告里要展示
        tool.via = res.via || ''
        // 若扫描到了真实安装目录，则用它覆盖默认的安装路径（便于后续一键配置环境变量）
        if (res.path) {
          tool.installPath = res.path.replace(/\//g, '\\')
          tool.realPath = true // 标记这是真实路径，工作空间变更时不再被覆盖
        }
        const viaText =
          res.via === 'path'
            ? '（PATH 中检测到）'
            : res.via === 'registry'
              ? '（注册表检测到）'
              : res.via === 'workspace'
                ? '（应用安装目录检测到）'
                : '（全盘扫描命中）'
        const verText = res.version ? ` v${res.version}` : ''
        appendLog(`✓ ${tool.name} 已安装${viaText}${verText}: ${res.path || (res.output || '').split('\n')[0]}`)
      } else {
        tool.status = 'notInstalled'
        tool.progress = 0
        appendLog(`○ ${tool.name} 未检测到`)
      }
    } catch (e) {
      appendLog(`检测 ${tool.name} 失败: ${e.message}`)
    }
  }
  appendLog('环境检测完成')
  // 检测完顺手把结果同步到云端：桌面端负责「检测」，网页端只负责「展示」。
  // 这是浏览器沙箱限制下唯一可行的做法——本机的事只在本机做。
  await uploadReport()
}

// ===== 环境报告 =====
// 当前显示的报告弹窗
const reportVisible = ref(false)

// 把当前检测结果整理成报告对象（可上传、可导出为 JSON）
async function buildReport() {
  // 设备信息只能从主进程拿（渲染进程没有 node:os）
  let info = {}
  try {
    info = (await window.electronAPI?.getDeviceInfo?.()) || {}
  } catch (_) {
    info = {}
  }
  const list = tools.value
  return {
    // 拿不到主机名时退回一句可读的标识，避免报告里出现空设备名
    device: info.hostname || 'unknown-device',
    os: [info.platform, info.release, info.arch].filter(Boolean).join(' '),
    workspace: workspace.value || '',
    client: info.app || '0.1.0',
    createdAt: new Date().toISOString(),
    tools: list.map((t) => ({
      id: t.id,
      name: t.name,
      category: t.category,
      installed: t.status === 'installed',
      version: t.installedVersion || '',
      path: t.realPath ? t.installPath : '',
      via: t.via || '',
    })),
  }
}

// 上传报告：失败只写日志，绝不打断本机使用
async function uploadReport() {
  if (!isDesktop) return
  try {
    const report = await buildReport()
    await axios.post(apiUrl('/api/reports'), toPlain(report), { timeout: 15000 })
    const done = report.tools.filter((t) => t.installed).length
    appendLog(`环境报告已上传（${done}/${report.tools.length}），可在「环境报告」中查看`)
  } catch (e) {
    appendLog(`○ 环境报告上传失败（不影响本机使用）: ${e.message}`)
  }
}

// 导出为 JSON 文件（弹系统另存为），便于在没有网络的机器之间传递
async function handleExportReport() {
  if (!isDesktop) {
    ElMessage.warning('导出报告需要调用本机文件系统，请在桌面客户端中操作')
    return
  }
  try {
    const report = await buildReport()
    const res = await window.electronAPI.saveReport(toPlain(report))
    if (res && res.success) {
      appendLog(`环境报告已导出：${res.path}`)
      ElMessage.success('报告已导出')
    } else if (res && !res.canceled) {
      ElMessage.error(res.error || '导出失败')
    }
  } catch (e) {
    ElMessage.error(`导出失败：${e.message}`)
  }
}

// 通过 IPC 调用 config-env，一键写入用户环境变量（含 Path 防重复追加）
function handleConfig(tool) {
  // 写环境变量属于本机操作，网页版没有权限通道
  if (!isDesktop) {
    ElMessage.warning('配置环境变量需修改本机注册表，请在桌面客户端中操作')
    return
  }
  // 动态计算真实安装路径：已安装/已检测（realPath=true）则直接用记录的真实路径；
  // 否则按「工作空间 + 安装子目录」动态拼接（base 缺失时回退到工具 id）。
  // 前端提前拦截占位/空路径（含 \xxx\ 占位用户名），避免把环境变量配到无效目录。
  const targetPath = tool.realPath
    ? tool.installPath
    : joinPath(workspace.value, tool.base || tool.id)
  // 前端提前拦截：占位路径 / 空路径 直接提示，避免把环境变量配到无效目录
  if (!targetPath || /\\xxx\\/i.test(targetPath)) {
    ElMessage.warning(`请先设置正确的工作空间，或先安装/检测 ${tool.name}`)
    appendLog(`✗ ${tool.name} 配置取消：安装路径无效（${targetPath || '空'}）`)
    return
  }
  appendLog(`正在为 ${tool.name} 配置环境变量（路径: ${targetPath}）...`)
  // env 规则由后端下发（{ name, bin }），主进程据此设置变量并追加 Path。
  // 用 toPlain 剥离响应式，避免 env（Proxy 对象）通过 IPC 时报 "An object could not be cloned."
  window.electronAPI
    .configEnv(
      toPlain({ id: tool.id, name: tool.name, installPath: targetPath, env: tool.env })
    )
    .then((res) => {
      if (res?.success) appendLog(`✓ ${tool.name} 环境变量配置完成`)
      else appendLog(`✗ ${tool.name} 环境变量配置失败：${res?.error || '未知错误'}`)
    })
    .catch((e) => appendLog(`✗ ${tool.name} 配置异常: ${e.message}`))
}

// 版本下拉切换：记忆“上次选的版本”（murig 风格）
function handleVersionChange({ tool, version }) {
  saveVersion(tool.id, version)
}

// ===== 注册主进程 -> 渲染进程的实时事件监听 =====
let offProgress, offLog
onMounted(() => {
  // 先注册事件监听，避免漏掉早期推送。
  // 用可选链：万一 preload 未加载（window.electronAPI 不存在），也不要让整个 onMounted 抛错，
  // 否则后续的清单加载/版本抓取都会被中断（浏览器里预览时尤其明显）。
  // 下载进度事件：根据软件名找到对应卡片并更新其 el-progress 进度条
  offProgress = window.electronAPI?.onDownloadProgress?.((data) => {
    const t = tools.value.find((x) => x.name === data.name)
    if (t) {
      t.progress = data.progress
      // 记录已下载/总字节数，供卡片显示「42.7 MB / 231.5 MB」
      if (typeof data.loaded === 'number') t.loaded = data.loaded
      if (typeof data.total === 'number') t.total = data.total
    }
  })
  // 日志事件：追加到底部运行日志控制台，组件自动滚动到底部
  offLog = window.electronAPI?.onLogMessage?.((text) => appendLog(text))

  // 先把工作空间解析为真实用户目录（默认 C:\Users\<用户名>\.env-tools），
  // 再加载清单（清单里的 installPath 依赖工作空间，必须先于 loadTools 确定）
  ;(async () => {
    try {
      const saved = localStorage.getItem(LS_WS)
      if (saved) {
        workspace.value = saved
      } else if (window.electronAPI?.getDefaultWorkspace) {
        workspace.value = await window.electronAPI.getDefaultWorkspace()
      } else {
        // 网页版拿不到本机真实目录：用 ~ 作为展示占位，
        // 否则 joinPath('', 'jdk') 会拼出「:\jdk」这种残缺路径
        workspace.value = '~\\.env-tools'
      }
    } catch (_) {
      /* 解析失败时退回空，交由用户手动选择 */
    }
    await loadTools()
    fetchAllVersions()
  })()
  // 支持 #report 深链：直接打开环境报告（方便把链接发给别人看某台机器的环境）
  if (typeof location !== 'undefined' && location.hash === '#report') {
    reportVisible.value = true
  }
})
onUnmounted(() => {
  // 组件卸载时移除监听，避免内存泄漏 / 重复回调
  offProgress && offProgress()
  offLog && offLog()
})

// 工作空间变化：持久化，并刷新尚未安装/检测的工具的安装路径（动态路径，避免陈旧）
watch(workspace, (ws) => {
  localStorage.setItem(LS_WS, ws || '')
  for (const t of tools.value) {
    // 仅当该工具尚未被「安装/检测」写入真实路径时，才随工作空间重算
    if (!t.realPath) t.installPath = joinPath(ws, t.base)
  }
})
</script>

<template>
  <div class="app">
    <!-- 客户端 preload 失效：和网页版不是一回事，必须显式报错，否则用户只会看到「功能都用不了」 -->
    <div v-if="preloadBroken" class="web-tip web-tip--error">
      <span class="web-tip-icon">⚠️</span>
      <span class="web-tip-text">
        客户端<strong>预加载脚本未生效</strong>，安装/检测/配置环境变量无法使用。
        请重新下载安装以修复。
      </span>
      <a class="web-tip-btn" href="/download/Lanyangyang-Setup-0.1.0.exe">重新下载</a>
    </div>
    <!-- 网页版提示：浏览器里没有 Electron 主进程，安装/检测/配环境变量都用不了 -->
    <div v-else-if="!isDesktop" class="web-tip">
      <span class="web-tip-icon">🌐</span>
      <span class="web-tip-text">
        当前是<strong>网页版</strong>，可浏览全部软件与版本清单；
        <strong>安装 / 检测 / 配置环境变量</strong>需要下载桌面客户端在本机执行。
      </span>
      <a class="web-tip-btn" href="/download/Lanyangyang-Setup-0.1.0.exe">下载桌面版</a>
    </div>
    <!-- 顶部栏：左侧标题，右侧 关于 / 工作空间 -->
    <header class="app-header">
      <div class="brand">
        <div class="brand-title">Lanyangyang</div>
        <div class="brand-sub">程序员开发环境极速装配工具</div>
      </div>
      <div class="header-actions">
        <el-button text :icon="InfoFilled" @click="aboutVisible = true">
          关于
        </el-button>
        <el-button
          :icon="Search"
          :disabled="!isDesktop"
          :title="isDesktop ? '' : '环境检测需要读取本机 PATH 与磁盘，请使用桌面客户端'"
          @click="handleDetectEnv"
        >
          检测已装环境
        </el-button>
        <el-button :icon="DataAnalysis" @click="reportVisible = true">
          环境报告
        </el-button>
        <el-button :icon="FolderOpened" @click="handleSelectWorkspace">
          工作空间
          <span class="ws-path" :title="workspace">{{ workspace }}</span>
        </el-button>
      </div>
    </header>

    <!-- 分类 Tab 栏（el-radio-group 实现）-->
    <nav class="category-bar">
      <el-radio-group v-model="activeCategory">
        <el-radio-button v-for="c in categories" :key="c.key" :value="c.key">
          {{ c.label }}
        </el-radio-button>
      </el-radio-group>
    </nav>

    <!-- 主体：卡片列表 -->
    <main class="content">
      <div class="card-grid">
        <ToolCard
          v-for="tool in filteredTools"
          :key="tool.id"
          :tool="tool"
          :can-operate="isDesktop"
          @install="handleInstall"
          @config="handleConfig"
          @version-change="handleVersionChange"
        />
      </div>
      <el-empty v-if="filteredTools.length === 0" description="该分类下暂无可安装组件" />
    </main>

    <!-- 底部固定：运行日志控制台 -->
    <LogConsole :logs="logs" />

    <!-- 关于弹窗 -->
    <el-dialog v-model="aboutVisible" title="关于 Lanyangyang" width="420px">
      <p class="about-name"><strong>Lanyangyang</strong></p>
      <p class="about-desc">程序员开发环境极速装配工具</p>
      <p class="about-meta">基于 Electron + Vue3 + Vite + Element Plus 构建</p>
      <p class="about-meta">版本 v0.1.0</p>
    </el-dialog>

    <!-- 环境报告弹窗：桌面端自动上传的结果在这里看，也可导入别人导出的 JSON -->
    <el-dialog v-model="reportVisible" title="环境报告" width="900px" top="6vh">
      <EnvReport :can-delete="isDesktop" />
      <template #footer>
        <el-button v-if="isDesktop" @click="handleExportReport">导出当前检测结果</el-button>
        <el-button type="primary" @click="reportVisible = false">关闭</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.app {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background: #f5f7fa; /* 淡灰色背景 */
}
/* 网页版提示条 */
.web-tip {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 20px;
  background: #fff8e6;
  border-bottom: 1px solid #ffe1a8;
  color: #7a5b00;
  font-size: 13px;
  line-height: 1.5;
}
.web-tip-icon {
  font-size: 15px;
  flex: none;
}
.web-tip-text {
  flex: 1;
}
.web-tip-text strong {
  color: #b26a00;
  font-weight: 600;
}
.web-tip-btn {
  flex: none;
  padding: 5px 14px;
  border-radius: 6px;
  background: #ff9a00;
  color: #fff;
  font-size: 12.5px;
  font-weight: 600;
  text-decoration: none;
}
.web-tip-btn:hover {
  background: #e88b00;
}
/* 客户端 preload 失效：红色警示 */
.web-tip--error {
  background: #fff1f0;
  border-bottom-color: #ffccc7;
  color: #a8071a;
}
.web-tip--error .web-tip-text strong {
  color: #cf1322;
}
.web-tip--error .web-tip-btn {
  background: #cf1322;
}
.web-tip--error .web-tip-btn:hover {
  background: #a8071a;
}

/* 顶部栏 */
.app-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 64px;
  padding: 0 20px;
  background: #fff;
  border-bottom: 1px solid #ebeef5;
}
.brand-title {
  font-size: 20px;
  font-weight: 700;
  color: #303133;
  letter-spacing: 0.5px;
}
.brand-sub {
  font-size: 12px;
  color: #909399;
  margin-top: 2px;
}
.header-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}
.ws-path {
  margin-left: 6px;
  font-size: 12px;
  color: #909399;
  max-width: 220px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
/* 分类 Tab 栏 */
.category-bar {
  display: flex;
  align-items: center;
  padding: 12px 20px;
  background: #fff;
  border-bottom: 1px solid #ebeef5;
}
/* 主体内容区：可滚动 */
.content {
  flex: 1;
  overflow-y: auto;
  padding: 20px;
}
.card-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 16px;
}
/* 关于弹窗内的文字 */
.about-name {
  font-size: 16px;
  color: #303133;
  margin: 0 0 6px;
}
.about-desc {
  color: #606266;
  margin: 0 0 12px;
}
.about-meta {
  color: #909399;
  font-size: 13px;
  margin: 4px 0;
}
</style>
