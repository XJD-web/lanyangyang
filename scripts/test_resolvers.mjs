import { fetchVersions } from './_versions.mjs'

const keys = [
  'nodejs', 'python', 'jdk', 'maven', 'gradle', 'tomcat',
  'miniconda', 'anaconda', 'vscode', 'pnpm', 'yarn',
  'postgresql', 'redis', 'mongodb', 'hadoop', 'spark', 'kafka',
  'flink', 'zookeeper', 'hbase', 'hive', 'elasticsearch',
  'kubectl', 'helm', 'minikube', 'nginx', 'rabbitmq', 'rocketmq',
  'git', 'cmake', 'mingw', 'idea', 'pycharm', 'webstorm',
  'mysql', 'docker', 'mariadb',
]

for (const k of keys) {
  const t0 = Date.now()
  try {
    const list = await fetchVersions(k)
    const dt = Date.now() - t0
    console.log(`✅ ${k.padEnd(14)} ${String(list.length).padStart(3)} 个  ${dt}ms  最新=${list[0]?.version}  ${list[0]?.url?.slice(0, 70)}`)
  } catch (e) {
    console.log(`❌ ${k.padEnd(14)} 失败: ${e.message}`)
  }
}
