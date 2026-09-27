// Reads the JSON data block rendered by index.html (a non-executable
// <script type="application/json">, so CSP script-src does not apply to it) and
// exposes it as window.SIVARR_CONFIG for boot/plausible.js and app code.
(function () {
  var el = document.getElementById("sivarr-config");
  try {
    window.SIVARR_CONFIG = el ? JSON.parse(el.textContent) : {};
  } catch (e) {
    window.SIVARR_CONFIG = {};
  }
})();
