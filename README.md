# JustTools / PDF Manager

100% free, No ads, all happen on the browsers, 100% private, No uploads. No tricks. Just tools.

A static, client-side PDF workspace styled to match the [JustTools QR-code generator](https://jlavista.github.io/qr-code/). No backend, build step, accounts, analytics, CDN requests, or file uploads.

## Use

Add or drop PDFs or images. Drag page cards or use their arrow buttons to reorder them. Check/uncheck pages, rotate them, reverse the order, or remove pages and entire files.

- **Image to PDF:** choose or drop PNG, JPEG, or WebP images, then click **Download PDF**. Each image becomes one edge-to-edge, image-sized page at 96 DPI, preserving aspect ratio, photo orientation, and transparency. Multiple images can become one PDF, or be mixed with existing PDF pages. Animated images use their first frame. Images exceeding PDF's 200-inch page limit are fitted within it without cropping.

- **One PDF:** merge checked pages in workspace order, or extract just the pages you need.
- **Separate PDFs:** download each checked page as a PDF inside a ZIP.
- **Custom page groups:** use workspace page numbers, regardless of checkboxes. `1-3; 4,6; 7-9` produces three PDFs in a ZIP. Groups can overlap or repeat pages. Reordering changes the numbers used by groups.

The originals are never modified. Processing and previews happen locally in the browser, and closing/reloading the tab clears the workspace. Downloads remain on your device. Large documents are limited by your device's available memory.

Use current Chrome, Edge, Firefox, or Safari. Touch users can reorder with the arrow buttons. Password-protected PDFs are rejected. Existing form appearances are flattened when possible; interactive fields, document-level bookmarks, and digital signatures are not preserved. Check the output of documents with complex forms before sharing.

## Run locally

Serve this folder with any static web server. For example, if Python is installed:

```powershell
python -m http.server 8000 --bind 127.0.0.1
```

Open `http://localhost:8000`. Opening `index.html` directly with `file://` is not supported because browser modules and the PDF worker require HTTP.

## Host on GitHub Pages

1. Push the contents of this folder to a GitHub repository, including `vendor`.
2. In **Settings > Pages**, choose **Deploy from a branch**, the `main` branch, and **/ (root)**.
3. Open the Pages URL shown by GitHub.

All asset paths are relative, so project sites such as `https://username.github.io/pdf-manager/` work without configuration. No workflow or build service is needed.

## Libraries

Browser distributions and supporting fonts, character maps, and WASM decoders are vendored so runtime requests stay on your own site:

| Library | Version | License | Purpose |
|---|---|---|---|
| [pdf-lib](https://github.com/Hopding/pdf-lib) | 1.17.1 | MIT | Image-to-PDF conversion, PDF loading, copying, flattening, rotation, and export |
| [PDF.js](https://github.com/mozilla/pdf.js) | 5.7.284 | Apache-2.0 | Lazy page previews |
| [JSZip](https://github.com/Stuk/jszip) | 3.10.1 | MIT or GPL-3.0 | Bundling split PDFs |

Upstream license files are included in `vendor` and the PDF.js asset directories. Distribution files were obtained from the corresponding versioned npm packages via jsDelivr. Retain these licenses when redistributing.
