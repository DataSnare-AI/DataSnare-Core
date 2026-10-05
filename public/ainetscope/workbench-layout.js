"use strict";

const workbenchLayout = { listHeight: null, detailRatio: 0.5 };
const workbenchLayoutGrid = document.querySelector("#workbenchGrid");

function updateWorkbenchDividers() {
  const grid = workbenchLayoutGrid;
  const horizontal = document.querySelector("#workbenchRowResizer");
  const vertical = document.querySelector("#workbenchColumnResizer");
  const desktop = matchMedia("(min-width: 901px)").matches;
  horizontal.hidden = vertical.hidden = !desktop;
  if (!desktop || !grid.clientWidth) return;
  const gridRect = grid.getBoundingClientRect();
  const list = document.querySelector("#workbenchListPane").getBoundingClientRect();
  const detail = document.querySelector(".workbench-detail-pane").getBoundingClientRect();
  horizontal.style.cssText = `left:0;top:${list.bottom - gridRect.top - 5}px;width:${list.width}px;height:10px`;
  vertical.style.cssText = `left:${detail.right - gridRect.left - 5}px;top:${detail.top - gridRect.top + 5}px;width:10px;height:${Math.max(0, detail.height - 5)}px`;
  horizontal.setAttribute("aria-valuenow", Math.round(list.height));
  vertical.setAttribute("aria-valuenow", Math.round(detail.width));
}

function resizeWorkbenchDivider(kind, delta) {
  const grid = workbenchLayoutGrid;
  if (!matchMedia("(min-width: 901px)").matches) return;
  if (kind === "row") {
    const current = document.querySelector("#workbenchListPane").getBoundingClientRect().height;
    workbenchLayout.listHeight = Math.max(140, Math.min(grid.clientHeight - 168, current + delta));
    grid.style.setProperty("--list-height", `${workbenchLayout.listHeight}px`);
  } else {
    const listWidth = document.querySelector("#workbenchListPane").getBoundingClientRect().width;
    const current = document.querySelector(".workbench-detail-pane").getBoundingClientRect().width;
    const width = Math.max(220, Math.min(listWidth - 240, current + delta));
    workbenchLayout.detailRatio = width / listWidth;
    grid.style.setProperty("--detail-ratio", workbenchLayout.detailRatio);
    grid.style.setProperty("--bytes-ratio", 1 - workbenchLayout.detailRatio);
  }
  updateWorkbenchDividers();
}

for (const [id, kind] of [["workbenchRowResizer", "row"], ["workbenchColumnResizer", "column"]]) {
  const handle = document.getElementById(id);
  handle.addEventListener("pointerdown", event => {
    if (event.button !== 0 || !event.isPrimary) return;
    event.preventDefault();
    handle.focus();
    handle.setPointerCapture(event.pointerId);
    let previous = kind === "row" ? event.clientY : event.clientX;
    const move = moveEvent => {
      if (moveEvent.pointerId !== event.pointerId) return;
      const current = kind === "row" ? moveEvent.clientY : moveEvent.clientX;
      resizeWorkbenchDivider(kind, current - previous);
      previous = current;
    };
    const stop = stopEvent => {
      if (stopEvent.pointerId !== event.pointerId) return;
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", stop);
      handle.removeEventListener("pointercancel", stop);
      handle.removeEventListener("lostpointercapture", stop);
      if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", stop);
    handle.addEventListener("pointercancel", stop);
    handle.addEventListener("lostpointercapture", stop);
  });
  handle.addEventListener("keydown", event => {
    const negative = kind === "row" ? "ArrowUp" : "ArrowLeft";
    const positive = kind === "row" ? "ArrowDown" : "ArrowRight";
    if (![negative, positive].includes(event.key)) return;
    event.preventDefault();
    resizeWorkbenchDivider(kind, (event.key === positive ? 1 : -1) * (event.shiftKey ? 50 : 10));
  });
}

new ResizeObserver(updateWorkbenchDividers).observe(workbenchLayoutGrid);
new ResizeObserver(updateWorkbenchDividers).observe(document.querySelector(".workbench-detail-pane"));