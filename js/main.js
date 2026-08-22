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
let bgAbort = false;

/** 最初に表示するファイル数（少ないほど速い） */
const FIRST_BATCH = 4;
/** 裏で同時に落とす数 */
const PARALLEL = 3;

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

async function processFile(item) {
  const buffer = await downloadFile(item.file);
  const pages = [];
  if (item.isPdf) {
    const pdfUrls = await renderPdfPages(buffer);
    createdUrls.push(...pdfUrls);
    for (const u of pdfUrls) {
      try { pages.push(await loadImageSize(u)); } catch (_) {}
    }
  } else {
    const mime = guessMime(item.name);
    const objUrl = bufferToObjectURL(buffer, mime);
    createdUrls.push(objUrl);
    try { pages.push(await loadImageSize(objUrl)); } catch (_) {}
  }
  return pages;
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
  bgAbort = false;
  loadBtn.disabled = true;
  showScreen("loading");
  setLoading("フォルダ情報を取得中...", "初回だけ少し時間がかかることがあります");

  try {
    const fileList = await loadMegaFolder(url, (msg) => setLoading(msg, ""));
    if (fileList.length === 0) throw new Error("表示できるファイルがありません");

    // --- 最初の数ファイルだけ先に落とす ---
    const first = fileList.slice(0, FIRST_BATCH);
    const rest = fileList.slice(FIRST_BATCH);
    const firstPages = [];

    for (let i = 0; i < first.length; i++) {
      setLoading(`すぐ表示するページを準備中 (${i + 1}/${first.length})`, first[i].path);
      try {
        const pages = await processFile(first[i]);
        firstPages.push(...pages);
      } catch (e) {
        console.warn("スキップ:", first[i].path, e);
      }
    }

    if (firstPages.length === 0) {
      throw new Error("表示できるページがありませんでした");
    }

    // --- すぐビューアを開く ---
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
    viewer.setPages(firstPages);

    // --- 残りは裏で並列ダウンロード ---
    if (rest.length > 0) {
      loadRestInBackground(rest);
    }
  } catch (err) {
    console.error(err);
    showError(err.message || "読み込みに失敗しました");
    showScreen("start");
  } finally {
    loading = false;
    loadBtn.disabled = false;
  }
}

async function loadRestInBackground(fileList) {
  let idx = 0;
  async function worker() {
    while (idx < fileList.length && !bgAbort) {
      const i = idx++;
      const item = fileList[i];
      try {
        const pages = await processFile(item);
        if (pages.length && viewer && !bgAbort) {
          viewer.appendPages(pages);
        }
      } catch (e) {
        console.warn("裏読み込みスキップ:", item.path, e);
      }
    }
  }
  const workers = [];
  for (let w = 0; w < Math.min(PARALLEL, fileList.length); w++) {
    workers.push(worker());
  }
  await Promise.all(workers);
}

function resetToStart() {
  bgAbort = true;
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
