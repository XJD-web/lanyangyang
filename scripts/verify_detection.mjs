// 独立验证脚本：在真实 Windows 上验证「注册表 + where」检测逻辑是否能找到已装软件
// 仅用于本地验证，不属于应用运行时代码
import { execSync, exec } from 'node:child_process'
import { promisify } from 'node:util'

const execAsync = promisify(exec)

const REG_KEYWORDS = {
  jdk: ['Java(TM) SE Development Kit', 'Java SE Development Kit', 'JDK', 'OpenJDK'],
  maven: ['Maven'],
  gradle: ['Gradle'],
  python: ['Python'],
  miniconda: ['Miniconda', 'Anaconda'],
  nodejs: ['Node.js'],
  pnpm: ['pnpm'],
  yarn: ['Yarn'],
  mysql: ['MySQL'],
  redis: ['Redis'],
  mongodb: ['MongoDB'],
  docker: ['Docker Desktop'],
  kubectl: ['Kubernetes CLI', 'kubectl'],
  nginx: ['nginx'],
  rabbitmq: ['RabbitMQ'],
  git: ['Git'],
  cmake: ['CMake'],
  vscode: ['Visual Studio Code'],
}
const REG_EXCLUDE = {
  python: ['launcher'],
  git: ['hub', 'desktop', 'credential', 'lfs', 'timeline', 'extensions'],
  jdk: ['auto updater', 'updater'],
  mongodb: ['compass'],
}

function runRegQuery(root) {
  try {
    return execSync(`reg query "${root}" /s`, { encoding: 'utf8', windowsHide: true, timeout: 15000 })
  } catch (_) {
    return ''
  }
}
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
async function detectViaWhere(check) {
  try {
    const { stdout } = await execAsync(`where ${check} 2>&1`, { timeout: 5000 })
    const first = (stdout || '').split('\n').map((s) => s.trim()).filter(Boolean)[0]
    if (first && /\.(exe|cmd|bat|ps1|jar)$/i.test(first)) return first
    if (first) return first
  } catch (_) {}
  return null
}

async function main() {
  console.log('=== 读取注册表卸载项 ===')
  const roots = [
    'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
    'HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
    'HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
  ]
  let all = []
  for (const r of roots) all = all.concat(parseUninstall(runRegQuery(r)))
  console.log(`共解析到 ${all.length} 个已安装软件条目\n`)

  console.log('=== 逐工具检测（注册表 + PATH）===')
  const ids = Object.keys(REG_KEYWORDS)
  for (const id of ids) {
    const hit = matchRegistry(id, all)
    const where = await detectViaWhere(whereCmd(id))
    const whereStr = where ? `where: ${where}` : 'where: (不在PATH)'
    if (hit) {
      console.log(`✅ ${id.padEnd(10)} 注册表: ${hit.name} | 版本 ${hit.version || '?'} | 路径 ${hit.location || '(无)'}`)
      console.log(`           ${whereStr}`)
    } else {
      console.log(`○ ${id.padEnd(10)} 注册表未命中 | ${whereStr}`)
    }
  }
}

// 仅对常见命令做 where 验证（与前端 check 字段对应）
function whereCmd(id) {
  const map = {
    jdk: 'java', maven: 'mvn', gradle: 'gradle', python: 'python',
    miniconda: 'conda', nodejs: 'node', pnpm: 'pnpm', yarn: 'yarn',
    mysql: 'mysql', redis: 'redis-server', mongodb: 'mongod', docker: 'docker',
    kubectl: 'kubectl', nginx: 'nginx', rabbitmq: 'rabbitmqctl', git: 'git',
    cmake: 'cmake', vscode: 'code',
  }
  return map[id] || null
}

main().catch((e) => console.error(e))
