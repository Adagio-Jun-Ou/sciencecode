import fs from 'node:fs';
import { getDocument, VerbosityLevel } from 'pdfjs-dist/legacy/build/pdf.mjs';

const source = process.argv[2];
if (!source) {
  process.stderr.write('A PDF source path is required.\n');
  process.exitCode = 2;
} else {
  let loadingTask;
  try {
    const data = new Uint8Array(fs.readFileSync(source));
    loadingTask = getDocument({
      data,
      isEvalSupported: false,
      useSystemFonts: true,
      useWasm: true,
      verbosity: VerbosityLevel.ERRORS
    });
    const document = await loadingTask.promise;
    const pages = [];
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent({ disableNormalization: false });
      let text = '';
      for (const item of content.items) {
        if (typeof item?.str !== 'string') continue;
        text += item.str;
        text += item.hasEOL ? '\n' : ' ';
      }
      pages.push({ page: pageNumber, text: text.trim() });
      page.cleanup();
    }
    process.stdout.write(JSON.stringify({ pages }));
    await loadingTask.destroy();
  } catch (error) {
    try { await loadingTask?.destroy(); } catch {}
    process.stderr.write(String(error?.message ?? error).slice(0, 2_000) + '\n');
    process.exitCode = 1;
  }
}
