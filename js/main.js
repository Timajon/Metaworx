(function () {
  const toggle = document.querySelector("[data-nav-toggle]");
  const nav = document.querySelector("[data-nav]");

  function closeNav() {
    if (!nav || !toggle) return;
    nav.classList.remove("is-open");
    toggle.setAttribute("aria-expanded", "false");
  }

  if (toggle && nav) {
    toggle.addEventListener("click", function () {
      const open = nav.classList.toggle("is-open");
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
    });

    nav.addEventListener("click", function (event) {
      if (event.target.closest("a")) closeNav();
    });

    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape") closeNav();
    });
  }

  const page = document.body.dataset.page;
  document.querySelectorAll("[data-nav] a").forEach(function (link) {
    const href = link.getAttribute("href") || "";
    if (href.indexOf("#") !== -1) return;
    const path = href.replace(".html", "");
    if (path === page || (page === "home" && path.indexOf("index") !== -1)) {
      link.setAttribute("aria-current", "page");
    }
  });

  const year = document.querySelector("[data-year]");
  if (year) year.textContent = String(new Date().getFullYear());

  const form = document.querySelector("[data-quote-form]");
  if (!form) return;

  const status = document.querySelector("[data-form-status]");
  const preview = document.querySelector("[data-enquiry-preview]");
  const copyBtn = document.querySelector("[data-copy-enquiry]");

  function fieldError(name, message) {
    const slot = form.querySelector('[data-error-for="' + name + '"]');
    if (slot) slot.textContent = message || "";
    const input = form.elements[name];
    if (input) input.setAttribute("aria-invalid", message ? "true" : "false");
  }

  form.addEventListener("submit", function (event) {
    event.preventDefault();
    const data = new FormData(form);
    const name = String(data.get("name") || "").trim();
    const phone = String(data.get("phone") || "").trim();
    const email = String(data.get("email") || "").trim();
    const vehicle = String(data.get("vehicle") || "").trim();
    const service = String(data.get("service") || "").trim();
    const insurer = String(data.get("insurer") || "").trim();
    const message = String(data.get("message") || "").trim();
    let valid = true;

    fieldError("name", "");
    fieldError("phone", "");
    fieldError("email", "");
    fieldError("message", "");

    if (name.length < 2) {
      fieldError("name", "Add the name we should ask for.");
      valid = false;
    }
    if (phone.replace(/\D/g, "").length < 9) {
      fieldError("phone", "Add a phone number we can reach.");
      valid = false;
    }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      fieldError("email", "That email does not look complete.");
      valid = false;
    }
    if (message.length < 8) {
      fieldError("message", "Tell us briefly what happened to the vehicle.");
      valid = false;
    }
    if (!valid) return;

    const lines = [
      "Assessment enquiry for Auto Magic Metaworx Autobody",
      "",
      "Name: " + name,
      "Phone: " + phone,
      "Email: " + (email || "Not given"),
      "Vehicle: " + (vehicle || "Not given"),
      "Service: " + (service || "Not given"),
      "Insurer / claim: " + (insurer || "Not given"),
      "",
      message
    ];
    const body = lines.join("\n");
    const subject = "Assessment enquiry" + (vehicle ? " — " + vehicle : "");

    if (preview) preview.value = body;
    if (status) status.hidden = false;

    const mailto =
      "mailto:tim@metaworx.co.za?subject=" +
      encodeURIComponent(subject) +
      "&body=" +
      encodeURIComponent(body);
    window.location.href = mailto;
    if (status) status.scrollIntoView({ behavior: "smooth", block: "nearest" });
  });

  if (copyBtn && preview) {
    copyBtn.addEventListener("click", function () {
      const text = preview.value;
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(function () {
          copyBtn.textContent = "Copied";
        });
        return;
      }
      preview.focus();
      preview.select();
    });
  }
})();
