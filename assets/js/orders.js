const orderList = document.querySelector(".orders-list");
const ordersMessage = document.querySelector(".orders-message");
const updateMessage = document.querySelector(".orders-update-message");
const refreshButton = document.querySelector(".orders-refresh");
const ordersSearch = document.querySelector(".orders-search-input");
let orderRecords = [];
let orderStatusSnapshot = null;
let refreshInProgress = false;

function formatStatus(status) {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function formatPrice(amount, currency = "VND") {
  return new Intl.NumberFormat("vi-VN", {
    style: "currency",
    currency,
    maximumFractionDigits: currency === "VND" ? 0 : 2,
  }).format(amount);
}

function paymentMethodName(method) {
  return ({
    stripe: "Credit/debit card (Stripe)",
    bank_transfer: "Bank transfer",
    zalopay: "ZaloPay",
    momo: "MoMo",
  })[method] || "Not specified";
}

function addDetail(parent, label, value) {
  const detail = document.createElement("div");
  detail.className = "order-detail";
  const name = document.createElement("span");
  name.textContent = label;
  const content = document.createElement("strong");
  content.textContent = value;
  detail.append(name, content);
  parent.append(detail);
}

function renderOrders(orders = orderRecords) {
  orderRecords = orders;
  orderList.replaceChildren();
  if (orders.length === 0) {
    ordersMessage.textContent = "No orders yet. Your next favorite fit is waiting.";
    return;
  }

  const query = ordersSearch.value.trim().toLocaleLowerCase();
  const filteredOrders = orders.filter((order) => {
    const address = order.shippingAddress || {};
    const searchableText = [
      order.id,
      order.status,
      order.paymentMethod,
      order.items.map((item) => `${item.name} ${item.size || ""} ${item.color || ""}`).join(" "),
      address.name,
      address.street,
      address.city,
      address.postalCode,
      address.country,
      new Date(order.createdAt).toLocaleString(),
    ].join(" ").toLocaleLowerCase();
    return !query || searchableText.includes(query);
  });

  ordersMessage.textContent = filteredOrders.length
    ? ""
    : "No orders match your search. Try an order number, item, or status.";
  filteredOrders.forEach((order) => {
    const card = document.createElement("article");
    card.className = "order-card";
    card.dataset.scrollReveal = "";
    const header = document.createElement("div");
    header.className = "order-card-header";
    const heading = document.createElement("h2");
    heading.textContent = `Order #${order.id.slice(-8)}`;
    const status = document.createElement("span");
    status.className = "order-status";
    status.textContent = formatStatus(order.status);
    header.append(heading, status);
    card.append(header);

    const rows = document.createElement("div");
    rows.className = "order-card-items";
    order.items.forEach((item) => {
      const line = document.createElement("div");
      line.className = "order-item-line";
      const name = document.createElement("span");
      const options = [item.size, item.color].filter(Boolean).join(" · ");
      name.textContent = `${item.name}${options ? ` — ${options}` : ""} × ${item.quantity}`;
      const price = document.createElement("strong");
      price.textContent = formatPrice(item.unitPrice * item.quantity, item.currency || order.currency);
      line.append(name, price);
      rows.append(line);
    });
    card.append(rows);

    const footer = document.createElement("div");
    footer.className = "order-card-footer";
    addDetail(footer, "Placed", new Date(order.createdAt).toLocaleString());
    addDetail(footer, "Total", formatPrice(Number(order.total), order.currency));
    if (order.paymentMethod) {
      const paymentName = `${paymentMethodName(order.paymentMethod)}${order.paymentStatus === "not_configured" ? " (not connected)" : order.paymentStatus === "confirmed_manually" ? " (confirmed manually)" : ""}`;
      addDetail(footer, "Payment", paymentName);
    }
    if (order.shippingAddress) {
      const address = order.shippingAddress;
      addDetail(
        footer,
        "Deliver to",
        `${address.name}, ${address.phone}, ${address.street}, ${address.city}, ${address.postalCode}, ${address.country}`,
      );
    }
    card.append(footer);
    orderList.append(card);
  });
}

async function refreshOrders(manual = false) {
  if (refreshInProgress) return;
  refreshInProgress = true;
  refreshButton.disabled = true;
  updateMessage.classList.remove("is-error");
  try {
    const response = await fetch("/api/account/orders");
    const result = await response.json();
    if (response.status === 401) {
      window.location.replace("/account?next=/orders");
      return;
    }
    if (!response.ok) throw new Error(result.error || "Could not refresh your orders.");

    const nextSnapshot = JSON.stringify(result.map((order) => [order.id, order.status]));
    const hasChanged = orderStatusSnapshot !== null && nextSnapshot !== orderStatusSnapshot;
    if (orderStatusSnapshot === null || hasChanged) renderOrders(result);
    orderStatusSnapshot = nextSnapshot;
    updateMessage.textContent = manual
      ? "Your order statuses are up to date."
      : hasChanged
        ? "Your order status has been updated."
        : "";
  } catch (error) {
    console.error("Could not refresh order statuses:", error);
    updateMessage.classList.add("is-error");
    updateMessage.textContent = "Could not refresh your order statuses. Please try again.";
  } finally {
    refreshInProgress = false;
    refreshButton.disabled = false;
  }
}

async function initializeOrders() {
  document.querySelectorAll(".current-year").forEach((element) => {
    element.textContent = new Date().getFullYear();
  });

  const userResponse = await fetch("/api/auth/me");
  const userResult = await userResponse.json();

  if (!userResponse.ok) throw new Error(userResult.error || "Could not check your account.");
  if (!userResult.user) {
    window.location.replace("/account?next=/orders");
    return;
  }

  document.querySelector(".orders-account-email").textContent = userResult.user.email;
  document.querySelector(".account-button-label").textContent = "Account";
  document.querySelector(".account-button").setAttribute("aria-label", `Account for ${userResult.user.email}`);
  const bagButton = document.querySelector(".bag-button");
  const canShop = userResult.user.role === "user";
  bagButton.hidden = !canShop;
  if (canShop) {
    try {
      const cart = JSON.parse(localStorage.getItem(`gg-supply-cart:${userResult.user.id}`) || "[]");
      if (Array.isArray(cart)) {
        bagButton.querySelector(".bag-count").textContent = cart.reduce(
          (sum, item) => sum + (Number.isInteger(item?.quantity) && item.quantity > 0 ? item.quantity : 0),
          0,
        );
      }
    } catch (error) {
      console.error("Could not read the shopping bag:", error);
    }
  }
  await refreshOrders();
}

document.querySelector(".menu-toggle").addEventListener("click", (event) => {
  const button = event.currentTarget;
  const expanded = button.getAttribute("aria-expanded") === "true";
  button.setAttribute("aria-expanded", String(!expanded));
  document.querySelector(".main-nav").classList.toggle("is-open", !expanded);
});

refreshButton.addEventListener("click", () => refreshOrders(true));
ordersSearch.addEventListener("input", () => renderOrders());
window.setInterval(() => {
  if (!document.hidden) refreshOrders();
}, 10000);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) refreshOrders();
});

initializeOrders().catch((error) => {
  console.error("Could not load order history:", error);
  ordersMessage.classList.add("is-error");
  ordersMessage.textContent = error.message;
});
