<script setup>
import { computed } from 'vue'

// 单张工具卡片：展示软件名称、状态、版本、操作与安装进度
const props = defineProps({
  tool: { type: Object, required: true },
  // 网页版（浏览器打开）没有 Electron 能力，安装/配置按钮需要置灰
  canOperate: { type: Boolean, default: true },
})
const emit = defineEmits(['install', 'config', 'version-change'])

// 是否已配置（决定状态标签的颜色与文案）
const isInstalled = computed(() => props.tool.status === 'installed')
// 是否正在安装中（进度条处于 0~100 之间）
const installing = computed(
  () => props.tool.progress > 0 && props.tool.progress < 100
)

// 字节数格式化（用于显示「42.7 MB / 231.5 MB」）
function fmtBytes(n) {
  if (!n) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)))
  return `${(n / Math.pow(1024, i)).toFixed(1)} ${units[i]}`
}
// 下载字节数文案（仅有总大小、且正在安装时展示）
const bytesText = computed(() => {
  const t = props.tool
  if (!t.total) return ''
  return `${fmtBytes(t.loaded || 0)} / ${fmtBytes(t.total)}`
})
</script>

<template>
  <el-card class="tool-card" shadow="hover">
    <!-- 名称 + 状态标签 -->
    <div class="tool-header">
      <span class="tool-name">{{ tool.name }}</span>
      <el-tag
        :type="isInstalled ? 'success' : 'danger'"
        effect="light"
        size="small"
        round
      >
        {{ isInstalled ? '✓ 已配置' : '○ 未安装' }}
      </el-tag>
    </div>

    <p class="tool-desc">{{ tool.desc }}</p>

    <!-- 版本选择下拉框 -->
    <el-select
      v-model="tool.selectedVersion"
      class="version-select"
      placeholder="选择版本"
      filterable
      @change="(v) => emit('version-change', { tool, version: v })"
    >
      <el-option v-for="v in tool.versions" :key="v" :label="v" :value="v" />
    </el-select>

    <!-- 操作按钮：下载并安装（主色调） + 配置环境变量 -->
    <!-- 网页版会置灰并给出原因提示，避免点了以后静默失败 -->
    <div class="tool-actions">
      <el-button
        type="primary"
        :loading="installing"
        :disabled="!canOperate"
        :title="canOperate ? '' : '安装需要读写本机磁盘，请使用桌面客户端'"
        @click="emit('install', tool)"
      >
        {{ installing ? '安装中…' : '下载并安装' }}
      </el-button>
      <el-button
        :disabled="!canOperate"
        :title="canOperate ? '' : '配置环境变量需要修改本机注册表，请使用桌面客户端'"
        @click="emit('config', tool)"
      >
        配置环境变量
      </el-button>
    </div>

    <!-- 安装路径提示 -->
    <p class="install-path">安装到: {{ tool.installPath }}</p>

    <!-- 检测到的真实已装版本 -->
    <p v-if="tool.installedVersion" class="detected-version">
      已装版本: {{ tool.installedVersion }}
    </p>

    <!-- 进度条（默认 0%）-->
    <el-progress
      :percentage="tool.progress"
      :stroke-width="10"
      :status="isInstalled ? 'success' : undefined"
    />
    <!-- 下载字节数（如 42.7 MB / 231.5 MB）-->
    <div v-if="bytesText" class="dl-bytes">{{ bytesText }}</div>
  </el-card>
</template>

<style scoped>
.tool-card {
  border-radius: 10px;
  border: 1px solid #ebeef5;
}
.tool-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.tool-name {
  font-size: 22px;
  font-weight: 700;
  color: #303133;
  letter-spacing: 0.5px;
}
.tool-desc {
  color: #909399;
  font-size: 13px;
  margin: 8px 0 16px;
  min-height: 18px;
}
.version-select {
  width: 100%;
  margin-bottom: 14px;
}
.tool-actions {
  display: flex;
  gap: 10px;
  margin-bottom: 12px;
}
.tool-actions .el-button {
  flex: 1;
}
.install-path {
  font-size: 12px;
  color: #909399;
  margin: 0 0 12px;
  word-break: break-all;
  font-family: Consolas, Menlo, monospace;
}
.detected-version {
  font-size: 12px;
  color: #67c23a;
  margin: 0 0 12px;
  font-weight: 600;
}
.dl-bytes {
  margin-top: 6px;
  text-align: right;
  font-size: 12px;
  color: #909399;
  font-family: Consolas, Menlo, monospace;
}
</style>
