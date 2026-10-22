import { contextBridge, ipcRenderer } from 'electron'

// 通过 contextBridge 把主进程能力安全地暴露给渲染进程（window.electronAPI）
// 渲染进程永远无法直接访问 Node / Electron 内部 API，只能调用这里白名单中的方法
contextBridge.exposeInMainWorld('electronAPI', {
  // 打开系统文件夹选择框，返回选中的路径
  selectWorkspace: () => ipcRenderer.invoke('select-workspace'),

  // 返回默认安装根目录（当前用户目录下 .env-tools），用于初始化工作空间
  getDefaultWorkspace: () => ipcRenderer.invoke('get-default-workspace'),

  // 检测某软件是否已安装
  // payload: { id, check, markers }
  //   check   => 命令行可执行名（如 'java'），用于在 PATH 中快速判定
  //   markers => 安装目录下用于“全盘盘符扫描”的标志文件（如 ['bin/java.exe']）
  // 返回 { installed, output, path, via }
  //   via: 'path'（命令在 PATH 中）| 'disk'（全盘扫描命中标志文件）| null
  //   path: 扫描到的安装根目录（HOME），找不到则为 undefined
  checkEnv: (payload) => ipcRenderer.invoke('check-env', payload),

  // 从官网实时获取某工具的版本列表
  // payload: { id, name }
  // 返回 { ok: true, versions: [{ version, url }] } 或 { ok: false, error }
  getVersions: (payload) => ipcRenderer.invoke('get-versions', payload),

  // 触发安装（模拟下载+解压），返回最终 { success, path }
  // payload: { name, downloadUrl, targetPath, version }
  runInstall: (payload) => ipcRenderer.invoke('run-install', payload),

  // 一键配置环境变量（当前用户），返回 { success }
  // payload: { id, name, installPath }
  configEnv: (payload) => ipcRenderer.invoke('config-env', payload),

  // 取本机标识（主机名/系统/架构），用于生成环境报告
  getDeviceInfo: () => ipcRenderer.invoke('get-device-info'),

  // 把环境报告写成 JSON 文件（弹系统另存为对话框）
  // payload: 报告对象；返回 { success, path } 或 { success:false, canceled:true }
  saveReport: (payload) => ipcRenderer.invoke('save-report', payload),

  // 监听下载进度：回调收到 { name, progress }
  // 返回一个取消监听的函数，便于组件卸载时清理
  onDownloadProgress: (callback) => {
    const listener = (_event, data) => callback(data)
    ipcRenderer.on('download-progress', listener)
    return () => ipcRenderer.removeListener('download-progress', listener)
  },

  // 监听日志消息：回调收到字符串文本（如 "[JDK] 开始下载..."）
  onLogMessage: (callback) => {
    const listener = (_event, text) => callback(text)
    ipcRenderer.on('log-message', listener)
    return () => ipcRenderer.removeListener('log-message', listener)
  },
})
