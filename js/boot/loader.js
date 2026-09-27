// Artistic boot loader -- the Sivarr mark itself animates as the loader.
(function () {
  function hide() {
    var b = document.getElementById("siv-boot");
    if (!b || b.classList.contains("hide")) return;
    b.classList.add("hide");
    setTimeout(function () {
      if (b) b.style.display = "none";
    }, 520);
  }
  window.sivHideBoot = hide;
  // Reveal the app once it's ready, after a brief beat so the animation reads
  window.addEventListener("load", function () {
    setTimeout(hide, 450);
  });
  // Hard fallback in case 'load' never fires
  setTimeout(hide, 4500);
})();
