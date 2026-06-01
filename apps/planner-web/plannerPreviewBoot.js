(() => {
  const pathname = window.location.pathname.replace(/\/$/, "") || "/";
  const plannerPreview =
    pathname === "/" || pathname === "/index.html" || pathname === "/v2.1"
      ? { script: "/plannerV21.js", stylesheet: "/plannerV21.css", version: "v2.1" }
      : pathname === "/v2"
        ? { script: "/plannerV2.js", stylesheet: "/plannerV2.css", version: "v2" }
        : null;
  if (!plannerPreview) return;
  document.documentElement.dataset.plannerVersion = plannerPreview.version;
  const stylesheet = Object.assign(document.createElement("link"), {
    rel: "stylesheet",
    href: plannerPreview.stylesheet
  });
  document.head.append(stylesheet);
  window.addEventListener(
    "DOMContentLoaded",
    () => {
      const script = document.createElement("script");
      script.src = plannerPreview.script;
      document.body.append(script);
    },
    { once: true }
  );
})();
