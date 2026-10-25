export function parsePageGroups(text, pageCount) {
  if (!text.trim()) {
    throw new Error("Enter page groups, such as 1-3; 4-6; 7,9.");
  }
  return text.split(";").map((group, groupIndex) => {
    if (!group.trim()) {
      throw new Error(`Group ${groupIndex + 1} is empty. Put page numbers between semicolons.`);
    }
    return group.split(",").flatMap((part) => {
      const match = part.trim().match(/^(\d+)(?:\s*-\s*(\d+))?$/);
      if (!match) {
        throw new Error(`"${part.trim()}" is not a page or range. Use a format like 1,3-5.`);
      }
      const first = Number(match[1]);
      const last = Number(match[2] || match[1]);
      if (!Number.isSafeInteger(first) || !Number.isSafeInteger(last) ||
          first < 1 || last > pageCount || first > last) {
        throw new Error(`Page ranges must run forward and stay between 1 and ${pageCount}.`);
      }
      return Array.from({ length: last - first + 1 }, (_, index) => first + index - 1);
    });
  });
}

export function safeFilename(value) {
  const name = value.trim().replace(/\.(pdf|zip)$/i, "")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-").replace(/[. ]+$/g, "").slice(0, 100);
  if (!name) {
    throw new Error("Enter a file name before downloading.");
  }
  return /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name) ? `document-${name}` : name;
}

export function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
