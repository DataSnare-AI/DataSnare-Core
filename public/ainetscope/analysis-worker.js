"use strict";

importScripts("app.js");

self.onmessage = event => {
  const { buffer, settings } = event.data;
  try {
    const packets = parseCapture(buffer, { ...settings, onProgress: count => self.postMessage({ type: "progress", packets: count }) });
    self.postMessage({ type: "complete", packets, compact: packets.compact === true, buffer }, [buffer]);
  } catch (error) {
    self.postMessage({ error: error.message || "Unable to parse capture." });
  }
};