import { loadMegaFolder, listChildFiles, downloadFile, guessMime } from "./mega-loader.js";
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
let bulkFiles = [];
let historyLock = false;

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

function goScreen(name, push) {
  showScreen(name);
  if (historyLock) return;
  try {
    if (push) history.pushState({ screen: name }, "");
    else history.replaceState({ screen: name }, "");
  } catch (_) {}
}

function renderShelf() {
  const list = getShelf();
  shelfList.innerHTML = "";
  if (list.length === 0) {
    shelfList.innerHTML =
      '<p class="empty-shelf">まだありません<br>「1件追加」または「親フォルダから一括登録」</p>';
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
        saveShelf(getShelf().filter((_, i) => i !== index));
        renderShelf();
      }
    });
    row.appendChild(nameEl);
    row.appendChild(del);
    row.addEventListener("click", () => openItem(item));
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

async function openItem(item) {
  const opts = {};
  if (item.kind === "file" && item.fileName) {
    opts.onlyFileName = item.fileName;
  } else if (item.childName) {
    opts.onlyChildName = item.childName;
  }
  await openFolder(item.url, item.name, opts);
}

async function openFolder(url, name, opts) {
  if (loading) return;
  loading = true;
  bgAbort = false;
  goScreen("loading", false);
  setLoading("情報を取得中...", name || "");

  try {
    const fileList = await loadMegaFolder(
      url,
      (msg) => setLoading(msg, name || ""),
      opts || {}
    );
    if (fileList.length === 0) throw new Error("表示できるファイルがありません");

    const first = fileList.slice(0, FIRST_BATCH);
    const rest = fileList.slice(FIRST_BATCH);
    const firstPages = [];

    for (let i = 0; i < first.length; i++) {
      setLoading(
        "準備中 (" + (i + 1) + "/" + first.length + ")",
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
    viewer.setPages(firstPages);

    if (rest.length > 0) loadRestInBackground(rest);
  } catch (err) {
    console.error(err);
    alert(err.message || "読み込みに失敗しました");
    goScreen("start", false);
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
  await Promise.all(
    Array.from({ length: Math.min(PARALLEL, fileList.length) }, () => worker())
  );
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
  } else {
    goScreen("start", false);
  }
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
  bulkFiles = [];
  bulkParentUrl = "";

  if (!url || !/mega\.(nz|co\.nz)/i.test(url)) {
    bulkError.textContent = "正しいMEGAフォルダリンクを入力してください";
    bulkError.classList.remove("hidden");
    return;
  }

  bulkFetchBtn.disabled = true;
  bulkStatus.textContent = "取得中…（多いと数分かかることがあります）";

  try {
    const files = await listChildFiles(url, (msg) => {
      bulkStatus.textContent = msg;
    });
    if (files.length === 0) {
      bulkStatus.textContent =
        "直下にPDF・画像がありませんでした（サブフォルダ内は対象外です）";
      return;
    }
    bulkParentUrl = url;
    bulkFiles = files;
    bulkStatus.textContent = files.length + " 個のファイルが見つかりました";
    bulkList.innerHTML = "";
    files.forEach((f) => {
      const row = document.createElement("div");
      row.className = "bulk-item";
      const span = document.createElement("span");
      span.className = "name";
      span.textContent = f.name + (f.isPdf ? " [PDF]" : "");
      row.appendChild(span);
      bulkList.appendChild(row);
    });
    bulkAddAllBtn.classList.remove("hidden");
    bulkAddAllBtn.textContent = files.length + " 件すべて本棚に追加";
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
  if (!bulkParentUrl || bulkFiles.length === 0) return;
  const list = getShelf();
  const existing = new Set(
    list.map((x) => (x.fileName || x.childName || "") + "\n" + x.url)
  );
  let added = 0;
  for (const f of bulkFiles) {
    const key = f.name + "\n" + bulkParentUrl;
    if (existing.has(key)) continue;
    list.push({
      name: f.name.replace(/\.pdf$/i, ""),
      url: bulkParentUrl,
      kind: "file",
      fileName: f.name,
    });
    existing.add(key);
    added++;
  }
  saveShelf(list);
  alert(added + " 件を本棚に追加しました（重複はスキップ）");
  renderShelf();
  goScreen("start", false);
}

window.addEventListener("popstate", (e) => {
  if (historyLock) return;
  const screen = (e.state && e.state.screen) || "start";
  if (!viewerScreen.classList.contains("hidden")) resetViewerState();
  if (screen === "add") showScreen("add");
  else if (screen === "bulk") showScreen("bulk");
  else if (screen === "auth") showScreen("auth");
  else {
    renderShelf();
    showScreen("start");
  }
});

authBtn.addEventListener("click", handleAuth);
authInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") handleAuth();
});

addFolderBtn.addEventListener("click", () => {
  folderName.value = "";
  folderUrl.value = "";
  addError.classList.add("hidden");
  goScreen("add", true);
});
cancelAddBtn.addEventListener("click", () => {
  if (history.state && history.state.screen === "add") history.back();
  else goScreen("start", false);
});
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
  goScreen("start", false);
});

bulkFolderBtn.addEventListener("click", () => {
  bulkUrl.value = "";
  bulkList.innerHTML = "";
  bulkStatus.textContent = "";
  bulkError.classList.add("hidden");
  bulkAddAllBtn.classList.add("hidden");
  bulkFiles = [];
  bulkParentUrl = "";
  goScreen("bulk", true);
});
bulkCancelBtn.addEventListener("click", () => {
  if (history.state && history.state.screen === "bulk") history.back();
  else goScreen("start", false);
});
bulkFetchBtn.addEventListener("click", bulkFetch);
bulkAddAllBtn.addEventListener("click", bulkAddAll);

if (sessionStorage.getItem(SESSION_KEY) === "1" && localStorage.getItem(PASS_KEY)) {
  enterApp();
} else {
  showAuth();
}
