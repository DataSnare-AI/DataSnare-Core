(() => {
  "use strict";

  const STORAGE_KEY = "datasnare:lastLaunchContext";
  const LAUNCH_SCHEMA = "datasnare-core/project-launch-v1";

  if (new URLSearchParams(window.location.search).get("returnTo") === "/aianalysis") {
    const returnLink = document.createElement("a");
    returnLink.className = "button quiet";
    returnLink.href = "/aianalysis";
    returnLink.textContent = "Back to AIAnalysis";
    document.querySelector(".top-actions")?.prepend(returnLink);
  }

  function readLaunchContext(expectedProjectId) {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const context = JSON.parse(raw);
      if (context?.schema !== LAUNCH_SCHEMA) return null;
      if (expectedProjectId && context.project?.id && context.project.id !== expectedProjectId) return null;
      return context;
    } catch (_) {
      return null;
    }
  }

  function exportMetadata(expectedProjectId) {
    const context = readLaunchContext(expectedProjectId);
    if (!context) return null;
    return {
      schema: context.schema,
      issuedAt: context.issuedAt,
      project: context.project,
      account: context.account
    };
  }

  window.DataSnareCoreContext = Object.freeze({
    storageKey: STORAGE_KEY,
    launchSchema: LAUNCH_SCHEMA,
    readLaunchContext,
    exportMetadata
  });
})();
