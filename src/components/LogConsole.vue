<script setup>
import { ref, watch, nextTick } from 'vue'

// 底部「运行日志」控制台：黑色背景 + 等宽字体 + 自动滚动到底部
const props = defineProps({
  logs: { type: Array, default: () => [] },
})

const bodyRef = ref(null)

// 日志新增时自动滚动到最底部
watch(
  () => props.logs.length,
  () => {
    nextTick(() => {
      if (bodyRef.value) {
        bodyRef.value.scrollTop = bodyRef.value.scrollHeight
      }
    })
  }
)
</script>

<template>
  <div class="log-console">
    <div class="log-title">运行日志</div>
    <div ref="bodyRef" class="log-body">
      <p v-for="(line, i) in logs" :key="i" class="log-line">{{ line }}</p>
    </div>
  </div>
</template>

<style scoped>
.log-console {
  display: flex;
  flex-direction: column;
  height: 168px;
  background: #1e1e1e;
  color: #d4d4d4;
  border-top: 3px solid #000;
}
.log-title {
  padding: 6px 14px;
  font-size: 12px;
  letter-spacing: 1px;
  color: #9cdcfe;
  background: #252526;
  border-bottom: 1px solid #000;
}
.log-body {
  flex: 1;
  overflow-y: auto;
  padding: 10px 14px;
  font-family: Consolas, Menlo, 'Courier New', monospace;
  font-size: 12.5px;
  line-height: 1.7;
}
.log-line {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-all;
}
</style>
