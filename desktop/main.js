// TAO 桌面客户端 —— Electron 外壳
//
// 职责很窄：拉起 Python 后端，等它就绪，把网页控制台装进原生窗口；
// 窗口关闭时把后端一并结束。所有业务都在 tam/ 里，这里绝不重复实现。
//
// 两种运行形态：
//   开发（源码） ：TAO_BACKEND_EXE 不存在时，用系统/venv 的 python 跑 `-m tam.run`。
//   打包（绿色版）：随包携带 TAO-Backend.exe，直接拉起它；数据与密钥落在 exe 同级。
//
// 可用环境变量覆盖：
//   TAO_PYTHON       指定 Python 解释器（仅开发模式用；默认自动探测 .venv / python）
//   TAO_BACKEND_EXE  指定打包好的后端 exe（默认自动探测 resources/backend/TAO-Backend.exe）
//   TAO_PORT         后端端口（默认 8848）
//   TAO_BACKEND_ARGS 追加给后端的参数（空格分隔）
//   TAO_ROOT         源码仓库根目录（仅开发模式）
//   TAO_DATA_DIR     数据目录（默认：打包时在 exe 同级 data/，开发时用仓库根 data/）
'use strict';

const { app, BrowserWindow, shell, dialog, Menu } = require('electron');
const { spawn, execFile } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const DEV = process.argv.includes('--dev');
const PORT = parseInt(process.env.TAO_PORT || '8848', 10);
const PACKAGED = app.isPackaged;
const ROOT = process.env.TAO_ROOT
  ? path.resolve(process.env.TAO_ROOT)
  : path.resolve(__dirname, '..');

// 绿色版落点：优先 exe 所在目录（portable），退而求其次用 userData。
function portableRoot() {
  if (process.env.TAO_DATA_DIR) return path.resolve(process.env.TAO_DATA_DIR);
  if (!PACKAGED) return ROOT;
  // electron-builder 的 portable 目标会把真正的 exe 目录放在这个环境变量里；
  // 此时 process.execPath 指向的是临时的自解压目录，不能用它。
  const exeDir = process.env.PORTABLE_EXECUTABLE_DIR || path.dirname(process.execPath);
  try {
    fs.accessSync(exeDir, fs.constants.W_OK);
    return exeDir; // exe 同级可写 → 真正的绿色版，数据跟着程序走
  } catch (_) {
    return app.getPath('userData');
  }
}

let backend = null;       // 我们自己拉起的后端进程
let backendOwned = false; // 后端是不是这个客户端启动的（决定退出时是否要杀）
let win = null;
let quitting = false;

function iconPath() {
  const candidates = PACKAGED
    ? [path.join(process.resourcesPath, 'tao-icon.png')]
    : [path.join(ROOT, 'tam', 'assets', 'tao-icon.png')];
  return candidates.find((p) => fs.existsSync(p));
}

/** 打包后的后端 exe 路径（green build 会放到 resources/backend/）。 */
function resolveBackendExe() {
  if (process.env.TAO_BACKEND_EXE && fs.existsSync(process.env.TAO_BACKEND_EXE)) {
    return process.env.TAO_BACKEND_EXE;
  }
  if (!PACKAGED) return null;
  const cand = path.join(process.resourcesPath, 'backend', 'TAO-Backend.exe');
  return fs.existsSync(cand) ? cand : null;
}

/** 开发模式下探测一个能跑 `-m tam.run` 的 Python 解释器。 */
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

async function waitForServer(timeoutMs = 90000, intervalMs = 700) {
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

/**
 * 首次运行时生成一份最小 .env：写入主密钥、数据目录、本机免令牌。
 * 已存在则原样保留（用户可能自己改过端口/代理等）。
 */
function ensureEnvFile(dataRoot) {
  const envPath = path.join(dataRoot, '.env');
  if (fs.existsSync(envPath)) return envPath;
  const masterKey = crypto.randomBytes(32).toString('base64');
  const dataDir = path.join(dataRoot, 'data');
  const lines = [
    '# 本文件由 TAO 桌面客户端首次启动时自动生成。',
    '# 主密钥丢失 = 已保存的会话无法恢复，请离线备份本文件。',
    `TAM_MASTER_KEY=${masterKey}`,
    `TAM_DATA_DIR=${dataDir}`,
    'TAM_DEPLOY=local',
    'TAM_FRONTEND=web',
    'TAM_NO_MENU=1',
    'TAM_NO_AUTH=1',
    `TAM_PORT=${PORT}`,
    '',
  ];
  fs.writeFileSync(envPath, lines.join('\n'), 'utf8');
  return envPath;
}

function spawnBackend() {
  const dataRoot = portableRoot();
  fs.mkdirSync(dataRoot, { recursive: true });
  const envPath = ensureEnvFile(dataRoot);
  const backendExe = resolveBackendExe();

  const env = {
    ...process.env,
    // Windows 下 stdout 被管道接管时默认是 GBK，TAO 启动 banner 里的 emoji 会
    // 触发 UnicodeEncodeError 直接把后端打崩。强制 UTF-8。
    PYTHONUTF8: '1',
    PYTHONIOENCODING: 'utf-8',
    TAM_SUPERVISED: '1',
    TAM_ENV_FILE: envPath,
    TAM_DATA_DIR: path.join(dataRoot, 'data'),
    TAM_DEPLOY: process.env.TAM_DEPLOY || 'local',
    TAM_FRONTEND: process.env.TAM_FRONTEND || 'web',
    TAM_NO_MENU: '1',
    TAM_PORT: String(PORT),
  };

  let cmd;
  let args;
  let cwd;
  if (backendExe) {
    // 绿色版：直接跑随包的后端 exe，用户无需安装 Python。
    cmd = backendExe;
    args = [];
    cwd = path.dirname(backendExe);
  } else {
    // 开发模式：用解释器跑源码。
    cmd = resolvePython();
    args = ['-m', 'tam.run', '--deploy', 'local', '--frontend', 'web', '--no-menu'];
    cwd = ROOT;
  }
  const extra = (process.env.TAO_BACKEND_ARGS || '').split(' ').filter(Boolean);
  args = [...args, ...extra];

  backend = spawn(cmd, args, { cwd, env, windowsHide: true });
  backendOwned = true;
  backend.stdout.on('data', (d) => process.stdout.write(`[backend] ${d}`));
  backend.stderr.on('data', (d) => process.stderr.write(`[backend] ${d}`));
  backend.on('error', (err) => {
    const hint = backendExe
      ? `后端程序启动失败：${backendExe}\n${err.message}`
      : `找不到可用的 Python 解释器（${cmd}）。\n` +
        '请安装 Python 3.10+ 并确保它在 PATH 中，或用 TAO_PYTHON 指定路径。\n\n' + err.message;
    dialog.showErrorBox('无法启动后端', hint);
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
      const hint = resolveBackendExe()
        ? '随包的后端程序未能启动。可查看数据目录下的日志，或重新下载安装包。'
        : '请确认已安装依赖（pip install -r requirements.txt）后重试；' +
          '或在项目根目录手动运行 <code>python -m tam.run</code> 查看报错。';
      await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(
        `<!doctype html><meta charset="utf-8"><body style="margin:0;font:14px system-ui;
        display:flex;align-items:center;justify-content:center;height:100vh;background:#141824;color:#e5e9f0">
        <div style="max-width:520px;text-align:center">
        <div style="font-size:40px">⚠️</div>
        <h2>后端启动失败</h2>
        <p style="color:#fca5a5">${String(e.message || e)}</p>
        <p style="color:#9aa4b6">${hint}</p>
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
