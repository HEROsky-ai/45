@echo off
title 症狀圖片資料庫伺服器
echo 正在啟動本機伺服器...
start /min python -m http.server 8080
timeout /t 1 >nul
start http://localhost:8080
exit
