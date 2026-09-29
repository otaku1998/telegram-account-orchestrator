// TAO 桌面客户端 —— Electron 外壳
//
// 职责很窄：拉起 Python 后端（tam.run），等它就绪，把网页控制台装进原生窗口；
// 窗口关闭时把后端一并结束。所有业务都在 tam/ 里，这里绝不重复实现。
//
// 可用环境变量覆盖：
//   TAO_PYTHON       指定 python 解释器（默认自动探测 python / py）
//   TAO_PORT         后端端口（默认 8848）
//   TAO_BACKEND_ARGS 追加给 tam.run 的参数（空格分隔）
//   TAO_ROOT         仓库根目录（默认取 desktop/ 的上一级）
'use strict';

const { app, BrowserWindow, shell, dialog, Menu } = require('electron');
const { spawn, execFile } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');

const DEV = process.argv.includes('--dev');
const PORT = parseInt(process.env.TAO_PORT || '8848', 10);
const ROOT = process.env.TAO_ROOT
  ? path.resolve(process.env.TAO_ROOT)
  : path.resolve(__dirname, '..');

let backend = null;      // 我们自己拉起的后端进程
let backendOwned = false; // 后端是不是这个客户端启动的（决定退出时是否要杀）
let win = null;
let quitting = false;

function iconPath() {
  const p = path.join(ROOT, 'tam', 'assets', 'tao-icon.png');
  return fs.existsSync(p) ? p : undefined;
}

/** 探测一个能跑 `-m tam.run` 的 Python 解释器。 */
function resolvePython() {
  if (process.env.TAO_PYTHON) return process.env.TAO_PYTHON;
  const venv = process.platform === 'win32'
    ? path.join(ROOT, '.venv', 'Scripts', 'python.exe')
    : path.join(ROOT, '.venv', 'bin', 'python');
  if (fs.existsSync(venv)) return venv;
  return process.platform === 'win32' ? 'python' : 'python3';
}

function baseUrl() {
  return `http://127.0.0.1:${PORT}`;
}

/** 后端是否已经在监听（用户可能自己先开了一个）。 */
function probeServer(timeoutMs = 1200) {
  return new Promise((resolve) => {
    const req = http.get(baseUrl() + '/api/system/status', (res) => {
      res.resume();
      resolve(res.statusCode >= 200 && res.statusCode < 500);
    });
    req.on('error', () => resolve(false));
    req.setTimeout(timeoutMs, () => { req.destroy(); resolve(false); });
  });
}

async function waitForServer(timeoutMs = 60000, intervalMs = 700) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await probeServer()) return true;
    if (backend && backend.exitCode !== null) {
      // 后端进程已经退了，再等也没意义
      throw new Error(`后端进程已退出（退出码 ${backend.exitCode}）`);
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return false;
}

function spawnBackend() {
  const python = resolvePython();
  const extra = (process.env.TAO_BACKEND_ARGS || '').split(' ').filter(Boolean);
  const args = ['-m', 'tam.run', '--deploy', 'local', '--frontend', 'web', '--no-menu', ...extra];
  const env = {
    ...process.env,
    // Windows 下 stdout 被管道接管时默认是 GBK，TAO 启动 banner 里的 emoji 会
    // 触发 UnicodeEncodeError 直接把后端打崩。强制 Python 用 UTF-8。
    PYTHONUTF8: '1',
    PYTHONIOENCODING: 'utf-8',
    // 让 run.py 跳过 Windows 的 supervisor 包装，由本客户端直接管家后端生命周期
    TAM_SUPERVISED: '1',
    TAM_DEPLOY: process.env.TAM_DEPLOY || 'local',
    TAM_FRONTEND: process.env.TAM_FRONTEND || 'web',
    TAM_PORT: String(PORT),
  };
  backend = spawn(python, args, { cwd: ROOT, env, windowsHide: true });
  backendOwned = true;
  backend.stdout.on('data', (d) => process.stdout.write(`[backend] ${d}`));
  backend.stderr.on('data', (d) => process.stderr.write(`[backend] ${d}`));
  backend.on('error', (err) => {
    dialog.showErrorBox('无法启动后端',
      `找不到可用的 Python 解释器（${python}）。\n\n` +
      '请安装 Python 3.10+ 并确保它在 PATH 中，或用 TAO_PYTHON 指定路径。\n\n' + err.message);
  });
  return backend;
}

function killBackend() {
  if (!backend || !backendOwned || backend.killed) return;
  const pid = backend.pid;
  if (!pid) return;
  try {
    if (process.platform === 'win32') {
      // /T 连子进程一起杀；后端自己也可能拉起子进程
      execFile('taskkill', ['/PID', String(pid), '/T', '/F']);
    } else {
      process.kill(-pid, 'SIGTERM');
    }
  } catch (e) {
    try { backend.kill('SIGTERM'); } catch (_) { /* ignore */ }
  }
}

function loadingHtml(msg) {
  return `<!doctype html><meta charset="utf-8"><body style="margin:0;font:14px system-ui;
    display:flex;align-items:center;justify-content:center;height:100vh;background:#141824;color:#e5e9f0">
    <div style="text-align:center">
      <div style="font-size:40px">✈️</div>
      <h2 style="font-weight:600">正在启动 TAO 后端…</h2>
      <p style="color:#9aa4b6">${msg}</p>
    </div></body>`;
}

function createWindow() {
  win = new BrowserWindow({
    width: 1360,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: '#141824',
    title: 'TAO — Telegram 账号管理器',
    icon: iconPath(),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // 外部链接交给系统浏览器，不在壳里开
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url) && !url.startsWith(baseUrl())) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });

  win.on('closed', () => { win = null; });
  return win;
}

async function boot() {
  win = createWindow();
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(loadingHtml('正在检查服务…')));

  let reused = false;
  if (await probeServer()) {
    reused = true; // 已经有一个 TAO 在跑，直接连过去，不重复拉起
  } else {
    spawnBackend();
  }

  try {
    const ok = await waitForServer();
    if (!ok) throw new Error('等待后端就绪超时');
  } catch (e) {
    if (win) {
      await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(
        `<!doctype html><meta charset="utf-8"><body style="margin:0;font:14px system-ui;
        display:flex;align-items:center;justify-content:center;height:100vh;background:#141824;color:#e5e9f0">
        <div style="max-width:520px;text-align:center">
        <div style="font-size:40px">⚠️</div>
        <h2>后端启动失败</h2>
        <p style="color:#fca5a5">${String(e.message || e)}</p>
        <p style="color:#9aa4b6">请确认已安装依赖（pip install -r requirements.txt）后重试；
        或在项目根目录手动运行 <code>python -m tam.run</code> 查看报错。</p>
        </div></body>`));
    }
    return;
  }

  await win.loadURL(baseUrl());
  if (DEV) win.webContents.openDevTools({ mode: 'detach' });
  win.setTitle(reused ? 'TAO — Telegram 账号管理器（已连接现有服务）' : 'TAO — Telegram 账号管理器');
}

// 单实例：第二次启动聚焦已有窗口
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
  });

  app.whenReady().then(() => {
    Menu.setApplicationMenu(null);
    boot();
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) boot(); });
  });

  app.on('window-all-closed', () => {
    quitting = true;
    killBackend();
    app.quit();
  });

  app.on('before-quit', () => { quitting = true; killBackend(); });
}
