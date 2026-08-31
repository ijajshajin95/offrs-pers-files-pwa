// On-device-in-browser text recognition (Tesseract.js, WASM) for photographed
// docs — lets search match text INSIDE an image, not just its title/tags.
// Tesseract.js pulls its worker/core/language files from its own CDN on first
// use (then the browser HTTP cache serves them offline) — the one deliberate
// exception to "no network" here, alongside Firebase recovery on the lock
// screen. The extracted text and the image itself never leave the device.

let workerPromise = null;

function getWorker() {
  if (!workerPromise) {
    workerPromise = Tesseract.createWorker("eng");
  }
  return workerPromise;
}

/** Returns extracted text, or "" if OCR isn't available/fails — callers should treat that as "no text found," never block the upload on it. */
export async function extractText(fileOrBlob) {
  try {
    const worker = await getWorker();
    const { data } = await worker.recognize(fileOrBlob);
    return (data.text || "").trim();
  } catch {
    return "";
  }
}
