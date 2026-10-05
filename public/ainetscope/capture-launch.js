"use strict";

const captureLaunches = new Map();
let capturePickerLaunch = null;

function reserveCaptureWindow() {
  if (!/^https?:$/.test(location.protocol)) { showToast("Use a local or hosted web server to launch capture windows."); return null; }
  const token = crypto.randomUUID();
  const launch = { token, window: null, ready: false, payload: null };
  captureLaunches.set(token, launch);
  const url = new URL(location.href);
  url.searchParams.set("captureLaunch", token);
  launch.window = window.open(url.href, "_blank", "popup,width=1440,height=960");
  if (!launch.window) {
    captureLaunches.delete(token);
    showToast("Capture window blocked. Allow pop-ups for AINetScope and try again.");
    return null;
  }
  return launch;
}

function deliverCaptureWindow(launch, payload) {
  if (!launch || launch.window.closed) return;
  launch.payload = payload;
  if (!launch.ready) return;
  launch.window.postMessage({ type: "datasnare:capture-file", token: launch.token, ...payload }, location.origin);
  captureLaunches.delete(launch.token);
}

function launchCaptureFile(file) {
  if (!file) return;
  const launch = capturePickerLaunch || reserveCaptureWindow();
  capturePickerLaunch = null;
  deliverCaptureWindow(launch, { file, name: file.name });
}

function chooseNewCapture() {
  $("#captureChooser").close();
  if (capturePickerLaunch) {
    capturePickerLaunch.window.close();
    captureLaunches.delete(capturePickerLaunch.token);
  }
  $("#captureInput").click();
  capturePickerLaunch = reserveCaptureWindow();
}

function openCaptureChooser() {
  const results = batchState.results.filter(result => result.status === "Analyzed");
  if (!results.length && !batchState.items.length) { chooseNewCapture(); return; }
  const items = results.length ? results.map(result => ({ name: result.path, result }))
    : batchState.items.map(item => ({ name: item.path || item.name, file: item.file }));
  $("#captureChooserList").innerHTML = items.map((item, index) => `<button class="capture-choice" type="button" data-capture-choice="${index}">${escapeHtml(item.name)}</button>`).join("");
  $("#captureChooserList").onclick = event => {
    const button = event.target.closest("[data-capture-choice]");
    if (!button) return;
    const item = items[Number(button.dataset.captureChoice)];
    $("#captureChooser").close();
    if (item.result) openSetCapture(item.result.index);
    else launchCaptureFile(item.file);
  };
  $("#captureChooser").showModal();
}

window.addEventListener("message", async event => {
  if (event.origin !== location.origin || !event.data || typeof event.data.token !== "string") return;
  if (event.data.type === "datasnare:capture-ready") {
    const launch = captureLaunches.get(event.data.token);
    if (!launch || event.source !== launch.window) return;
    launch.ready = true;
    if (launch.payload) deliverCaptureWindow(launch, launch.payload);
    return;
  }
  const token = new URLSearchParams(location.search).get("captureLaunch");
  if (!token || event.data.token !== token || event.data.type !== "datasnare:capture-file" || event.source !== window.opener) return;
  const url = new URL(location.href);
  url.searchParams.delete("captureLaunch");
  history.replaceState(null, "", url.href);
  window.opener = null;
  try {
    if (event.data.file instanceof File) await openFile(event.data.file);
    else if (Array.isArray(event.data.demoPackets)) {
      showCoreMode();
      loadPackets(event.data.demoPackets, event.data.name, `set-demo:${event.data.name}`);
    }
    document.title = `${event.data.name} | AINetScope`;
  } catch (error) { showToast(`Could not open capture: ${error.message}`); }
});

$("#openCaptureButton").addEventListener("click", openCaptureChooser);
$("#captureChooserNew").addEventListener("click", chooseNewCapture);
$("#captureChooserClose").addEventListener("click", () => $("#captureChooser").close());
$("#captureInput").addEventListener("cancel", () => {
  if (!capturePickerLaunch) return;
  capturePickerLaunch.window.close();
  captureLaunches.delete(capturePickerLaunch.token);
  capturePickerLaunch = null;
});
const captureLaunchToken = new URLSearchParams(location.search).get("captureLaunch");
if (captureLaunchToken && window.opener) {
  window.opener.postMessage({ type: "datasnare:capture-ready", token: captureLaunchToken }, location.origin);
}