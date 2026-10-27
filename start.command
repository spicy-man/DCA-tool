#!/bin/zsh -l

# Finder 双击时也使用登录环境，并从启动器所在目录运行。
cd -- "${0:A:h}" || exit 1

fail() {
  print -r -- "$1"
  if [[ -t 0 ]]; then
    read -r "?按回车键关闭窗口…"
  fi
  exit 1
}

command -v node >/dev/null 2>&1 || fail "未找到 Node.js，请安装 Node.js 20 或更高版本后重试。"
node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 20 ? 0 : 1)' \
  || fail "需要 Node.js 20 或更高版本，当前版本：$(node --version)"

node server.mjs --open
result=$?
if (( result != 0 && result != 130 )); then
  fail "服务已退出（退出码：${result}），请查看上方错误信息。"
fi
exit "$result"
