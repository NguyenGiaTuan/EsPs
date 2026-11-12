let products = [];

const imageUrl = (photoId, width = 720) =>
  `https://images.unsplash.com/${photoId}?auto=format&fit=crop&w=${width}&q=80`;
const clothingSizes = ["XS", "S", "M", "L", "XL", "XXL"];
const formatPrice = (amount) =>
  new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND", maximumFractionDigits: 0 }).format(amount);

const readStoredCart = (storageKey) => {
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
  } catch {
    return [];
  }
};

let cart = [];
let cartStorageKey = null;
let activeFilter = "all";
let productSearchQuery = "";
let toastTimeout;

const productGrid = document.querySelector("#product-grid");
const visibleCount = document.querySelector("#visible-count");
const bagCount = document.querySelector(".bag-count");
const cartDrawer = document.querySelector(".cart-drawer");
const backdrop = document.querySelector(".drawer-backdrop");
const cartItems = document.querySelector(".cart-items");
const toast = document.querySelector(".toast");
const menuToggle = document.querySelector(".menu-toggle");
const mainNav = document.querySelector(".main-nav");
const accountButton = document.querySelector(".account-button");
let currentUser = null;

function updateBagAccess() {
  const canShop = currentUser?.role === "user";
  document.querySelectorAll("[data-player-only]").forEach((element) => {
    element.hidden = !canShop;
  });
  document.querySelectorAll("[data-add]").forEach((button) => {
    button.hidden = !canShop;
  });
  cartDrawer.hidden = !canShop;

  if (!canShop) {
    if (cartDrawer.classList.contains("is-open")) {
      cartDrawer.classList.remove("is-open");
      backdrop.classList.remove("is-open");
      document.body.classList.remove("no-scroll");
      backdrop.hidden = true;
    }
    cartDrawer.setAttribute("aria-hidden", "true");
    cartDrawer.inert = true;
    cartStorageKey = null;
    cart = [];
    return;
  }

  const userCartKey = `gg-supply-cart:${currentUser.id}`;
  if (cartStorageKey !== userCartKey) {
    cartStorageKey = userCartKey;
    cart = readStoredCart(cartStorageKey);
  }
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => {
    const entities = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
    return entities[character];
  });
}

function productSizes(product) {
  return product.category === "Accessories" ? ["One size"] : clothingSizes;
}

function renderOptionSelect(label, values, field) {
  const options = values
    .map((value, index) => {
      const optionLabel = field === "color" ? `Color ${index + 1} — ${value}` : value;
      return `<option value="${escapeHtml(value)}">${escapeHtml(optionLabel)}</option>`;
    })
    .join("");
  return `<label class="product-option">${label}<select data-option="${field}" required><option value="">Choose ${label.toLowerCase()}</option>${options}</select></label>`;
}

function productOptionsMarkup(product) {
  return `<div class="product-buy-options">${renderOptionSelect("Size", productSizes(product), "size")}${renderOptionSelect("Color", product.colors, "color")}</div><div class="product-buy-row"><button class="product-add-button" type="button" data-add="${escapeHtml(product.id)}">Add to bag <span aria-hidden="true">+</span></button><span class="product-option-error" role="status"></span></div>`;
}

function renderProducts() {
  const query = productSearchQuery.trim().toLocaleLowerCase();
  const filteredProducts = products.filter((product) => {
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

  visibleCount.textContent = String(filteredProducts.length).padStart(2, "0");
  document.querySelector(".catalog-search-message").textContent =
    query && filteredProducts.length === 0 ? "No gear matches your search. Try another name or category." : "";
  productGrid.innerHTML = filteredProducts
    .map(
      (product, index) => `
        <article class="product-card" data-scroll-reveal style="animation-delay: ${index * 45}ms">
          <div class="product-image-wrap">
            <img class="product-image" src="${imageUrl(product.image)}" alt="${escapeHtml(product.alt)}" loading="lazy" />
            ${product.tag ? `<span class="product-tag">${escapeHtml(product.tag)}</span>` : ""}
            <button class="favorite-button" type="button" aria-label="Add ${escapeHtml(product.name)} to favorites" aria-pressed="false" data-favorite="${escapeHtml(product.id)}">♡</button>
          </div>
          <div class="product-info">
            <div>
              <p class="product-category">${escapeHtml(product.category)}</p>
              <h3 class="product-name">${escapeHtml(product.name)}</h3>
              <div class="product-colors" aria-label="${product.colors.length} colors available">
                ${product.colors.map((color) => `<span class="color-dot" style="background-color:${escapeHtml(color)}" aria-hidden="true"></span>`).join("")}
              </div>
            </div>
            <p class="product-price">${formatPrice(product.price)}</p>
          </div>
          ${currentUser?.role === "user" ? productOptionsMarkup(product) : ""}
        </article>`,
    )
    .join("");
}

async function loadProducts() {
  productGrid.innerHTML = "<p>Loading the drop…</p>";
  try {
    const response = await fetch("/api/products");
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Could not load products.");
    products = result;
    const storedCartLength = cart.length;
    cart = cart.filter((item) => products.some((product) => product.id === item.id));
    if (cart.length !== storedCartLength) saveCart();
    renderProducts();
    renderCart();
  } catch (error) {
    console.error("Could not load products:", error);
    visibleCount.textContent = "00";
    bagCount.textContent = cart.reduce((total, item) => total + item.quantity, 0);
    productGrid.innerHTML =
      '<p role="alert">Could not load products from the database. Check that MongoDB is running and refresh the page.</p>';
  }
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "The request could not be completed.");
  return result;
}

async function refreshCurrentUser() {
  try {
    const response = await fetch("/api/auth/me");
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Could not check your account.");
    currentUser = result.user;
    updateBagAccess();
    renderProducts();
    if (products.length > 0) renderCart();
    if (currentUser) {
      accountButton.querySelector(".account-button-label").textContent = "Account";
      accountButton.setAttribute("aria-label", `Account for ${currentUser.email}`);
    }
  } catch (error) {
    console.error("Could not check your account:", error);
  }
}

function saveCart() {
  if (!cartStorageKey) return;
  try {
    localStorage.setItem(cartStorageKey, JSON.stringify(cart));
  } catch {
    showToast("Your bag is available for this visit.");
  }
}

function renderCart() {
  const quantity = cart.reduce((total, item) => total + item.quantity, 0);
  const subtotal = cart.reduce((total, item) => {
    const product = products.find((entry) => entry.id === item.id);
    return total + product.price * item.quantity;
  }, 0);

  bagCount.textContent = quantity;
  cartDrawer.classList.toggle("is-empty", cart.length === 0);
  cartItems.innerHTML = cart
    .map((item, index) => {
      const product = products.find((entry) => entry.id === item.id);
      return `
        <article class="cart-item">
          <img src="${imageUrl(product.image, 180)}" alt="" />
          <div>
            <h3>${escapeHtml(product.name)}</h3>
            <p>${formatPrice(product.price)}</p>
            <p class="cart-item-variant">${item.size && item.color
              ? `Size: ${escapeHtml(item.size)} · Color: ${escapeHtml(item.color)}`
              : "Selection needed; remove and re-add with a size and color."}</p>
            <div class="quantity-controls" aria-label="Quantity for ${escapeHtml(product.name)}">
              <button type="button" data-quantity="${index}" data-change="-1" aria-label="Remove one ${escapeHtml(product.name)}">−</button>
              <span>${item.quantity}</span>
              <button type="button" data-quantity="${index}" data-change="1" aria-label="Add one ${escapeHtml(product.name)}">+</button>
            </div>
          </div>
          <button class="remove-item" type="button" data-remove="${index}" aria-label="Remove ${escapeHtml(product.name)}">Remove</button>
        </article>`;
    })
    .join("");
  cartDrawer.querySelector(".cart-subtotal strong").textContent = formatPrice(subtotal);
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("is-visible");
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => toast.classList.remove("is-visible"), 2200);
}

function addToCart(id) {
  if (currentUser?.role !== "user") return;
  const card = productGrid.querySelector(`[data-add="${CSS.escape(id)}"]`).closest(".product-card");
  const size = card.querySelector('[data-option="size"]').value;
  const color = card.querySelector('[data-option="color"]').value;
  const error = card.querySelector(".product-option-error");
  if (!size || !color) {
    error.textContent = "Choose a size and color first.";
    return;
  }
  error.textContent = "";
  const existingItem = cart.find((item) => item.id === id && item.size === size && item.color === color);
  if (existingItem) {
    existingItem.quantity += 1;
  } else {
    cart.push({ id, size, color, quantity: 1 });
  }
  saveCart();
  renderCart();
  showToast(`${products.find((product) => product.id === id).name} added to your bag.`);
}

function openCart() {
  if (currentUser?.role !== "user") return;
  cartDrawer.hidden = false;
  document.querySelector(".bag-button").hidden = false;
  backdrop.hidden = false;
  cartDrawer.inert = false;
  cartDrawer.setAttribute("aria-hidden", "false");
  requestAnimationFrame(() => {
    backdrop.classList.add("is-open");
    cartDrawer.classList.add("is-open");
  });
  document.body.classList.add("no-scroll");
  cartDrawer.querySelector(".cart-close").focus();
}

function closeCart() {
  backdrop.classList.remove("is-open");
  cartDrawer.classList.remove("is-open");
  cartDrawer.setAttribute("aria-hidden", "true");
  cartDrawer.inert = true;
  document.body.classList.remove("no-scroll");
  document.querySelector(".bag-button").focus();
  setTimeout(() => {
    if (!cartDrawer.classList.contains("is-open")) backdrop.hidden = true;
  }, 280);
}

function applyFilter(filter) {
  activeFilter = filter;
  document.querySelectorAll(".filter-button").forEach((button) => {
    const isActive = button.dataset.filter === filter;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-pressed", String(isActive));
  });
  renderProducts();
}

document.querySelector(".filter-list").addEventListener("click", (event) => {
  const button = event.target.closest("[data-filter]");
  if (button) applyFilter(button.dataset.filter);
});

document.querySelector("[data-product-search]").addEventListener("input", (event) => {
  productSearchQuery = event.currentTarget.value;
  renderProducts();
});

productGrid.addEventListener("click", (event) => {
  const addButton = event.target.closest("[data-add]");
  if (addButton && !addButton.hidden) addToCart(addButton.dataset.add);

  const favoriteButton = event.target.closest("[data-favorite]");
  if (favoriteButton) {
    const isFavorite = favoriteButton.getAttribute("aria-pressed") !== "true";
    favoriteButton.setAttribute("aria-pressed", String(isFavorite));
    favoriteButton.classList.toggle("is-favorite", isFavorite);
    favoriteButton.textContent = isFavorite ? "♥" : "♡";
    showToast(isFavorite ? "Saved to your favorites." : "Removed from your favorites.");
  }
});

cartItems.addEventListener("click", (event) => {
  const quantityButton = event.target.closest("[data-quantity]");
  const removeButton = event.target.closest("[data-remove]");

  if (removeButton) {
    cart.splice(Number(removeButton.dataset.remove), 1);
  } else if (quantityButton) {
    const item = cart[Number(quantityButton.dataset.quantity)];
    item.quantity += Number(quantityButton.dataset.change);
    if (item.quantity <= 0) cart = cart.filter((entry) => entry !== item);
  } else {
    return;
  }

  saveCart();
  renderCart();
});

document.querySelector(".bag-button").addEventListener("click", openCart);
document.querySelector(".cart-close").addEventListener("click", closeCart);
backdrop.addEventListener("click", closeCart);
document.querySelector(".continue-shopping").addEventListener("click", () => {
  closeCart();
  document.querySelector("#shop").scrollIntoView({ behavior: "smooth" });
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && cartDrawer.classList.contains("is-open")) closeCart();
});

menuToggle.addEventListener("click", () => {
  const isExpanded = menuToggle.getAttribute("aria-expanded") === "true";
  menuToggle.setAttribute("aria-expanded", String(!isExpanded));
  mainNav.classList.toggle("is-open", !isExpanded);
});

document.querySelector(".newsletter-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const message = form.querySelector(".form-message");
  const submitButton = form.querySelector('button[type="submit"]');
  submitButton.disabled = true;
  message.textContent = "Adding you to the list…";
  try {
    await postJson("/api/newsletter", { email: new FormData(form).get("email") });
    message.textContent = "You're on the list. See you at the next drop.";
    form.reset();
  } catch (error) {
    message.textContent = error.message;
  } finally {
    submitButton.disabled = false;
  }
});

document.querySelector(".checkout-button").addEventListener("click", async (event) => {
  if (!currentUser) await refreshCurrentUser();
  if (!currentUser) {
    window.location.assign("/account?next=/orders");
    return;
  }
  if (currentUser.role !== "user") {
    showToast("Admin accounts do not have a shopping bag.");
    return;
  }

  if (!cart.length || cart.some((item) => !item.size || !item.color)) {
    showToast("Every item needs a size and color. Remove unselected items and add them again.");
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
  const submitButton = document.querySelector(".checkout-submit");
  submitButton.disabled = true;
  document.querySelector(".checkout-error").textContent = "Placing your order…";
  try {
    const values = Object.fromEntries(new FormData(event.currentTarget).entries());
    await postJson("/api/orders", {
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
    });
    cart = [];
    saveCart();
    renderCart();
    document.querySelector(".checkout-dialog").close();
    window.location.assign("/orders?placed=1");
  } catch (error) {
    document.querySelector(".checkout-error").textContent = error.message;
  } finally {
    submitButton.disabled = false;
  }
});

document.querySelector("#current-year").textContent = new Date().getFullYear();

refreshCurrentUser();
loadProducts();
