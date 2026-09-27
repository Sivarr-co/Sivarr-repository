// Plausible analytics loader, gated on the server-provided plausible_domain.
(function () {
  var cfg = window.SIVARR_CONFIG || {};
  if (cfg.plausible_domain) {
    var s = document.createElement("script");
    s.defer = true;
    s.setAttribute("data-domain", cfg.plausible_domain);
    s.src = "https://plausible.io/js/script.js";
    document.head.appendChild(s);
  }
})();
