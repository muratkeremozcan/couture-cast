// The shared image fixture helper uses Node's Blob in jsdom. Browsers provide their own.
export const Blob = globalThis.Blob
