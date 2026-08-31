try {
  const saved = globalThis.localStorage.getItem('openclasp.theme.v1');
  const theme =
    saved === 'dark' || saved === 'light'
      ? saved
      : globalThis.matchMedia('(prefers-color-scheme: light)').matches
        ? 'light'
        : 'dark';
  globalThis.document.documentElement.dataset.theme = theme;
  globalThis.document.documentElement.classList.toggle('dark', theme === 'dark');
  globalThis.document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', theme === 'light' ? '#f7f4f2' : '#0c0a0a');
} catch {
  // The default theme remains usable when browser storage is unavailable.
}
