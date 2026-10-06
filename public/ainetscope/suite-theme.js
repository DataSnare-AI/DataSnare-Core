"use strict";
const AINETSCOPE_THEME_KEY = 'datasnare:core-skin';
function applyAINetScopeTheme(value, persist = false) {
  const normalized = ({ ainetscope: 'modern', aiops: 'dark' })[value] || value;
  const theme = ['modern', 'dark', 'light'].includes(normalized) ? normalized : 'modern';
  document.documentElement.dataset.skin = theme;
  document.documentElement.style.colorScheme = theme === 'dark' ? 'dark' : 'light';
  document.querySelectorAll('[data-suite-theme]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.suiteTheme === theme)));
  if (persist) { try { localStorage.setItem(AINETSCOPE_THEME_KEY, theme); } catch (_) {} }
}
let initialAINetScopeTheme = 'modern';
try { initialAINetScopeTheme = localStorage.getItem(AINETSCOPE_THEME_KEY) || 'modern'; } catch (_) {}
applyAINetScopeTheme(initialAINetScopeTheme);
document.querySelectorAll('[data-suite-theme]').forEach(button => button.addEventListener('click', () => applyAINetScopeTheme(button.dataset.suiteTheme, true)));
window.addEventListener('storage', event => { if (event.key === AINETSCOPE_THEME_KEY) applyAINetScopeTheme(event.newValue); });