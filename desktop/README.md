# TAO 桌面客户端（Electron）

把 TAO 网页控制台装进原生桌面窗口，并自动接管 Python 后端的生命周期。

## 它做什么

1. 启动时先探测 `http://127.0.0.1:8848`：
   - 已经有一个 TAO 在跑 → 直接连过去，不重复拉起。
   - 没有 → 拉起后端（见下「两种形态」），等它就绪。
2. 就绪后把网页控制台加载进窗口（固定侧栏 + 浅/深主题，桌面观感）。
3. 关窗时，如果是本客户端拉起的后端，会连同子进程一起结束。

> 壳本身不含业务逻辑。所有功能都在 `tam/`（Python）与 `tam/web/`（前端）。
> 改后端或页面后必须**完全重启**（见仓库根目录 `AGENTS.md`）。

## 两种运行形态

| 形态 | 后端来源 | 数据/密钥落点 |
| --- | --- | --- |
| 开发（源码） | 系统/venv 的 Python 跑 `-m tam.run` | 仓库根 `data/`、根 `.env` |
| 打包（绿色版） | 随包携带的 `resources/backend/TAO-Backend.exe` | 绿色版 exe 同级 `data/`、`.env` |

绿色版首次运行会在 exe 同级生成 `.env`（含随机主密钥）与 `data/`；若该目录不可写
（只读盘 / Program Files），自动回退到用户数据目录。

## 开发

```bash
cd desktop
npm install          # 首次
npm start            # 启动桌面客户端（开发模式）
npm run dev          # 带 DevTools
```

## 打包绿色版（Windows，免安装单文件）

```bash
cd desktop
npm run backend:build   # 1) PyInstaller 打出内置后端 dist/TAO-Backend/
npm run dist            # 2) electron-builder 产出 TAO-Portable-<版本>.exe
```

产物在 `desktop/dist/TAO-Portable-<版本>.exe`，已内置 Python 后端，
**终端用户无需安装 Python / pip**，双击即用。整个 exe 拷到任意可写目录都能跑，
数据跟着 exe 走。

## 覆盖项（环境变量）

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `TAO_PYTHON` | 自动探测（优先 `.venv`） | 开发模式的 Python 解释器路径 |
| `TAO_BACKEND_EXE` | `resources/backend/TAO-Backend.exe` | 打包后端的可执行文件路径 |
| `TAO_PORT` | `8848` | 后端端口 |
| `TAO_BACKEND_ARGS` | 空 | 追加给后端的参数，空格分隔 |
| `TAO_ROOT` | `desktop/` 的上一级 | 开发模式的仓库根目录 |
| `TAO_DATA_DIR` | exe 同级（绿色版）/ 仓库根（开发） | 数据目录 |

## 依赖

- 开发模式：Node.js 18+ / npm、Python 3.10+ 且已 `pip install -r requirements.txt`。
- 打绿色版：额外需要 `pyinstaller`（在 `.venv` 中），以及 `electron-builder`（随 `npm install`）。
