const panels = document.querySelectorAll("[data-auth-panel]");
const query = new URLSearchParams(window.location.search);
const requestedNext = query.get("next");
const nextRoutes = ["/orders", "/admin"];
const nextRoute = nextRoutes.includes(requestedNext) ? requestedNext : "/account";
const loginForm = document.querySelector("#login-form");
const registerForm = document.querySelector("#register-form");

function updateBagAccess(user) {
  const canShop = user?.role === "user";
  const bagButton = document.querySelector(".bag-button");
  bagButton.hidden = !canShop;
  if (!canShop) return;

  try {
    const cart = JSON.parse(localStorage.getItem(`gg-supply-cart:${user.id}`) || "[]");
    bagButton.querySelector(".bag-count").textContent = Array.isArray(cart)
      ? cart.reduce(
          (sum, item) => sum + (Number.isInteger(item?.quantity) && item.quantity > 0 ? item.quantity : 0),
          0,
        )
      : "0";
  } catch (error) {
    console.error("Could not read the account shopping bag:", error);
    bagButton.querySelector(".bag-count").textContent = "0";
  }
}

function showPanel(name) {
  panels.forEach((panel) => {
    panel.hidden = panel.dataset.authPanel !== name;
  });
  if (name !== "account") document.querySelector(`[data-auth-panel="${name}"] input`)?.focus();
}

function redirectAfterSignIn(user) {
  window.location.assign(nextRoute === "/admin" && user.role !== "admin" ? "/orders" : nextRoute);
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

function attachAuthForm(form, endpoint) {
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const message = form.querySelector(".auth-message");
    const submitButton = form.querySelector('button[type="submit"]');
    const values = new FormData(form);
    submitButton.disabled = true;
    message.textContent = endpoint.endsWith("/login") ? "Signing you in…" : "Creating your account…";

    try {
      const { user } = await postJson(endpoint, {
        email: values.get("email"),
        password: values.get("password"),
        adminSetupKey: values.get("adminSetupKey"),
      });
      redirectAfterSignIn(user);
    } catch (error) {
      message.textContent = error.message;
      submitButton.disabled = false;
    }
  });
}

async function signOut() {
  const button = document.querySelector(".account-logout");
  button.disabled = true;
  try {
    await postJson("/api/auth/logout", {});
    window.location.assign("/");
  } catch (error) {
    const message = document.querySelector(".account-panel-message");
    message.textContent = error.message;
    button.disabled = false;
  }
}

function redirectToAccount(user) {
  updateBagAccess(user);
  document.querySelector(".account-button-label").textContent = "Account";
  document.querySelector(".account-button").setAttribute("aria-label", `Account for ${user.email}`);
  const email = document.querySelector(".route-account-email");
  email.textContent = user.email;
  document.querySelector(".account-role").textContent =
    user.role === "admin" ? "Administrator" : "Player account";
  document.querySelector(".route-admin-link").hidden = user.role !== "admin";
  showPanel("account");
}

async function initializeAccount() {
  document.querySelectorAll(".current-year").forEach((element) => {
    element.textContent = new Date().getFullYear();
  });

  const response = await fetch("/api/auth/me");
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Could not check your account.");
  if (result.user) {
    redirectToAccount(result.user);
    return;
  }

  updateBagAccess(null);
  const panelName = query.get("view") === "register" ? "register" : "login";
  if (nextRoute === "/orders") {
    document.querySelector('[data-auth-panel="login"] .account-intro').textContent =
      "Sign in to view your order history. You'll return to your orders after signing in.";
  } else if (nextRoute === "/admin") {
    document.querySelector('[data-auth-panel="login"] .account-intro').textContent =
      "Sign in with your admin account to open the store dashboard.";
  }
  showPanel(panelName);
}

attachAuthForm(loginForm, "/api/auth/login");
attachAuthForm(registerForm, "/api/auth/register");
document.querySelector(".account-logout").addEventListener("click", signOut);
document.querySelector(".menu-toggle").addEventListener("click", (event) => {
  const button = event.currentTarget;
  const expanded = button.getAttribute("aria-expanded") === "true";
  button.setAttribute("aria-expanded", String(!expanded));
  document.querySelector(".main-nav").classList.toggle("is-open", !expanded);
});

initializeAccount().catch((error) => {
  console.error("Could not load the account page:", error);
  const message = document.querySelector(".account-page-message");
  if (message) message.textContent = error.message;
});
