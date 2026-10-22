// 真实全盘检测验证脚本：复刻 main.js 的扫描函数，在本机逐盘扫描各工具的 marker
import fs from 'node:fs/promises'
import fsSync from 'node:fs'
import path from 'node:path'
import { execSync } from 'node:child_process'
import { softwares } from '../server/softwares.js'

// ============ 以下函数与 electron/main.js 完全一致 ============
function getLogicalDrives() {
  try {
    const out = execSync('wmic logicaldisk where "drivetype=3" get caption', { encoding: 'utf8', windowsHide: true })
    const drives = out.split('\n').map((l) => l.trim().replace(/:$/, ':\\')).filter((l) => /^[A-Z]:\\$/i.test(l))
    if (drives.length) return drives
  } catch (_) {}
  const found = []
  for (const letter of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') {
    const root = `${letter}:\\`
    try { if (fsSync.existsSync(root)) found.push(root) } catch (_) {}
  }
  return found
}

function candidateRootsForDrive(drive) {
  const roots = new Set()
  const add = (p) => { try { if (fsSync.existsSync(p)) roots.add(p) } catch (_) {} }
  add(path.join(drive, 'Program Files'))
  add(path.join(drive, 'Program Files (x86)'))
  for (const c of ['env-tools', 'tools', 'dev', 'opt', 'software', 'sdk', 'apps', 'portapps', 'env', 'green']) add(path.join(drive, c))
  if (/^[Cc]:/i.test(drive)) {
    try {
      for (const u of fsSync.readdirSync(path.join(drive, 'Users'))) {
        const home = path.join(drive, 'Users', u)
        try { if (fsSync.statSync(home).isDirectory()) roots.add(home) } catch (_) {}
      }
    } catch (_) {}
  } else {
    add(drive)
  }
  return [...roots]
}

async function findMarker(root, markerNames, depth, guard) {
  if (depth < 0 || guard.count > guard.limit) return null
  let entries
  try { entries = await fs.readdir(root, { withFileTypes: true }) } catch (_) { return null }
  for (const e of entries) {
    guard.count++
    if (e.isFile() && markerNames.has(e.name.toLowerCase())) return path.join(root, e.name)
  }
  if (depth > 0) {
    for (const e of entries) {
      if (e.isDirectory()) {
        const found = await findMarker(path.join(root, e.name), markerNames, depth - 1, guard)
        if (found) return found
        if (guard.count > guard.limit) return null
      }
    }
  }
  return null
}

function resolveHomeFromMarker(markerFullPath, markerRelList) {
  const lower = markerFullPath.toLowerCase().replace(/\//g, '\\')
  const rel = (markerRelList || []).find((m) => lower.endsWith('\\' + m.toLowerCase().replace(/\//g, '\\')))
  let dir = path.dirname(markerFullPath)
  if (rel) {
    const ups = (rel.match(/[\/\\]/g) || []).length
    for (let i = 0; i < ups; i++) dir = path.dirname(dir)
  }
  return dir
}

async function scanAllDrives(markers) {
  if (!markers || !markers.length) return null
  const markerNames = new Set(markers.map((m) => m.toLowerCase().replace(/\//g, '\\').split('\\').pop()))
  const guard = { count: 0, limit: 120000 }
  const drives = getLogicalDrives()
  for (const drive of drives) {
    const roots = candidateRootsForDrive(drive)
    const depthOf = (r) => /Program Files|Users[\\/][^\\/]+$|env-tools|tools|dev|opt|software|sdk|apps|portapps|env|green/i.test(r) ? 4 : 3
    for (const r of roots) {
      const hit = await findMarker(r, markerNames, depthOf(r), guard)
      if (hit) return hit
      if (guard.count > guard.limit) return null
    }
  }
  return null
}
// =============================================================

// 优先用 PATH 命令探测，命中则直接返回（与 check-env 阶段1一致）
import { exec } from 'node:child_process'
const execAsync = (cmd) => new Promise((res, rej) => exec(cmd, { windowsHide: true }, (e, stdout, stderr) => (e ? rej(e) : res({ stdout, stderr }))))

async function detect(name, check, markers) {
  // 阶段1：命令探测
  if (check) {
    try {
      await execAsync(`${check} -version 2>&1`)
      let home
      try {
        const { stdout } = await execAsync(`where ${check} 2>&1`)
        const first = (stdout || '').split('\n')[0]?.trim()
        if (first) home = resolveHomeFromMarker(first, markers || [`${check}.exe`])
      } catch (_) {}
      return { installed: true, via: 'path', path: home, output: 'PATH 命中' }
    } catch (_) {}
  }
  // 阶段2：全盘扫描
  if (markers && markers.length) {
    const hit = await scanAllDrives(markers)
    if (hit) return { installed: true, via: 'disk', path: resolveHomeFromMarker(hit, markers), output: hit }
  }
  return { installed: false, via: null, path: undefined, output: '未检测到' }
}

const drives = getLogicalDrives()
console.log('本机检测到的本地磁盘盘符:', drives.join(', '))
console.log('待检测工具总数:', Object.values(softwares).reduce((n, a) => n + a.length, 0))
console.log('—'.repeat(60))

let hitCount = 0
const t0 = Date.now()
for (const [cat, list] of Object.entries(softwares)) {
  for (const t of list) {
    const markers = t.check?.markers || []
    const check = t.check?.command || null
    const r = await detect(t.name, check, markers)
    if (r.installed) {
      hitCount++
      console.log(`✓ ${t.name.padEnd(16)} via=${r.via.padEnd(4)} HOME=${r.path || '(PATH 未定位)'}`)
    }
  }
}
const cost = ((Date.now() - t0) / 1000).toFixed(1)
console.log('—'.repeat(60))
console.log(`扫描完成：命中 ${hitCount} 个工具，耗时 ${cost}s`)
