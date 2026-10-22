import { createApp } from 'vue'
import ElementPlus from 'element-plus'
import 'element-plus/dist/index.css'
import App from './App.vue'

// 渲染进程入口：挂载 Vue 应用并全局引入 Element Plus
createApp(App).use(ElementPlus).mount('#app')
