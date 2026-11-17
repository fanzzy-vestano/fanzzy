// Only the live storefront sends traffic to the Fanzzy GA4 property.
(function () {
  if (window.location.hostname !== "fanzzy.in" && window.location.hostname !== "www.fanzzy.in") return;
  if (document.getElementById("fanzzy-google-tag")) return;

  window.dataLayer = window.dataLayer || [];
  window.gtag = window.gtag || function () { window.dataLayer.push(arguments); };
  window.gtag("js", new Date());
  window.gtag("config", "G-MS2TLN2C7B");

  var script = document.createElement("script");
  script.id = "fanzzy-google-tag";
  script.async = true;
  script.src = "https://www.googletagmanager.com/gtag/js?id=G-MS2TLN2C7B";
  document.head.appendChild(script);
})();
