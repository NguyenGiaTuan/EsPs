let products = [];
let cart = [];
let cartStorageKey = null;
let currentUser = null;
const requestedFilter = new URLSearchParams(window.location.search).get("category");
let activeFilter = ["jerseys", "tops", "accessories"].includes(requestedFilter) ? requestedFilter : "all";
let productSearchQuery = "";
const clothingSizes = ["XS", "S", "M", "L", "XL", "XXL"];
const formatPrice = (amount) =>
  new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND", maximumFractionDigits: 0 }).format(amount);

const productGrid = document.querySelector("#product-grid");
const productCount = document.querySelector("#visible-count");
const bagCount = document.querySelector(".bag-count");
const bagItems = document.querySelector(".shop-bag-items");
const bagSummary = document.querySelector(".shop-bag-summary");
const emptyMessage = document.querySelector(".shop-bag-empty");
const checkoutMessage = document.querySelector(".shop-checkout-message");
const checkoutButton = document.querySelector(".checkout-button");
const toast = document.querySelector(".toast");

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => {
    const entities = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
    return entities[character];
  });
}

function imageUrl(photoId, width = 720) {
  return `https://images.unsplash.com/${encodeURIComponent(photoId)}?auto=format&fit=crop&w=${width}&q=80`;
}

function productSizes(product) {
  return product.category === "Accessories" ? ["One size"] : clothingSizes;
}

function renderOptionSelect(label, values, field, selected = "") {
  const options = values
    .map((value, index) => {
      const optionValue = field === "color" ? value : value;
      const optionLabel = field === "color" ? `Color ${index + 1} — ${value}` : value;
      return `<option value="${escapeHtml(optionValue)}" ${selected === optionValue ? "selected" : ""}>${escapeHtml(optionLabel)}</option>`;
    })
    .join("");
  return `<label class="product-option">${label}<select data-option="${field}" required><option value="">Choose ${label.toLowerCase()}</option>${options}</select></label>`;
}

function productOptionsMarkup(product) {
  return `<div class="product-buy-options">${renderOptionSelect("Size", productSizes(product), "size")}${renderOptionSelect("Color", product.colors, "color")}</div><div class="product-buy-row"><button class="product-add-button" type="button" data-add="${escapeHtml(product.id)}">Add to bag <span aria-hidden="true">+</span></button><span class="product-option-error" role="status"></span></div>`;
}

function cartSelectionText(item) {
  if (!item.size || !item.color) return "Choose size and color on the product, then remove and re-add this item.";
  return `Size: ${escapeHtml(item.size)} · Color: ${escapeHtml(item.color)}`;
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("is-visible");
  window.clearTimeout(showToast.timeout);
  showToast.timeout = window.setTimeout(() => toast.classList.remove("is-visible"), 2200);
}

function readStoredCart(storageKey) {
  try {
    const stored = JSON.parse(localStorage.getItem(storageKey) || "[]");
    if (!Array.isArray(stored)) return [];
    return stored.filter(
      (item) =>
        item &&
        typeof item.id === "string" &&
        Number.isInteger(item.quantity) &&
        item.quantity > 0,
    );
  } catch (error) {
    console.error("Could not read the saved shopping bag:", error);
    return [];
  }
}

function updateBagAccess() {
  const canShop = currentUser?.role === "user";
  document.querySelectorAll("[data-player-only]").forEach((element) => {
    element.hidden = !canShop;
  });
  document.querySelectorAll("[data-add]").forEach((button) => {
    button.hidden = !canShop;
  });

  if (!canShop) {
    cart = [];
    cartStorageKey = null;
    return;
  }

  const userCartKey = `gg-supply-cart:${currentUser.id}`;
  if (cartStorageKey !== userCartKey) {
    cartStorageKey = userCartKey;
    cart = readStoredCart(cartStorageKey);
  }
}

function saveCart() {
  if (!cartStorageKey) return;
  try {
    localStorage.setItem(cartStorageKey, JSON.stringify(cart));
  } catch (error) {
    console.error("Could not save the shopping bag:", error);
    checkoutMessage.textContent = "Could not save your bag in this browser.";
  }
}

function renderProducts() {
  const query = productSearchQuery.trim().toLocaleLowerCase();
  const filtered = products.filter((product) => {
    const matchesFilter = activeFilter === "all" || product.group === activeFilter;
    const searchableText = [
      product.name,
      product.category,
      product.group,
      product.tag,
      product.alt,
      formatPrice(product.price),
    ].join(" ").toLocaleLowerCase();
    return matchesFilter && (!query || searchableText.includes(query));
  });
  productCount.textContent = String(filtered.length).padStart(2, "0");
  document.querySelector(".catalog-search-message").textContent =
    query && filtered.length === 0 ? "No gear matches your search. Try another name or category." : "";
  productGrid.replaceChildren();

  filtered.forEach((product, index) => {
    const card = document.createElement("article");
    card.className = "product-card";
    card.dataset.scrollReveal = "";
    card.style.animationDelay = `${index * 45}ms`;
    const colors = product.colors
      .map((color) => `<span class="color-dot" style="background-color:${escapeHtml(color)}" aria-hidden="true"></span>`)
      .join("");
    card.innerHTML = `
      <div class="product-image-wrap">
        <img class="product-image" src="${imageUrl(product.image)}" alt="${escapeHtml(product.alt)}" loading="lazy">
        ${product.tag ? `<span class="product-tag">${escapeHtml(product.tag)}</span>` : ""}
        <button class="favorite-button" type="button" aria-label="Add ${escapeHtml(product.name)} to favorites" aria-pressed="false">♡</button>
      </div>
      <div class="product-info">
        <div><p class="product-category">${escapeHtml(product.category)}</p><h2 class="product-name">${escapeHtml(product.name)}</h2>
        <div class="product-colors" aria-label="${product.colors.length} colors available">${colors}</div></div>
        <p class="product-price">${formatPrice(product.price)}</p>
      </div>
      ${currentUser?.role === "user" ? productOptionsMarkup(product) : ""}`;
    productGrid.append(card);
  });

  document.querySelectorAll("[data-filter]").forEach((button) => {
    const selected = button.dataset.filter === activeFilter;
    button.classList.toggle("is-active", selected);
    button.setAttribute("aria-pressed", String(selected));
  });
}

function renderBag() {
  if (currentUser?.role !== "user") {
    bagCount.textContent = "0";
    bagItems.replaceChildren();
    return;
  }

  const quantity = cart.reduce((sum, item) => sum + item.quantity, 0);
  const subtotal = cart.reduce((sum, item) => {
    const product = products.find((entry) => entry.id === item.id);
    return sum + (product ? product.price * item.quantity : 0);
  }, 0);
  bagCount.textContent = quantity;
  bagItems.replaceChildren();
  bagSummary.hidden = cart.length === 0;
  emptyMessage.hidden = cart.length > 0;

  cart.forEach((item, index) => {
    const product = products.find((entry) => entry.id === item.id);
    if (!product) return;
    const row = document.createElement("article");
    row.className = "shop-bag-item";
    const image = document.createElement("img");
    image.src = imageUrl(product.image, 180);
    image.alt = "";
    const info = document.createElement("div");
    const name = document.createElement("h3");
    name.textContent = product.name;
    const price = document.createElement("p");
    price.textContent = formatPrice(product.price);
    const options = document.createElement("p");
    options.className = "shop-bag-variant";
    options.innerHTML = cartSelectionText(item);
    const controls = document.createElement("div");
    controls.className = "quantity-controls";
    controls.innerHTML = `<button type="button" data-quantity="${index}" data-change="-1" aria-label="Remove one ${escapeHtml(product.name)}">−</button><span>${item.quantity}</span><button type="button" data-quantity="${index}" data-change="1" aria-label="Add one ${escapeHtml(product.name)}">+</button>`;
    info.append(name, price, options, controls);
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "remove-item";
    remove.dataset.remove = String(index);
    remove.textContent = "Remove";
    row.append(image, info, remove);
    bagItems.append(row);
  });
  document.querySelector(".cart-subtotal strong").textContent = formatPrice(subtotal);
  saveCart();
}

async function loadProducts() {
  productGrid.innerHTML = "<p>Loading the drop…</p>";
  try {
    const response = await fetch("/api/products");
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Could not load products.");
    products = result;
    cart = cart.filter((item) => products.some((product) => product.id === item.id));
    renderProducts();
    renderBag();
  } catch (error) {
    console.error("Could not load shop products:", error);
    productGrid.innerHTML = '<p role="alert">Could not load the drop. Check your connection and try again.</p>';
  }
}

document.querySelector(".filter-list").addEventListener("click", (event) => {
  const button = event.target.closest("[data-filter]");
  if (!button) return;
  activeFilter = button.dataset.filter;
  const url = new URL(window.location.href);
  if (activeFilter === "all") url.searchParams.delete("category");
  else url.searchParams.set("category", activeFilter);
  window.history.replaceState({}, "", url);
  renderProducts();
});

document.querySelector("[data-product-search]").addEventListener("input", (event) => {
  productSearchQuery = event.currentTarget.value;
  renderProducts();
});

productGrid.addEventListener("click", (event) => {
  const addButton = event.target.closest("[data-add]");
  if (addButton && !addButton.hidden && currentUser?.role === "user") {
    const card = addButton.closest(".product-card");
    const size = card.querySelector('[data-option="size"]').value;
    const color = card.querySelector('[data-option="color"]').value;
    const error = card.querySelector(".product-option-error");
    if (!size || !color) {
      error.textContent = "Choose a size and color first.";
      return;
    }
    error.textContent = "";
    const existing = cart.find((item) => item.id === addButton.dataset.add && item.size === size && item.color === color);
    if (existing) existing.quantity += 1;
    else cart.push({ id: addButton.dataset.add, size, color, quantity: 1 });
    renderBag();
    showToast("Added to your bag.");
    return;
  }

  const favorite = event.target.closest(".favorite-button");
  if (favorite) {
    const isFavorite = favorite.getAttribute("aria-pressed") !== "true";
    favorite.setAttribute("aria-pressed", String(isFavorite));
    favorite.classList.toggle("is-favorite", isFavorite);
    favorite.textContent = isFavorite ? "♥" : "♡";
    showToast(isFavorite ? "Saved to your favorites." : "Removed from your favorites.");
  }
});

bagItems.addEventListener("click", (event) => {
  const remove = event.target.closest("[data-remove]");
  const change = event.target.closest("[data-quantity]");
  if (remove) cart.splice(Number(remove.dataset.remove), 1);
  else if (change) {
    const item = cart[Number(change.dataset.quantity)];
    item.quantity += Number(change.dataset.change);
    if (item.quantity <= 0) cart = cart.filter((entry) => entry !== item);
  } else return;
  renderBag();
});

checkoutButton.addEventListener("click", async () => {
  if (!currentUser) {
    try {
      const sessionResponse = await fetch("/api/auth/me");
      const session = await sessionResponse.json();
      currentUser = session.user;
    } catch (error) {
      console.error("Could not check the current account:", error);
    }
  }
  if (!currentUser) {
    window.location.assign("/account?next=/orders");
    return;
  }
  if (currentUser.role !== "user") {
    checkoutMessage.textContent = "Admin accounts do not have a shopping bag.";
    return;
  }
  if (!cart.length || cart.some((item) => !item.size || !item.color)) {
    checkoutMessage.textContent = "Every item needs a selected size and color. Remove unselected items and add them again.";
    return;
  }
  const total = cart.reduce((sum, item) => {
    const product = products.find((entry) => entry.id === item.id);
    return sum + product.price * item.quantity;
  }, 0);
  document.querySelector(".checkout-total strong").textContent = formatPrice(total);
  document.querySelector(".checkout-error").textContent = "";
  document.querySelector(".checkout-dialog").showModal();
});

document.querySelectorAll(".checkout-cancel").forEach((button) => button.addEventListener("click", () => {
  document.querySelector(".checkout-dialog").close();
}));

document.querySelector(".checkout-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  checkoutButton.disabled = true;
  const submitButton = document.querySelector(".checkout-submit");
  submitButton.disabled = true;
  document.querySelector(".checkout-error").textContent = "Placing your order…";
  try {
    const values = Object.fromEntries(new FormData(event.currentTarget).entries());
    const response = await fetch("/api/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        items: cart.map((item) => ({ productId: item.id, quantity: item.quantity, size: item.size, color: item.color })),
        paymentMethod: values.paymentMethod,
        address: {
          name: values.name,
          phone: values.phone,
          street: values.street,
          city: values.city,
          postalCode: values.postalCode,
          country: values.country,
        },
      }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Could not create your order.");
    cart = [];
    renderBag();
    document.querySelector(".checkout-dialog").close();
    window.location.assign("/orders?placed=1");
  } catch (error) {
    document.querySelector(".checkout-error").textContent = error.message;
  } finally {
    checkoutButton.disabled = false;
    submitButton.disabled = false;
  }
});

document.querySelector(".menu-toggle").addEventListener("click", (event) => {
  const button = event.currentTarget;
  const expanded = button.getAttribute("aria-expanded") === "true";
  button.setAttribute("aria-expanded", String(!expanded));
  document.querySelector(".main-nav").classList.toggle("is-open", !expanded);
});

document.querySelector(".current-year").textContent = new Date().getFullYear();
try {
  const storedCart = JSON.parse(localStorage.getItem("gg-supply-cart") || "[]");
  if (Array.isArray(storedCart)) {
    cart = storedCart.filter(
      (item) => item && typeof item.id === "string" && Number.isInteger(item.quantity) && item.quantity > 0,
    ).map((item) => ({ ...item, size: typeof item.size === "string" ? item.size : "", color: typeof item.color === "string" ? item.color : "" }));
  }
} catch (error) {
  console.error("Could not read the saved shopping bag:", error);
  try {
    localStorage.removeItem("gg-supply-cart");
  } catch (storageError) {
    console.error("Could not clear the saved shopping bag:", storageError);
  }
}

async function initializeShop() {
try {
  const response = await fetch("/api/auth/me");
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Could not check your account.");
  currentUser = result.user;
} catch (error) {
  console.error("Could not check the current account:", error);
}

updateBagAccess();
if (currentUser) {
  document.querySelector(".account-button-label").textContent = "Account";
  document.querySelector(".account-button").setAttribute("aria-label", `Account for ${currentUser.email}`);
}
await loadProducts();
renderBag();
}

initializeShop();
