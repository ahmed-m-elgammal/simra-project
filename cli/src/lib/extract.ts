export interface Extractor {
  extractText(pdfBytes: Uint8Array): Promise<{ pages: string[] }>;
}

export class UnpdfExtractor implements Extractor {
  async extractText(pdfBytes: Uint8Array): Promise<{ pages: string[] }> {
    const { extractText, getDocumentProxy } = await import("unpdf");
    const pdf = await getDocumentProxy(pdfBytes);
    const { text } = await extractText(pdf, { mergePages: false });
    return { pages: (Array.isArray(text) ? text : [text]) as string[] };
  }
}

export class StubExtractor implements Extractor {
  constructor(private fixture: string[]) {}

  async extractText(_pdfBytes: Uint8Array): Promise<{ pages: string[] }> {
    return { pages: this.fixture };
  }
}

let override: Extractor | undefined;

export function setExtractor(e: Extractor | undefined): void {
  override = e;
}

export function getExtractor(): Extractor {
  return override ?? new UnpdfExtractor();
}
