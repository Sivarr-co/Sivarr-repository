// Apply saved theme before first paint (prevents a white flash on the loader).
// Must stay a synchronous, non-deferred script in <head>.
(function () {
  try {
    var m =
      localStorage.getItem("sivarr_theme_mode") ||
      (localStorage.getItem("sivarr_theme") === "dark"
        ? "dark"
        : "light");
    var dark =
      m === "dark" ||
      (m === "system" &&
        window.matchMedia &&
        window.matchMedia("(prefers-color-scheme: dark)").matches);
    if (dark) document.documentElement.setAttribute("data-theme", "dark");
  } catch (e) {}
})();
