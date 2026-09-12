import { bankFileRows } from "./bank-import-parser";
self.onmessage = async (
  event: MessageEvent<{ name: string; bytes: ArrayBuffer }>,
) => {
  try {
    self.postMessage({
      rows: await bankFileRows(event.data.name, event.data.bytes),
    });
  } catch (e) {
    self.postMessage({
      error: e instanceof Error ? e.message : "Archivo inválido",
    });
  }
};
