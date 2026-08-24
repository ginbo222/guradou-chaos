import { loadMegaFolder, listAllFiles, listImageFolders, downloadFile, guessMime } from "./mega-loader.js";
import { renderPdfPages } from "./pdf-renderer.js";
import { bufferToObjectURL, loadImageSize } from "./utils.js";
import { ComicViewer } from "./viewer.js";

const authScreen = document.getElementById("auth-screen");
const startScreen = document.getElementById("start-screen");
const addScreen = document.getElementById("add-screen");
const bulkScreen = document.getElementById("bulk-screen");
const moveScreen = document.getElementById("move-screen");
const loadingScreen = document.getElementById("loading-screen");
const viewerScreen = document.getElementById("viewer-screen");

const authTitle = document.getElementById("auth-title");
const authSub = document.getElementById("auth-sub");
const authInput = document.getElementById("auth-input");
const authBtn = document.getElementById("auth-btn");
const authError = document.getElementById("auth-error");

const shelfList = document.getElementById("shelf-list");
const shelfTitle = document.getElementById("shelf-title");
const shelfSub = document.getElementById("shelf-sub");
const shelfBackBtn = document.getElementById("shelf-back-btn");
const addFolderBtn = document.getElementById("add-folder-btn");
const addItemBtn = document.getElementById("add-item-btn");
const bulkFolderBtn = document.getElementById("bulk-folder-btn");
const lockBtn = document.getElementById("lock-btn");

const folderName = document.getElementById("folder-name");
const folderUrl = document.getElementById("folder-url");
const saveFolderBtn = document.getElementById("save-folder-btn");
const cancelAddBtn = document.getElementById("cancel-add-btn");
const addError = document.getElementById("add-error");

const bulkUrl = document.getElementById("bulk-url");
const bulkFetchBtn = document.getElementById("bulk-fetch-btn");
const bulkCancelBtn = document.getElementById("bulk-cancel-btn");
const bulkAddAllBtn = document.getElementById("bulk-add-all-btn");
const bulkList = document.getElementById("bulk-list");
const bulkStatus = document.getElementById("bulk-status");
const bulkError = document.getElementById("bulk-error");

const moveList = document.getElementById("move-list");
const moveTargetName = document.getElementById("move-target-name");
const moveRootBtn = document.getElementById("move-root-btn");
const moveCancelBtn = document.getElementById("move-cancel-btn");

const loadingText = document.getElementById("loading-text");
const loadingProgress = document.getElementById("loading-progress");

const SHELF_KEY = "mcv_shelf_v2";
const PASS_KEY = "mcv_pass_hash";
const SESSION_KEY = "mcv_unlocked";
const CACHE_DB = "mcv_page_cache";
const CACHE_STORE = "pages";
const FIRST_PAGES = 4;
const PARALLEL = 3;

let viewer = null;
let createdUrls = [];
let loading = false;
let bgAbort = false;
let authMode = "login";
let bulkParentUrl = "";
let bulkEntries = [];
let bulkMode = "folders";
let historyLock = false;
let currentFolderId = null;
let movingItemId = null;

function uid() {
  return "id_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8);
}

async function sha256(text) {
  const data = new TextEncoder().encode(text);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function getShelf() {
  try {
    const raw = JSON.parse(localStorage.getItem(SHELF_KEY) || "null");
    if (raw && Array.isArray(raw.items)) return raw;
  } catch (_) {}
  try {
    const old = JSON.parse(localStorage.getItem("mcv_shelf") || "[]");
    if (Array.isArray(old) && old.length) {
      const items = old.map((x) => ({
        id: uid(),
        type: x.type === "folder" ? "folder" : "book",
        name: x.name,
        url: x.url,
        kind: x.kind,
        filePath: x.filePath,
        fileName: x.fileName,
        childName: x.childName,
        rootFilesOnly: x.rootFilesOnly,
        parentId: null,
      }));
      const data = { items };
      localStorage.setItem(SHELF_KEY, JSON.stringify(data));
      return data;
    }
  } catch (_) {}
  return { items: [] };
}

function saveShelf(data) {
  localStorage.setItem(SHELF_KEY, JSON.stringify(data));
}

function openCacheDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(CACHE_DB, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(CACHE_STORE)) db.createObjectStore(CACHE_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function cacheGet(key) {
  try {
    const db = await openCacheDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(CACHE_STORE, "readonly");
      const r = tx.objectStore(CACHE_STORE).get(key);
      r.onsuccess = () => resolve(r.result || null);
      r.onerror = () => reject(r.error);
    });
  } catch {
    return null;
  }
}

async function cacheSet(key, blobs) {
  try {
    const db = await openCacheDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(CACHE_STORE, "readwrite");
      tx.objectStore(CACHE_STORE).put(blobs, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (e) {
    console.warn("キャッシュ保存失敗", e);
  }
}

function cacheKey(item) {
  return (
    (item.url || "") +
    "::" +
    (item.filePath || item.childName || item.fileName || item.name || "") +
    (item.rootFilesOnly ? "::root" : "")
  );
}

function showScreen(name) {
  authScreen.classList.toggle("hidden", name !== "auth");
  startScreen.classList.toggle("hidden", name !== "start");
  addScreen.classList.toggle("hidden", name !== "add");
  bulkScreen.classList.toggle("hidden", name !== "bulk");
  moveScreen.classList.toggle("hidden", name !== "move");
  loadingScreen.classList.toggle("hidden", name !== "loading");
  viewerScreen.classList.toggle("hidden", name !== "viewer");
}

function goScreen(name, push) {
  showScreen(name);
  if (historyLock) return;
  try {
    if (push) history.pushState({ screen: name }, "");
    else history.replaceState({ screen: name }, "");
  } catch (_) {}
}

function renderShelf() {
  const data = getShelf();
  const items = data.items.filter((x) => (x.parentId || null) === currentFolderId);
  const folders = items.filter((x) => x.type === "folder");
  const books = items.filter((x) => x.type !== "folder");

  if (currentFolderId) {
    const folder = data.items.find((x) => x.id === currentFolderId);
    shelfTitle.textContent = folder ? folder.name : "フォルダ";
    shelfSub.textContent = "中の作品";
    shelfBackBtn.classList.remove("hidden");
  } else {
    shelfTitle.textContent = "本棚";
    shelfSub.textContent = "タップして読む";
    shelfBackBtn.classList.add("hidden");
  }

  shelfList.innerHTML = "";
  if (!folders.length && !books.length) {
    shelfList.innerHTML = '<p class="empty-shelf">空です</p>';
    return;
  }
  folders.forEach((item) => appendShelfRow(item, true));
  books.forEach((item) => appendShelfRow(item, false));
}

function appendShelfRow(item, isFolder) {
  const row = document.createElement("div");
  row.className = "shelf-item" + (isFolder ? " folder-row" : "");
  const icon = document.createElement("span");
  icon.className = "icon";
  icon.textContent = isFolder ? "📁" : "📄";
  const nameEl = document.createElement("span");
  nameEl.className = "name";
  nameEl.textContent = item.name;

  const moveBtn = document.createElement("button");
  moveBtn.className = "act";
  moveBtn.type = "button";
  moveBtn.textContent = "移動";
  moveBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    openMoveScreen(item.id);
  });

  const delBtn = document.createElement("button");
  delBtn.className = "act";
  delBtn.type = "button";
  delBtn.textContent = "削除";
  delBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (!confirm("「" + item.name + "」を削除しますか？")) return;
    const data = getShelf();
    if (item.type === "folder") {
      data.items.forEach((x) => {
        if (x.parentId === item.id) x.parentId = item.parentId || null;
      });
    }
    data.items = data.items.filter((x) => x.id !== item.id);
    saveShelf(data);
    renderShelf();
  });

  row.appendChild(icon);
  row.appendChild(nameEl);
  row.appendChild(moveBtn);
  row.appendChild(delBtn);
  row.addEventListener("click", () => {
    if (isFolder) {
      currentFolderId = item.id;
      renderShelf();
    } else openItem(item);
  });
  shelfList.appendChild(row);
}

function openMoveScreen(itemId) {
  movingItemId = itemId;
  const data = getShelf();
  const item = data.items.find((x) => x.id === itemId);
  moveTargetName.textContent = item ? item.name : "";
  const folders = data.items.filter((x) => x.type === "folder" && x.id !== itemId);
  moveList.innerHTML = "";
  folders.forEach((f) => {
    const row = document.createElement("div");
    row.className = "move-item shelf-item";
    const ic = document.createElement("span");
    ic.className = "icon";
    ic.textContent = "📁";
    const n = document.createElement("span");
    n.className = "name";
    n.textContent = f.name;
    row.appendChild(ic);
    row.appendChild(n);
    row.addEventListener("click", () => moveItemTo(itemId, f.id));
    moveList.appendChild(row);
  });
  if (!folders.length) {
    moveList.innerHTML = '<p class="empty-shelf">先にフォルダを作ってください</p>';
  }
  goScreen("move", true);
}

function moveItemTo(itemId, parentId) {
  const data = getShelf();
  const item = data.items.find((x) => x.id === itemId);
  if (!item) return;
  item.parentId = parentId;
  saveShelf(data);
  movingItemId = null;
  renderShelf();
  goScreen("start", false);
}

function showAuth() {
  const hasPass = !!localStorage.getItem(PASS_KEY);
  authMode = hasPass ? "login" : "setup";
  authTitle.textContent = hasPass ? "パスワード" : "パスワード設定";
  authSub.textContent = hasPass
    ? "入室用パスワードを入力"
    : "初めての利用です。好きなパスワードを決めてください";
  authInput.value = "";
  authError.classList.add("hidden");
  goScreen("auth", false);
  setTimeout(() => authInput.focus(), 100);
}

async function handleAuth() {
  const pw = authInput.value;
  if (!pw) {
    authError.textContent = "パスワードを入力してください";
    authError.classList.remove("hidden");
    return;
  }
  const hash = await sha256(pw);
  if (authMode === "setup") {
    localStorage.setItem(PASS_KEY, hash);
    sessionStorage.setItem(SESSION_KEY, "1");
    enterApp();
    return;
  }
  if (hash === localStorage.getItem(PASS_KEY)) {
    sessionStorage.setItem(SESSION_KEY, "1");
    enterApp();
  } else {
    authError.textContent = "パスワードが違います";
    authError.classList.remove("hidden");
  }
}

function enterApp() {
  currentFolderId = null;
  renderShelf();
  goScreen("start", false);
}

function lockApp() {
  sessionStorage.removeItem(SESSION_KEY);
  resetViewerState();
  showAuth();
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

async function openItem(item) {
  await openFolder(item.url, item.name, buildOpts(item), item);
}

async function openFolder(url, name, opts, shelfItem) {
  if (loading) return;
  loading = true;
  bgAbort = false;
  goScreen("loading", false);
  setLoading("準備中...", name || "");

  try {
    if (shelfItem) {
      setLoading("キャッシュ確認中...", name || "");
      const cached = await cacheGet(cacheKey(shelfItem));
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
          startViewer(pages);
          loading = false;
          return;
        }
      }
    }

    const fileList = await loadMegaFolder(
      url,
      (msg) => setLoading(msg, name || ""),
      opts || {}
    );
    if (!fileList.length) throw new Error("表示できるファイルがありません");

    // ★ 全ファイルをページ化（WebPフォルダ対応）
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

    startViewer(firstPages);

    if (rest.length) {
      loadRestInBackground(rest, shelfItem, firstPages);
    } else if (shelfItem) {
      savePagesToCache(shelfItem, firstPages);
    }
  } catch (err) {
    console.error(err);
    alert(err.message || "読み込みに失敗しました");
    goScreen("start", false);
  } finally {
    loading = false;
  }
}

function startViewer(pages) {
  goScreen("viewer", true);
  if (viewer) viewer.destroy();
  viewer = new ComicViewer({
    container: document.getElementById("viewer"),
    slotLeft: document.getElementById("page-left"),
    slotRight: document.getElementById("page-right"),
    pageInfo: document.getElementById("page-info"),
    slider: document.getElementById("page-slider"),
    onExit: backToShelfFromButton,
  });
  viewer.setPages(pages);
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

function resetViewerState() {
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

function backToShelfFromButton() {
  resetViewerState();
  renderShelf();
  if (history.state && history.state.screen === "viewer") {
    historyLock = true;
    history.back();
    setTimeout(() => {
      historyLock = false;
      goScreen("start", false);
    }, 0);
  } else goScreen("start", false);
}

function setLoading(text, progress) {
  loadingText.textContent = text;
  loadingProgress.textContent = progress || "";
}

async function bulkFetch() {
  const url = bulkUrl.value.trim();
  bulkError.classList.add("hidden");
  bulkList.innerHTML = "";
  bulkAddAllBtn.classList.add("hidden");
  bulkEntries = [];
  bulkParentUrl = "";
  if (!url || !/mega\.(nz|co\.nz)/i.test(url)) {
    bulkError.textContent = "正しいMEGAフォルダリンクを入力してください";
    bulkError.classList.remove("hidden");
    return;
  }
  bulkFetchBtn.disabled = true;
  bulkStatus.textContent = "取得中…";
  try {
    // WebPフォルダ＝1冊
    const folders = await listImageFolders(url, (msg) => {
      bulkStatus.textContent = msg;
    });
    if (folders.length) {
      bulkMode = "folders";
      bulkParentUrl = url;
      bulkEntries = folders;
      bulkStatus.textContent =
        folders.length + " 冊（各フォルダの画像をまとめて1冊）";
      bulkList.innerHTML = "";
      folders.forEach((f) => {
        const row = document.createElement("div");
        row.className = "bulk-item";
        const span = document.createElement("span");
        span.className = "name";
        span.textContent =
          "📁 " + f.name + "（" + f.fileCount + "枚）";
        row.appendChild(span);
        bulkList.appendChild(row);
      });
      bulkAddAllBtn.classList.remove("hidden");
      bulkAddAllBtn.textContent = folders.length + " 冊を本棚に追加";
      return;
    }

    // フォルダが無くファイルだけなら1ファイル＝1冊
    const files = await listAllFiles(url, (msg) => {
      bulkStatus.textContent = msg;
    });
    if (!files.length) {
      bulkStatus.textContent = "画像・PDFが見つかりませんでした";
      return;
    }
    bulkMode = "files";
    bulkParentUrl = url;
    bulkEntries = files;
    bulkStatus.textContent = files.length + " ファイル（1件＝1冊）";
    bulkList.innerHTML = "";
    files.forEach((f) => {
      const row = document.createElement("div");
      row.className = "bulk-item";
      const span = document.createElement("span");
      span.className = "name";
      span.textContent = f.path + (f.isPdf ? " [PDF]" : "");
      row.appendChild(span);
      bulkList.appendChild(row);
    });
    bulkAddAllBtn.classList.remove("hidden");
    bulkAddAllBtn.textContent = files.length + " 件を追加";
  } catch (e) {
    console.error(e);
    bulkError.textContent = e.message || "取得に失敗しました";
    bulkError.classList.remove("hidden");
    bulkStatus.textContent = "";
  } finally {
    bulkFetchBtn.disabled = false;
  }
}

function bulkAddAll() {
  if (!bulkParentUrl || !bulkEntries.length) return;
  const data = getShelf();
  let added = 0;

  if (bulkMode === "folders") {
    const existing = new Set(
      data.items.map(
        (x) =>
          (x.childName || "") +
          "\n" +
          (x.rootFilesOnly ? "root" : "") +
          "\n" +
          (x.url || "")
      )
    );
    for (const f of bulkEntries) {
      const key =
        (f.childName || "") +
        "\n" +
        (f.isRootFiles ? "root" : "") +
        "\n" +
        bulkParentUrl;
      if (existing.has(key)) continue;
      data.items.push({
        id: uid(),
        type: "book",
        name: f.name,
        url: bulkParentUrl,
        kind: "dir",
        childName: f.childName,
        rootFilesOnly: !!f.isRootFiles,
        parentId: currentFolderId,
      });
      existing.add(key);
      added++;
    }
  } else {
    const existing = new Set(
      data.items.map((x) => (x.filePath || "") + "\n" + (x.url || ""))
    );
    for (const f of bulkEntries) {
      const key = f.path + "\n" + bulkParentUrl;
      if (existing.has(key)) continue;
      data.items.push({
        id: uid(),
        type: "book",
        name: f.name.replace(/\.(pdf|png|jpe?g|webp|gif)$/i, ""),
        url: bulkParentUrl,
        kind: "file",
        filePath: f.path,
        fileName: f.name,
        parentId: currentFolderId,
      });
      existing.add(key);
      added++;
    }
  }

  saveShelf(data);
  alert(added + " 件を追加しました");
  renderShelf();
  goScreen("start", false);
}

window.addEventListener("popstate", (e) => {
  if (historyLock) return;
  
