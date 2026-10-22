// ===== 官网版本抓取模块 =====
// 目标：不再依赖写死的 versions 数组，而是启动时按工具去「官方数据源」实时拉取版本列表。
// 每个工具的解析器返回数组：[{ version: '3.12.7', url: '下载地址' }]（按版本倒序）。
// 任何工具抓取失败都会抛错，由渲染进程捕获后降级为「内置默认列表」并打日志。
//
// 设计取舍：
//   - 优先使用官方提供的 JSON / XML 接口（稳定、结构化）；
//   - 没有 API 的用 Apache 归档目录 / GitHub Releases / S3 目录列举；
//   - 结果缓存 30 分钟，避免频繁请求（尤其 GitHub 未授权有 60 次/小时限流）；
//   - 对超大列表做上限截断（MAX_PER_TOOL），保证下拉框可用。

import axios from 'axios'

const HTTP_TIMEOUT = 20000
const CACHE_TTL = 30 * 60 * 1000 // 30 分钟
const MAX_PER_TOOL = 300 // 单个工具最多展示的版本数

const cache = new Map() // key -> { at, data }

// —— 基础请求（文本 / JSON）——
async function getText(url, extra = {}) {
  const res = await axios.get(url, {
    timeout: HTTP_TIMEOUT,
    headers: { 'User-Agent': 'Lanyangyang/1.0 (+dev-env-tool)' },
    transformResponse: [(d) => d], // 保持原始文本，供 XML/HTML 解析
    ...extra,
  })
  return res.data
}
async function getJson(url, extra = {}) {
  const res = await axios.get(url, {
    timeout: HTTP_TIMEOUT,
    headers: { 'User-Agent': 'Lanyangyang/1.0 (+dev-env-tool)', Accept: 'application/json' },
    ...extra,
  })
  return res.data
}

// —— 版本工具函数 ——
function cleanVersion(v) {
  return String(v == null ? '' : v).trim().replace(/^[vV]/, '')
}
// 把版本号转成可比较的数组 [major, minor, patch, extra]
function semverKey(v) {
  const m = String(v).match(/(\d+)\.(\d+)(?:\.(\d+))?(?:[._-](\d+))?/)
  if (!m) return [0, 0, 0, 0]
  return [Number(m[1]), Number(m[2]), Number(m[3] || 0), Number(m[4] || 0)]
}
// 版本倒序
function sortDesc(list) {
  return list.sort((a, b) => {
    const A = semverKey(a.version)
    const B = semverKey(b.version)
    for (let i = 0; i < 4; i++) if (A[i] !== B[i]) return B[i] - A[i]
    return 0
  })
}
// 去重（按 version 小写）+ 倒序 + 截断
function finalize(list, max = MAX_PER_TOOL) {
  const seen = new Set()
  const out = []
  for (const item of list) {
    if (!item || !item.version || !item.url) continue
    const k = String(item.version).toLowerCase()
    if (seen.has(k)) continue
    seen.add(k)
    out.push({ version: String(item.version), url: item.url })
  }
  return sortDesc(out).slice(0, max)
}

// GitHub Releases（未授权 60 次/小时，已做 30 分钟缓存 + 全量并发控制）
async function ghReleases(repo, perPage = 30) {
  const arr = await getJson(
    `https://api.github.com/repos/${repo}/releases?per_page=${perPage}`
  )
  return Array.isArray(arr) ? arr : []
}

// Apache 归档目录列举：返回形如 ['3.9.9','3.8.1',...]（倒序）
// 有些项目的目录名带前缀（hadoop-3.4.0 / spark-3.5.3 / flink-1.20.0 …），用 prefix 指定
async function apacheVersions(projectPath, prefix = '') {
  const html = String(await getText(`https://archive.apache.org/dist/${projectPath}/`))
  const set = new Set()
  const p = prefix ? prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : ''
  const re = new RegExp(`href="${p}(\\d+\\.\\d+\\.\\d+)/"`, 'g')
  for (const m of html.matchAll(re)) set.add(m[1])
  return [...set].sort((a, b) => {
    const A = semverKey(a)
    const B = semverKey(b)
    for (let i = 0; i < 4; i++) if (A[i] !== B[i]) return B[i] - A[i]
    return 0
  })
}

// ===== 各工具解析器注册表（key 为规范化后的工具标识）=====
const resolvers = {
  // ---------- 语言运行时 ----------
  async nodejs() {
    // 官方 index.json 含所有发布；只保留有 Windows x64 包的版本
    const arr = await getJson('https://nodejs.org/dist/index.json')
    return finalize(
      arr
        // 注意：nodejs index.json 的 files 字段用的是 'win-x64-zip'（不是 win-x64）
        .filter((x) => Array.isArray(x.files) && x.files.includes('win-x64-zip'))
        .map((x) => ({
          version: cleanVersion(x.version),
          url: `https://nodejs.org/dist/${x.version}/node-${x.version}-win-x64.zip`,
        }))
    )
  },

  async python() {
    // python.org 官方发布 API；注意 version 字段是「主版本号数字」，真实版本在 name 里（如 "Python 3.12.7"）
    let arr = await getJson(
      'https://www.python.org/api/v2/downloads/release/?is_published=true'
    )
    if (arr && arr.results) arr = arr.results
    const out = []
    for (const r of arr) {
      if (r.pre_release) continue
      const m = /^Python (\d+)\.(\d+)\.(\d+)$/.exec(String(r.name || ''))
      if (!m || Number(m[1]) < 3) continue // 只保留 3.x 正式版
      const ver = `${m[1]}.${m[2]}.${m[3]}`
      out.push({
        version: ver,
        url: `https://www.python.org/ftp/python/${ver}/python-${ver}-amd64.exe`,
      })
    }
    return finalize(out)
  },

  async jdk() {
    // Eclipse Adoptium（Temurin）：available_releases 给出所有主版本，再取每个主版本最新构建
    const info = await getJson('https://api.adoptium.net/v3/info/available_releases')
    const feats = info.available_releases || []
    // 并发获取每个主版本的最新构建，避免 14 次串行请求过慢
    const out = await Promise.all(
      feats.map(async (f) => {
        try {
          const j = await getJson(
            `https://api.adoptium.net/v3/assets/latest/${f}/hotspot?os=windows&architecture=x64&image_type=jdk`
          )
          const first = Array.isArray(j) ? j[0] : null
          const ver = first?.version?.semver || String(f)
          const link =
            first?.binary?.package?.link ||
            `https://api.adoptium.net/v3/binary/latest/${f}/ga/windows/x64/jdk/hotspot/normal/eclipse`
          return { version: String(ver).replace(/^v/, ''), url: link }
        } catch (_) {
          return {
            version: String(f),
            url: `https://api.adoptium.net/v3/binary/latest/${f}/ga/windows/x64/jdk/hotspot/normal/eclipse`,
          }
        }
      })
    )
    return finalize(out)
  },

  // ---------- Java 构建工具 ----------
  async maven() {
    const xml = String(
      await getText(
        'https://repo.maven.apache.org/maven2/org/apache/maven/apache-maven/maven-metadata.xml'
      )
    )
    const vs = [...xml.matchAll(/<version>([^<]+)<\/version>/g)]
      .map((m) => m[1])
      .filter((v) => /^\d+\.\d+\.\d+$/.test(v))
    return finalize(
      vs.map((v) => ({
        version: v,
        url: `https://archive.apache.org/dist/maven/maven-${v.split('.')[0]}/${v}/binaries/apache-maven-${v}-bin.zip`,
      }))
    )
  },

  async gradle() {
    // Gradle 官方版本 API 直接带下载地址
    const arr = await getJson('https://services.gradle.org/versions/all')
    return finalize(
      arr
        .filter(
          (x) =>
            x.version &&
            x.downloadUrl &&
            !x.snapshot &&
            !x.nightly &&
            !/(milestone|rc|beta|alpha|preview)/i.test(x.version)
        )
        .map((x) => ({ version: cleanVersion(x.version), url: x.downloadUrl }))
    )
  },

  async tomcat() {
    const xml = String(
      await getText(
        'https://repo.maven.apache.org/maven2/org/apache/tomcat/tomcat/maven-metadata.xml'
      )
    )
    const vs = [...xml.matchAll(/<version>([^<]+)<\/version>/g)]
      .map((m) => m[1])
      .filter((v) => /^\d+\.\d+\.\d+$/.test(v))
    return finalize(
      vs.map((v) => ({
        version: v,
        url: `https://archive.apache.org/dist/tomcat/tomcat-${v.split('.')[0]}/v${v}/bin/apache-tomcat-${v}.zip`,
      }))
    )
  },

  // ---------- Python 发行版 ----------
  async miniconda() {
    const html = String(await getText('https://repo.anaconda.com/miniconda/'))
    const map = new Map()
    for (const m of html.matchAll(
      /(Miniconda3-py\d+_(\d+\.\d+\.\d+)-\d+-Windows-x86_64\.exe)/g
    )) {
      const filename = m[1]
      const ver = m[2]
      if (!map.has(ver)) {
        map.set(ver, {
          version: ver,
          url: `https://repo.anaconda.com/miniconda/${filename}`,
        })
      }
    }
    return finalize([...map.values()])
  },

  async anaconda() {
    const html = String(await getText('https://repo.anaconda.com/archive/'))
    const map = new Map()
    for (const m of html.matchAll(
      /(Anaconda3-(\d{4}\.\d{2})-\d+-Windows-x86_64\.exe)/g
    )) {
      const filename = m[1]
      const ver = m[2]
      if (!map.has(ver)) {
        map.set(ver, {
          version: ver,
          url: `https://repo.anaconda.com/archive/${filename}`,
        })
      }
    }
    return finalize([...map.values()])
  },

  // ---------- 前端 ----------
  async vscode() {
    const arr = await getJson('https://update.code.visualstudio.com/api/releases/stable')
    return finalize(
      (Array.isArray(arr) ? arr : []).map((v) => ({
        version: String(v),
        url: `https://update.code.visualstudio.com/${v}/win32-x64-archive/zip`,
      }))
    )
  },

  async pnpm() {
    const rels = await ghReleases('pnpm/pnpm', 30)
    return finalize(
      rels
        .map((r) => {
          const exe = (r.assets || []).find((a) => /pnpm-win-x64\.exe$/i.test(a.name))
          return exe
            ? { version: cleanVersion(r.tag_name), url: exe.browser_download_url }
            : null
        })
        .filter(Boolean)
    )
  },

  async yarn() {
    const rels = await ghReleases('yarnpkg/yarn', 30)
    return finalize(
      rels
        .map((r) => {
          const msi = (r.assets || []).find((a) => /\.msi$/i.test(a.name))
          return msi
            ? { version: cleanVersion(r.tag_name), url: msi.browser_download_url }
            : null
        })
        .filter(Boolean)
    )
  },

  // ---------- 数据库 ----------
  async postgresql() {
    // postgresql.org 官方 versions.json：只保留仍受支持的版本
    const arr = await getJson('https://www.postgresql.org/versions.json')
    return finalize(
      (Array.isArray(arr) ? arr : [])
        .filter((v) => v.supported)
        .map((v) => {
          const ver = `${v.major}.${v.latestMinor}`
          return {
            version: ver,
            url: `https://get.enterprisedb.com/postgresql/postgresql-${ver}-1-windows-x64-binaries.zip`,
          }
        })
    )
  },

  async redis() {
    // Windows 版 Redis 由 tporadowski 维护
    const rels = await ghReleases('tporadowski/redis', 30)
    return finalize(
      rels
        .map((r) => {
          const zip = (r.assets || []).find((a) => /Redis-x64-.*\.zip$/i.test(a.name))
          return zip
            ? { version: cleanVersion(r.tag_name), url: zip.browser_download_url }
            : null
        })
        .filter(Boolean)
    )
  },

  async mariadb() {
    // MariaDB 官方 REST：先取主版本线，再取每条线的补丁版本
    const root = await getJson('https://downloads.mariadb.org/rest-api/mariadb/')
    const majors = (root.major_releases || [])
      .filter((m) => !/preview|\brc\b|alpha|beta/i.test(m.release_status || ''))
      .map((m) => m.release_id)
      .slice(0, 8)
    const out = []
    for (const maj of majors) {
      try {
        const j = await getJson(`https://downloads.mariadb.org/rest-api/mariadb/${maj}/`)
        for (const ver of Object.keys(j.releases || {})) {
          out.push({
            version: ver,
            url: `https://archive.mariadb.org/mariadb-${ver}/winx64-packages/mariadb-${ver}-winx64.zip`,
          })
        }
      } catch (_) {
        /* 单条版本线失败不影响其它 */
      }
    }
    return finalize(out)
  },

  async mongodb() {
    // fastdl.mongodb.org 是 S3，可用 list-type=2 列举 windows/ 下的安装包
    const xml = String(
      await getText('https://fastdl.mongodb.org/?list-type=2&prefix=windows/&max-keys=1000')
    )
    const map = new Map()
    for (const m of xml.matchAll(
      /mongodb-windows-x86_64-(\d+\.\d+\.\d+)\.zip/g
    )) {
      const ver = m[1]
      if (!map.has(ver)) {
        map.set(ver, {
          version: ver,
          url: `https://fastdl.mongodb.org/windows/mongodb-windows-x86_64-${ver}.zip`,
        })
      }
    }
    return finalize([...map.values()])
  },

  // ---------- 大数据（Apache 归档目录）----------
  async hadoop() {
    const vs = await apacheVersions('hadoop/common', 'hadoop-')
    return finalize(
      vs.map((v) => ({
        version: v,
        url: `https://archive.apache.org/dist/hadoop/common/hadoop-${v}/hadoop-${v}.tar.gz`,
      })),
      10
    )
  },
  async spark() {
    const vs = await apacheVersions('spark', 'spark-')
    return finalize(
      vs.map((v) => ({
        version: v,
        url: `https://archive.apache.org/dist/spark/spark-${v}/spark-${v}-bin-hadoop3.tgz`,
      })),
      10
    )
  },
  async kafka() {
    const vs = await apacheVersions('kafka')
    return finalize(
      vs.map((v) => ({
        version: v,
        // Kafka 包名带 Scala 版本，优先 2.13
        url: `https://archive.apache.org/dist/kafka/${v}/kafka_2.13-${v}.tgz`,
      })),
      10
    )
  },
  async flink() {
    const vs = await apacheVersions('flink', 'flink-')
    return finalize(
      vs.map((v) => ({
        version: v,
        url: `https://archive.apache.org/dist/flink/flink-${v}/flink-${v}-bin-scala_2.12.tgz`,
      })),
      10
    )
  },
  async zookeeper() {
    const vs = await apacheVersions('zookeeper', 'zookeeper-')
    return finalize(
      vs.map((v) => ({
        version: v,
        url: `https://archive.apache.org/dist/zookeeper/zookeeper-${v}/apache-zookeeper-${v}-bin.tar.gz`,
      })),
      10
    )
  },
  async hbase() {
    const vs = await apacheVersions('hbase')
    return finalize(
      vs.map((v) => ({
        version: v,
        url: `https://archive.apache.org/dist/hbase/${v}/hbase-${v}-bin.tar.gz`,
      })),
      10
    )
  },
  async hive() {
    const vs = await apacheVersions('hive', 'hive-')
    return finalize(
      vs.map((v) => ({
        version: v,
        url: `https://archive.apache.org/dist/hive/hive-${v}/apache-hive-${v}-bin.tar.gz`,
      })),
      10
    )
  },
  async elasticsearch() {
    // Elasticsearch 官方产物在 artifacts.elastic.co；GitHub Releases 取版本号
    const rels = await ghReleases('elastic/elasticsearch', 30)
    return finalize(
      rels
        .map((r) => {
          const v = cleanVersion(r.tag_name)
          if (!/^\d+\.\d+\.\d+$/.test(v)) return null
          return {
            version: v,
            url: `https://artifacts.elastic.co/downloads/elasticsearch/elasticsearch-${v}-windows-x86_64.zip`,
          }
        })
        .filter(Boolean),
      15
    )
  },

  // ---------- 容器 / 云原生 ----------
  async kubectl() {
    const rels = await ghReleases('kubernetes/kubernetes', 30)
    return finalize(
      rels
        .filter((r) => /^v1\.\d+\.\d+$/.test(r.tag_name))
        .map((r) => ({
          version: cleanVersion(r.tag_name),
          url: `https://dl.k8s.io/release/${r.tag_name}/bin/windows/amd64/kubectl.exe`,
        }))
    )
  },
  async helm() {
    const rels = await ghReleases('helm/helm', 30)
    return finalize(
      rels
        .filter((r) => /^v\d+\.\d+\.\d+$/.test(r.tag_name))
        .map((r) => ({
          version: cleanVersion(r.tag_name),
          url: `https://get.helm.sh/helm-${r.tag_name}-windows-amd64.zip`,
        }))
    )
  },
  async minikube() {
    const rels = await ghReleases('kubernetes/minikube', 30)
    return finalize(
      rels
        .map((r) => {
          const exe = (r.assets || []).find((a) =>
            /minikube-windows-amd64\.exe$/i.test(a.name)
          )
          return exe
            ? { version: cleanVersion(r.tag_name), url: exe.browser_download_url }
            : null
        })
        .filter(Boolean)
    )
  },

  // ---------- 中间件 ----------
  async nginx() {
    const html = String(await getText('https://nginx.org/download/'))
    const set = new Set()
    for (const m of html.matchAll(/nginx-(\d+\.\d+\.\d+)\.zip/g)) set.add(m[1])
    return finalize(
      [...set].map((v) => ({
        version: v,
        url: `https://nginx.org/download/nginx-${v}.zip`,
      }))
    )
  },
  async rabbitmq() {
    const rels = await ghReleases('rabbitmq/rabbitmq-server', 30)
    return finalize(
      rels
        .map((r) => {
          const zip = (r.assets || []).find((a) => /\.zip$/i.test(a.name))
          return zip
            ? { version: cleanVersion(r.tag_name), url: zip.browser_download_url }
            : null
        })
        .filter(Boolean)
    )
  },
  async rocketmq() {
    const vs = await apacheVersions('rocketmq')
    return finalize(
      vs.map((v) => ({
        version: v,
        url: `https://archive.apache.org/dist/rocketmq/${v}/rocketmq-all-${v}-bin-release.zip`,
      })),
      10
    )
  },

  // ---------- 开发工具 ----------
  async git() {
    const rels = await ghReleases('git-for-windows/git', 30)
    return finalize(
      rels
        .map((r) => {
          const exe = (r.assets || []).find((a) => /64-bit\.exe$/i.test(a.name))
          return exe
            ? { version: cleanVersion(r.tag_name), url: exe.browser_download_url }
            : null
        })
        .filter(Boolean),
      20
    )
  },
  async cmake() {
    const rels = await ghReleases('Kitware/CMake', 30)
    return finalize(
      rels
        .map((r) => {
          const v = cleanVersion(r.tag_name)
          if (!/^\d+\.\d+\.\d+$/.test(v)) return null
          return {
            version: v,
            url: `https://github.com/Kitware/CMake/releases/download/v${v}/cmake-${v}-windows-x86_64.zip`,
          }
        })
        .filter(Boolean),
      30
    )
  },
  async mingw() {
    const rels = await ghReleases('brechtsanders/winlibs_mingw', 30)
    return finalize(
      rels
        .map((r) => {
          const zip = (r.assets || []).find(
            (a) => /winlibs-x86_64.*\.zip$/i.test(a.name)
          )
          return zip
            ? { version: cleanVersion(r.tag_name), url: zip.browser_download_url }
            : null
        })
        .filter(Boolean)
    )
  },

  // ---------- JetBrains IDE ----------
  async idea() {
    return jetbrains('IIC')
  },
  async pycharm() {
    return jetbrains('PCC')
  },
  async webstorm() {
    return jetbrains('WS')
  },
}

// JetBrains 官方 releases 接口（code: IIC=IDEA Community, PCC=PyCharm Community, WS=WebStorm）
async function jetbrains(code) {
  const j = await getJson(
    `https://data.services.jetbrains.com/products/releases?code=${code}&type=release`
  )
  const arr = j && j[code]
  return finalize(
    (Array.isArray(arr) ? arr : [])
      .map((r) => {
        const link = r.downloads?.windows?.link
        return link ? { version: String(r.version), url: link } : null
      })
      .filter(Boolean)
  )
}

// ===== 工具标识规范化 =====
// 前端后端拼出的 id 可能是 'java-jdk' / 'database-mysql' / 'frontend-node.js' 等，
// 这里统一还原成解析器的 key（如 jdk / mysql / nodejs）。
const ID_ALIASES = {
  jdk: 'jdk',
  'jdk (temurin)': 'jdk',
  temurin: 'jdk',
  openjdk: 'jdk',
  maven: 'maven',
  gradle: 'gradle',
  tomcat: 'tomcat',
  'intellij idea': 'idea',
  idea: 'idea',
  python: 'python',
  miniconda: 'miniconda',
  anaconda: 'anaconda',
  pycharm: 'pycharm',
  node: 'nodejs',
  'node.js': 'nodejs',
  nodejs: 'nodejs',
  pnpm: 'pnpm',
  yarn: 'yarn',
  'vs code': 'vscode',
  vscode: 'vscode',
  webstorm: 'webstorm',
  mysql: 'mysql',
  'mysql server': 'mysql',
  postgresql: 'postgresql',
  redis: 'redis',
  mongodb: 'mongodb',
  mariadb: 'mariadb',
  hadoop: 'hadoop',
  spark: 'spark',
  kafka: 'kafka',
  flink: 'flink',
  elasticsearch: 'elasticsearch',
  hbase: 'hbase',
  hive: 'hive',
  docker: 'docker',
  'docker desktop': 'docker',
  kubectl: 'kubectl',
  helm: 'helm',
  minikube: 'minikube',
  nginx: 'nginx',
  rabbitmq: 'rabbitmq',
  zookeeper: 'zookeeper',
  rocketmq: 'rocketmq',
  git: 'git',
  cmake: 'cmake',
  'mingw-w64': 'mingw',
  mingw: 'mingw',
}

export function canonicalToolKey(id, name) {
  let s = String(id || '')
    .toLowerCase()
    .trim()
  // 去掉分类前缀，如 python-python / database-mysql server
  s = s.replace(
    /^(java|python|frontend|database|bigdata|container|middleware|tools)[-_]/,
    ''
  )
  if (ID_ALIASES[s]) return ID_ALIASES[s]
  const n = String(name || '')
    .toLowerCase()
    .trim()
  if (ID_ALIASES[n]) return ID_ALIASES[n]
  // 名称包含匹配兜底（取最长匹配，避免 'git' 命中 'github'）
  let best = null
  for (const k of Object.keys(ID_ALIASES)) {
    if (n.includes(k) && (!best || k.length > best.length)) best = k
  }
  return best ? ID_ALIASES[best] : s
}

// ===== 对外：抓取某个工具的官网版本列表（带缓存）=====
export async function fetchVersions(idOrKey, name) {
  const key = canonicalToolKey(idOrKey, name)
  const now = Date.now()
  const hit = cache.get(key)
  if (hit && now - hit.at < CACHE_TTL) return hit.data

  const resolver = resolvers[key]
  if (!resolver) throw new Error(`暂不支持该工具的官网抓取（${key}）`)

  const data = await resolver()
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error('官网返回为空')
  }
  cache.set(key, { at: now, data })
  return data
}
