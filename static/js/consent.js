// Privacy choices. The Ads switch is there only when ads are set up.
// Saves the visitor's pick in this browser and passes it to
// Google tags (Consent Mode: Analytics, Ads, AdSense, Tag Manager) and
// Microsoft Clarity. Until someone picks, analytics and ad cookies stay off
// (set in the page head). Choices last a year, then the box asks again.
(() => {
  const KEY = "beehive-consent";
  const box = document.getElementById("consent");
  if (!box) return;
  const opts = document.getElementById("consent-options");
  const more = document.getElementById("consent-more");
  const analytics = document.getElementById("consent-analytics");
  const ads = document.getElementById("consent-ads");

  const read = () => {
    try {
      const c = JSON.parse(localStorage.getItem(KEY));
      if (c && Date.now() - c.time < 365 * 864e5) return c;
    } catch (e) {}
    return null;
  };
  const apply = (c) => {
    const yes = (v) => (v ? "granted" : "denied");
    window.gtag?.("consent", "update", {
      analytics_storage: yes(c.analytics),
      ad_storage: yes(c.ads),
      ad_user_data: yes(c.ads),
      ad_personalization: yes(c.ads),
    });
    window.clarity?.("consentv2", { analytics_Storage: yes(c.analytics), ad_Storage: yes(c.ads) });
  };
  const store = (c) => {
    c.time = Date.now();
    try { localStorage.setItem(KEY, JSON.stringify(c)); } catch (e) {}
    apply(c);
  };
  const choose = (c) => {
    store(c);
    box.hidden = true;
  };
  const open = (showOptions) => {
    const c = read() || { analytics: false, ads: false };
    analytics.checked = c.analytics;
    if (ads) ads.checked = c.ads;
    toggleOptions(showOptions);
    box.hidden = false;
  };
  const toggleOptions = (show) => {
    opts.hidden = !show;
    more.hidden = show;
    more.setAttribute("aria-expanded", String(show));
  };

  box.addEventListener("click", (e) => {
    const b = e.target.closest("[data-consent]");
    if (b) {
      const v = b.dataset.consent;
      if (v === "accept") choose({ analytics: true, ads: Boolean(ads) }); // ads only when asked
      if (v === "reject") choose({ analytics: false, ads: false });
      // Closing without picking: cookies stay off, and the box waits for the
      // next visit
      if (v === "close") {
        try { sessionStorage.setItem(KEY, "closed"); } catch (e) {}
        box.hidden = true;
      }
    }
  });
  more.addEventListener("click", () => toggleOptions(true));
  // Each switch takes effect (and is saved) as soon as it's flipped
  [analytics, ads].filter(Boolean).forEach((s) =>
    s.addEventListener("change", () => store({ analytics: analytics.checked, ads: Boolean(ads?.checked) })));
  document.querySelectorAll("[data-consent-open]").forEach((a) =>
    a.addEventListener("click", (e) => { e.preventDefault(); open(true); }));

  const saved = read();
  let closed = false;
  try { closed = sessionStorage.getItem(KEY) === "closed"; } catch (e) {}
  if (saved) apply(saved);
  else if (!closed) open(false);
})();
