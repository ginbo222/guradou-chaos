const CACHE_DB = "mcv_page_cache";
const CACHE_STORE = "pages";
const THUMB_STORE = "thumbs";

export function cacheKey(item) {
  return (
    (item.url || "") +
    "::" +
    (item.filePath || item.childName || item.fileName || item.name || "") +
    (item.rootFilesOnly ? "::root" : "")
  );
}

function openCacheDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(CACHE_DB, 2);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(CACHE_STORE)) {
        db.createObjectStore(CACHE_STORE);
      }
      if (!db.objectStoreNames.contains(THUMB_STORE)) {
        db.createObjectStore(THUMB_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function cacheGet(key) {
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

export async function cacheSet(key, blobs) {
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

export async function thumbGet(key) {
  try {
    const db = await openCacheDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(THUMB_STORE, "readonly");
      const r = tx.objectStore(THUMB_STORE).get(key);
      r.onsuccess = () => resolve(r.result || null);
      r.onerror = () => reject(r.error);
    });
  } catch {
    return null;
  }
}

export async function thumbSet(key, blob) {
  try {
    const db = await openCacheDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(THUMB_STORE, "readwrite");
      tx.objectStore(THUMB_STORE).put(blob, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (e) {
    console.warn("サムネ保存失敗", e);
  }
}
