@echo off
setlocal
cd /d "%~dp0"
rem 与 start-local.cmd 的 48188 端口配套；直接 npm run dev 则仍代理默认的 59188。
set "XIANYU_DEV_API_TARGET=http://127.0.0.1:48188"
npm --prefix frontend run dev
