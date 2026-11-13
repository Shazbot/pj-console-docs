// Light/dark toggle shared by every page. No attribute = follow the system setting.
export function initTheme() {
  const root = document.documentElement;
  try {
    const saved = localStorage.getItem('pjc-theme');
    if (saved === 'light' || saved === 'dark') root.setAttribute('data-theme', saved);
  } catch { /* storage blocked */ }
  document.querySelectorAll('[data-theme-toggle]').forEach((b) => b.addEventListener('click', () => {
    const cur = root.getAttribute('data-theme') || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    const next = cur === 'dark' ? 'light' : 'dark';
    root.setAttribute('data-theme', next);
    try { localStorage.setItem('pjc-theme', next); } catch { /* storage blocked */ }
  }));
}
