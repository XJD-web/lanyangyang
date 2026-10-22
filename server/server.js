// Lanyangyang 后端 API 服务
// 提供 /api/softwares（软件清单）与 /api/health（健康检查），供桌面客户端拉取并安装开发环境。
const express = require('express')
const cors = require('cors')
const { softwares } = require('./softwares')

const app = express()

// 允许跨域：桌面客户端（Electron）请求的是 http://IP:3000，与本地 file:// 不同源，必须放开 CORS
app.use(cors())

// 监听端口：优先读环境变量 PORT，默认 3000（与前端 API_BASE 默认端口一致）
const PORT = process.env.PORT || 3000

// 健康检查（可用 nginx / 云厂商探针调用）
app.get('/api/health', (_req, res) => {
  res.json({ ok: true, time: new Date().toISOString() })
})

// 软件清单接口：前端 App.vue 的 onMounted 会请求该接口
// 返回结构：{ java: [{ name, version, url, path, versions?, downloads? }], python: [...], ... }
app.get('/api/softwares', (_req, res) => {
  res.json(softwares)
})

// 软件清单统计（首页展示用）
app.get('/api/stats', (_req, res) => {
  const groups = Object.keys(softwares || {})
  let total = 0
  for (const k of groups) {
    const arr = softwares[k]
    if (Array.isArray(arr)) total += arr.length
  }
  res.json({ groups: groups.length, softwares: total })
})

// ===== 环境报告 =====
// 浏览器永远读不到本机 PATH/注册表，所以「检测」只能在桌面端做；
// 但检测结果可以上传到这里，网页端与其它机器就能查看——这是绕开浏览器沙箱的唯一正路。
//   桌面端检测完成 → POST /api/reports → 网页 GET 查看
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')

// 存储目录：默认服务目录下 data/，可用 DATA_DIR 覆盖（部署到只读目录时改这里）
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data')
const REPORT_DIR = path.join(DATA_DIR, 'reports')
try {
  fs.mkdirSync(REPORT_DIR, { recursive: true })
} catch (e) {
  // 目录不可写不应导致整个服务起不来，只让报告功能失效
  console.error('[reports] 存储目录创建失败，报告功能不可用:', e.message)
}

// 设置了 REPORT_KEY 后，上传/删除必须带 x-report-key 头；不设则开放
const REPORT_KEY = process.env.REPORT_KEY || ''
// 最多保留多少份报告，超出删最旧的，避免无限增长
const MAX_REPORTS = Number(process.env.MAX_REPORTS || 100)

const cut = (v, n) => (typeof v === 'string' ? v.slice(0, n) : '')

function keyOk(req) {
  if (!REPORT_KEY) return true
  return req.get('x-report-key') === REPORT_KEY
}

// 只接受白名单字段并截断长度：避免把任意大对象/脏数据写进磁盘
function sanitize(body = {}) {
  const when = Date.parse(body.createdAt)
  const tools = Array.isArray(body.tools) ? body.tools.slice(0, 300) : []
  return {
    device: cut(body.device, 64) || 'unknown',
    os: cut(body.os, 128),
    workspace: cut(body.workspace, 512),
    client: cut(body.client, 32),
    createdAt: Number.isFinite(when) ? new Date(when).toISOString() : new Date().toISOString(),
    tools: tools.map((t) => ({
      id: cut(t && t.id, 64),
      name: cut(t && t.name, 64),
      category: cut(t && t.category, 32),
      installed: !!(t && t.installed),
      version: cut(t && t.version, 64),
      path: cut(t && t.path, 512),
      via: cut(t && t.via, 16),
    })),
  }
}

// id 只允许安全字符，防止 ../ 路径穿越
function reportPath(id) {
  if (!/^[A-Za-z0-9_-]{6,64}$/.test(String(id))) return null
  return path.join(REPORT_DIR, `${id}.json`)
}

// 列表只返回摘要，不返回完整工具明细，避免一次拉几百 KB
function summarize(id, r) {
  const tools = Array.isArray(r.tools) ? r.tools : []
  return {
    id,
    device: r.device,
    os: r.os,
    client: r.client,
    createdAt: r.createdAt,
    installed: tools.filter((t) => t.installed).length,
    total: tools.length,
  }
}

function listAll() {
  let files = []
  try {
    files = fs.readdirSync(REPORT_DIR)
  } catch (_) {
    return []
  }
  const out = []
  for (const f of files) {
    if (!f.endsWith('.json')) continue
    const id = f.slice(0, -5)
    try {
      out.push(summarize(id, JSON.parse(fs.readFileSync(path.join(REPORT_DIR, f), 'utf8'))))
    } catch (_) {
      // 单个文件损坏不影响整体列表
    }
  }
  return out.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
}

app.get('/api/reports', (_req, res) => {
  res.json({ ok: true, reports: listAll() })
})

app.get('/api/reports/:id', (req, res) => {
  const p = reportPath(req.params.id)
  if (!p || !fs.existsSync(p)) return res.status(404).json({ ok: false, error: '报告不存在' })
  try {
    res.json({ ok: true, id: req.params.id, report: JSON.parse(fs.readFileSync(p, 'utf8')) })
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message })
  }
})

app.post('/api/reports', express.json({ limit: '512kb' }), (req, res) => {
  if (!keyOk(req)) return res.status(401).json({ ok: false, error: '缺少或错误的 x-report-key' })
  const report = sanitize(req.body || {})
  if (!report.tools.length) return res.status(400).json({ ok: false, error: 'tools 不能为空' })
  const id = `${Date.now().toString(36)}${crypto.randomBytes(3).toString('hex')}`
  fs.writeFileSync(path.join(REPORT_DIR, `${id}.json`), JSON.stringify(report, null, 2), 'utf8')
  const all = listAll()
  if (all.length > MAX_REPORTS) {
    for (const old of all.slice(MAX_REPORTS)) {
      const p = reportPath(old.id)
      if (p) {
        try {
          fs.unlinkSync(p)
        } catch (_) {}
      }
    }
  }
  res.json({ ok: true, id, summary: summarize(id, report) })
})

app.delete('/api/reports/:id', (req, res) => {
  if (!keyOk(req)) return res.status(401).json({ ok: false, error: '缺少或错误的 x-report-key' })
  const p = reportPath(req.params.id)
  if (!p || !fs.existsSync(p)) return res.status(404).json({ ok: false, error: '报告不存在' })
  fs.unlinkSync(p)
  res.json({ ok: true })
})

// 根路径：返回一个可直接在浏览器打开的说明页
// （80 端口反代到本服务后，直接访问 http://IP 不应该是一片空白）
app.get('/', (_req, res) => {
  const groups = Object.keys(softwares || {})
  let total = 0
  for (const k of groups) {
    const arr = softwares[k]
    if (Array.isArray(arr)) total += arr.length
  }
  const rows = groups
    .map((k) => {
      const arr = Array.isArray(softwares[k]) ? softwares[k] : []
      const name = (arr[0] && arr[0].name) || k
      return `<tr><td class="k">${k}</td><td>${name}</td><td class="n">${arr.length}</td></tr>`
    })
    .join('')

  res.type('html').send(`<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Lanyangyang API 服务</title>
<style>
  :root{color-scheme:light}
  *{box-sizing:border-box}
  body{margin:0;padding:40px 20px;font:15px/1.7 -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;background:#f6f7f9;color:#1f2329}
  .wrap{max-width:760px;margin:0 auto}
  h1{margin:0 0 6px;font-size:22px;letter-spacing:.5px}
  .sub{color:#646a73;font-size:13px;margin-bottom:24px}
  .badge{display:inline-block;padding:2px 10px;border-radius:999px;background:#e8f5e9;color:#1a7f37;font-size:12px;font-weight:600;margin-left:8px;vertical-align:3px}
  .card{background:#fff;border:1px solid #e5e6eb;border-radius:12px;padding:20px 22px;margin-bottom:16px}
  .card h2{margin:0 0 12px;font-size:15px;color:#1f2329}
  code{background:#f2f3f5;padding:2px 7px;border-radius:5px;font-family:ui-monospace,Consolas,Monaco,monospace;font-size:13px;color:#d1369c}
  .link{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:9px 0;border-bottom:1px dashed #eee}
  .link:last-child{border-bottom:0}
  a{color:#3370ff;text-decoration:none}
  a:hover{text-decoration:underline}
  table{width:100%;border-collapse:collapse;font-size:13.5px}
  th,td{text-align:left;padding:7px 8px;border-bottom:1px solid #f0f1f3}
  th{color:#8f959e;font-weight:500;font-size:12px;text-transform:uppercase;letter-spacing:.4px}
  td.k{font-family:ui-monospace,Consolas,monospace;color:#646a73}
  td.n{text-align:right;color:#1a7f37;font-weight:600}
  .sum{font-size:13px;color:#646a73;margin-top:10px}
  .foot{text-align:center;color:#8f959e;font-size:12px;margin-top:26px}
</style></head>
<body><div class="wrap">
  <h1>Lanyangyang API<span class="badge">运行中</span></h1>
  <div class="sub">懒羊羊开发环境装配 · 后端服务 · 共 ${groups.length} 类 / ${total} 条软件记录</div>

  <div class="card">
    <h2>接口</h2>
    <div class="link"><span><code>GET /api/softwares</code> 软件清单</span><a href="/api/softwares">打开</a></div>
    <div class="link"><span><code>GET /api/health</code> 健康检查</span><a href="/api/health">打开</a></div>
    <div class="link"><span><code>GET /api/stats</code> 数量统计</span><a href="/api/stats">打开</a></div>
  </div>

  <div class="card">
    <h2>清单分组</h2>
    <table><thead><tr><th>key</th><th>名称</th><th style="text-align:right">条数</th></tr></thead>
    <tbody>${rows}</tbody></table>
    <div class="sum">客户端默认请求 <code>/api/softwares</code>，失败时自动降级为内置静态清单。</div>
  </div>

  <div class="foot">Lanyangyang · Node.js + Express</div>
</div></body></html>`)
})

// 绑定 0.0.0.0，确保云服务器上能通过公网/内网 IP 访问（而非仅 localhost）
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Lanyangyang API listening on http://0.0.0.0:${PORT}`)
})
