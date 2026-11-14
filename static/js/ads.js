// Fills the ad containers a page ships empty (data-ad="follow", "row", "side"
// and "text"). Nothing is random: the browser counts this visitor's page views
// and steps through the lists in public/js/ads-data.js (window.BEEHIVE_ADS),
// so a spot moves on to the next ad each page and the same one doesn't repeat
// in a spot. Sponsors never repeat on one page. Built from config/site.json,
// bookshop.json and awin.json by scripts/lib/affiliate.js.
(() => {
  const D = window.BEEHIVE_ADS;
  if (!D) return;
  const one = (s) => document.querySelector(s);
  const all = (s) => [...document.querySelectorAll(s)];
  // Anything past its "ends" date (YYYY-MM-DD in the config) is dropped here too,
  // so a promo stops on its date even if the site wasn't rebuilt
  const d0 = new Date();
  const iso = `${d0.getFullYear()}-${String(d0.getMonth() + 1).padStart(2, "0")}-${String(d0.getDate()).padStart(2, "0")}`;
  const notEnded = (list) => (list || []).filter((x) => !x.ends || x.ends >= iso);
  D.books = notEnded(D.books);
  D.images = notEnded(D.images);
  D.banners = notEnded(D.banners);
  D.tall = notEnded(D.tall);
  D.text = notEnded(D.text);
  // Default spots use Awin brands tagged "general" (broad interest); if none are tagged, all
  const general = (list) => {
    const g = (list || []).filter((x) => (x.topics || []).includes("general"));
    return g.length ? g : list || [];
  };
  D.images = general(D.images);
  D.banners = general(D.banners);
  D.tall = general(D.tall);
  D.text = general(D.text);
  const follows = all('[data-ad="follow"]');
  const row = one('[data-ad="row"]');
  const side = one('[data-ad="side"]');
  const text = one('[data-ad="text"]');
  if (!follows.length && !row && !side && !text) return;

  // This visitor's page view number. Without storage, it follows the clock.
  let c;
  try {
    c = (parseInt(localStorage.getItem("beehive-ads"), 10) || 0) + 1;
    localStorage.setItem("beehive-ads", String(c));
  } catch (e) {
    c = Math.floor(Date.now() / 6e4);
  }
  const esc = (s) =>
    String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/"/g, "&quot;")
      .replace(/</g, "&lt;");
  // Hide the ad around an element (a picture that won't load, a book that never drew)
  const hideAd = (el) => {
    const s = el.closest(".ad-slot");
    if (s) s.style.display = "none";
  };
  const at = (list, i) => list[((i % list.length) + list.length) % list.length];

  const placeholder = (name) =>
    `<aside class="ad-slot ad-setup mb-0" aria-label="Advertisement placeholder"><div class="ad-label font-sans">Advertisement</div><div class="ad-box ad-rect"><span>${esc(name)}</span><small>300 &times; 250, live on deploy</small></div></aside>`;
  const cell = (inner) =>
    `<aside class="ad-slot ad-on mb-0" aria-label="Advertisement"><div class="ad-label font-sans">Advertisement</div><div class="affiliate-box affiliate-card">${inner}</div></aside>`;
  // A card: picture, a rule, then title, a line of copy and a link, all one
  // link to the sponsor (copy comes from brandCopy in config/awin.json)
  const picture = (a, tall) =>
    `<a class="ad-card-link" rel="sponsored" href="${esc(a.href)}"><span class="ad-card-img${a.logo ? " ad-card-logo" : ""}${a.pad ? " ad-card-img-pad" : ""}${a.trim && !tall ? " ad-card-img-trim" : ""}${tall && !a.native ? " ad-card-img-tall" : ""}${a.native ? " ad-card-img-native" : ""}"><img src="${esc(a.src)}" width="${a.width}" height="${a.height}" alt="${esc(a.alt)}" loading="lazy"${a.logo && a.logoWidth ? ` style="width:${a.logoWidth}px;max-width:90%;height:auto"` : ""}></span>${a.title || a.blurb || a.cta ? `<span class="ad-card-text">${a.title ? `<strong class="font-zilla ad-card-title">${esc(a.title)}</strong>` : ""}${a.blurb ? `<span class="font-sans ad-card-body">${esc(a.blurb)}</span>` : ""}${a.cta ? `<span class="font-arial link-secondary ad-card-cta">${esc(a.cta)}</span>` : ""}</span>` : ""}</a>`;
  // Bookshop's widget writes itself into the page as it loads, which doesn't
  // work for a script added later. So each book goes in its own small frame
  // that loads the widget normally (a book is about 250 px tall, a featured
  // book about 530).
  const bookFrame = (b, type) => {
    const f = document.createElement("iframe");
    f.title = "Book from Bookshop.org";
    f.loading = "lazy";
    f.scrolling = "no";
    f.style.cssText = `display:block;margin:0 auto;width:${type === "featured" ? "340px" : "100%"};max-width:${type === "featured" ? "100%" : "340px"};border:0;height:${type === "featured" ? 540 : 260}px`;
    // Fit the frame to the widget once it has drawn
    let tries = 0;
    let drew = false;
    const fit = () => {
      try {
        const h = f.contentDocument.body.scrollHeight;
        if (h > 40) {
          f.style.height = h + "px";
          // Featured books: shrink the frame to the widget so a border can hug it
          if (type === "featured") f.style.width = Math.ceil(f.contentDocument.body.getBoundingClientRect().width) + "px";
          drew = true;
        }
      } catch (e) {
        drew = true; // can't look inside: leave it be
      }
      if (++tries < 20) setTimeout(fit, 400);
      else if (!drew) hideAd(f); // the widget never drew (book unavailable)
    };
    f.addEventListener("load", fit);
    f.srcdoc = `<!doctype html><base target="_blank"><body style="margin:0;font-family:sans-serif${type === "featured" ? ";display:inline-block" : ""}"><script src="https://bookshop.org/widgets.js" data-type="${type}"${type === "featured" ? ' data-full-info="true"' : ""} data-affiliate-id="${esc(D.affiliateId)}" data-sku="${esc(b.isbn)}"><\/script>`;
    return f;
  };

  // --- Bottom row: Awin cards (a different brand in each, moving on every
  // page view) or, every Nth page view, a row of three random books. Never mixed.
  const brands = [...new Set(D.images.map((i) => i.brand))];
  const byBrand = (b) => D.images.filter((i) => i.brand === b);
  // Books are picked at random from the whole list (it's grouped by subject,
  // so stepping through it in order would show similar books together)
  const shuffled = (list) => {
    const a = list.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };
  // Default spots use books tagged "general" (broad interest); if none are tagged yet, all books
  const generalBooks = D.books.some((b) => (b.topics || []).includes("general"))
    ? D.books.filter((b) => (b.topics || []).includes("general"))
    : D.books;
  const books = shuffled(generalBooks.filter((b) => !b.featuredOnly));
  const cells = row ? all('[data-ad-cell]') : [];
  const rowBrands = new Set();
  const rowBooks = [];
  if (cells.length) {
    if (books.length >= cells.length && c % D.bookshopEvery === 0) {
      cells.forEach((el, i) => {
        const b = books[i];
        rowBooks.push(b);
        if (D.live) {
          el.innerHTML = cell("");
          el.querySelector(".affiliate-box").appendChild(bookFrame(b, "book"));
        } else el.innerHTML = placeholder("Bookshop: book");
      });
    } else {
      cells.forEach((el, i) => {
        if (i >= brands.length) {
          el.hidden = true; // fewer brands than cells: leave it empty
          return;
        }
        const brand = at(brands, c + i);
        rowBrands.add(brand);
        const imgs = byBrand(brand);
        const img = at(imgs, Math.floor(c / brands.length));
        el.innerHTML = D.live ? cell(picture(img)) : placeholder(`Awin: ${brand}`);
      });
    }
  }

  // --- Town pages: on some page views the mid-page spot holds a row of three
  // books instead of a wide banner. Those views never put books at the bottom
  // too (the bottom row is Awin then), so books don't repeat on a page.
  const midSpot = follows.length > 1 ? follows[1] : null;
  if (midSpot && books.length >= 6 && c % D.bookshopEvery === (1 % D.bookshopEvery) && c % D.bookshopEvery !== 0) {
    const mid = books.slice(3, 6);
    rowBooks.push(...mid);
    midSpot.innerHTML = `<div class="row justify-content-center g-4">${mid.map((_, i) => `<div class="col-md-4${i ? " d-none d-md-block" : ""}" data-mid-cell></div>`).join("")}</div>`;
    midSpot.querySelectorAll("[data-mid-cell]").forEach((el, i) => {
      if (D.live) {
        el.innerHTML = cell("");
        el.querySelector(".affiliate-box").appendChild(bookFrame(mid[i], "book"));
      } else el.innerHTML = placeholder("Bookshop: book");
    });
    midSpot.classList.add("ad-books-mid");
    midSpot.setAttribute("aria-label", "Advertisement");
    midSpot.hidden = false;
    follows.splice(1, 1); // the follow/banner logic below skips this spot
  }

  // --- Follow banner: every Nth page view, one channel by weight, at the
  // top or (on town pages) mid-page in turn
  const showFollow = c % D.followEvery === 0 && D.social.length;
  if (follows.length && showFollow) {
    const n = Math.floor(c / D.followEvery);
    // Channels in turn by weight, like Instagram, YouTube, Instagram...
    const left = D.social.map((s) => D.followWeights[s.name] ?? 1);
    const seq = [];
    while (left.some((x) => x > 0))
      D.social.forEach((s, i) => {
        if (left[i] > 0) {
          seq.push(s);
          left[i]--;
        }
      });
    const ch = at(seq, n);
    // On phones the mid-page spot is only a wide Awin ad or a book, so Follow stays at the top
    const spot = window.matchMedia("(max-width: 767.98px)").matches ? follows[0] : at(follows, n);
    spot.innerHTML = `<div class="ad-label font-sans">Advertisement</div><a class="house-ad house-${esc(ch.name.toLowerCase())} ad-box ad-banner" href="${esc(ch.url)}" rel="${ch.shop ? "sponsored noopener" : "noopener"}"><span class="house-logo">${D.logo}</span><span class="house-text"><strong>${ch.shop ? "Beehive Guide Bookshop" : "Follow Beehive Guide"}</strong><span class="house-handle">${ch.shop ? "Books on gardening, cooking, Utah history and more" : `${esc(D.handle)} on ${esc(ch.name)}`}</span></span><span class="house-btn"><span class="house-icon">${ch.icon}</span>${ch.shop ? "Browse books" : "Follow"}</span></a>`;
    spot.hidden = false;
  }
  // Other page views: the top spot holds a wide Awin banner (a brand that
  // isn't already in the bottom row), so the top of the page always has an ad
  else if (follows.length && D.banners && D.banners.length) {
    // Every banner spot on the page gets one (top and mid-page on town pages),
    // each from a different brand
    const used = new Set(rowBrands);
    follows.forEach((spot, si) => {
    // Mid-page spots skip logo-only banners (the ones with copy beside a logo)
    const fit = D.banners.filter((b) => si === 0 || !b.text);
    const open = fit.filter((b) => !used.has(b.brand));
    const pool = open.length ? open : fit.length ? fit : D.banners;
    const bn = at(pool, c + si);
    used.add(bn.brand);
    spot.innerHTML = D.live
      ? bn.logoSrc
        ? `<div class="ad-label font-sans">Advertisement</div><a class="affiliate-banner-box affiliate-banner-pair" rel="sponsored" href="${esc(bn.href)}"><img class="affiliate-pair-logo" src="${esc(bn.logoSrc)}" width="${bn.logoWidth}" height="${bn.logoHeight}" alt="${esc(bn.alt)}" loading="lazy"><img class="affiliate-pair-pic" src="${esc(bn.src)}" width="${bn.width}" height="${bn.height}" alt="" loading="lazy"></a>`
        : `<div class="ad-label font-sans">Advertisement</div><a class="affiliate-banner-box${bn.flip ? " affiliate-banner-flip" : ""}" rel="sponsored" href="${esc(bn.href)}"><img class="affiliate-banner${bn.text ? " affiliate-banner-logo" : ""}" src="${esc(bn.src)}" width="${bn.width}" height="${bn.height}" alt="${esc(bn.alt)}" loading="lazy">${bn.text ? `<span class="affiliate-banner-copy">${bn.title ? `<strong class="font-zilla affiliate-banner-title">${esc(bn.title)}</strong>` : ""}<span class="font-arial affiliate-banner-text">${esc(bn.text)}</span></span>` : ""}</a>`
      : `<div class="ad-label font-sans">Advertisement</div><div class="ad-box ad-banner house-placeholder"><span>Awin banner: ${esc(bn.brand)}</span><small>wide, live on deploy</small></div>`;
    spot.setAttribute("aria-label", "Advertisement");
    spot.hidden = false;
    });
  }

  // --- Sidebar: on alternate page views a tall or text-heavy Awin card,
  // otherwise a featured Bookshop book (never one from the bottom row)
  if (side && (D.books.length || (D.tall && D.tall.length))) {
    const useTall = D.tall && D.tall.length && (c % 2 === 0 || !D.books.length);
    if (useTall) {
      const t = at(D.tall, Math.floor(c / 2));
      side.innerHTML = D.live ? cell(picture(t, true)) : placeholder(`Awin: ${t.brand}, sidebar`);
    } else {
      const pool = shuffled(generalBooks).filter((b) => !rowBooks.some((r) => r.isbn === b.isbn));
      const b = pool[0];
      if (D.live) {
        side.innerHTML = cell("");
        side.querySelector(".affiliate-box").appendChild(bookFrame(b, "featured"));
      } else side.innerHTML = placeholder("Bookshop: featured book");
    }
  }

  // --- Text link: every Nth page view; skips brands already on the page, and
  // brands with pictures come up only every fifth time
  if (text && D.text.length && D.textEvery > 0 && c % D.textEvery === 0) {
    const t = Math.floor(c / D.textEvery);
    const free = D.text.filter((x) => !rowBrands.has(x.brand));
    const plain = free.filter((x) => !D.picBrands.includes(x.brand));
    const pics = free.filter((x) => D.picBrands.includes(x.brand));
    const pool = t % 5 === 4 && pics.length ? pics : plain.length ? plain : free;
    if (pool.length) {
      const x = at(pool, t);
      text.innerHTML = D.live
        ? `Sponsored: <a rel="sponsored" href="${esc(x.href)}">${esc(x.label)}</a>`
        : `<span class="text-placeholder">Awin text link (live on deploy)</span>`;
      text.hidden = false;
    }
  }

  // A picture that fails to load (removed by the advertiser, blocked) hides its ad
  all(".ad-card-img img, .affiliate-banner, .affiliate-pair-logo, .affiliate-pair-pic").forEach((img) => {
    if (img.complete && img.naturalWidth === 0 && img.getAttribute("src")) hideAd(img);
    else img.addEventListener("error", () => hideAd(img));
  });
})();
