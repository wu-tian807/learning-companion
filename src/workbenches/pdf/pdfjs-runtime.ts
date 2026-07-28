import * as pdfjsLib from 'pdfjs-dist';

type PdfJsGlobal = typeof globalThis & {
  pdfjsLib?: typeof pdfjsLib;
};

(globalThis as PdfJsGlobal).pdfjsLib = pdfjsLib;

const pdfjsViewer = await import(
  'pdfjs-dist/web/pdf_viewer.mjs'
);

export { pdfjsLib, pdfjsViewer };
