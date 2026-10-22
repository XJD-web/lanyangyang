// 后端地址解析（App.vue 与 EnvReport.vue 共用，避免两处逻辑各写一份后逐渐漂移）
//
// 优先级：
//   1) 运行时配置 localStorage['lyy_api_base']，改服务器不用重新打包
//   2) 浏览器直接打开网页版（生产构建）→ 空串，即同源相对路径 /api/...
//      这样 http://IP 与 https://域名 两个入口都能用，也不会被混合内容拦截
//   3) 构建时注入的 VITE_API_BASE（Electron 内 app:// 下只能用绝对地址）
//   4) 本地开发默认 http://127.0.0.1:3000（先 npm run server）
const runtimeBase =
  typeof localStorage !== 'undefined' ? localStorage.getItem('lyy_api_base') : ''

export const API_BASE =
  runtimeBase ||
  (import.meta.env.PROD && typeof window !== 'undefined' && !window.electronAPI
    ? ''
    : import.meta.env.VITE_API_BASE || 'http://127.0.0.1:3000')

// 拼接口地址：base 为空时得到相对路径，交给浏览器按当前 origin 解析
export const apiUrl = (p) => `${API_BASE}${p}`
