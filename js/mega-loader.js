import { File } from "./megajs.esm.js";

export async function loadMegaFolder(url, onProgress) {
  if (onProgress) onProgress("MEGAフォルダの解析中...");

  let cleanUrl = url.trim();

  // URLから不要なフォルダ指定などを切り落とす処理
  const hashIdx = cleanUrl.indexOf("#");
  if (hashIdx !== -1) {
    const baseUrl = cleanUrl.substring(0, hashIdx);
    let keyPart = cleanUrl.substring(hashIdx + 1);

    const slashIdx = keyPart.search(/[\/\s?]/);
    if (slashIdx !== -1) {
      keyPart = keyPart.substring(0, slashIdx);
    }

    cleanUrl = baseUrl + "#" + keyPart;
  }

  const folder = File.fromURL(cleanUrl);
  await folder.loadAttributes();

  if (!folder.children) {
    throw new Error("フォルダ内にファイルが見つかりません");
  }

  const files = [];

  function traverse(item, pathPrefix = "") {
    if (item.directory) {
      for (const child of item.children) {
        traverse(child, pathPrefix ? `${pathPrefix}/${item.name}` : item.name);
      }
    } else {
      const fullPath = pathPrefix ? `${pathPrefix}/${item.name}` : item.name;
      const isPdf = /\.pdf$/i.test(item.name);
      const isImg = /\.(jpg|jpeg|png|webp|gif)$/i.test(item.name);
      if (isPdf || isImg) {
        files.push({
          name: item.name,
          path: fullPath,
          file: item,
          isPdf,
        });
      }
    }
  }

  traverse(folder);

  files.sort((a, b) =>
    a.path.localeCompare(b.path, undefined, { numeric: true, sensitivity: "base" })
  );

  return files;
}

export async function downloadFile(fileObj) {
  return new Promise((resolve, reject) => {
    fileObj.download((err, data) => {
      if (err) return reject(err);
      resolve(data.buffer || data);
    });
  });
}

export function guessMime(filename) {
  const ext = (filename.split(".").pop() || "").toLowerCase();
  if (ext === "png") return "image/png";
  if (ext === "webp") return "image/webp";
  if (ext === "gif") return "image/gif";
  return "image/jpeg";
}
