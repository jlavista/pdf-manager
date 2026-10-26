import { parsePageGroups, safeFilename, formatBytes } from "./pdf-utils.js";

const $ = (id) => document.getElementById(id);
const sources = new Map();
const colors = ["#43826b", "#7c85b1", "#bd8a55", "#5b98a7", "#b27891", "#8e9d56"];
let pages = [];
let nextId = 0;
let busy = false;
let ready = false;
let pdfjs;
let draggedId = null;
let previewQueue = [];
let activePreviews = 0;
let previewWarning = false;

const observer = new IntersectionObserver((entries) => {
  for (const entry of entries) {
    if (!entry.isIntersecting) continue;
    observer.unobserve(entry.target);
    queuePreview(entry.target.dataset.id);
  }
}, { rootMargin: "300px" });

function showError(message = "") {
  $("error").textContent = message;
  $("error").hidden = !message;
}

function reportPreviewError(error) {
  console.error("PDF preview failed:", error);
  if (previewWarning) return;
  previewWarning = true;
  $("notice").textContent = "Some previews could not be displayed. The original pages can still be exported.";
  $("notice").hidden = false;
}

function setBusy(value, message) {
  busy = value;
  $("pages").setAttribute("aria-busy", String(value));
  if (message) $("status").textContent = message;
  updateControls();
}

function updateControls() {
  const checked = pages.filter((page) => page.selected).length;
  const mode = $("export-mode").value;
  document.querySelectorAll("[data-lock]").forEach((element) => {
    element.disabled = busy || !ready;
  });
  $("clear").disabled = busy || !sources.size;
  for (const id of ["select-all", "select-none", "reverse"]) {
    $(id).disabled = busy || !pages.length;
  }
  for (const id of ["rotate", "remove"]) {
    $(id).disabled = busy || !checked;
  }
  $("download").disabled = busy || !ready || !(mode === "ranges" ? pages.length : checked);
  $("page-count").textContent = `${pages.length} ${pages.length === 1 ? "PAGE" : "PAGES"}`;
  $("selection-count").textContent = `${checked} checked`;
  $("file-summary").textContent = sources.size
    ? `${sources.size} ${sources.size === 1 ? "file" : "files"} \u00b7 ${formatBytes([...sources.values()].reduce((sum, source) => sum + source.size, 0))}`
    : "No files added yet";
  $("empty").hidden = pages.length > 0;
  $("ranges-field").hidden = mode !== "ranges";
  $("extension").textContent = mode === "merge" ? ".pdf" : ".zip";
  $("download-label").textContent = busy ? "Working..." : mode === "merge" ? "Download PDF" : "Download ZIP";
  $("mode-hint").textContent = {
    merge: "Combine checked pages in the order shown. Uncheck pages to leave them out.",
    each: "Each checked page becomes its own PDF, numbered in the order shown, in one ZIP file.",
    ranges: "Create a separate PDF for each page group. Groups use the current workspace order."
  }[mode];
  $("export-summary").textContent = !pages.length ? "Add some pages to get started."
    : mode === "ranges" ? `${pages.length} workspace pages available for your groups.`
    : `${checked} of ${pages.length} pages ${mode === "merge" ? "in your PDF" : "to split"}.`;

  for (const [index, page] of pages.entries()) {
    const card = page.card;
    card.draggable = !busy;
    card.classList.toggle("unchecked", !page.selected);
    card.querySelector(".page-number").textContent = `Page ${index + 1}`;
    const checkbox = card.querySelector("input");
    checkbox.checked = page.selected;
    checkbox.disabled = busy;
    checkbox.setAttribute("aria-label", `Include page ${index + 1}, ${page.source.name}, original page ${page.index + 1}`);
    for (const button of card.querySelectorAll("button")) {
      const action = button.dataset.action;
      button.disabled = busy || (action === "earlier" && index === 0) || (action === "later" && index === pages.length - 1);
      button.setAttribute("aria-label", `${button.title}: page ${index + 1}`);
    }
    card.querySelector(".source-page").textContent = `Original page ${page.index + 1}${page.rotation ? ` \u00b7 +${page.rotation}\u00b0` : ""}`;
  }
  document.querySelectorAll(".file-remove").forEach((button) => { button.disabled = busy; });
}

function renderFiles() {
  $("file-list").replaceChildren();
  for (const source of sources.values()) {
    const item = document.createElement("li");
    item.className = "file-item";
    item.style.setProperty("--source-color", source.color);
    const dot = document.createElement("span");
    dot.className = "file-dot";
    const info = document.createElement("div");
    info.className = "file-info";
    const name = document.createElement("span");
    name.className = "file-name";
    name.textContent = source.name;
    name.title = source.name;
    const detail = document.createElement("span");
    detail.className = "file-detail";
    const remaining = pages.filter((page) => page.source === source).length;
    detail.textContent = `${remaining} of ${source.count} pages \u00b7 ${formatBytes(source.size)}`;
    info.append(name, detail);
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "file-remove";
    remove.textContent = "\u00d7";
    remove.setAttribute("aria-label", `Remove file ${source.name}`);
    remove.addEventListener("click", () => removePages((page) => page.source === source));
    item.append(dot, info, remove);
    $("file-list").append(item);
  }
}

function createCard(page) {
  const card = $("page-template").content.firstElementChild.cloneNode(true);
  card.dataset.id = page.id;
  card.style.setProperty("--source-color", page.source.color);
  card.querySelector(".source-name").textContent = page.source.name;
  card.querySelector(".source-name").title = page.source.name;
  page.card = card;
  return card;
}

function syncPages() {
  // Keep existing canvases rather than re-rendering thumbnails on each reorder.
  const fragment = document.createDocumentFragment();
  for (const page of pages) fragment.append(page.card || createCard(page));
  $("pages").replaceChildren(fragment);
  for (const page of pages) {
    if (!page.previewState) observer.observe(page.card);
  }
  renderFiles();
  updateControls();
}

async function loadPreviewDocument(source) {
  if (!source.previewPromise) {
    source.previewPromise = pdfjs.getDocument({
      data: source.bytes.slice(),
      cMapUrl: new URL("./vendor/pdfjs/cmaps/", import.meta.url).href,
      cMapPacked: true,
      standardFontDataUrl: new URL("./vendor/pdfjs/standard_fonts/", import.meta.url).href,
      wasmUrl: new URL("./vendor/pdfjs/wasm/", import.meta.url).href,
      isEvalSupported: false,
      // AcroForm appearances are flattened by pdf-lib before thumbnail rendering.
      enableXfa: false
    }).promise;
  }
  return source.previewPromise;
}

function queuePreview(id) {
  const page = pages.find((item) => item.id === id);
  if (!page || page.previewState === "queued" || page.previewState === "rendering") return;
  page.previewState = "queued";
  previewQueue.push(page);
  drainPreviews();
}

function drainPreviews() {
  while (activePreviews < 2 && previewQueue.length) {
    const page = previewQueue.shift();
    if (!pages.includes(page)) continue;
    activePreviews++;
    page.previewState = "rendering";
    renderPreview(page).finally(() => {
      activePreviews--;
      drainPreviews();
    });
  }
}

async function renderPreview(page) {
  const rotation = page.rotation;
  const card = page.card;
  const message = card.querySelector(".thumbnail-status");
  message.textContent = "Rendering preview...";
  try {
    const doc = await loadPreviewDocument(page.source);
    if (!pages.includes(page)) return;
    const pdfPage = await doc.getPage(page.index + 1);
    const original = pdfPage.getViewport({ scale: 1, rotation: (pdfPage.rotate + rotation) % 360 });
    const scale = Math.min(300 / original.width, 340 / original.height);
    const viewport = pdfPage.getViewport({ scale, rotation: (pdfPage.rotate + rotation) % 360 });
    const canvas = card.querySelector("canvas");
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    await pdfPage.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
    canvas.hidden = false;
    canvas.setAttribute("role", "img");
    canvas.setAttribute("aria-label", `${page.source.name}, original page ${page.index + 1}`);
    message.hidden = true;
    page.previewState = "done";
  } catch (error) {
    if (!pages.includes(page)) return;
    page.previewState = "failed";
    message.hidden = false;
    message.textContent = "Preview unavailable";
    card.querySelector("canvas").hidden = true;
    reportPreviewError(error);
  } finally {
    if (pages.includes(page) && rotation !== page.rotation) {
      page.previewState = null;
      queuePreview(page.id);
    }
  }
}

async function imageToPdf(file) {
  // Decode in the browser to honor photo orientation and normalize all formats to PNG.
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  const canvas = document.createElement("canvas");
  try {
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Your browser could not create an image canvas.");
    context.drawImage(bitmap, 0, 0);
    const png = await new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error("This image could not be converted. Try a smaller image."));
      }, "image/png");
    });
    const doc = await window.PDFLib.PDFDocument.create();
    const image = await doc.embedPng(await png.arrayBuffer());
    // Use 96 DPI, keeping the entire image within PDF's 200-inch page limit.
    const scale = Math.min(72 / 96, 14400 / image.width, 14400 / image.height);
    const width = image.width * scale;
    const height = image.height * scale;
    doc.addPage([width, height]).drawImage(image, { x: 0, y: 0, width, height });
    return { doc, bytes: await doc.save() };
  } finally {
    bitmap.close();
    canvas.width = 0;
    canvas.height = 0;
  }
}

async function loadSourceFile(file) {
  const isPdf = /\.pdf$/i.test(file.name) || file.type === "application/pdf";
  const isImage = /\.(png|jpe?g|webp)$/i.test(file.name) || /^image\/(png|jpeg|webp)$/i.test(file.type);
  if (!isPdf && !isImage) throw new Error("Choose a PDF, PNG, JPEG, or WebP file.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!isPdf) {
    const isPng = [137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => bytes[index] === byte);
    const isJpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
    const isWebp = [82, 73, 70, 70].every((byte, index) => bytes[index] === byte) &&
      [87, 69, 66, 80].every((byte, index) => bytes[index + 8] === byte);
    if (!isPng && !isJpeg && !isWebp) throw new Error("This is not a valid PNG, JPEG, or WebP image.");
    return imageToPdf(file);
  }
  const doc = await window.PDFLib.PDFDocument.load(bytes);
  if (doc.isEncrypted) throw new Error("Password-protected PDFs are not supported. Save an unencrypted copy first.");
  if (!doc.getPageCount()) throw new Error("This PDF has no pages.");
  // Flatten forms on import so field appearances survive copying into a new PDF.
  const form = doc.getForm();
  if (form.getFields().length) {
    form.flatten({ updateFieldAppearances: false });
    return { doc, bytes: await doc.save() };
  }
  return { doc, bytes };
}

async function addFiles(fileList) {
  if (busy || !ready) return;
  const files = [...fileList];
  if (!files.length) return;
  showError();
  const errors = [];
  let added = 0;
  setBusy(true, `Opening ${files.length} ${files.length === 1 ? "file" : "files"}...`);
  try {
    for (const [index, file] of files.entries()) {
      $("status").textContent = `Opening file ${index + 1} of ${files.length}: ${file.name}`;
      try {
        const { doc, bytes } = await loadSourceFile(file);
        const source = {
          id: `source-${nextId++}`, name: file.name, size: file.size,
          bytes, doc, count: doc.getPageCount(), color: colors[nextId % colors.length],
          previewPromise: null
        };
        sources.set(source.id, source);
        for (let pageIndex = 0; pageIndex < source.count; pageIndex++) {
          pages.push({ id: `page-${nextId++}`, source, index: pageIndex, rotation: 0, selected: true, card: null, previewState: null });
        }
        added++;
      } catch (error) {
        console.error(`Could not open ${file.name}:`, error);
        const encrypted = error.name === "EncryptedPDFError" || /encrypted/i.test(error.message);
        errors.push(`${file.name}: ${encrypted ? "Password-protected PDFs are not supported. Save an unencrypted copy first." : `Could not open this file. ${error.message}`}`);
      }
    }
    syncPages();
    $("status").textContent = added
      ? `Added ${added} ${added === 1 ? "file" : "files"}. Your pages are ready to arrange.`
      : "No files were added.";
  } finally {
    setBusy(false);
    $("file-input").value = "";
    showError(errors.join("\n"));
  }
}

function releaseSource(source) {
  sources.delete(source.id);
  if (source.previewPromise) {
    source.previewPromise.then((doc) => doc.destroy()).catch(reportPreviewError);
  }
}

function removePages(predicate) {
  if (busy) return;
  const removed = pages.filter(predicate);
  for (const page of removed) observer.unobserve(page.card);
  pages = pages.filter((page) => !removed.includes(page));
  previewQueue = previewQueue.filter((page) => pages.includes(page));
  for (const source of sources.values()) {
    if (!pages.some((page) => page.source === source)) releaseSource(source);
  }
  syncPages();
  $("status").textContent = `Removed ${removed.length} ${removed.length === 1 ? "page" : "pages"}.`;
  if (!pages.length) {
    previewWarning = false;
    $("notice").hidden = true;
  }
}

function rotatePages(targets) {
  for (const page of targets) {
    page.rotation = (page.rotation + 90) % 360;
    // A render already in progress will pick up the latest rotation when it finishes.
    if (page.previewState !== "rendering" && page.previewState !== "queued") {
      page.previewState = null;
      observer.observe(page.card);
    }
  }
  updateControls();
  $("status").textContent = `Rotated ${targets.length} ${targets.length === 1 ? "page" : "pages"} clockwise.`;
}

function movePage(id, destination) {
  const from = pages.findIndex((page) => page.id === id);
  if (from < 0 || destination < 0 || destination >= pages.length || from === destination) return;
  const [page] = pages.splice(from, 1);
  pages.splice(destination, 0, page);
  syncPages();
  $("status").textContent = `Moved page ${from + 1} to position ${destination + 1}.`;
}

async function createPdf(group) {
  const output = await window.PDFLib.PDFDocument.create();
  const copies = new Array(group.length);
  // Copy in source batches so shared fonts and images are not embedded for every page.
  for (const source of new Set(group.map((page) => page.source))) {
    const positions = group.map((page, position) => ({ page, position })).filter((item) => item.page.source === source);
    const copied = await output.copyPages(source.doc, positions.map(({ page }) => page.index));
    for (const [index, { page, position }] of positions.entries()) {
      const copy = copied[index];
      copy.setRotation(window.PDFLib.degrees((copy.getRotation().angle + page.rotation) % 360));
      copies[position] = copy;
    }
  }
  for (const copy of copies) output.addPage(copy);
  return output.save();
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  // Let the browser acquire the Blob before releasing its URL.
  window.setTimeout(() => URL.revokeObjectURL(url), 60000);
}

async function exportPages() {
  if (busy || !ready) return;
  showError();
  $("ranges").removeAttribute("aria-invalid");
  $("filename").removeAttribute("aria-invalid");
  const mode = $("export-mode").value;
  let groups;
  let filename;
  try {
    filename = safeFilename($("filename").value);
  } catch (error) {
    showError(error.message);
    $("filename").setAttribute("aria-invalid", "true");
    $("filename").focus();
    return;
  }
  try {
    const selected = pages.filter((page) => page.selected);
    groups = mode === "ranges"
      ? parsePageGroups($("ranges").value, pages.length).map((indices) => indices.map((index) => pages[index]))
      : mode === "each" ? selected.map((page) => [page]) : [selected];
    if (!groups.length || groups.some((group) => !group.length)) throw new Error("Check at least one page to download.");
  } catch (error) {
    showError(error.message);
    if (mode === "ranges") {
      $("ranges").setAttribute("aria-invalid", "true");
      $("ranges").focus();
    }
    return;
  }
  setBusy(true, "Preparing your download...");
  try {
    // Yield once so busy feedback is painted before PDF work starts.
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    if (mode === "merge") {
      const bytes = await createPdf(groups[0]);
      downloadBlob(new Blob([bytes], { type: "application/pdf" }), `${filename}.pdf`);
    } else {
      const zip = new window.JSZip();
      const digits = Math.max(3, String(groups.length).length);
      for (const [index, group] of groups.entries()) {
        $("status").textContent = `Preparing PDF ${index + 1} of ${groups.length}...`;
        const bytes = await createPdf(group);
        zip.file(`${filename}-${String(index + 1).padStart(digits, "0")}.pdf`, bytes);
        await new Promise((resolve) => window.setTimeout(resolve, 0));
      }
      $("status").textContent = "Packaging your ZIP...";
      const blob = await zip.generateAsync({ type: "blob", compression: "STORE" });
      downloadBlob(blob, `${filename}.zip`);
    }
    $("status").textContent = `Download ready: ${filename}.${mode === "merge" ? "pdf" : "zip"}. Your originals are unchanged.`;
  } catch (error) {
    console.error("PDF export failed:", error);
    showError(`Could not create your download. ${error.message}`);
    $("status").textContent = "Download failed. Your pages are still here.";
  } finally {
    setBusy(false);
  }
}

$("add-files").addEventListener("click", () => $("file-input").click());
$("file-input").addEventListener("change", (event) => addFiles(event.target.files));
$("download").addEventListener("click", exportPages);
$("export-mode").addEventListener("change", () => { showError(); updateControls(); });
$("ranges").addEventListener("input", () => $("ranges").removeAttribute("aria-invalid"));
$("filename").addEventListener("input", () => $("filename").removeAttribute("aria-invalid"));
$("clear").addEventListener("click", () => {
  if (!busy && window.confirm("Clear all files and pages from this workspace? Your originals will not be changed.")) {
    removePages(() => true);
    showError();
    $("status").textContent = "Workspace cleared. Ready for a fresh start.";
  }
});
for (const [id, selected] of [["select-all", true], ["select-none", false]]) {
  $(id).addEventListener("click", () => {
    if (busy) return;
    pages.forEach((page) => { page.selected = selected; });
    updateControls();
  });
}
$("reverse").addEventListener("click", () => {
  if (busy) return;
  pages.reverse();
  syncPages();
  $("status").textContent = "Reversed the page order.";
});
$("rotate").addEventListener("click", () => { if (!busy) rotatePages(pages.filter((page) => page.selected)); });
$("remove").addEventListener("click", () => removePages((page) => page.selected));
$("pages").addEventListener("change", (event) => {
  if (busy || !event.target.matches('input[type="checkbox"]')) return;
  const page = pages.find((item) => item.id === event.target.closest(".page-card").dataset.id);
  page.selected = event.target.checked;
  updateControls();
});
$("pages").addEventListener("click", (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button || busy) return;
  const card = button.closest(".page-card");
  const index = pages.findIndex((page) => page.id === card.dataset.id);
  const page = pages[index];
  const action = button.dataset.action;
  if (action === "rotate") rotatePages([page]);
  if (action === "remove") {
    removePages((item) => item === page);
    const neighbor = pages[Math.min(index, pages.length - 1)];
    if (neighbor) neighbor.card.querySelector("input").focus();
    else $("add-files").focus();
  }
  if (action === "earlier" || action === "later") {
    movePage(page.id, index + (action === "earlier" ? -1 : 1));
    const target = card.querySelector(`[data-action="${action}"]`);
    if (!target.disabled) target.focus();
    else card.querySelector("input").focus();
  }
});

function clearDropMarkers() {
  $("pages").querySelectorAll(".drop-before, .drop-after").forEach((card) => card.classList.remove("drop-before", "drop-after"));
}

$("pages").addEventListener("dragstart", (event) => {
  const card = event.target.closest(".page-card");
  if (!card || busy || event.target.closest("button, input")) {
    event.preventDefault();
    return;
  }
  draggedId = card.dataset.id;
  event.dataTransfer.setData("text/plain", draggedId);
  event.dataTransfer.effectAllowed = "move";
  card.classList.add("dragging");
});
$("pages").addEventListener("dragover", (event) => {
  if (!draggedId || busy) return;
  const card = event.target.closest(".page-card");
  if (!card) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = "move";
  clearDropMarkers();
  if (card.dataset.id === draggedId) return;
  const rect = card.getBoundingClientRect();
  card.classList.add(event.clientX < rect.left + rect.width / 2 ? "drop-before" : "drop-after");
});
$("pages").addEventListener("drop", (event) => {
  if (!draggedId || busy) return;
  event.preventDefault();
  const card = event.target.closest(".page-card");
  if (card && card.dataset.id !== draggedId) {
    const from = pages.findIndex((page) => page.id === draggedId);
    const to = pages.findIndex((page) => page.id === card.dataset.id);
    const rect = card.getBoundingClientRect();
    const after = event.clientX >= rect.left + rect.width / 2;
    movePage(draggedId, to + (after ? 1 : 0) - (from < to ? 1 : 0));
  }
  clearDropMarkers();
});
$("pages").addEventListener("dragend", () => {
  draggedId = null;
  clearDropMarkers();
  $("pages").querySelectorAll(".dragging").forEach((card) => card.classList.remove("dragging"));
});

// Prevent the browser from navigating away when a file is dropped outside the picker.
document.addEventListener("dragover", (event) => {
  if (![...event.dataTransfer.types].includes("Files")) return;
  event.preventDefault();
  if (!busy && ready) $("add-files").classList.add("drag-over");
});
document.addEventListener("dragleave", (event) => {
  if (!event.relatedTarget) $("add-files").classList.remove("drag-over");
});
document.addEventListener("drop", (event) => {
  $("add-files").classList.remove("drag-over");
  if (!event.dataTransfer.files.length) return;
  event.preventDefault();
  if (busy) {
    showError("Please wait for the current operation to finish, then add your files again.");
    return;
  }
  addFiles(event.dataTransfer.files);
});

async function initialize() {
  try {
    pdfjs = await import("./vendor/pdfjs/build/pdf.min.mjs");
    pdfjs.GlobalWorkerOptions.workerSrc = new URL("./vendor/pdfjs/build/pdf.worker.min.mjs", import.meta.url).href;
    if (!window.PDFLib || !window.JSZip) throw new Error("A required PDF library did not load.");
    ready = true;
    updateControls();
    $("status").textContent = "Add PDFs or images to get started. Nothing leaves your browser.";
  } catch (error) {
    console.error("PDF tools failed to initialize:", error);
    showError("PDF tools could not load. Serve this folder over HTTP (or GitHub Pages) in a current browser, then refresh. Make sure the vendor folder is included.");
    $("status").textContent = "PDF tools are unavailable.";
  }
}

initialize();
