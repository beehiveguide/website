// School tables on town pages (more than 15 schools): a search box and menus
// for level and district or type. The menus fill from the table's rows.
// Matching rows move to the top of the table, in their first order, so the
// stripes stay even.
(() => {
  document.querySelectorAll(".schools-tools").forEach((tools) => {
    const table = document.getElementById(tools.dataset.table);
    if (!table) return;
    const body = table.tBodies[0];
    const rows = [...body.rows];
    const search = tools.querySelector('input[type="search"]');
    const menus = [...tools.querySelectorAll("select[data-filter]")];
    const count = tools.querySelector(".schools-count");
    const none = table.parentElement.querySelector(".schools-none");

    // Each menu lists its values in the order they first appear
    menus.forEach((menu) => {
      const key = menu.dataset.filter;
      [...new Set(rows.map((r) => r.dataset[key]).filter(Boolean))].forEach((value) => {
        const option = document.createElement("option");
        option.value = option.textContent = value;
        menu.append(option);
      });
      // A menu with only one choice isn't needed
      if (menu.options.length < 3) menu.parentElement.hidden = true;
    });

    const update = () => {
      const q = search.value.trim().toLowerCase();
      const shown = [];
      const hidden = [];
      rows.forEach((r) => {
        const match =
          (!q || r.cells[0].textContent.toLowerCase().includes(q)) &&
          menus.every((m) => !m.value || r.dataset[m.dataset.filter] === m.value);
        r.hidden = !match;
        (match ? shown : hidden).push(r);
      });
      body.append(...shown, ...hidden);
      table.hidden = !shown.length;
      none.hidden = shown.length > 0;
      count.textContent =
        shown.length === rows.length ? "" : `Showing ${shown.length} of ${rows.length} schools`;
    };

    search.addEventListener("input", update);
    menus.forEach((m) => m.addEventListener("change", update));
    tools.hidden = false; // without JavaScript, the full table shows
  });
})();
