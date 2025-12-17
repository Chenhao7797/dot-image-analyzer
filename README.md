# Dot Image Analyzer (點影像分析器)

這是一個基於 React 和 OpenCV.js 開發的網頁應用程式，專門用於分析圖片中的點分佈特徵。主要提供 **能量範圍分析 (D86 Analysis)** 與 **點計數 (Point Counting)** 兩大功能。

## ✨ 主要功能

### 1. 能量範圍分析 (Energy Analysis / D86)
用於計算圖片中像素亮度的能量分佈範圍。
- **核心算法**：計算圖像的協方差矩陣 (Covariance Matrix) 與特徵值，擬合出能量集中的橢圓或圓形範圍。
- **參數設定**：
  - **Hx / Hy (實際寬度/高度)**：用於將像素單位轉換為實際物理單位的比例參數。
  - **Energy Ratio (%)**：定義包含總能量多少百分比的範圍 (例如 86%)。
- **輸出結果**：
  - Gamma 值
  - 形狀判定 (圓形或橢圓)
  - 長軸、短軸長度 (實際單位)
  - 旋轉角度

### 2. 點計數 (Count Points)
用於自動計算圖片中出現的點或物件數量。
- **核心算法**：使用圖像處理技術 (灰階 -> 模糊 -> 閾值化 -> 連通域分析) 來分割並計算物件。
- **參數設定**：
  - **Min Area (px)**：過濾掉面積小於此值的雜訊。
  - **Blur (Kernel Size)**：模糊程度，用於平滑影像以減少噪點。
  - **Threshold Mode**：閾值處理模式 (Otsu 自動、Binary 固定值或自訂)。
  - **Invert Color**：若圖片是白底黑點，可勾選此項進行顏色反轉。

## 🚀 快速開始

### 安裝依賴
請確保您已安裝 [Node.js](https://nodejs.org/)。在專案目錄下執行：

```bash
npm install
```

### 本地開發預覽
啟動本地開發伺服器：

```bash
npm run dev
```
打開瀏覽器訪問顯示的網址 (通常是 http://localhost:5173)。

### 建置專案
打包成靜態檔案 (供生產環境使用)：

```bash
npm run build
```

## 📦 發佈至 GitHub Pages

本專案已配置好發佈至 GitHub Pages 的腳本。

1. 修改 `vite.config.js` 中的 `base` 設定，確保路徑正確 (通常是 `'/你的儲存庫名稱/'`)。
2. 執行發佈指令：

```bash
npm run deploy
```

這將會把 `dist` 資料夾的內容推送到遠端的 `gh-pages` 分支。

## 🛠️ 技術棧
- **React 18** - UI 框架
- **Vite** - 建置工具
- **OpenCV.js** - 圖像處理核心
- **Tailwind CSS** - 樣式設計
- **Lucide React** - 圖標庫

## ⚠️ 注意事項
- 本程式依賴 `OpenCV.js`，首次載入時需要從 CDN 下載約 10MB 的檔案，請保持網路連線。
- 大尺寸圖片分析可能需要數秒鐘的計算時間。

---
License: MIT
