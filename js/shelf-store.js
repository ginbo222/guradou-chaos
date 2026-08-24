const SHELF_KEY = "mcv_shelf_v2";

export function uid() {
  return "id_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8);
}

export function getShelf() {
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

export function saveShelf(data) {
  localStorage.setItem(SHELF_KEY, JSON.stringify(data));
}
