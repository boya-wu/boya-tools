# Boya Tools 🧰

[![Python](https://img.shields.io/badge/Python-3.12%2B-blue?logo=python&logoColor=white)](https://www.python.org/)
[![Flask](https://img.shields.io/badge/Flask-3.0%2B-lightgrey?logo=flask&logoColor=white)](https://flask.palletsprojects.com/)
[![yt-dlp](https://img.shields.io/badge/yt--dlp-Latest-red?logo=youtube&logoColor=white)](https://github.com/yt-dlp/yt-dlp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

**Boya Tools** 是一個整合了 YouTube 影音擷取與 PDF 書籍檢索下載的萬用 Web 工具箱。基於 Flask 輕量級後端與現代化 Web 前端，提供極致流暢的操作體驗。

---

## 🌟 特色功能

### 🎥 YouTube 影音下載與管理
- **多功能搜尋**：支援全局關鍵字搜尋、頻道搜尋及播放清單解析。
- **音訊自動轉檔**：一鍵下載 YouTube 影片並轉檔為高品質 MP3 或 M4A 音訊。
- **批次字幕查詢**：多線程（Multi-threaded）批次檢測多個影片的字幕與自動語音辨識（ASR）狀態，支援結果串流（NDJSON Stream）即時回傳。

### 📚 PDF 書籍搜尋與驗證
- **無縫搜尋**：整合 DuckDuckGo 免 API 快速檢索網路上的公開 PDF 電子書。
- **網址智慧解析**：支援將 Google Drive、Archive.org 及 GitHub 原生網址自動轉換為直接下載連結。
- **內容品質驗證**：自動解析 PDF 結構並檢驗頁數（預設過濾少於 50 頁的預覽頁或登入限制頁），確保下載到的均為完整書籍內容。

---

## 📂 專案目錄結構

```
boya-tools/
├── bin/                       # 啟動與隱藏執行指令檔 (Windows/Linux/macOS)
│   ├── run_hidden.vbs         # Windows 自動背景靜態執行 (Startup 捷徑對象)
│   ├── run_server.bat         # Windows 連接埠衝突自動清理與伺服器啟動腳本
│   └── start.sh               # macOS/Linux 一鍵設定與啟動腳本
├── docs/                      # 相關參考文件
│   └── yt-dlp README.md       # yt-dlp 完整命令指南
├── static/                    # 前端使用者介面資源 (HTML, CSS, JS)
│   ├── index.html             # 現代感設計網頁主體
│   ├── app.js                 # 異步請求與串流資料渲染邏輯
│   └── style.css              # 精美毛玻璃與動態微動畫 UI 樣式
├── tests/                     # 單元測試與工具腳本
│   └── test_comments.py
├── requirements.txt           # 專案依賴套件表
├── server.py                  # Flask 主應用程式服務
└── README.md                  # 本說明文件
```

---

## 🚀 啟動指南

### 1. Windows 系統

#### 🛠️ 初次手動部署 (PowerShell)
請在專案根目錄下依序執行：
```powershell
# 1. 建立 Python 虛擬環境
python -m venv venv

# 2. 啟用並更新 pip，然後安裝依賴套件
.\venv\Scripts\python -m pip install --upgrade pip
.\venv\Scripts\pip install -r requirements.txt
```

#### ⚡ 一鍵開發啟動
雙擊執行 `bin/run_server.bat`，將會自動清除佔用 `5001` 埠的舊程序，並隨即啟動伺服器。

#### 👤 背景靜態運行 (開機自動啟動)
本專案支援將 `bin/run_hidden.vbs` 的捷徑放入 Windows `Startup` 目錄，開機後系統將自動於背景悄悄運行，不會彈出任何終端機視窗。

---

### 2. macOS / Linux 系統
在終端機中執行內建的啟動腳本：
```bash
# 賦予執行權限
chmod +x bin/start.sh

# 執行啟動與部署腳本
./bin/start.sh
```

---

## 🌐 瀏覽器存取

伺服器成功啟動後，請在瀏覽器中開啟以下網址：
- **[http://127.0.0.1:5001](http://127.0.0.1:5001)**

---

## 📝 授權條款
本專案採用 **MIT 授權條款** 進行開源發佈。
