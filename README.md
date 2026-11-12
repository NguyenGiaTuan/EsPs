# GG Supply

A responsive esports streetwear storefront built with plain HTML, CSS, JavaScript,
Node.js, and MongoDB.

## Project structure

```text
EsPs/
├── index.html           # Storefront content and accessible page structure
├── shop.html            # Product catalog, filters, and persistent shopping bag
├── account.html         # Registration, login, and account entry page
├── orders.html          # Signed-in customer order history
├── server.js            # Web server, MongoDB connection, and JSON API
├── admin.html           # Admin dashboard (served only to signed-in admins)
├── data/
│   └── products.js      # Initial products inserted into MongoDB on first run
├── assets/
│   ├── css/
│   │   ├── styles.css   # Storefront theme, responsive rules, and account dialog
│   │   └── admin.css    # Admin dashboard styles
│   └── js/
│       ├── app.js       # Product display, accounts, and storefront interactions
│       └── admin.js     # Admin dashboard and order list
├── .env.example         # Example local server settings; copy to .env
├── package.json         # Node.js scripts and server dependencies
├── package-lock.json    # Locked dependency versions
├── .gitignore           # Excludes local dependencies and credentials
└── README.md            # Project overview and local setup
```

## Run locally on Windows

Make sure the MongoDB server is running. If MongoDB is installed as a Windows
service, start it in PowerShell:

```powershell
Start-Service MongoDB
```

If it is not installed as a service, start the server in its own PowerShell
window (use the `mongod.exe` installed with MongoDB Community Server):

```powershell
New-Item -ItemType Directory -Force "$env:USERPROFILE\mongodb-data"
& "C:\Program Files\MongoDB\Server\8.2\bin\mongod.exe" --dbpath "$env:USERPROFILE\mongodb-data"
```

In a second PowerShell window, start the website:

```powershell
cd C:\Users\ADMIN\Desktop\EsPs
npm install
npm start
```

Open [http://localhost:3000](http://localhost:3000). The server creates the
`EsPs` database and seeds the `products` collection automatically. MongoDB
creates the database when the initial product documents are written.

## Publish on Render

The included `render.yaml` configures a public Node.js web service. Render
provides the listening port, while MongoDB Atlas stores products, accounts,
orders, and sessions outside the web service.

1. Create a MongoDB Atlas cluster and a database user with read/write access to
   the `EsPs` database. In Atlas Network Access, allow connections from your
   Render service. Render's free web services do not provide fixed outbound IPs,
   so Atlas may require `0.0.0.0/0`; use a unique, strong database-user password
   and restrict that user to the `EsPs` database.
2. Copy the Atlas connection string and replace its password placeholder. Use
   `EsPs` as the database name in the connection string.
3. Create a **private** GitHub repository and upload the project files. Do not
   upload `.env`, passwords, database connection strings, or setup keys. The
   `.gitignore` excludes `.env` and `node_modules`.
4. In Render, create a Blueprint using that repository and confirm the
   `gg-supply` web service. Add the values requested by the Blueprint:
   `MONGODB_URI`, `ADMIN_EMAILS` (the exact admin account email allowlist), and
   a new random `ADMIN_SETUP_KEY`. Generate a setup key in PowerShell with:

   ```powershell
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```

5. Deploy and wait for the `/api/health` check to pass. Open the public `onrender.com`
   URL, register the allowlisted admin email using the setup key, then remove
   `ADMIN_SETUP_KEY` from the Render service's environment and redeploy. Keep
   `ADMIN_EMAILS` configured so the account retains admin access.

The free Render service may sleep when idle and take longer to answer its first
request. The public website uses MongoDB Atlas; your local MongoDB data is not
automatically copied to Atlas. The first deployment seeds the catalog products.
If the setup key previously used in this project was valid, replace it and use
a new key before uploading the project.

## Website routes

- `/` or `/home` — storefront home page
- `/shop` — product catalog, category filters, and shopping bag
- `/account` or `/login` — sign in, register, or view your account
- `/orders` — signed-in user's order history; redirects to sign in otherwise
- `/admin` — allowlisted administrator dashboard for products and orders; redirects to sign in otherwise

The site navigation links between the public pages. After signing in, customers
return to their orders; allowlisted administrators can open their dashboard from
their account page. The shared shopping bag is retained in browser storage when
navigating between the home and shop routes.

The default connection is `mongodb://127.0.0.1:27017/EsPs`. To use another
MongoDB server, set the `MONGODB_URI` environment variable before `npm start`.
The website's `/api/health` endpoint checks the database connection.

## Accounts and admin access

1. Copy the example settings file and edit it:

   ```powershell
   Copy-Item .env.example .env
   notepad .env
   ```

2. Before registering any admin account, set `ADMIN_EMAILS` to the exact email
   address(es) that should have admin access. Separate multiple addresses with
   commas. Leave it blank if you are only setting up regular user accounts.
3. Generate a private admin setup key and paste it into `ADMIN_SETUP_KEY`:

   ```powershell
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```

4. Restart the site with `npm start`. Create the admin account from the storefront
   using one of the allowlisted emails and the setup key. The account will show an
   **Administrator** role and can open `/admin`. Configure the email allowlist
   before registering that account; allowlisted email addresses cannot be
   registered without the setup key.
5. After creating the admin account, remove `ADMIN_SETUP_KEY` from `.env` and
   restart the server. Keep `ADMIN_EMAILS` configured. Admin accounts must both
   have been created with the setup key and remain on the server allowlist.

Anyone can register a regular player account. Admin access cannot be selected in
the signup form: allowlisted admin registration also requires the private setup
key. Passwords are stored as salted scrypt hashes, and sign-in sessions use
HTTP-only cookies stored in MongoDB. User accounts can see their own order
history; administrators can view recent store orders at `/admin`. Checkout
creates a pending order; payment processing is not configured.

Administrators can add, edit, and delete products from the Products section at
`/admin`. Product changes are saved in MongoDB and immediately appear in the
store catalog. Prices are whole Vietnamese dong (VND). Product images use an
Unsplash photo ID (for example `photo-1521572163474-6864f9cf17ab`); colors are
comma-separated hex values.
Administrators can also update order statuses from the order dashboard:
Pending, Paid, Processing, Shipped, Completed, or Cancelled. Customers see the
latest status in their order history, which refreshes automatically every 10 seconds
while open; customers can also use the Refresh status button.

Customers select a size and color for each item, then provide a recipient name,
phone, delivery address, and preferred payment method at checkout. New orders
save those selections, address, payment method, and VND total to MongoDB and
show them in both the customer's order history and the admin dashboard. Stripe,
bank transfer, ZaloPay, and MoMo are recorded as preferences only until their
payment services and bank instructions are configured; checkout does not charge
customers or confirm payment. Setting an order to Paid in the admin dashboard
records a manual confirmation and does not verify a payment with a provider.

## Storefront features

- Responsive VND product catalog loaded from MongoDB with category filters
- Shopping bag with required size/color selections, quantity controls, and browser storage
- Checkout with recipient address and selected payment method recorded on each order
- Player account registration, login/logout, and personal order history
- Server-allowlisted admin accounts and a protected order dashboard
- Newsletter subscriptions saved to MongoDB
- Orders saved to MongoDB with server-calculated totals; payment processing is not configured
- Favorite toggles and mobile navigation
- Mobile navigation, accessible labels, and reduced-motion support
- Split-panel scroll reveals and staggered product/order cards on customer pages
- Product search with category filters, customer order lookup, and admin product/order search
