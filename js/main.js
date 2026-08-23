import { loadMegaFolder, listChildFolders, downloadFile, guessMime } from "./mega-loader.js";
import { renderPdfPages } from "./pdf-renderer.js";
import { bufferToObjectURL, loadImageSize } from "./utils.js";
import { ComicViewer } from "./viewer.js";

const authScreen = document.getElementById("auth-screen");
const startScreen = document.getElementById("start-screen");
const addScreen = document.getElementById("add-screen");
const bulkScreen = document.getElementById("bulk-screen");
const loadingScreen = document.getElementById("loading-screen");
const viewerScreen = document.getElementById("viewer-screen");

const authTitle = document.getElementById("auth-title");
const authSub = document.getElementById("auth-sub");
const authInput = document.getElementById("auth-input");
const authBtn = document.getElementById("auth-btn");
const authError = document.getElementById("auth-error");

const shelfList = document.getElementById("shelf-list");
const addFolderBtn = document.getElementById("add-folder-btn");
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

const loadingText = document.getElementById("loading-text");
const loadingProgress = document.getElementById("loading-progress");

const SHELF_KEY = "mcv_shelf";
const PASS_KEY = "mcv_pass_hash";
const SESSION_KEY = "mcv_unlocked";

const FIRST_BATCH = 4;
const PARALLEL = 3;

let viewer = null;
let createdUrls = [];
let loading = false;
let bgAbort = false;
let authMode = "login";
let bulkParentUrl = "";
let bulkChildren = [];

async function sha256(text) {
  const data = new TextEncoder().encode(text);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function getShelf() {
  try {
    return JSON.parse(localStorage.getItem(SHELF_KEY) || "[]");
  } catch {
    return [];
  }
}

function saveShelf(list) {
  localStorage.setItem(SHELF_KEY, JSON.stringify(list));
}

function showScreen(name) {
  authScreen.classList.toggle("hidden", name !== "auth");
  startScreen.classList.toggle("hidden", name !== "start");
  addScreen.classList.toggle("hidden", name !== "add");
  bulkScreen.classList.toggle("hidden", name !== "bulk");
  loadingScreen.classList.toggle("hidden", name !== "loading");
  viewerScreen.classList.toggle("hidden", name !== "viewer");
}

function renderShelf() {
  const list = getShelf();
  shelfList.innerHTML = "";
  if (list.length === 0) {
    shelfList.innerHTML =
      '<p class="empty-shelf">まだフォルダがありません<br>「1件追加」または「一括登録」から追加</p>';
    return;
  }
  list.forEach((item, index) => {
    const row = document.createElement("div");
    row.className = "shelf-item";
    const nameEl = document.createElement("span");
    nameEl.className = "name";
    nameEl.textContent = item.name;
    const del = document.createElement("button");
    del.className = "del";
    del.type = "button";
    del.textContent = "削除";
    del.addEventListener("click", (e) => {
      e.stopPropagation();
      if (confirm("「" + item.name + "」を削除しますか？")) {
        const next = getShelf().filter((_, i) => i !== index);
        saveShelf(next);
        renderShelf();
      }
    });
    row.appendChild(nameEl);
    row.appendChild(del);
    row.addEventListener("click", () =>
      openFolder(item.url, item.name, item.childName || null)
    );
    shelfList.appendChild(row);
  });
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
  showScreen("auth");
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
  renderShelf();
  showScreen("start");
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
    const pdfUrls = await renderPdfPages(buffer);
    createdUrls.push(...pdfUrls);
    for (const u of pdfUrls) {
      try {
        pages.push(await loadImageSize(u));
      } catch (_) {}
    }
  } else {
    const mime = guessMime(item.name);
    const objUrl = bufferToObjectURL(buffer, mime);
    createdUrls.push(objUrl);
    try {
      pages.push(await loadImageSize(objUrl));
    } catch (_) {}
  }
  return pages;
}

async function openFolder(url, name, childName) {
  if (loading) return;
  loading = true;
  bgAbort = false;
  showScreen("loading");
  setLoading("フォルダ情報を取得中...", name || "");

  try {
    const opts = childName ? { onlyChildName: childName } : {};
    const fileList = await loadMegaFolder(
      url,
      (msg) => setLoading(msg, name || ""),
      opts
    );
    if (fileList.length === 0) throw new Error("表示できるファイルがありません");

    const first = fileList.slice(0, FIRST_BATCH);
    const rest = fileList.slice(FIRST_BATCH);
    const firstPages = [];

    for (let i = 0; i < first.length; i++) {
      setLoading(
        "すぐ表示するページを準備中 (" + (i + 1) + "/" + first.length + ")",
        first[i].path
      );
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

    showScreen("viewer");
    if (viewer) viewer.destroy();
    viewer = new ComicViewer({
      container: document.getElementById("viewer"),
      slotLeft: document.getElementById("page-left"),
      slotRight: document.getElementById("page-right"),
      pageInfo: document.getElementById("page-info"),
      slider: document.getElementById("page-slider"),
      onExit: backToShelf,
    });
    viewer.setPages(firstPages);

    if (rest.length > 0) loadRestInBackground(rest);
  } catch (err) {
    console.error(err);
    alert(err.message || "読み込みに失敗しました");
    showScreen("start");
  } finally {
    loading = false;
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
        if (pages.length && viewer && !bgAbort) viewer.appendPages(pages);
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

function backToShelf() {
  resetViewerState();
  renderShelf();
  showScreen("start");
}

function setLoading(text, progress) {
  loadingText.textContent = text;
  loadingProgress.textContent = progress || "";
}

// --- 一括登録 ---
async function bulkFetch() {
  const url = bulkUrl.value.trim();
  bulkError.classList.add("hidden");
  bulkList.innerHTML = "";
  bulkAddAllBtn.classList.add("hidden");
  bulkChildren = [];
  bulkParentUrl = "";

  if (!url || !/mega\.(nz|co\.nz)/i.test(url)) {
    bulkError.textContent = "正しいMEGAフォルダリンクを入力してください";
    bulkError.classList.remove("hidden");
    return;
  }

  bulkFetchBtn.disabled = true;
  bulkStatus.textContent = "取得中…（フォルダが多いと数分かかることがあります）";

  try {
    const dirs = await listChildFolders(url, (msg) => {
      bulkStatus.textContent = msg;
    });
    if (dirs.length === 0) {
      bulkStatus.textContent = "直下にフォルダがありませんでした";
      return;
    }
    bulkParentUrl = url;
    bulkChildren = dirs;
    bulkStatus.textContent = dirs.length + " 個のフォルダが見つかりました";
    bulkList.innerHTML = "";
    dirs.forEach((d) => {
      const row = document.createElement("div");
      row.className = "bulk-item";
      row.innerHTML = '<span class="name"></span>';
      row.querySelector(".name").textContent = d.name;
      bulkList.appendChild(row);
    });
    bulkAddAllBtn.classList.remove("hidden");
    bulkAddAllBtn.textContent = dirs.length + " 件すべて本棚に追加";
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
  if (!bulkParentUrl || bulkChildren.length === 0) return;
  const list = getShelf();
  const existing = new Set(
    list.map((x) => (x.childName || "") + "\n" + x.url)
  );
  let added = 0;
  for (const d of bulkChildren) {
    const key = d.name + "\n" + bulkParentUrl;
    if (existing.has(key)) continue;
    list.push({
      name: d.name,
      url: bulkParentUrl,
      childName: d.name,
    });
    existing.add(key);
    added++;
  }
  saveShelf(list);
  alert(added + " 件を本棚に追加しました（重複はスキップ）");
  renderShelf();
  showScreen("start");
}

// events
authBtn.addEventListener("click", handleAuth);
authInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") handleAuth();
});

addFolderBtn.addEventListener("click", () => {
  folderName.value = "";
  folderUrl.value = "";
  addError.classList.add("hidden");
  showScreen("add");
});
cancelAddBtn.addEventListener("click", () => showScreen("start"));
lockBtn.addEventListener("click", lockApp);

saveFolderBtn.addEventListener("click", () => {
  const name = folderName.value.trim();
  const url = folderUrl.value.trim();
  if (!name) {
    addError.textContent = "名前を入力してください";
    addError.classList.remove("hidden");
    return;
  }
  if (!url || !/mega\.(nz|co\.nz)/i.test(url)) {
    addError.textContent = "正しいMEGAリンクを入力してください";
    addError.classList.remove("hidden");
    return;
  }
  const list = getShelf();
  list.push({ name, url });
  saveShelf(list);
  renderShelf();
  showScreen("start");
});

bulkFolderBtn.addEventListener("click", () => {
  bulkUrl.value = "";
  bulkList.innerHTML = "";
  bulkStatus.textContent = "";
  bulkError.classList.add("hidden");
  bulkAddAllBtn.classList.add("hidden");
  bulkChildren = [];
  bulkParentUrl = "";
  showScreen("bulk");
});
bulkCancelBtn.addEventListener("click", () => showScreen("start"));
bulkFetchBtn.addEventListener("click", bulkFetch);
bulkAddAllBtn.addEventListener("click", bulkAddAll);

if (sessionStorage.getItem(SESSION_KEY) === "1" && localStorage.getItem(PASS_KEY)) {
  enterApp();
} else {
  showAuth();
}
