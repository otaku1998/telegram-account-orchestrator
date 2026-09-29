# TAO 桌面客户端（Electron）

把 TAO 网页控制台装进原生桌面窗口，并自动接管 Python 后端的生命周期。

## 它做什么

1. 启动时先探测 `http://127.0.0.1:8848`：
   - 已经有一个 TAO 在跑 → 直接连过去，不重复拉起。
   - 没有 → 拉起 `python -m tam.run --deploy local --frontend web --no-menu`，等它就绪。
2. 就绪后把网页控制台加载进窗口（固定侧栏 + 浅/深主题，桌面观感）。
3. 关窗时，如果是本客户端拉起的后端，会连同子进程一起结束。

> 壳本身不含业务逻辑。所有功能都在 `tam/`（Python）与 `tam/web/`（前端）。
> 改后端或页面后必须**完全重启**（见仓库根目录 `AGENTS.md`）。

## 开发

```bash
cd desktop
npm install          # 首次
npm start            # 启动桌面客户端
npm run dev          # 带 DevTools
```

## 打包（Windows）

```bash
cd desktop
npm run dist         # 产出 NSIS 安装包到 desktop/dist/
```

## 覆盖项（环境变量）

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `TAO_PYTHON` | 自动探测（优先 `.venv`） | Python 解释器路径 |
| `TAO_PORT` | `8848` | 后端端口 |
| `TAO_BACKEND_ARGS` | 空 | 追加给 `tam.run` 的参数，空格分隔 |
| `TAO_ROOT` | `desktop/` 的上一级 | 仓库根目录 |

## 依赖

- Node.js 18+ / npm
- Python 3.10+，且已 `pip install -r requirements.txt`（后端依赖）
