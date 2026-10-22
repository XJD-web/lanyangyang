// 受沙箱限制（WMIC 被拦截 + 真实文件系统被隔离），无法在沙箱内扫真实磁盘。
// 本脚本在临时目录构造“C/D/E 三个盘”的模拟目录树，调用与 main.js 原样的扫描函数，
// 证明全盘符扫描、候选根、深度限制、HOME 反推均按预期工作。
import fs from 'node:fs/promises'
import fsSync from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const BASE = path.join(os.tmpdir(), 'lanyangyang_scan_demo')

// 构造模拟多盘目录树
function buildTree() {
  fsSync.rmSync(BASE, { recursive: true, force: true })
  const put = (p) => {
    fsSync.mkdirSync(path.dirname(p), { recursive: true })
    fsSync.writeFileSync(p, '')
  }
  // C 盘（系统盘）：Program Files 下的 JDK
  put(path.join(BASE, 'C', 'Program Files', 'Java', 'jdk-17', 'bin', 'java.exe'))
  put(path.join(BASE, 'C', 'Program Files', 'Java', 'jdk-17', 'bin', 'javac.exe'))
  put(path.join(BASE, 'C', 'Program Files', 'Git', 'cmd', 'git.exe'))
  // D 盘（非系统盘，以盘根为起点）：自定义绿色目录装 Maven
  put(path.join(BASE, 'D', 'tools', 'maven', 'bin', 'mvn.cmd'))
  // E 盘：根目录装 Python
  put(path.join(BASE, 'E', 'Python312', 'python.exe'))
  put(path.join(BASE, 'E', 'Python312', 'Scripts', 'pip.exe'))
  return [
    path.join(BASE, 'C') + path.sep,
    path.join(BASE, 'D') + path.sep,
    path.join(BASE, 'E') + path.sep,
  ]
}

// ===== 以下函数与 electron/main.js 完全一致（仅 getLogicalDrives/candidateRootsForDrive 指向模拟盘）=====
function getLogicalDrives() {
  return DRIVES
}
function candidateRootsForDrive(drive) {
  const roots = new Set()
  const add = (p) => { try { if (fsSync.existsSync(p)) roots.add(p) } catch (_) {} }
  add(path.join(drive, 'Program Files'))
  add(path.join(drive, 'Program Files (x86)'))
  for (const c of ['env-tools', 'tools', 'dev', 'opt', 'software', 'sdk', 'apps', 'portapps', 'env', 'green']) add(path.join(drive, c))
  // 演示脚本：模拟盘均在 temp 下，统一把盘根也作为候选起点（真实机器上非系统盘走此分支）
  add(drive)
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

const DRIVES = buildTree()
console.log('模拟本地磁盘盘符:', DRIVES.map((d) => d.split(/[\\/]/).filter(Boolean).pop() + ':').join(', '))
console.log('—'.repeat(64))

const cases = [
  ['JDK', ['bin/java.exe', 'bin/javac.exe']],
  ['Git', ['cmd/git.exe', 'bin/git.exe', 'git.exe']],
  ['Maven', ['bin/mvn.cmd', 'bin/mvn', 'bin/mvn.bat']],
  ['Python', ['python.exe']],
]
let hits = 0
const t0 = Date.now()
for (const [name, markers] of cases) {
  const hit = await scanAllDrives(markers)
  if (hit) {
    hits++
    console.log(`✓ ${name.padEnd(8)} 命中文件: ${hit}`)
    console.log(`          反推 HOME: ${resolveHomeFromMarker(hit, markers)}`)
  } else {
    console.log(`○ ${name.padEnd(8)} 未命中`)
  }
}
const cost = ((Date.now() - t0) / 1000).toFixed(2)
console.log('—'.repeat(64))
console.log(`全盘扫描完成：命中 ${hits}/${cases.length}，耗时 ${cost}s（扫描条目受 120000 上限保护，不会卡死）`)
fsSync.rmSync(BASE, { recursive: true, force: true })
