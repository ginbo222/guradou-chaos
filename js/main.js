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
  if (history.state &&
