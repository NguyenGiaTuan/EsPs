const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { promisify } = require("node:util");
require("dotenv").config();
const { MongoClient, ObjectId } = require("mongodb");
const seedProducts = require("./data/products");

const scrypt = promisify(crypto.scrypt);
const root = __dirname;
const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || "127.0.0.1";
const mongoUri = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/EsPs";
const mongoClient = new MongoClient(mongoUri, { serverSelectionTimeoutMS: 5000 });
const sessionLifetimeMs = 7 * 24 * 60 * 60 * 1000;
const sessionCookie = "gg_session";
const dummySalt = "e94b4a1f3a5c7d9e1b2c4d6f8a0c2e4f";
const dummyHash = Buffer.alloc(64);
const loginAttempts = new Map();
const orderStatuses = new Set(["pending", "paid", "processing", "shipped", "completed", "cancelled"]);
const paymentMethods = new Set(["stripe", "bank_transfer", "zalopay", "momo"]);
const clothingSizes = ["XS", "S", "M", "L", "XL", "XXL"];
const pageRoutes = new Map([
  ["/", "/index.html"],
  ["/home", "/index.html"],
  ["/shop", "/shop.html"],
  ["/account", "/account.html"],
  ["/login", "/account.html"],
]);
const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

let database;

function sendJson(response, status, body) {
  response.writeHead(status, {
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(body));
}

function getCookies(request) {
  const cookies = new Map();
  for (const cookie of (request.headers.cookie || "").split(";")) {
    const separator = cookie.indexOf("=");
    if (separator > 0) cookies.set(cookie.slice(0, separator).trim(), cookie.slice(separator + 1).trim());
  }
  return cookies;
}

function sessionCookieHeader(value, maxAge) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${sessionCookie}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

function normalizeEmail(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function isValidEmail(email) {
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function isAdminEmail(email) {
  const allowlist = (process.env.ADMIN_EMAILS || "")
    .split(",")
    .map(normalizeEmail)
    .filter(Boolean);
  return allowlist.includes(email);
}

function publicUser(user) {
  return {
    id: user._id.toString(),
    email: user.email,
    role: isAdminUser(user) ? "admin" : "user",
    createdAt: user.createdAt,
  };
}

function isAdminUser(user) {
  return user.role === "admin" && isAdminEmail(user.email);
}

function isCustomerUser(user) {
  return user.role === "user" && !isAdminUser(user);
}

function isValidAdminSetupKey(candidate) {
  const expected = process.env.ADMIN_SETUP_KEY || "";
  if (!expected || typeof candidate !== "string") return false;
  const suppliedBuffer = Buffer.from(candidate);
  const expectedBuffer = Buffer.from(expected);
  return (
    suppliedBuffer.length === expectedBuffer.length &&
    crypto.timingSafeEqual(suppliedBuffer, expectedBuffer)
  );
}

async function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const derivedKey = await scrypt(password, salt, 64);
  return { salt, hash: derivedKey.toString("hex") };
}

async function verifyPassword(password, user) {
  const salt = user ? user.passwordSalt : dummySalt;
  const expectedHash = user ? Buffer.from(user.passwordHash, "hex") : dummyHash;
  const actualHash = await scrypt(password, salt, 64);
  return Boolean(user) && crypto.timingSafeEqual(actualHash, expectedHash);
}

async function createSession(response, user) {
  const token = crypto.randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + sessionLifetimeMs);
  await database.collection("sessions").insertOne({
    _id: crypto.createHash("sha256").update(token).digest("hex"),
    userId: user._id,
    createdAt: new Date(),
    expiresAt,
  });
  response.setHeader("Set-Cookie", sessionCookieHeader(token, sessionLifetimeMs / 1000));
}

async function getCurrentUser(request) {
  const token = getCookies(request).get(sessionCookie);
  if (!token || !/^[A-Za-z0-9_-]{40,50}$/.test(token)) return null;

  const sessionId = crypto.createHash("sha256").update(token).digest("hex");
  const session = await database.collection("sessions").findOne({
    _id: sessionId,
    expiresAt: { $gt: new Date() },
  });
  if (!session) return null;

  const user = await database.collection("users").findOne({ _id: session.userId });
  if (!user) {
    await database.collection("sessions").deleteOne({ _id: sessionId });
    return null;
  }

  const role = user.role === "admin" && isAdminEmail(user.email) ? "admin" : "user";
  if (user.role !== role) {
    await database.collection("users").updateOne({ _id: user._id }, { $set: { role } });
    user.role = role;
  }
  return user;
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    let settled = false;
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      if (settled) return;
      body += chunk;
      if (body.length > 16_384) {
        settled = true;
        reject(Object.assign(new Error("Request body is too large."), { status: 413 }));
        request.resume();
      }
    });
    request.on("end", () => {
      if (settled) return;
      settled = true;
      if (!body) return reject(Object.assign(new Error("A JSON request body is required."), { status: 400 }));
      let parsed;
      try {
        parsed = JSON.parse(body);
      } catch {
        return reject(Object.assign(new Error("Request body must be valid JSON."), { status: 400 }));
      }
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return reject(Object.assign(new Error("The JSON body must be an object."), { status: 400 }));
      }
      resolve(parsed);
    });
    request.on("error", reject);
  });
}

async function handleAuthentication(request, response, pathname) {
  if (request.method === "GET" && pathname === "/api/auth/me") {
    const user = await getCurrentUser(request);
    return sendJson(response, 200, { user: user ? publicUser(user) : null });
  }

  if (request.method === "POST" && pathname === "/api/auth/register") {
    const body = await readJsonBody(request);
    const email = normalizeEmail(body.email);
    if (!isValidEmail(email)) return sendJson(response, 400, { error: "Enter a valid email address." });
    if (typeof body.password !== "string" || body.password.length < 10 || body.password.length > 128) {
      return sendJson(response, 400, { error: "Your password must be between 10 and 128 characters." });
    }
    if (isAdminEmail(email) && !isValidAdminSetupKey(body.adminSetupKey)) {
      return sendJson(response, 403, {
        error: "This admin email needs the server setup key. Ask the site owner to configure it.",
      });
    }

    const password = await hashPassword(body.password);
    const user = {
      email,
      passwordSalt: password.salt,
      passwordHash: password.hash,
      role: isAdminEmail(email) ? "admin" : "user",
      createdAt: new Date(),
    };
    try {
      const result = await database.collection("users").insertOne(user);
      user._id = result.insertedId;
    } catch (error) {
      if (error.code === 11000) {
        return sendJson(response, 409, { error: "An account with that email already exists." });
      }
      throw error;
    }

    await createSession(response, user);
    clearLoginAttempts(request, pathname);
    return sendJson(response, 201, { user: publicUser(user) });
  }

  if (request.method === "POST" && pathname === "/api/auth/login") {
    const body = await readJsonBody(request);
    const email = normalizeEmail(body.email);
    if (!isValidEmail(email) || typeof body.password !== "string" || body.password.length > 128) {
      return sendJson(response, 400, { error: "Enter your email and password." });
    }

    const user = await database.collection("users").findOne({ email });
    if (!(await verifyPassword(body.password, user))) {
      return sendJson(response, 401, { error: "Email or password is incorrect." });
    }

    const role = user.role === "admin" && isAdminEmail(email) ? "admin" : "user";
    if (user.role !== role) {
      await database.collection("users").updateOne({ _id: user._id }, { $set: { role } });
      user.role = role;
    }
    await createSession(response, user);
    clearLoginAttempts(request, pathname);
    return sendJson(response, 200, { user: publicUser(user) });
  }

  if (request.method === "POST" && pathname === "/api/auth/logout") {
    const token = getCookies(request).get(sessionCookie);
    if (token && /^[A-Za-z0-9_-]{40,50}$/.test(token)) {
      const sessionId = crypto.createHash("sha256").update(token).digest("hex");
      await database.collection("sessions").deleteOne({ _id: sessionId });
    }
    response.setHeader("Set-Cookie", sessionCookieHeader("", 0));
    return sendJson(response, 200, { user: null });
  }

  return null;
}

function consumeLoginAttempt(request, pathname) {
  const key = `${request.socket.remoteAddress || "unknown"}:${pathname}`;
  const now = Date.now();
  const existing = loginAttempts.get(key);
  if (!existing || existing.resetAt <= now) {
    loginAttempts.set(key, { count: 1, resetAt: now + 15 * 60 * 1000 });
    return true;
  }
  if (existing.count >= 10) return false;
  existing.count += 1;
  return true;
}

function clearLoginAttempts(request, pathname) {
  loginAttempts.delete(`${request.socket.remoteAddress || "unknown"}:${pathname}`);
}

function validateProduct(body) {
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const category = typeof body.category === "string" ? body.category : "";
  const group = typeof body.group === "string" ? body.group : "";
  const price = Number(body.price);
  const tag = typeof body.tag === "string" ? body.tag.trim() : "";
  const image = typeof body.image === "string" ? body.image.trim() : "";
  const alt = typeof body.alt === "string" ? body.alt.trim() : "";
  const colors = typeof body.colors === "string"
    ? body.colors.split(",").map((color) => color.trim()).filter(Boolean)
    : body.colors;

  if (!name || name.length > 100) {
    return { error: "Product name must be between 1 and 100 characters." };
  }
  if (!["Jerseys", "Layers", "Tops", "Accessories"].includes(category)) {
    return { error: "Choose a valid product category." };
  }
  if (!["jerseys", "tops", "accessories"].includes(group)) {
    return { error: "Choose a valid product filter group." };
  }
  if (!Number.isSafeInteger(price) || price <= 0 || price > 100000000) {
    return { error: "Price must be a positive whole VND amount." };
  }
  if (tag.length > 40) return { error: "Product tag must be 40 characters or fewer." };
  if (!/^photo-[A-Za-z0-9-]{1,100}$/.test(image)) {
    return { error: "Enter a valid Unsplash photo ID, such as photo-123456." };
  }
  if (!alt || alt.length > 250) {
    return { error: "Image description must be between 1 and 250 characters." };
  }
  if (!Array.isArray(colors) || colors.length < 1 || colors.length > 8 ||
      colors.some((color) => typeof color !== "string" || !/^#[0-9a-fA-F]{6}$/.test(color))) {
    return { error: "Enter 1 to 8 colors as comma-separated hex values, such as #20211c." };
  }

  return {
    product: {
      name,
      category,
      group,
      price,
      currency: "VND",
      tag,
      image,
      alt,
      colors,
    },
  };
}

function availableProductSizes(product) {
  return product.category === "Accessories" ? ["One size"] : clothingSizes;
}

async function handleApi(request, response, pathname) {
  await handleAuthentication(request, response, pathname);
  if (response.headersSent) return;

  if (request.method === "GET" && pathname === "/api/health") {
    await database.command({ ping: 1 });
    return sendJson(response, 200, { status: "ok", database: "EsPs" });
  }

  if (request.method === "GET" && pathname === "/api/products") {
    const products = await database.collection("products").find({}, { projection: { _id: 0 } }).toArray();
    return sendJson(response, 200, products);
  }

  if (pathname === "/api/admin/products" || pathname.startsWith("/api/admin/products/")) {
    const user = await getCurrentUser(request);
    if (!user) return sendJson(response, 401, { error: "Sign in to continue." });
    if (!isAdminUser(user)) return sendJson(response, 403, { error: "Admin access is required." });

    const collection = database.collection("products");
    if (request.method === "GET" && pathname === "/api/admin/products") {
      const products = await collection.find({}, { projection: { _id: 0 } }).sort({ name: 1 }).toArray();
      return sendJson(response, 200, products);
    }

    if (request.method === "POST" && pathname === "/api/admin/products") {
      const body = await readJsonBody(request);
      const validated = validateProduct(body);
      if (validated.error) return sendJson(response, 400, { error: validated.error });
      const product = { id: crypto.randomUUID(), ...validated.product };
      await collection.insertOne(product);
      return sendJson(response, 201, product);
    }

    const productPath = pathname.match(/^\/api\/admin\/products\/([^/]+)$/);
    if (productPath && request.method === "PUT") {
      let id;
      try {
        id = decodeURIComponent(productPath[1]);
      } catch {
        return sendJson(response, 400, { error: "Invalid product ID." });
      }
      const body = await readJsonBody(request);
      const validated = validateProduct(body);
      if (validated.error) return sendJson(response, 400, { error: validated.error });
      const result = await collection.updateOne({ id }, { $set: validated.product });
      if (!result.matchedCount) return sendJson(response, 404, { error: "Product not found." });
      return sendJson(response, 200, { id, ...validated.product });
    }

    if (productPath && request.method === "DELETE") {
      let id;
      try {
        id = decodeURIComponent(productPath[1]);
      } catch {
        return sendJson(response, 400, { error: "Invalid product ID." });
      }
      const result = await collection.deleteOne({ id });
      if (!result.deletedCount) return sendJson(response, 404, { error: "Product not found." });
      return sendJson(response, 200, { id });
    }

    return sendJson(response, 405, { error: "Method not allowed." });
  }

  if (request.method === "POST" && pathname === "/api/newsletter") {
    const body = await readJsonBody(request);
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
      return sendJson(response, 400, { error: "Enter a valid email address." });
    }

    await database.collection("newsletter").updateOne(
      { email },
      { $setOnInsert: { email, subscribedAt: new Date() } },
      { upsert: true },
    );
    return sendJson(response, 201, { message: "Thanks for subscribing." });
  }

  if (request.method === "POST" && pathname === "/api/orders") {
    const user = await getCurrentUser(request);
    if (!user) return sendJson(response, 401, { error: "Sign in to place an order." });
    if (!isCustomerUser(user)) {
      return sendJson(response, 403, { error: "Admin accounts cannot place customer orders." });
    }

    const body = await readJsonBody(request);
    if (!Array.isArray(body.items) || body.items.length === 0 || body.items.length > 50) {
      return sendJson(response, 400, { error: "Your bag is empty or contains too many items." });
    }

    if (!paymentMethods.has(body.paymentMethod)) {
      return sendJson(response, 400, { error: "Choose a valid payment method." });
    }

    const address = {};
    for (const field of ["name", "phone", "street", "city", "postalCode", "country"]) {
      address[field] = typeof body.address?.[field] === "string" ? body.address[field].trim() : "";
    }
    if (
      !address.name || address.name.length > 100 ||
      !/^[+()\d.\-\s]{7,25}$/.test(address.phone) ||
      !address.street || address.street.length > 200 ||
      !address.city || address.city.length > 100 ||
      !address.postalCode || address.postalCode.length > 20 ||
      !address.country || address.country.length > 100
    ) {
      return sendJson(response, 400, { error: "Enter a valid recipient name, phone, and complete delivery address." });
    }

    const quantities = new Map();
    for (const item of body.items) {
      if (
        !item ||
        typeof item.productId !== "string" ||
        typeof item.size !== "string" ||
        typeof item.color !== "string" ||
        !Number.isInteger(item.quantity) ||
        item.quantity < 1 ||
        item.quantity > 99
      ) {
        return sendJson(response, 400, { error: "One or more order items are invalid." });
      }
      const key = `${item.productId}\u0000${item.size}\u0000${item.color}`;
      const existing = quantities.get(key);
      if (existing && existing.quantity + item.quantity > 99) {
        return sendJson(response, 400, { error: "Each product option is limited to 99 items per order." });
      }
      if (existing) existing.quantity += item.quantity;
      else quantities.set(key, { productId: item.productId, size: item.size, color: item.color, quantity: item.quantity });
    }

    const products = await database
      .collection("products")
      .find({ id: { $in: [...new Set([...quantities.values()].map((item) => item.productId))] } },
        { projection: { _id: 0, id: 1, name: 1, price: 1, currency: 1, colors: 1, category: 1 } })
      .toArray();
    if (products.length !== new Set([...quantities.values()].map((item) => item.productId)).size) {
      return sendJson(response, 400, { error: "One or more products are no longer available." });
    }

    const productsById = new Map(products.map((product) => [product.id, product]));
    const items = [];
    for (const selection of quantities.values()) {
      const product = productsById.get(selection.productId);
      if (
        !availableProductSizes(product).includes(selection.size) ||
        !Array.isArray(product.colors) ||
        !product.colors.includes(selection.color)
      ) {
        return sendJson(response, 400, { error: `Choose a valid size and color for ${product.name}.` });
      }
      items.push({
        productId: product.id,
        name: product.name,
        unitPrice: product.price,
        currency: product.currency || "VND",
        size: selection.size,
        color: selection.color,
        quantity: selection.quantity,
      });
    }
    const total = items.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);
    const order = {
      userId: user._id,
      email: user.email,
      items,
      total,
      currency: "VND",
      paymentMethod: body.paymentMethod,
      paymentStatus: "not_configured",
      shippingAddress: address,
      status: "pending",
      createdAt: new Date(),
    };
    const result = await database.collection("orders").insertOne(order);
    return sendJson(response, 201, {
      orderId: result.insertedId.toString(),
      total,
      currency: order.currency,
      status: order.status,
      paymentStatus: order.paymentStatus,
    });
  }

  if (request.method === "GET" && pathname === "/api/account/orders") {
    const user = await getCurrentUser(request);
    if (!user) return sendJson(response, 401, { error: "Sign in to view your orders." });

    const orders = await database
      .collection("orders")
      .find({ userId: user._id }, { projection: { userId: 0 } })
      .sort({ createdAt: -1 })
      .limit(50)
      .toArray();
    return sendJson(
      response,
      200,
      orders.map((order) => ({
        id: order._id.toString(),
        email: order.email,
        items: order.items,
        total: order.total,
        currency: order.currency || "USD",
        status: order.status,
        paymentMethod: order.paymentMethod || "",
        paymentStatus: order.paymentStatus || "",
        shippingAddress: order.shippingAddress || null,
        createdAt: order.createdAt,
      })),
    );
  }

  if (request.method === "GET" && pathname === "/api/admin/orders") {
    const user = await getCurrentUser(request);
    if (!user) return sendJson(response, 401, { error: "Sign in to continue." });
    if (!isAdminUser(user)) return sendJson(response, 403, { error: "Admin access is required." });

    const orders = await database
      .collection("orders")
      .find({}, {
        projection: {
          email: 1, items: 1, total: 1, currency: 1, paymentMethod: 1, paymentStatus: 1,
          shippingAddress: 1, status: 1, createdAt: 1,
        },
      })
      .sort({ createdAt: -1 })
      .limit(100)
      .toArray();
    return sendJson(
      response,
      200,
      orders.map((order) => ({
        id: order._id.toString(),
        email: order.email || "",
        items: order.items,
        total: order.total,
        currency: order.currency || "USD",
        paymentMethod: order.paymentMethod || "",
        paymentStatus: order.paymentStatus || "",
        shippingAddress: order.shippingAddress || null,
        status: order.status,
        createdAt: order.createdAt,
      })),
    );
  }

  const adminOrderPath = pathname.match(/^\/api\/admin\/orders\/([^/]+)$/);
  if (adminOrderPath && request.method === "PATCH") {
    const user = await getCurrentUser(request);
    if (!user) return sendJson(response, 401, { error: "Sign in to continue." });
    if (!isAdminUser(user)) return sendJson(response, 403, { error: "Admin access is required." });

    const orderId = adminOrderPath[1];
    if (!/^[a-f\d]{24}$/i.test(orderId)) {
      return sendJson(response, 400, { error: "Invalid order ID." });
    }

    const body = await readJsonBody(request);
    if (typeof body.status !== "string" || !orderStatuses.has(body.status)) {
      return sendJson(response, 400, { error: "Choose a valid order status." });
    }

    const result = await database.collection("orders").updateOne(
      { _id: new ObjectId(orderId) },
      {
        $set: {
          status: body.status,
          updatedAt: new Date(),
          ...(body.status === "paid" ? { paymentStatus: "confirmed_manually" } : {}),
        },
      },
    );
    if (!result.matchedCount) return sendJson(response, 404, { error: "Order not found." });
    return sendJson(response, 200, {
      id: orderId,
      status: body.status,
      ...(body.status === "paid" ? { paymentStatus: "confirmed_manually" } : {}),
    });
  }

  return sendJson(response, 404, { error: "API endpoint not found." });
}

async function serveStatic(request, response, pathname) {
  let decodedPath;
  try {
    decodedPath = decodeURIComponent(pathname);
  } catch {
    return sendJson(response, 400, { error: "Invalid URL path." });
  }

  const requestedPath = decodedPath.replace(/\/+$/, "") || "/";
  let pagePath = pageRoutes.get(requestedPath);

  if (requestedPath === "/orders") {
    const user = await getCurrentUser(request);
    if (!user) {
      response.writeHead(303, {
        Location: "/account?next=/orders",
        "Cache-Control": "no-store",
      });
      return response.end();
    }
    pagePath = "/orders.html";
  }

  if (requestedPath === "/admin" || requestedPath === "/admin.html") {
    const user = await getCurrentUser(request);
    if (!user || !isAdminUser(user)) {
      response.writeHead(303, {
        Location: "/account?next=/admin",
        "Cache-Control": "no-store",
      });
      return response.end();
    }
    pagePath = "/admin.html";
  }

  if (pagePath) {
    response.writeHead(200, {
      "Cache-Control": "no-store",
      "Content-Type": "text/html; charset=utf-8",
    });
    return fs.createReadStream(path.join(root, pagePath)).pipe(response);
  }

  if (!requestedPath.startsWith("/assets/")) {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    return response.end("Not found");
  }

  const assetRoot = path.resolve(root, "assets");
  const filePath = path.resolve(root, `.${requestedPath}`);
  if (!filePath.startsWith(`${assetRoot}${path.sep}`)) {
    return sendJson(response, 403, { error: "Access denied." });
  }

  fs.stat(filePath, (error, stats) => {
    if (error || !stats.isFile()) {
      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      return response.end("Not found");
    }
    response.writeHead(200, {
      "Content-Type": mimeTypes[path.extname(filePath).toLowerCase()] || "application/octet-stream",
    });
    fs.createReadStream(filePath).pipe(response);
  });
}

async function start() {
  await mongoClient.connect();
  database = mongoClient.db("EsPs");
  await database.command({ ping: 1 });

  const products = database.collection("products");
  await products.createIndex({ id: 1 }, { unique: true });
  await products.bulkWrite(
    seedProducts.map((product) => ({
      updateOne: { filter: { id: product.id }, update: { $setOnInsert: product }, upsert: true },
    })),
  );
  await database.collection("newsletter").createIndex({ email: 1 }, { unique: true });
  await database.collection("users").createIndex({ email: 1 }, { unique: true });
  await database.collection("sessions").createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });

  const server = http.createServer(async (request, response) => {
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("X-Frame-Options", "DENY");
    response.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    let pathname;
    try {
      pathname = new URL(request.url, `http://${request.headers.host || "localhost"}`).pathname;
      if (pathname.startsWith("/api/")) {
        if (["POST", "PUT", "PATCH", "DELETE"].includes(request.method) && request.headers.origin) {
          let origin;
          try {
            origin = new URL(request.headers.origin);
          } catch {
            return sendJson(response, 403, { error: "Request origin is not allowed." });
          }
          if (!["http:", "https:"].includes(origin.protocol) || origin.host !== request.headers.host) {
            return sendJson(response, 403, { error: "Request origin is not allowed." });
          }
        }

        if (
          request.method === "POST" &&
          ["/api/auth/login", "/api/auth/register"].includes(pathname) &&
          !consumeLoginAttempt(request, pathname)
        ) {
          response.setHeader("Retry-After", "900");
          return sendJson(response, 429, { error: "Too many attempts. Please try again in 15 minutes." });
        }

        await handleApi(request, response, pathname);
      } else if (request.method === "GET" || request.method === "HEAD") {
        await serveStatic(request, response, pathname);
      } else {
        sendJson(response, 405, { error: "Method not allowed." });
      }
    } catch (error) {
      console.error(`Request failed for ${request.method} ${request.url}:`, error);
      if (!response.headersSent) {
        sendJson(response, error.status || 500, {
          error: error.status ? error.message : "The request could not be completed.",
        });
      } else {
        response.destroy(error);
      }
    }
  });

  server.listen(port, host, () => {
    console.log(`GG Supply is listening on ${host}:${port}`);
    console.log(`Connected to MongoDB database "${database.databaseName}".`);
  });

  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, async () => {
      server.close();
      await mongoClient.close();
      process.exit(0);
    });
  }

  setInterval(() => {
    const now = Date.now();
    for (const [key, attempt] of loginAttempts) {
      if (attempt.resetAt <= now) loginAttempts.delete(key);
    }
  }, 15 * 60 * 1000).unref();
}

start().catch(async (error) => {
  console.error("Could not connect to MongoDB:", error.message);
  console.error('Start the MongoDB service or set MONGODB_URI to your MongoDB connection string.');
  await mongoClient.close();
  process.exitCode = 1;
});
