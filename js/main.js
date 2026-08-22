import { loadMegaFolder, downloadFile, guessMime } from "./mega-loader.js";
import { renderPdfPages } from "./pdf-renderer.js";
import { bufferToObjectURL, loadImageSize } from "./utils.js";
import { ComicViewer } from "./viewer.js";

const startScreen = document.getElementById("start-screen");
const loadingScreen = document.getElementById("loading-screen");
const viewerScreen = document.getElementById("viewer-screen");
const megaUrlInput = document.getElementById("mega-url");
const loadBtn = document.getElementById("load-btn");
const errorMsg = document.getElementById("error-msg");
const loadingText = document.getElementById("loading-text");
const loadingProgress = document.getElementById("loading-progress");

let viewer = null;
let createdUrls = [];
let loading = false;

loadBtn.addEventListener("click", startLoad);
megaUrlInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") startLoad();
});

const params = new URLSearchParams(location.search);
const initialUrl = params.get("url");
if (initialUrl) {
  megaUrlInput.value = decodeURIComponent(initialUrl);
  setTimeout(startLoad, 100);
}

async function startLoad() {
  if (loading) return;
  const url = megaUrlInput.value.trim();
  if (!url) {
    showError("MEGAのフォルダリンクを入力してください");
    return;
  }
  if (!/mega\.(nz|co\.nz)/i.test(url)) {
    showError("正しいMEGAリンクを入力してください（mega.nz）");
    return;
  }

  hideError();
  loading = true;
  loadBtn.disabled = true;
  showScreen("loading");
  setLoading("フォルダを解析中...", "");

  try {
    const fileList = await loadMegaFolder(url, (msg) => setLoading(msg, ""));
    const pages = [];

    for (let i = 0; i < fileList.length; i++) {
      const item = fileList[i];
      setLoading(`ダウンロード中 (${i + 1}/${fileList.length})`, item.path);
      let buffer;
      try {
        buffer = await downloadFile(item.file);
      } catch (e) {
        console.warn("スキップ:", item.path, e);
        continue;
      }

      if (item.isPdf) {
        setLoading(`PDFを変換中: ${item.name}`, "");
        try {
          const pdfUrls = await renderPdfPages(buffer, (page, total) => {
            setLoading(`PDF変換中 (${page}/${total})`, item.name);
          });
          createdUrls.push(...pdfUrls);
          for (const u of pdfUrls) {
            try { pages.push(await loadImageSize(u)); } catch (e) {}
          }
        } catch (e) {
          console.warn("PDF変換失敗:", item.name, e);
        }
      } else {
        const mime = guessMime(item.name);
        const objUrl = bufferToObjectURL(buffer, mime);
        createdUrls.push(objUrl);
        try { pages.push(await loadImageSize(objUrl)); } catch (e) {}
      }
    }

    if (pages.length === 0) {
      throw new Error("表示できるページがありませんでした");
    }

    setLoading("ビューアを準備中...", "");
    showScreen("viewer");
    if (viewer) viewer.destroy();

    viewer = new ComicViewer({
      container: document.getElementById("viewer"),
      slotLeft: document.getElementById("page-left"),
      slotRight: document.getElementById("page-right"),
      pageInfo: document.getElementById("page-info"),
      slider: document.getElementById("page-slider"),
      onExit: resetToStart,
    });
    viewer.setPages(pages);
  } catch (err) {
    console.error(err);
    showError(err.message || "読み込みに失敗しました");
    showScreen("start");
  } finally {
    loading = false;
    loadBtn.disabled = false;
  }
}

function resetToStart() {
  if (viewer) { viewer.destroy(); viewer = null; }
  for (const u of createdUrls) {
    try { URL.revokeObjectURL(u); } catch (_) {}
  }
  createdUrls = [];
  showScreen("start");
  megaUrlInput.focus();
}

function showScreen(name) {
  startScreen.classList.toggle("hidden", name !== "start");
  loadingScreen.classList.toggle("hidden", name !== "loading");
  viewerScreen.classList.toggle("hidden", name !== "viewer");
}

function setLoading(text, progress) {
  loadingText.textContent = text;
  loadingProgress.textContent = progress || "";
}

function showError(msg) {
  errorMsg.textContent = msg;
  errorMsg.classList.remove("hidden");
}

function hideError() {
  errorMsg.classList.add("hidden");
  errorMsg.textContent = "";
  }
