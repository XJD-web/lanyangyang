<script setup>
// 环境报告：展示「桌面端检测出来」的结果。
// 浏览器自己检测不了本机环境，但可以看别人/自己上传上来的报告——
// 桌面端检测完自动 POST 到这里，网页端只负责读。
import { ref, computed, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { Refresh } from '@element-plus/icons-vue'
import axios from 'axios'
import { apiUrl } from '../api'
import { categories } from '../data/tools'

const props = defineProps({
  // 删除属于破坏性操作，只在桌面端放开
  canDelete: { type: Boolean, default: false },
})

const loading = ref(false)
const reports = ref([])
const activeId = ref('')
const detail = ref(null)
const detailLoading = ref(false)
const fileInput = ref(null)

const p2 = (n) => String(n).padStart(2, '0')
function fmt(t) {
  const d = new Date(t)
  if (Number.isNaN(d.getTime())) return '-'
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}`
}

// 列表只取摘要（设备/时间/已装数），详情点开再拉，报告多了也不会一次拖很慢
async function loadList(openFirst = true) {
  loading.value = true
  try {
    const { data } = await axios.get(apiUrl('/api/reports'), { timeout: 10000 })
    reports.value = data.reports || []
    // 默认打开最新一份；若当前选中的报告已被删除，也回落到最新一份
    const stillThere = reports.value.some((r) => r.id === activeId.value)
    if (reports.value.length && (openFirst || !stillThere)) {
      await openReport(reports.value[0].id)
    } else if (!reports.value.length) {
      activeId.value = ''
      detail.value = null
    }
  } catch (_) {
    ElMessage.warning('报告列表加载失败，请确认后端服务可用')
  } finally {
    loading.value = false
  }
}

async function openReport(id) {
  activeId.value = id
  detailLoading.value = true
  try {
    const { data } = await axios.get(apiUrl(`/api/reports/${id}`), { timeout: 10000 })
    detail.value = data.report
  } catch (_) {
    detail.value = null
    ElMessage.error('报告详情读取失败')
  } finally {
    detailLoading.value = false
  }
}

// 触发隐藏的文件选择框（<script setup> 里拿不到 $refs，必须走 ref 变量）
function pickFile() {
  if (fileInput.value) fileInput.value.click()
}

// 桌面端导出的 JSON 可以在任何地方导入，包括网页版
async function onFileChange(e) {
  const file = e.target.files && e.target.files[0]
  e.target.value = '' // 允许重复选择同一个文件
  if (!file) return
  try {
    const raw = JSON.parse(await file.text())
    const body = raw.report || raw
    if (!Array.isArray(body.tools) || body.tools.length === 0) {
      throw new Error('不是有效的环境报告')
    }
    const { data } = await axios.post(apiUrl('/api/reports'), body, { timeout: 15000 })
    ElMessage.success('报告已导入')
    await loadList()
    if (data.id) await openReport(data.id)
  } catch (err) {
    ElMessage.error(`导入失败：${err.message}`)
  }
}

async function removeReport(r, ev) {
  ev.stopPropagation()
  try {
    await axios.delete(apiUrl(`/api/reports/${r.id}`))
    ElMessage.success('已删除')
    if (activeId.value === r.id) {
      activeId.value = ''
      detail.value = null
    }
    loadList()
  } catch (_) {
    ElMessage.error('删除失败')
  }
}

// 按分类分组，顺序沿用顶部 Tab 的定义
const grouped = computed(() => {
  if (!detail.value) return []
  const map = new Map()
  for (const t of detail.value.tools || []) {
    const k = t.category || 'tools'
    if (!map.has(k)) map.set(k, [])
    map.get(k).push(t)
  }
  const order = categories.filter((c) => c.key !== 'all').map((c) => c.key)
  return [...map.entries()]
    .sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0]))
    .map(([k, list]) => ({
      key: k,
      label: (categories.find((c) => c.key === k) || {}).label || k,
      installed: list.filter((t) => t.installed).length,
      list: [...list].sort((a, b) => Number(b.installed) - Number(a.installed)),
    }))
})

const detailStat = computed(() => {
  const list = (detail.value && detail.value.tools) || []
  return { installed: list.filter((t) => t.installed).length, total: list.length }
})

onMounted(() => loadList())
</script>

<template>
  <div class="env-report">
    <!-- 顶部说明 + 操作 -->
    <div class="rp-bar">
      <div class="rp-tip">
        报告由<strong>桌面客户端</strong>检测后自动上传；浏览器本身读不到本机环境，这里只做查看。
      </div>
      <div class="rp-actions">
        <input ref="fileInput" type="file" accept=".json,application/json" class="rp-file" @change="onFileChange" />
        <el-button size="small" @click="pickFile">导入 JSON</el-button>
        <el-button size="small" :icon="Refresh" :loading="loading" @click="loadList()">刷新</el-button>
      </div>
    </div>

    <div class="rp-body">
      <!-- 左：报告列表 -->
      <div class="rp-list">
        <el-empty v-if="!reports.length && !loading" description="还没有报告" :image-size="70" />
        <div
          v-for="r in reports"
          :key="r.id"
          class="rp-item"
          :class="{ active: r.id === activeId }"
          @click="openReport(r.id)"
        >
          <div class="rp-item-top">
            <span class="rp-device" :title="r.device">{{ r.device }}</span>
            <el-tag v-if="canDelete" size="small" type="danger" effect="plain" @click="removeReport(r, $event)">
              删除
            </el-tag>
          </div>
          <div class="rp-item-sub">{{ fmt(r.createdAt) }}</div>
          <div class="rp-item-sub">
            已装 <b class="rp-ok">{{ r.installed }}</b> / {{ r.total }}
          </div>
        </div>
      </div>

      <!-- 右：报告详情 -->
      <div v-loading="detailLoading" class="rp-detail">
        <el-empty v-if="!detail" description="选择左侧一份报告查看详情" :image-size="80" />
        <template v-else>
          <div class="rp-head">
            <div class="rp-head-main">
              <div class="rp-head-title">{{ detail.device }}</div>
              <div class="rp-head-sub">{{ detail.os }} · {{ fmt(detail.createdAt) }}</div>
              <div v-if="detail.workspace" class="rp-head-sub">工作空间：{{ detail.workspace }}</div>
            </div>
            <div class="rp-head-stat">
              <b class="rp-ok">{{ detailStat.installed }}</b>
              <span>/ {{ detailStat.total }}</span>
            </div>
          </div>

          <div v-for="g in grouped" :key="g.key" class="rp-group">
            <div class="rp-group-title">
              {{ g.label }}
              <span class="rp-group-count">{{ g.installed }}/{{ g.list.length }}</span>
            </div>
            <div v-for="t in g.list" :key="t.id" class="rp-row">
              <span class="rp-dot" :class="{ on: t.installed }"></span>
              <span class="rp-name">{{ t.name }}</span>
              <span class="rp-ver">{{ t.installed ? t.version || '已安装' : '未安装' }}</span>
              <span class="rp-path" :title="t.path">{{ t.path }}</span>
            </div>
          </div>
        </template>
      </div>
    </div>
  </div>
</template>

<style scoped>
.env-report {
  display: flex;
  flex-direction: column;
  height: 540px;
}
.rp-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding-bottom: 10px;
  border-bottom: 1px solid #ebeef5;
}
.rp-tip {
  font-size: 12px;
  color: #909399;
  line-height: 1.5;
}
.rp-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}
.rp-file {
  display: none;
}
.rp-body {
  display: flex;
  flex: 1;
  min-height: 0;
  padding-top: 10px;
}
.rp-list {
  width: 240px;
  flex-shrink: 0;
  overflow-y: auto;
  padding-right: 8px;
  border-right: 1px solid #ebeef5;
}
.rp-item {
  padding: 9px 10px;
  border-radius: 8px;
  cursor: pointer;
  border: 1px solid transparent;
  margin-bottom: 4px;
  transition: background 0.15s;
}
.rp-item:hover {
  background: #f7f8fa;
}
.rp-item.active {
  background: #f2f6ff;
  border-color: #c6d9ff;
}
.rp-item-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
}
.rp-device {
  font-size: 13px;
  font-weight: 500;
  color: #303133;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.rp-item-sub {
  font-size: 12px;
  color: #909399;
  margin-top: 2px;
}
.rp-ok {
  color: #1a7f37;
  font-weight: 500;
}
.rp-detail {
  flex: 1;
  min-width: 0;
  overflow-y: auto;
  padding-left: 16px;
}
.rp-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 2px 0 12px;
  border-bottom: 1px solid #f0f1f3;
  margin-bottom: 10px;
}
.rp-head-title {
  font-size: 15px;
  font-weight: 500;
  color: #303133;
}
.rp-head-sub {
  font-size: 12px;
  color: #909399;
  margin-top: 3px;
}
.rp-head-stat {
  font-size: 13px;
  color: #909399;
  white-space: nowrap;
}
.rp-head-stat b {
  font-size: 20px;
}
.rp-group {
  margin-bottom: 12px;
}
.rp-group-title {
  font-size: 12px;
  font-weight: 500;
  color: #606266;
  padding: 4px 0 6px;
}
.rp-group-count {
  color: #a8abb2;
  font-weight: 400;
  margin-left: 6px;
}
.rp-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 0;
  font-size: 13px;
  border-bottom: 1px dashed #f2f3f5;
}
.rp-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #dcdfe6;
  flex-shrink: 0;
}
.rp-dot.on {
  background: #1a7f37;
}
.rp-name {
  width: 120px;
  flex-shrink: 0;
  color: #303133;
}
.rp-ver {
  width: 90px;
  flex-shrink: 0;
  color: #606266;
  font-family: ui-monospace, Consolas, Monaco, monospace;
  font-size: 12px;
}
.rp-path {
  flex: 1;
  min-width: 0;
  color: #a8abb2;
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  direction: rtl;
  text-align: left;
}
</style>
