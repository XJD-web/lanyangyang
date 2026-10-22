// 探测各官网数据源的真实版本数量，用于对齐参考实现
import axios from 'axios'
const t = 20000
const get = (u) => axios.get(u, { timeout: t }).then(r => r.data)

async function countNode() {
  const a = await get('https://nodejs.org/dist/index.json')
  return a.length
}
async function countPython() {
  let a = await get('https://www.python.org/api/v2/downloads/release/?is_published=true')
  if (a && a.results) a = a.results
  return a.length
}
async function countMaven() {
  const x = await get('https://repo.maven.apache.org/maven2/org/apache/maven/apache-maven/maven-metadata.xml')
  return (String(x).match(/<version>/g) || []).length
}
async function countTomcat() {
  const x = await get('https://repo.maven.apache.org/maven2/org/apache/tomcat/tomcat/maven-metadata.xml')
  return (String(x).match(/<version>/g) || []).length
}
async function countAdoptium() {
  const j = await get('https://api.adoptium.net/v3/info/available_releases')
  return { total: j.available_releases.length, lts: j.available_lts_releases.length, arr: j.available_releases }
}
async function countPg() {
  const a = await get('https://www.postgresql.org/versions.json')
  return { total: a.length, supported: a.filter(v => v.supported).length, arr: a.map(v => v.major + '.' + v.latestMinor) }
}
async function countMiniconda() {
  const html = String(await get('https://repo.anaconda.com/miniconda/'))
  const set = new Set()
  for (const m of html.matchAll(/Miniconda3-py(\d+\.\d+\.\d+)-/g)) set.add(m[1])
  return set.size
}
async function countGh(owner, repo) {
  const a = await get(`https://api.github.com/repos/${owner}/${repo}/releases?per_page=30`)
  return Array.isArray(a) ? { n: a.length, first: a[0]?.tag_name } : { err: a }
}

const results = {}
const tasks = {
  node: countNode,
  python: countPython,
  maven: countMaven,
  tomcat: countTomcat,
  adoptium: countAdoptium,
  pg: countPg,
  miniconda: countMiniconda,
}
await Promise.all(Object.entries(tasks).map(async ([k, fn]) => {
  try { results[k] = await fn() } catch (e) { results[k] = 'ERR ' + e.message }
}))
try { results.gitwin = await countGh('git-for-windows', 'git') } catch (e) { results.gitwin = 'ERR ' + e.message }
try { results.elastic = await (async () => { const x = await get('https://artifacts.elastic.co/maven/org/elasticsearch/elasticsearch/maven-metadata.xml'); return (String(x).match(/<version>/g) || []).length })() } catch (e) { results.elastic = 'ERR ' + e.message }
console.log(JSON.stringify(results, null, 2))
