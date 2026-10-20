// Privacy choices. Switches (under "Choices") are there only when ads are
// set up; with analytics only, the box has just Accept and Reject.
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
    if (analytics) analytics.checked = c.analytics;
    if (ads) ads.checked = c.ads;
    toggleOptions(showOptions);
    box.hidden = false;
  };
  const toggleOptions = (show) => {
    if (!opts) return; // analytics only: no switches
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
      // Closing keeps the choice already saved (from earlier, or from the
      // switches); with nothing saved yet, it counts as no to everything.
      if (v === "close") choose(read() || { analytics: false, ads: false });
    }
  });
  more?.addEventListener("click", () => toggleOptions(true));
  // Each switch takes effect (and is saved) as soon as it's flipped
  [analytics, ads].filter(Boolean).forEach((s) =>
    s.addEventListener("change", () => store({ analytics: Boolean(analytics?.checked), ads: Boolean(ads?.checked) })));
  document.querySelectorAll("[data-consent-open]").forEach((a) =>
    a.addEventListener("click", (e) => { e.preventDefault(); open(true); }));

  const saved = read();
  if (saved) apply(saved);
  else open(false);
})();
