const identity = document.querySelector(".admin-identity");
const statusMessage = document.querySelector(".admin-status");
const orderBody = document.querySelector(".admin-orders-table tbody");
const refreshButton = document.querySelector(".admin-refresh");
const productForm = document.querySelector(".admin-product-form");
const productList = document.querySelector(".admin-product-list");
const productStatus = document.querySelector(".admin-product-status");
const productFormTitle = document.querySelector("[data-product-form-title]");
const saveProductButton = document.querySelector(".admin-save-product");
const productSearch = document.querySelector(".admin-product-search");
const orderSearch = document.querySelector(".admin-order-search");
const productSearchMessage = document.querySelector(".admin-product-search-message");
const orderSearchMessage = document.querySelector(".admin-order-search-message");
let editingProductId = null;
let productRecords = [];
let orderRecords = [];
const orderStatuses = ["pending", "paid", "processing", "shipped", "completed", "cancelled"];

function formatStatus(status) {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function formatDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString();
}

function formatPrice(amount, currency = "VND") {
  return new Intl.NumberFormat("vi-VN", {
    style: "currency",
    currency,
    maximumFractionDigits: currency === "VND" ? 0 : 2,
  }).format(amount);
}

function formatCurrencyTotals(orders) {
  const totals = new Map();
  orders.forEach((order) => {
    const currency = order.currency || "USD";
    totals.set(currency, (totals.get(currency) || 0) + Number(order.total || 0));
  });
  return [...totals].map(([currency, amount]) => formatPrice(amount, currency)).join(" · ") || formatPrice(0);
}

function paymentMethodName(method) {
  return ({
    stripe: "Stripe card",
    bank_transfer: "Bank transfer",
    zalopay: "ZaloPay",
    momo: "MoMo",
  })[method] || "Not specified";
}

function addCell(row, value) {
  const cell = document.createElement("td");
  cell.textContent = value;
  row.append(cell);
  return cell;
}

function renderOrders(orders) {
  orderRecords = orders;
  orderBody.replaceChildren();
  document.querySelector("[data-order-count]").textContent = orders.length;
  document.querySelector("[data-pending-count]").textContent = orders.filter(
    (order) => order.status === "pending",
  ).length;
  document.querySelector("[data-order-total]").textContent = formatCurrencyTotals(orders);

  if (!orders.length) {
    statusMessage.textContent = "There are no orders yet.";
    orderSearchMessage.textContent = "";
    return;
  }

  statusMessage.textContent = "";
  const query = orderSearch.value.trim().toLocaleLowerCase();
  const filteredOrders = orders.filter((order) => {
    const address = order.shippingAddress || {};
    const searchableText = [
      order.id,
      order.email,
      order.status,
      order.paymentMethod,
      paymentMethodName(order.paymentMethod),
      order.paymentStatus,
      order.items.map((item) => `${item.name} ${item.size || ""} ${item.color || ""}`).join(" "),
      address.name,
      address.phone,
      address.street,
      address.city,
      address.postalCode,
      address.country,
      formatPrice(Number(order.total), order.currency),
      formatDate(order.createdAt),
    ].join(" ").toLocaleLowerCase();
    return !query || searchableText.includes(query);
  });
  orderSearchMessage.textContent =
    query && filteredOrders.length === 0 ? "No orders match your search." : "";
  filteredOrders.forEach((order) => {
    const row = document.createElement("tr");
    addCell(row, `#${order.id.slice(-8)}`);
    addCell(row, order.email || "—");
    addCell(
      row,
      order.items.map((item) => `${item.name}${item.size ? ` · ${item.size}` : ""}${item.color ? ` · ${item.color}` : ""} × ${item.quantity}`).join(", "),
    );
    addCell(row, formatPrice(Number(order.total), order.currency));
    const payment = order.paymentMethod
      ? `${paymentMethodName(order.paymentMethod)}${order.paymentStatus === "not_configured" ? " — not connected" : order.paymentStatus === "confirmed_manually" ? " — manually confirmed" : ""}`
      : "—";
    addCell(row, payment);
    const address = order.shippingAddress;
    addCell(
      row,
      address
        ? `${address.name}, ${address.phone}, ${address.street}, ${address.city}, ${address.postalCode}, ${address.country}`
        : "—",
    );
    const statusCell = addCell(row, "");
    const statusControls = document.createElement("div");
    statusControls.className = "admin-order-controls";
    const statusSelect = document.createElement("select");
    statusSelect.className = "admin-order-select";
    statusSelect.setAttribute("aria-label", `Status for order ${order.id.slice(-8)}`);
    orderStatuses.forEach((value) => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = formatStatus(value);
      statusSelect.append(option);
    });
    statusSelect.value = orderStatuses.includes(order.status) ? order.status : "pending";
    const saveStatus = document.createElement("button");
    saveStatus.type = "button";
    saveStatus.className = "admin-order-save";
    saveStatus.dataset.orderStatusId = order.id;
    saveStatus.textContent = "Save";
    statusControls.append(statusSelect, saveStatus);
    statusCell.append(statusControls);
    addCell(row, formatDate(order.createdAt));
    orderBody.append(row);
  });
}

async function loadOrders() {
  refreshButton.disabled = true;
  statusMessage.classList.remove("is-error");
  statusMessage.textContent = "Loading orders…";
  try {
    const response = await fetch("/api/admin/orders");
    const result = await response.json();
    if (response.status === 401 || response.status === 403) {
      window.location.replace("/#account");
      return;
    }
    if (!response.ok) throw new Error(result.error || "Could not load orders.");
    renderOrders(result);
  } catch (error) {
    console.error("Could not load admin orders:", error);
    statusMessage.classList.add("is-error");
    statusMessage.textContent = error.message;
  } finally {
    refreshButton.disabled = false;
  }
}

async function updateOrderStatus(orderId, button) {
  const row = button.closest("tr");
  const select = row.querySelector(".admin-order-select");
  button.disabled = true;
  statusMessage.classList.remove("is-error");
  statusMessage.textContent = `Updating order #${orderId.slice(-8)}…`;
  try {
    const response = await fetch(`/api/admin/orders/${encodeURIComponent(orderId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: select.value }),
    });
    const result = await response.json();
    if (response.status === 401 || response.status === 403) {
      window.location.replace("/#account");
      return;
    }
    if (!response.ok) throw new Error(result.error || "Could not update order status.");
    const order = orderRecords.find((entry) => entry.id === orderId);
    if (order) {
      order.status = result.status;
      if (result.paymentStatus) order.paymentStatus = result.paymentStatus;
    }
    renderOrders(orderRecords);
    statusMessage.textContent = `Order #${orderId.slice(-8)} is now ${formatStatus(result.status)}.`;
  } catch (error) {
    console.error("Could not update order status:", error);
    statusMessage.classList.add("is-error");
    statusMessage.textContent = error.message;
    button.disabled = false;
  }
}

function showProductMessage(message, isError = false) {
  productStatus.textContent = message;
  productStatus.classList.toggle("is-error", isError);
}

function renderProducts(products) {
  productRecords = products;
  productList.replaceChildren();
  if (!products.length) {
    const empty = document.createElement("p");
    empty.className = "admin-product-empty";
    empty.textContent = "No products yet. Add your first product above.";
    productList.append(empty);
    productSearchMessage.textContent = "";
    return;
  }

  const query = productSearch.value.trim().toLocaleLowerCase();
  const filteredProducts = products.filter((product) =>
    [
      product.name,
      product.category,
      product.group,
      product.tag,
      product.alt,
      product.colors.join(" "),
      formatPrice(Number(product.price), product.currency || "VND"),
    ].join(" ").toLocaleLowerCase().includes(query),
  );
  productSearchMessage.textContent =
    query && filteredProducts.length === 0 ? "No products match your search." : "";
  filteredProducts.forEach((product) => {
    const row = document.createElement("article");
    row.className = "admin-product-row";
    const details = document.createElement("div");
    details.className = "admin-product-details";
    const name = document.createElement("strong");
    name.textContent = product.name;
    const meta = document.createElement("span");
    meta.textContent = `${product.category} · ${formatPrice(Number(product.price), product.currency || "VND")}`;
    details.append(name, meta);

    const actions = document.createElement("div");
    actions.className = "admin-product-actions";
    const edit = document.createElement("button");
    edit.type = "button";
    edit.dataset.editProduct = product.id;
    edit.textContent = "Edit";
    const remove = document.createElement("button");
    remove.type = "button";
    remove.dataset.deleteProduct = product.id;
    remove.textContent = "Delete";
    actions.append(edit, remove);
    row.append(details, actions);
    productList.append(row);
  });
}

async function loadProducts() {
  productStatus.classList.remove("is-error");
  productStatus.textContent = "Loading products…";
  try {
    const response = await fetch("/api/admin/products");
    const result = await response.json();
    if (response.status === 401 || response.status === 403) {
      window.location.replace("/#account");
      return;
    }
    if (!response.ok) throw new Error(result.error || "Could not load products.");
    renderProducts(result);
    productStatus.textContent = "";
  } catch (error) {
    console.error("Could not load admin products:", error);
    showProductMessage(error.message, true);
  }
}

function resetProductForm() {
  productForm.reset();
  editingProductId = null;
  productForm.hidden = true;
  productFormTitle.textContent = "Add a product";
  saveProductButton.textContent = "Save product";
  saveProductButton.disabled = false;
}

function editProduct(product) {
  editingProductId = product.id;
  productForm.elements.namedItem("name").value = product.name;
  productForm.elements.namedItem("category").value = product.category;
  productForm.elements.namedItem("group").value = product.group;
  productForm.elements.namedItem("price").value = product.price;
  productForm.elements.namedItem("tag").value = product.tag || "";
  productForm.elements.namedItem("image").value = product.image;
  productForm.elements.namedItem("alt").value = product.alt;
  productForm.elements.namedItem("colors").value = product.colors.join(", ");
  productFormTitle.textContent = "Edit product";
  saveProductButton.textContent = "Save changes";
  productForm.hidden = false;
  productForm.scrollIntoView({ behavior: "smooth", block: "start" });
}

async function saveProduct(event) {
  event.preventDefault();
  const formData = new FormData(productForm);
  const body = Object.fromEntries(formData.entries());
  body.colors = body.colors.split(",").map((color) => color.trim()).filter(Boolean);
  const isEditing = Boolean(editingProductId);
  const url = isEditing
    ? `/api/admin/products/${encodeURIComponent(editingProductId)}`
    : "/api/admin/products";
  saveProductButton.disabled = true;
  showProductMessage(isEditing ? "Saving product changes…" : "Adding product…");

  try {
    const response = await fetch(url, {
      method: isEditing ? "PUT" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Could not save product.");
    resetProductForm();
    await loadProducts();
    showProductMessage(isEditing ? "Product updated." : "Product added.");
  } catch (error) {
    console.error("Could not save product:", error);
    showProductMessage(error.message, true);
    saveProductButton.disabled = false;
  }
}

async function deleteProduct(id) {
  if (!window.confirm("Delete this product from the shop? Existing orders will not be changed.")) return;
  showProductMessage("Deleting product…");
  try {
    const response = await fetch(`/api/admin/products/${encodeURIComponent(id)}`, { method: "DELETE" });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Could not delete product.");
    if (editingProductId === id) resetProductForm();
    await loadProducts();
    showProductMessage("Product deleted.");
  } catch (error) {
    console.error("Could not delete product:", error);
    showProductMessage(error.message, true);
  }
}

async function signOut() {
  try {
    const response = await fetch("/api/auth/logout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    if (!response.ok) throw new Error("Could not sign out. Please try again.");
    window.location.assign("/");
  } catch (error) {
    statusMessage.classList.add("is-error");
    statusMessage.textContent = error.message;
  }
}

async function startDashboard() {
  try {
    const response = await fetch("/api/auth/me");
    const result = await response.json();
    if (!result.user || result.user.role !== "admin") {
      window.location.replace("/#account");
      return;
    }
    identity.textContent = result.user.email;
    await Promise.all([loadOrders(), loadProducts()]);
  } catch (error) {
    console.error("Could not check administrator account:", error);
    statusMessage.classList.add("is-error");
    statusMessage.textContent = "Could not verify your account. Refresh the page to try again.";
  }
}

document.querySelector(".admin-signout").addEventListener("click", signOut);
document.querySelector(".admin-add-product").addEventListener("click", () => {
  resetProductForm();
  productForm.hidden = false;
  productForm.scrollIntoView({ behavior: "smooth", block: "start" });
});
document.querySelector(".admin-cancel-edit").addEventListener("click", resetProductForm);
productForm.addEventListener("submit", saveProduct);
refreshButton.addEventListener("click", () => Promise.all([loadOrders(), loadProducts()]));
productSearch.addEventListener("input", () => renderProducts(productRecords));
orderSearch.addEventListener("input", () => renderOrders(orderRecords));
productList.addEventListener("click", (event) => {
  const editButton = event.target.closest("[data-edit-product]");
  if (editButton) {
    const product = productRecords.find((entry) => entry.id === editButton.dataset.editProduct);
    if (product) editProduct(product);
    return;
  }
  const deleteButton = event.target.closest("[data-delete-product]");
  if (deleteButton) deleteProduct(deleteButton.dataset.deleteProduct);
});
orderBody.addEventListener("click", (event) => {
  const button = event.target.closest("[data-order-status-id]");
  if (button) updateOrderStatus(button.dataset.orderStatusId, button);
});
startDashboard();
