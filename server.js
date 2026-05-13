const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = 3000;
const ROOT = __dirname;
const DB_FILE = path.join(ROOT, "database.json");

const sampleItems = [
  { id: "itm-1", name: "Organic Cotton Tee", category: "Apparel", qty: 18, cost: 12, selling: 29 },
  { id: "itm-2", name: "Ceramic Pour Over", category: "Home", qty: 4, cost: 18, selling: 46 },
  { id: "itm-3", name: "Travel Tumbler", category: "Accessories", qty: 32, cost: 9, selling: 24 },
  { id: "itm-4", name: "Botanical Candle", category: "Home", qty: 7, cost: 11, selling: 28 },
  { id: "itm-5", name: "Leather Card Case", category: "Accessories", qty: 3, cost: 22, selling: 58 },
  { id: "itm-6", name: "Daily Greens Pack", category: "Grocery", qty: 24, cost: 5, selling: 12 }
];

const sampleSales = {
  "itm-1": [2, 3, 1, 2, 4, 3, 2],
  "itm-2": [1, 0, 1, 1, 0, 1, 0],
  "itm-3": [4, 5, 3, 4, 6, 7, 3],
  "itm-4": [1, 1, 0, 2, 1, 1, 1],
  "itm-5": [0, 1, 0, 0, 1, 1, 0],
  "itm-6": [3, 2, 4, 3, 5, 4, 3]
};

function seedHistory(items) {
  const history = [];
  const now = new Date();
  items.forEach((item, idx) => {
    for (let d = 0; d < 370; d += 3 + idx) {
      const date = new Date(now);
      date.setDate(now.getDate() - d);
      const qty = ((idx + d) % 5) + 1;
      history.push({
        date: date.toISOString().slice(0, 10),
        itemId: item.id,
        qty,
        revenue: qty * item.selling
      });
    }
  });
  return history;
}

function defaultDb() {
  return {
    retailerName: "Demo Retail Store",
    inventoryItems: sampleItems,
    weeklySales: sampleSales,
    salesHistory: seedHistory(sampleItems),
    bills: []
  };
}

function ensureDb() {
  if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify(defaultDb(), null, 2));
  }
}

function readDb() {
  ensureDb();
  const db = JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
  if (!Array.isArray(db.salesHistory) || db.salesHistory.length === 0) {
    db.salesHistory = seedHistory(db.inventoryItems || sampleItems);
    writeDb(db);
  }
  db.bills = Array.isArray(db.bills) ? db.bills : [];
  db.weeklySales = db.weeklySales || {};
  db.inventoryItems = Array.isArray(db.inventoryItems) ? db.inventoryItems : [];
  return db;
}

function writeDb(db) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

function sendJson(res, status, data) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  });
  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", chunk => {
      body += chunk;
      if (body.length > 1_000_000) req.destroy();
    });
    req.on("end", () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(error);
      }
    });
  });
}

function todayIndex() {
  return (new Date().getDay() + 6) % 7;
}

function sellUnits(db, itemId, qty, source) {
  const item = db.inventoryItems.find(product => product.id === itemId);
  if (!item) throw new Error("Item not found");
  if (qty < 1) throw new Error("Quantity must be at least 1");
  if (item.qty < qty) throw new Error(`Only ${item.qty} units available for ${item.name}`);

  item.qty -= qty;
  db.weeklySales[itemId] = db.weeklySales[itemId] || [0, 0, 0, 0, 0, 0, 0];
  db.weeklySales[itemId][todayIndex()] = (db.weeklySales[itemId][todayIndex()] || 0) + qty;
  db.salesHistory.push({
    date: new Date().toISOString().slice(0, 10),
    itemId,
    qty,
    revenue: qty * item.selling,
    source
  });

  return item;
}

async function handleApi(req, res, url) {
  if (req.method === "OPTIONS") return sendJson(res, 200, { ok: true });

  try {
    const db = readDb();

    if (req.method === "GET" && url.pathname === "/api/state") {
      return sendJson(res, 200, db);
    }

    if (req.method === "POST" && url.pathname === "/api/login") {
      const body = await readBody(req);
      db.retailerName = String(body.retailerName || "Retail Store").trim();
      writeDb(db);
      return sendJson(res, 200, { ok: true, retailerName: db.retailerName });
    }

    if (req.method === "POST" && url.pathname === "/api/items") {
      const body = await readBody(req);
      const item = {
        id: body.id || `itm-${Date.now()}`,
        name: String(body.name || "").trim(),
        category: String(body.category || "General"),
        qty: Number(body.qty || 0),
        cost: Number(body.cost || 0),
        selling: Number(body.selling || 0)
      };
      if (!item.name) return sendJson(res, 400, { error: "Item name is required" });
      db.inventoryItems.push(item);
      db.weeklySales[item.id] = [0, 0, 0, 0, 0, 0, 0];
      writeDb(db);
      return sendJson(res, 201, { ok: true, item });
    }

    const itemMatch = url.pathname.match(/^\/api\/items\/([^/]+)$/);
    if (itemMatch && req.method === "PUT") {
      const body = await readBody(req);
      const item = db.inventoryItems.find(product => product.id === itemMatch[1]);
      if (!item) return sendJson(res, 404, { error: "Item not found" });
      item.name = String(body.name || item.name).trim();
      item.category = String(body.category || item.category);
      item.qty = Number(body.qty ?? item.qty);
      item.cost = Number(body.cost ?? item.cost);
      item.selling = Number(body.selling ?? item.selling);
      writeDb(db);
      return sendJson(res, 200, { ok: true, item });
    }

    if (itemMatch && req.method === "DELETE") {
      db.inventoryItems = db.inventoryItems.filter(item => item.id !== itemMatch[1]);
      delete db.weeklySales[itemMatch[1]];
      writeDb(db);
      return sendJson(res, 200, { ok: true });
    }

    if (req.method === "POST" && url.pathname === "/api/sell") {
      const body = await readBody(req);
      const item = sellUnits(db, body.itemId, Number(body.qty || 1), "single-sale");
      writeDb(db);
      return sendJson(res, 200, { ok: true, item });
    }

    if (req.method === "POST" && url.pathname === "/api/pay-bill") {
      const body = await readBody(req);
      const lines = Array.isArray(body.items) ? body.items : [];
      if (!lines.length) return sendJson(res, 400, { error: "Bill is empty" });

      const billItems = lines.map(line => {
        const item = db.inventoryItems.find(product => product.id === line.id);
        const qty = Number(line.qty || 0);
        if (!item) throw new Error("Item not found in bill");
        if (qty < 1) throw new Error("Bill quantity must be at least 1");
        if (item.qty < qty) throw new Error(`Only ${item.qty} units available for ${item.name}`);
        return { id: item.id, name: item.name, qty, price: item.selling, total: qty * item.selling };
      });

      billItems.forEach(line => sellUnits(db, line.id, line.qty, "bill-payment"));
      const bill = {
        id: `bill-${Date.now()}`,
        date: new Date().toISOString(),
        paymentMethod: body.paymentMethod || "Cash",
        payment: {
          method: body.paymentMethod || "Cash",
          status: body.paymentStatus || "Paid",
          reference: body.paymentReference || "",
          upiId: body.upiId || "",
          cardLast4: body.cardLast4 || "",
          receivedAmount: Number(body.receivedAmount || 0),
          changeDue: Number(body.changeDue || 0)
        },
        items: billItems,
        total: billItems.reduce((sum, line) => sum + line.total, 0)
      };
      db.bills.push(bill);
      writeDb(db);
      return sendJson(res, 201, { ok: true, bill, state: db });
    }

    if (req.method === "POST" && url.pathname === "/api/history") {
      const body = await readBody(req);
      const item = db.inventoryItems.find(product => product.id === body.itemId);
      if (!item) return sendJson(res, 404, { error: "Item not found" });
      db.salesHistory = db.salesHistory.filter(entry => !(entry.manualPeriod === body.period && entry.itemId === body.itemId));
      const qty = Number(body.qty || 0);
      if (qty > 0) {
        db.salesHistory.push({
          date: body.date || new Date().toISOString().slice(0, 10),
          itemId: item.id,
          qty,
          revenue: qty * item.selling,
          manualPeriod: body.period
        });
      }
      writeDb(db);
      return sendJson(res, 200, { ok: true, salesHistory: db.salesHistory });
    }

    return sendJson(res, 404, { error: "API route not found" });
  } catch (error) {
    return sendJson(res, 400, { error: error.message || "Request failed" });
  }
}

function serveStatic(req, res, url) {
  let filePath = decodeURIComponent(url.pathname);
  if (filePath === "/") filePath = "/login.html";
  const safePath = path.normalize(filePath).replace(/^(\.\.[/\\])+/, "");
  const absolutePath = path.join(ROOT, safePath);

  if (!absolutePath.startsWith(ROOT)) {
    res.writeHead(403);
    return res.end("Forbidden");
  }

  fs.readFile(absolutePath, (error, data) => {
    if (error) {
      res.writeHead(404);
      return res.end("Not found");
    }

    const ext = path.extname(absolutePath);
    const types = {
      ".html": "text/html; charset=utf-8",
      ".js": "text/javascript; charset=utf-8",
      ".json": "application/json; charset=utf-8"
    };
    res.writeHead(200, { "Content-Type": types[ext] || "text/plain; charset=utf-8" });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname.startsWith("/api/")) return handleApi(req, res, url);
  return serveStatic(req, res, url);
});

ensureDb();
server.listen(PORT, () => {
  console.log(`StockFlow backend running at http://127.0.0.1:${PORT}/login.html`);
  console.log(`Database file: ${DB_FILE}`);
});
