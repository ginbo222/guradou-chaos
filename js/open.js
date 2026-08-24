import { loadMegaFolder, downloadFile, guessMime } from "./mega-loader.js";
import { renderPdfPages } from "./pdf-renderer.js";
import { bufferToObjectURL, loadImageSize } from "./utils.js";
import { ComicViewer } from "./viewer.js";
import { cacheGet, cacheSet, cacheKey, thumbSet } from "./cache.js";

const FIRST_PAGES = 4;
const PARALLEL = 3;

let viewer = null;
let createdUrls = [];
let loading = false;
let bgAbort = false;

export function getViewerState() {
  return { viewer, loading };
}

export function resetViewerState() {
  bgAbort = true;
  if (viewer) {
    viewer.destroy();
    viewer = null;
  }
  for (const u of createdUrls) {
    try {
      URL.revokeObjectURL(u);
    } catch (_) {}
  }
  createdUrls = [];
}

function setLoading(text, progress) {
  const loadingText = document.getElementById("loading-text");
  const loadingProgress = document.getElementById("loading-progress");
  if (loadingText) loadingText.textContent = text;
  if (loadingProgress) loadingProgress.textContent = progress || "";
}

async function processFile(item) {
  const buffer = await downloadFile(item.file);
  const pages = [];
  if (item.isPdf) {
    const pdfUrls = await renderPdfPages(buffer, (page, total) => {
      setLoading("PDF変換中 (" + page + "/" + total + ")", item.path || item.name);
    });
    createdUrls.push(...pdfUrls);
    for (const u of pdfUrls) {
      try {
        pages.push(await loadImageSize(u));
      } catch (_) {}
    }
  } else {
    const objUrl = bufferToObjectURL(buffer, guessMime(item.name));
    createdUrls.push(objUrl);
    try {
      pages.push(await loadImageSize(objUrl));
    } catch (_) {}
  }
  return pages;
}

function buildOpts(item) {
  const opts = {};
  if (item.kind === "file" && item.filePath) opts.onlyFilePath = item.filePath;
  else if (item.kind === "file" && item.fileName) opts.onlyFileName = item.fileName;
  else if (item.kind === "dir" && item.childName) opts.onlyChildName = item.childName;
  else if (item.kind === "dir" && item.rootFilesOnly) opts.rootFilesOnly = true;
  else if (item.childName) opts.onlyChildName = item.childName;
  return opts;
}

function startViewer(pages, onExit) {
  if (viewer) viewer.destroy();
  viewer = new ComicViewer({
    container: document.getElementById("viewer"),
    slotLeft: document.getElementById("page-left"),
    slotRight: document.getElementById("page-right"),
    pageInfo: document.getElementById("page-info"),
    slider: document.getElementById("page-slider"),
    onExit,
  });
  viewer.setPages(pages);
}

async function savePagesToCache(shelfItem, pages) {
  try {
    const blobs = await Promise.all(
      pages.map(async (p) => {
        const res = await fetch(p.url);
        return await res.blob();
      })
    );
    await cacheSet(cacheKey(shelfItem), blobs);
  } catch (e) {
    console.warn(e);
  }
}

async function saveThumb(item, pageUrl) {
  try {
    const img = new Image();
    await new Promise((res, rej) => {
      img.onload = res;
      img.onerror = rej;
      img.src = pageUrl;
    });
    const canvas = document.createElement("canvas");
    const w = 120;
    const h = Math.max(1, Math.round((img.naturalHeight / img.naturalWidth) * w));
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0, w, h);
    const blob = await new Promise((res) => canvas.toBlob(res, "image/jpeg", 0.7));
    if (blob) await thumbSet(cacheKey(item), blob);
  } catch (e) {
    console.warn("サムネ作成スキップ", e);
  }
}

async function loadRestInBackground(fileList, shelfItem, alreadyPages) {
  const allPages = alreadyPages ? alreadyPages.slice() : [];
  let idx = 0;
  async function worker() {
    while (idx < fileList.length && !bgAbort) {
      const i = idx++;
      try {
        const pages = await processFile(fileList[i]);
        if (pages.length && viewer && !bgAbort) {
          viewer.appendPages(pages);
          allPages.push(...pages);
        }
      } catch (e) {
        console.warn(e);
      }
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(PARALLEL, fileList.length) }, () => worker())
  );
  if (shelfItem && allPages.length && !bgAbort) {
    savePagesToCache(shelfItem, allPages);
  }
}

export async function openItem(item, { showScreen, goScreen, onExit }) {
  if (loading) return;
  loading = true;
  bgAbort = false;
  goScreen("loading", false);
  setLoading("準備中...", item.name || "");

  try {
    setLoading("キャッシュ確認中...", item.name || "");
    const cached = await cacheGet(cacheKey(item));
    if (cached && cached.length) {
      const pages = [];
      for (const blob of cached) {
        const u = URL.createObjectURL(blob);
        createdUrls.push(u);
        try {
          pages.push(await loadImageSize(u));
        } catch (_) {}
      }
      if (pages.length) {
        goScreen("viewer", true);
        startViewer(pages, onExit);
        if (pages[0] && pages[0].url) saveThumb(item, pages[0].url);
        loading = false;
        return;
      }
    }

    const opts = buildOpts(item);
    const fileList = await loadMegaFolder(
      item.url,
      (msg) => setLoading(msg, item.name || ""),
      opts
    );
    if (!fileList.length) throw new Error("表示できるファイルがありません");

    const first = fileList.slice(0, FIRST_PAGES);
    const rest = fileList.slice(FIRST_PAGES);
    const firstPages = [];

    for (let i = 0; i < first.length; i++) {
      setLoading(
        "読み込み中 (" + (i + 1) + "/" + fileList.length + ")",
        first[i].path || first[i].name
      );
      try {
        const pages = await processFile(first[i]);
        firstPages.push(...pages);
      } catch (e) {
        console.warn(e);
      }
    }

    if (!firstPages.length) throw new Error("表示できるページがありませんでした");

    goScreen("viewer", true);
    startViewer(firstPages, onExit);
    if (firstPages[0] && firstPages[0].url) saveThumb(item, firstPages[0].url);

    if (rest.length) loadRestInBackground(rest, item, firstPages);
    else savePagesToCache(item, firstPages);
  } catch (err) {
    console.error(err);
    alert(err.message || "読み込みに失敗しました");
    goScreen("start", false);
  } finally {
    loading = false;
  }
    }
