import { getShelf, saveShelf, uid } from "./shelf-store.js";
import { openItem, resetViewerState } from "./open.js";
import { listImageFolders, listAllFiles } from "./mega-loader.js";

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

const PASS_KEY = "mcv_pass_hash";
const SESSION_KEY = "mcv_unlocked";

let authMode = "login";
let currentFolderId = null;
let movingItemId = null;
let historyLock = false;
let bulkParentUrl = "";
let bulkEntries = [];
let bulkMode = "folders";

async function sha256(text) {
  const data = new TextEncoder().encode(text);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
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
    } else {
      openItem(item, {
        showScreen,
        goScreen,
        onExit: backToShelfFromButton,
      });
    }
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
    const folders = await listImageFolders(url, (msg) => {
      bulkStatus.textContent = msg;
    });

    if (folders.length) {
      bulkMode = "folders";
      bulkParentUrl = url;
      bulkEntries = folders;
      bulkStatus.textContent = folders.length + " 冊（フォルダ＝1冊）";
      folders.forEach((f) => {
        const row = document.createElement("div");
        row.className = "bulk-item";
        const span = document.createElement("span");
        span.className = "name";
        span.textContent = "📁 " + f.name + "（" + f.fileCount + "枚）";
        row.appendChild(span);
        bulkList.appendChild(row);
      });
      bulkAddAllBtn.classList.remove("hidden");
      bulkAddAllBtn.textContent = folders.length + " 冊を本棚に追加";
      return;
    }

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
  const screen = (e.state && e.state.screen) || "start";
  if (!viewerScreen.classList.contains("hidden")) resetViewerState();
  if (screen === "add") showScreen("add");
  else if (screen === "bulk") showScreen("bulk");
  else if (screen === "move") showScreen("move");
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

shelfBackBtn.addEventListener("click", () => {
  const data = getShelf();
  const folder = data.items.find((x) => x.id === currentFolderId);
  currentFolderId = folder && folder.parentId ? folder.parentId : null;
  renderShelf();
});

addFolderBtn.addEventListener("click", () => {
  const name = prompt("フォルダ名");
  if (!name || !name.trim()) return;
  const data = getShelf();
  data.items.push({
    id: uid(),
    type: "folder",
    name: name.trim(),
    parentId: currentFolderId,
  });
  saveShelf(data);
  renderShelf();
});

addItemBtn.addEventListener("click", () => {
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
  const data = getShelf();
  data.items.push({
    id: uid(),
    type: "book",
    name,
    url,
    parentId: currentFolderId,
  });
  saveShelf(data);
  renderShelf();
  goScreen("start", false);
});

bulkFolderBtn.addEventListener("click", () => {
  bulkUrl.value = "";
  bulkList.innerHTML = "";
  bulkStatus.textContent = "";
  bulkError.classList.add("hidden");
  bulkAddAllBtn.classList.add("hidden");
  bulkEntries = [];
  bulkParentUrl = "";
  goScreen("bulk", true);
});

bulkCancelBtn.addEventListener("click", () => {
  if (history.state && history.state.screen === "bulk") history.back();
  else goScreen("start", false);
});

bulkFetchBtn.addEventListener("click", bulkFetch);
bulkAddAllBtn.addEventListener("click", bulkAddAll);

moveRootBtn.addEventListener("click", () => {
  if (movingItemId) moveItemTo(movingItemId, null);
});

moveCancelBtn.addEventListener("click", () => {
  movingItemId = null;
  if (history.state && history.state.screen === "move") history.back();
  else goScreen("start", false);
});

if (sessionStorage.getItem(SESSION_KEY) === "1" && localStorage.getItem(PASS_KEY)) {
  enterApp();
} else {
  showAuth();
}
