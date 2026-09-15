import { describe, expect, it } from "vitest";
import { getExtractor, setExtractor, StubExtractor, UnpdfExtractor } from "./extract.js";

describe("extract", () => {
  it("stub returns the fixture and ignores input bytes", async () => {
    setExtractor(new StubExtractor(["p1", "p2"]));
    try {
      const out = await getExtractor().extractText(new Uint8Array([0]));
      expect(out.pages).toEqual(["p1", "p2"]);
    } finally {
      setExtractor(undefined);
    }
  });
  it("restores the real extractor when cleared", () => {
    setExtractor(new StubExtractor([]));
    setExtractor(undefined);
    expect(getExtractor()).toBeInstanceOf(UnpdfExtractor);
  });
});
