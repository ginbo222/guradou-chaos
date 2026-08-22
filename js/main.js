import { loadMegaFolder, downloadFile, guessMime } from "./mega-loader.js";
import { renderPdfPages } from "./pdf-renderer.js";
import { bufferToObjectURL, loadImageSize } from "./utils.js";
import { ComicViewer } from "./viewer.js";

const authScreen = document.getElementById("auth-screen");
const startScreen = document.getElementById("start-screen");
const addScreen = document.getElementById("add-screen");
const loadingScreen = document.getElementById("loading-screen");
const viewerScreen = document.getElementById("viewer-screen");

const authTitle = document.getElementById("auth-title");
const authSub = document.getElementById("auth-sub");
const authInput = document.getElementById("auth-input");
const authBtn = document.getElementById("auth-btn");
const authError = document.getElementById("auth-error");

const shelfList = document.getElementById("shelf-list");
const addFolderBtn = document.getElementById("add-folder-btn");
const lockBtn = document.getElementById("lock-btn");
const folderName = document.getElementById("folder-name");
const folderUrl = document.getElementById("folder-url");
const saveFolderBtn = document.getElementById("save-folder-btn");
const cancelAddBtn = document.getElementById("cancel-add-btn");
const addError = document.getElementById("add-error");

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

async function sha256(text) {
  const data = new TextEncoder().encode(text);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// my_site_folders.txt からテキストデータを自動読み込みして配列化する関数
async function fetchTxtFolders() {
  try {
    const res = await fetch("./my_site_folders.txt");
    if (!res.ok) return [];
    const text = await res.text();
    const items = [];
    const lines = text.trim().split("\n");
    lines.forEach((line) => {
      if (!line.trim()) return;
      const commaIdx = line.lastIndexOf("http");
      if (commaIdx !== -1) {
        let name = line.substring(0, commaIdx).replace(/,$/, "").trim();
        let url = line.substring(commaIdx).trim();
        items.push({ name, url });
      }
    });
    return items;
  } catch {
    return [];
  }
}

function getLocalShelf() {
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
  loadingScreen.classList.toggle("hidden", name !== "loading");
  viewerScreen.classList.toggle("hidden", name !== "viewer");
}

async function renderShelf() {
  const localList = getLocalShelf();
  const txtList = await fetchTxtFolders();

  // 重複を避けつつ txt の290個と手動追加分を合体
  const combined = [...localList];
  txtList.forEach((txtItem) => {
    if (!combined.some((item) => item.url === txtItem.url)) {
      combined.push(txtItem);
    }
  });

  shelfList.innerHTML = "";
  if (combined.length === 0) {
    shelfList.innerHTML =
      '<p class="empty-shelf">まだフォルダがありません<br>下のボタンから追加してください</p>';
    return;
  }

  combined.forEach((item, index) => {
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
        const nextLocal = getLocalShelf().filter((loc) => loc.url !== item.url);
        saveShelf(nextLocal);
        renderShelf();
      }
    });
    row.appendChild(nameEl);
    row.appendChild(del);
    row.addEventListener("click", () => openFolder(item.url, item.name));
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
  const saved = localStorage.getItem(PASS_KEY);
  if (hash === saved) {
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

async function openFolder(url, name) {
  if (loading) return;
  loading = true;
  bgAbort = false;
  showScreen("loading");
  setLoading("フォルダ情報を取得中...", name || "");

  try {
    const fileList = await loadMegaFolder(url, (msg) => setLoading(msg, name || ""));
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
cancelAddBtn.addEventListener("click", showScreen("start"));
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
  const list = getLocalShelf();
  list.push({ name, url });
  saveShelf(list);
  renderShelf();
  showScreen("start");
});

if (sessionStorage.getItem(SESSION_KEY) === "1" && localStorage.getItem(PASS_KEY)) {
  enterApp();
} else {
  showAuth();
}
