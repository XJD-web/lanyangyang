import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import electron from 'vite-plugin-electron'

// Vite 配置：开发时同时拉起渲染进程（Vue）与主进程（Electron）
export default defineConfig({
  plugins: [
    vue(),
    electron([
      { entry: 'electron/main.js' },   // 主进程入口
      { entry: 'electron/preload.js' }, // 预加载脚本（暴露原生能力给渲染进程）
    ]),
  ],
  server: {
    port: 5173,
    strictPort: false,
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
})
