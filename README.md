# 📈 0050 股票即時行情每日 LINE 推播機器人

這是一個使用 **TypeScript (Node.js)** 開發的自動化通知專案。利用 **yahoo-finance2** 取得元大台灣50 (`0050.TW`) 最新交易數據，並透過 **LINE Messaging API (Push Message)** 與 **GitHub Actions** 免費排程，在台灣時間每週一至週五早上 09:30 自動推播當前盤況通知至您的 LINE。

---

## 📁 專案架構

```text
.
├── .github/
│   └── workflows/
│       └── stock.yml         # GitHub Actions 每日排程工作流 (台灣時間 09:30)
├── notify.ts                 # 核心腳本：抓取股價、格式化訊息並發送 LINE 推播
├── package.json              # 專案相依套件與執行指令設定
├── tsconfig.json             # TypeScript 編譯設定
├── .env.example              # 本地環境變數範例檔
├── .gitignore                # Git 忽略清單 (忽略 .env、node_modules、dist)
└── README.md                 # 專案說明文件
```

---

## 🔑 前置作業：獲取 LINE API 憑證

要使用 LINE 推播通知，您需要至 [LINE Developers Console](https://developers.line.biz/console/) 建立一個免費的 Messaging API 頻道：

1. **登入並建立 Provider**：
   * 進入 LINE Developers Console，使用您個人的 LINE 帳號登入。
   * 點選 **Create a new provider**（例如命名為 `MyBot`）。

2. **建立 Messaging API Channel**：
   * 在剛建立的 Provider 下點選 **Create a Messaging API channel**。
   * 填寫頻道名稱（例如 `股市通知小助手`）、描述、類別等，點選確認建立。

3. **取得 `LINE_USER_ID` (您個人的識別碼)**：
   * 進入該 Channel，切換到 **Messaging API** 頁籤。
   * 往下滾動找到 **Your user ID**（格式為以 `U` 開頭的 33 碼字串，例如 `U1234567890abcdef1234567890abcdef`）。
   * ⚠️ **特別注意**：此處是系統唯一的 User ID，**不是** 您平常用來加好友的 LINE ID！

4. **取得 `LINE_CHANNEL_ACCESS_TOKEN` (頻道存取憑證)**：
   * 同樣在 **Messaging API** 頁籤，滾動至最底部 **Channel access token** 區塊。
   * 點選 **Issue** 按鈕產生長期憑證，將整串 Token 複製保存。

5. **加入 Bot 為好友**：
   * 在 **Messaging API** 頁籤上方會有一個 QR Code。
   * 使用手機 LINE App 掃描此 QR Code，**將該 Bot 加入好友**（必須加為好友，Bot 才有權限推播訊息給您）。

---

## 💻 本地測試步驟

1. **安裝相依套件**：
   ```bash
   npm install
   ```

2. **設定環境變數**：
   * 複製 `.env.example` 並命名為 `.env`：
     ```bash
     cp .env.example .env
     ```
   * 編輯 `.env` 填入您的憑證：
     ```env
     LINE_CHANNEL_ACCESS_TOKEN=您的_CHANNEL_ACCESS_TOKEN
     LINE_USER_ID=您的_USER_ID
     ```

3. **執行測試**：
   * 開發模式直接執行（使用 `ts-node`）：
     ```bash
     npm run dev
     ```
   * 或編譯後執行：
     ```bash
     npm run build
     npm start
     ```
   * 執行成功後，您的 LINE 就會收到如下格式的盤況通知：

```text
元大台灣50 (0050.TW)】盤況通知
回報時間：2026/09/21 09:30:00

最新股價：195.50 元
今日漲跌：+2.50 (+1.30%)
昨日收盤：193.00 元
今日最高：196.00 元
今日最低：194.50 元
成交張數：12,345 張
```

---

## ☁️ 部署至 GitHub Actions（自動每日排程）

專案內建 `.github/workflows/stock.yml`，利用 GitHub 提供的免費雲端主機定時執行：

1. **將專案推送到您的 GitHub 儲存庫**：
   ```bash
   git init
   git add .
   git commit -m "feat: initial commit for 0050 stock notifier"
   git remote add origin https://github.com/<您的用戶名>/<您的儲存庫名>.git
   git branch -M main
   git push -u origin main
   ```
   > ⚠️ 請確認 `.env` 沒有被 push 上去（`.gitignore` 已預設排除）。

2. **在 GitHub 儲存庫中設定 Secrets**：
   * 進入您的 GitHub Repository 頁面。
   * 點選上方 **Settings** ➔ 左側選單 **Secrets and variables** ➔ **Actions**。
   * 點選 **New repository secret**，分別新增以下兩個 Secret：
     * **`LINE_CHANNEL_ACCESS_TOKEN`**：填入您的 LINE Channel Access Token。
     * **`LINE_USER_ID`**：填入您的 LINE User ID (`U...`)。

3. **手動測試觸發**：
   * 進入 GitHub Repository 的 **Actions** 頁籤。
   * 點選左側的 **0050 Stock Daily Notification**。
   * 點選右側 **Run workflow** 下拉選單 ➔ 點擊綠色的 **Run workflow** 按鈕。
   * 稍等約 30 秒，查看 Workflow 執行記錄並檢查手機 LINE 是否收到推播。

4. **排程時間說明**：
   * GitHub Actions 使用 UTC 時間。
   * 台灣時區為 UTC+8，早上 09:30 對應 UTC 時間為 **01:30**。
   * Cron 表達式已設定為：`30 1 * * 1-5`（每週一至週五 UTC 01:30 / 台灣時間 09:30 觸發）。
