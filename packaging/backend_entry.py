"""桌面客户端内置后端的入口。

与 `python -m tam.run` 等价，但面向打包场景做了三点收敛：

1. 强制 local + web（桌面客户端只做本机网页控制台，不跑机器人）。
2. 不弹交互菜单（没有 tty 时 run.py 本来也不会弹，这里再显式关掉）。
3. 读取的数据目录 / .env 由桌面壳通过环境变量传入（`TAM_DATA_DIR` /
   `TAM_ENV_FILE`），实现「数据跟着 App 走」的绿色版体验。

打包后用 PyInstaller 编成 TAO-Backend.exe，由 Electron 壳直接拉起。
"""
from __future__ import annotations

import os
import sys


def _bootstrap_utf8() -> None:
    """Windows 下 stdout 被管道接管时默认 GBK，启动 banner 的 emoji 会把进程打崩。

    冻结环境里没有可交互的控制台，最稳妥是直接把标准流重定向成 UTF-8 文本。
    """
    os.environ.setdefault("PYTHONUTF8", "1")
    os.environ.setdefault("PYTHONIOENCODING", "utf-8")
    for name, mode in (("stdout", "w"), ("stderr", "w")):
        stream = getattr(sys, name, None)
        if stream is None:
            new = open(os.devnull, mode, encoding="utf-8", errors="replace")
            setattr(sys, name, new)
            continue
        reconfigure = getattr(stream, "reconfigure", None)
        if reconfigure is not None:
            try:
                reconfigure(encoding="utf-8", errors="replace")
            except (ValueError, OSError):
                pass


def main() -> int:
    _bootstrap_utf8()

    os.environ.setdefault("TAM_DEPLOY", "local")
    os.environ.setdefault("TAM_FRONTEND", "web")
    os.environ.setdefault("TAM_NO_MENU", "1")
    os.environ.setdefault("TAM_SUPERVISED", "1")

    from tam.run import run

    # 不在这里预读 TAM_HOST / TAM_PORT：run() 会先加载 .env 再解析，
    # 这里提前读会拿不到 .env 里写的值，导致端口被硬编码成 8848。
    try:
        run(
            deploy="local",
            frontend="web",
            host=None,
            port=None,
            skip_doctor=True,
            force=True,
            menu=False,
        )
    except KeyboardInterrupt:
        return 0
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
