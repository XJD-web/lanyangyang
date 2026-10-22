import { exec, execSync } from 'node:child_process'
import { promisify } from 'node:util'
import fs from 'node:fs/promises'
import path from 'node:path'

const execAsync = promisify(exec)

// 当前用户环境变量作用域（HKCU，无需管理员权限）
// 采用 .NET [Environment]::SetEnvironmentVariable 直写注册表（等价于 winreg，
// 与 vfaner/murig 的方案一致），优点：
//   1) 无 setx 的 1024 字符限制；
//   2) 无 reg.exe 命令行引号转义地狱；
//   3) 写入后系统会自动广播 WM_SETTINGCHANGE，新进程立即感知。
function psStr(s) {
  // PowerShell 单引号字符串内的 ' 需要写成 '' 转义
  return String(s).replace(/'/g, "''")
}

// ============================================================
// 1) setEnvVariable：持久化写入「用户级」环境变量
// ============================================================
export async function setEnvVariable(name, value) {
  const ps = `[Environment]::SetEnvironmentVariable('${psStr(name)}', '${psStr(value)}', 'User')`
  await execAsync(`powershell -NoProfile -Command "${ps}"`)
}

// ============================================================
// 2) 读取用户级环境变量（经 .NET API 读 HKCU\Environment）
// ============================================================
export async function readUserEnv(name) {
  try {
    const ps = `[Environment]::GetEnvironmentVariable('${psStr(name)}', 'User')`
    const { stdout } = await execAsync(`powershell -NoProfile -Command "${ps}"`)
    return (stdout || '').trim()
  } catch (_) {
    return ''
  }
}

// ============================================================
// 3) appendToPath：把目录追加到用户级 Path，自动防重复
//    返回 true=已追加；false=已存在跳过
//    注意：若原 Path 含 %VAR% 引用，则保留 REG_EXPAND_SZ 类型，避免展开语义丢失
// ============================================================
export async function appendToPath(segment) {
  const current = await readUserEnv('Path')
  const segments = current
    ? current.split(';').map((s) => s.trim()).filter(Boolean)
    : []
  const exists = segments.some((s) => s.toLowerCase() === segment.toLowerCase())
  if (exists) return false
  segments.push(segment)
  const newValue = segments.join(';')
  const expand = /%[A-Za-z_][^%]*%/i.test(current || '')
  if (expand) {
    // 保留 ExpandString 类型，用 PowerShell 单引号 here-string 写入避免转义问题
    const ps = `Set-ItemProperty -Path 'HKCU:\\Environment' -Name 'Path' -Value '${psStr(newValue)}' -Type ExpandString`
    await execAsync(`powershell -NoProfile -Command "${ps}"`)
  } else {
    await setEnvVariable('Path', newValue)
  }
  // 同步刷新当前进程的 PATH，使本进程内后续的 `where` / 命令探测立即生效，
  // 无需重启应用（否则要等下一次启动才会读取最新注册表值）。
  const key = process.platform === 'win32' ? 'Path' : 'PATH'
  const curProcPath = process.env[key] || process.env.PATH || ''
  const already = curProcPath
    .split(';')
    .some((s) => s.trim().toLowerCase() === segment.toLowerCase())
  if (!already) {
    process.env[key] = curProcPath ? `${curProcPath};${segment}` : segment
  }
  return true
}

// ============================================================
// 4) broadcastEnvChange：显式广播 WM_SETTINGCHANGE
//    （[Environment]::SetEnvironmentVariable 已自动广播，此处作为兜底，
//     确保 Explorer / 已打开的终端尽快感知变化）
// ============================================================
export async function broadcastEnvChange() {
  const ps1 = [
    'Add-Type -Namespace Win32 -Name Native -MemberDefinition \'[DllImport("user32.dll", CharSet=CharSet.Auto, SetLastError=true)] public static extern IntPtr SendMessageTimeout(IntPtr hWnd, uint Msg, UIntPtr wParam, string lParam, uint fuFlags, uint uTimeout, out UIntPtr lpdwResult);\'',
    '$HWND_BROADCAST = [IntPtr]0xffff',
    '$WM_SETTINGCHANGE = 0x001A',
    '[Win32.Native]::SendMessageTimeout($HWND_BROADCAST, $WM_SETTINGCHANGE, [UIntPtr]::Zero, \'Environment\', 2, 5000, [ref][UIntPtr]::Zero) | Out-Null',
  ].join('\n')
  const tmp = path.join(process.env.TEMP || '.', `lyy_env_${Date.now()}.ps1`)
  await fs.writeFile(tmp, ps1)
  try {
    await execAsync(`powershell -NoProfile -ExecutionPolicy Bypass -File "${tmp}"`)
  } finally {
    await fs.unlink(tmp).catch(() => {})
  }
}

// ============================================================
// 5) 提权相关（仅在需要系统级 HKLM 时使用，默认用户级无需）
// ============================================================
export function isAdmin() {
  if (process.platform !== 'win32') return true
  try {
    execSync('net session >nul 2>&1')
    return true
  } catch (_) {
    return false
  }
}

// 系统级环境变量（HKLM）写入：本进程未提权时，用 PowerShell -Verb RunAs 拉起提权子进程
export async function setMachineEnvElevated(name, value) {
  const regCmd = `reg add "HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment" /v ${name} /t REG_SZ /d "${value.replace(/"/g, '\\"')}" /f`
  const ps = `Start-Process cmd -Verb RunAs -ArgumentList '/c', '${regCmd.replace(/'/g, "''")}'`
  await execAsync(`powershell -NoProfile -Command "${ps}"`)
}

// 整个应用以管理员身份重启（可选）
export function relaunchAsAdmin() {
  const exe = process.execPath
  const argv = process.argv.slice(1).map((a) => `"${a}"`).join(' ')
  execSync(`powershell -Command "Start-Process '${exe}' -Verb RunAs -ArgumentList '${argv}'"`)
  process.exit(0)
}

// ============================================================
// 6) verifyEnv：写入后回读校验，确保确实生效（防止静默失败）
// ============================================================
export async function verifyEnv(name, expected) {
  const actual = await readUserEnv(name)
  if (name.toUpperCase() === 'PATH') {
    return actual.split(';').some((s) => s.trim().toLowerCase() === expected.toLowerCase())
  }
  return actual === expected
}
