@echo off
chcp 65001 >nul
setlocal
pushd "%~dp0"

where node >nul 2>&1
if errorlevel 1 (
  echo 未找到 Node.js，请安装 Node.js 20 或更高版本后重试。
  popd
  pause
  endlocal & exit /b 1
)

for /f "delims=" %%v in ('node -v') do set "NODE_VERSION=%%v"
node -e "process.exit(Number(process.versions.node.split('.')[0]) >= 20 ? 0 : 1)"
if errorlevel 1 (
  echo 需要 Node.js 20 或更高版本，当前版本：%NODE_VERSION%
  popd
  pause
  endlocal & exit /b 1
)

node server.mjs --open
set "EXIT_CODE=%ERRORLEVEL%"
if not "%EXIT_CODE%"=="0" if not "%EXIT_CODE%"=="130" (
  echo 服务已退出（退出码：%EXIT_CODE%），请查看上方错误信息。
  popd
  pause
  endlocal & exit /b 1
)

popd
endlocal & exit /b %EXIT_CODE%
