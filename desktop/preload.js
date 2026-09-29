// 预加载脚本：目前壳不需要给页面注入任何特权 API。
// 保留占位是为了后续需要在原生菜单/文件对话框等能力时，按 contextBridge 安全地暴露。
'use strict';

const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('taoDesktop', {
  version: process.versions.electron,
  platform: process.platform,
});
