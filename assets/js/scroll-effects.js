(() => {
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduceMotion || !("IntersectionObserver" in window)) return;

  document.documentElement.classList.add("scroll-effects-ready");

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("is-visible");
        observer.unobserve(entry.target);
      });
    },
    { threshold: 0.12, rootMargin: "0px 0px -8% 0px" },
  );

  function observeElements(root) {
    if (root instanceof Element && root.matches("[data-scroll-reveal], [data-scroll-split]")) {
      observer.observe(root);
    }

    root.querySelectorAll?.("[data-scroll-reveal], [data-scroll-split]").forEach((element) => {
      observer.observe(element);
    });

    root.querySelectorAll?.("[data-scroll-reveal]").forEach((element) => {
      if (!element.matches(".product-card, .order-card")) return;
      const siblings = Array.from(element.parentElement.children).filter((child) =>
        child.matches(".product-card, .order-card"),
      );
      element.style.setProperty("--scroll-index", String(siblings.indexOf(element) % 6));
    });
  }

  observeElements(document);
  new MutationObserver((records) => {
    records.forEach((record) => {
      record.addedNodes.forEach((node) => {
        if (node instanceof Element) observeElements(node);
      });
      record.removedNodes.forEach((node) => {
        if (!(node instanceof Element)) return;
        if (node.matches("[data-scroll-reveal], [data-scroll-split]")) observer.unobserve(node);
        node.querySelectorAll("[data-scroll-reveal], [data-scroll-split]").forEach((element) => {
          observer.unobserve(element);
        });
      });
    });
  }).observe(document.body, { childList: true, subtree: true });
})();
