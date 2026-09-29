# AGENTS.md — 给 AI / 开发者的工作须知

本文件约束在本仓库里干活的自动化 Agent（以及人类开发者）。动手前先读
[`FOR_AI.md`](FOR_AI.md)（架构与魔改配方）；本文件只讲**工作流硬规则**。

---

## 1. 本项目一句话

自托管 **Telegram 多账号管理器（TAO）**：Telethon 会话 Fernet 加密存 SQLite，
对外提供 FastAPI 网页控制台 / 桌面客户端 / Telegram 机器人 / CLI / MCP / Agent 工具层。

- Python 包根目录：`tam/`（`python -m tam.cli ...`）
- 桌面客户端：`desktop/`（Electron，见 §5）
- 前端源码：`tam/web/`（`index.src.html` + `styles.css` + `app.js` → `build.py` → `index.html`）

---

## 2. 铁律：改完代码必须**完全重启**服务

**任何后端（`tam/*.py`）改动都不会热生效。** 进程启动时已经把
`config.Settings`、工具注册表、路由、Telegram 连接池都读进内存了，
改文件后**必须彻底重启**，不要只刷新页面、也不要只点顶栏的「热重载」，
除非你确认那次重启真的把进程换掉了。

完整重启步骤：

```powershell
# 1. 停掉正在跑的服务（Ctrl+C，或关掉启动它的终端 / 桌面客户端）
# 2. 确认端口 8848 已经没有进程占用
Get-NetTCPConnection -LocalPort 8848 -ErrorAction SilentlyContinue

# 3. 重新启动
python -m tam.cli serve            # 仅网页控制台
# 或
python -m tam.cli run              # 按 .env 的 TAM_DEPLOY / TAM_FRONTEND
# 或
python -m tam.launcher             # 桌面启动器（Tkinter）
# 或
cd desktop; npm start              # Electron 桌面客户端
```

规则细节：

- 改了 `.env` / 主密钥 / 并发等参数：**必须重启**（部分参数重启后才写回并生效）。
- 改了前端源文件（`index.src.html` / `styles.css` / `app.js`）：先
  `python tam/web/build.py` 重新生成单文件 `index.html`，再重启服务。**只改 `index.html`
  不算数**——它是构建产物，下次构建会被覆盖。
- 改了 `tam/web/index.html` 本身：直接重启即可（但要同步回源文件，见上条）。
- 判断「到底有没有重启成功」：看启动 banner 的 `TAM 启动：部署=... 前端=...`，
  或访问 `GET /api/system/status`。
- 「热重载」按钮走 `os.execv` 换进程，理论上算完整重启；但**依赖旧进程状态、
  端口未释放、或 Windows 上没有 supervisor 时可能失效**，所以本地开发请手动重启，
  不要赌它。

---

## 3. 每次改动完成后的验收清单

1. 语法/静态检查：`python -m compileall tam`（至少覆盖你改过的文件）。
2. 相关测试：见 §6；改加密 / 导入 / ZIP / 清设备 / 工具箱时**必须**跑对应测试。
3. 前端改动：`python tam/web/build.py` 必须成功，且 `index.html` 里没有
   `PLACEHOLDER` 残留。
4. **完全重启服务**（§2）后，用浏览器/客户端实测受影响的功能。
5. 更新文档：`README.md`、`FOR_AI.md`、网页「帮助」按需同步。
6. 需要 Agent 也能用的能力，**双注册**：`toolbox.py`（网页）+ `tools.py`（AI/MCP），
   详见 `FOR_AI.md` §8–§9。

---

## 4. 桌面客户端（`desktop/`）

- Electron 壳，启动后自动拉起后端，再把网页控制台装进原生窗口；
  窗口关闭时一并结束后端。
- 开发：`cd desktop && npm install && npm start`（用系统/venv 的 Python 跑 `-m tam.run`）
- 打包绿色版：先 `npm run backend:build`（PyInstaller 打出内置 `dist/TAO-Backend/`），
  再 `npm run dist`（Windows 出免安装单文件 `TAO-Portable-<版本>.exe`，
  内含后端，用户无需装 Python）。产物在 `desktop/dist/`。
- 绿色版首次运行在 exe 同级生成 `.env`（随机主密钥）+ `data/`；exe 目录不可写时回退用户数据目录。
- 后端可执行/解释器路径等通过环境变量覆盖：`TAO_PYTHON`、`TAO_BACKEND_EXE`、
  `TAO_PORT`、`TAO_BACKEND_ARGS`、`TAO_ROOT`、`TAO_DATA_DIR`。
- 桌面客户端只是壳；**业务与 UI 都在 `tam/`**，改功能请改 Python / 网页前端，
  不要在桌面壳里重复实现。

---

## 5. 推送到 GitHub（收尾步骤）

远程仓库：`https://github.com/otaku1998/telegram-account-orchestrator`（主分支 `main`）。

**只有在用户明确要求时才提交/推送。** 推送流程：

```powershell
git status                     # 看清哪些文件要进这次提交
git diff                       # 复核改动（尤其别把密钥/数据带进去）
git add -A
git commit -m "feat: <一句话说明>"   # 提交信息用祈使句，遵循仓库现有风格
git push origin main
```

提交前**必须**确认以下内容没被 add（`.gitignore` 已覆盖，但人工再扫一眼）：

- `.env`、`data/`、`*.session`、任何真实 token / 密钥 / 号包。
- `reference-cockpit/`：仅作 UI 参考，**不进版本库**。
- `desktop/node_modules/`、`desktop/dist/` 等构建产物。

---

## 6. 测试与常用命令

```powershell
python -m compileall tam                       # 语法检查
python -m tam.cli doctor --fix                 # 一键体检查依赖/密钥/数据库
python -m tam.cli serve                        # 仅网页
python -m tam.cli run                          # 统一入口（部署×前端）
python tam/web/build.py                        # 重建单文件 index.html
python -m tam.tests.t_zhenghe                  # 内核/工具箱/参数转换等
```

- 网页 + 机器人都默认只监听 `127.0.0.1`；对外暴露前先读 `SECURITY.md`。
- 详细目录地图、数据模型、API 清单、魔改配方见 `FOR_AI.md`。
