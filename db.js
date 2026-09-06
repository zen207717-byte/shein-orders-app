// db.js - Database setup and queries
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');

const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'app.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Initialize schema
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  );

  CREATE TABLE IF NOT EXISTS shipments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    total_cost REAL DEFAULT 0,
    currency TEXT DEFAULT 'SAR',
    distribution TEXT DEFAULT 'equal',
    status TEXT DEFAULT 'in_transit',
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_name TEXT NOT NULL,
    customer_phone TEXT,
    order_number TEXT,
    order_date DATE,
    customer_value REAL DEFAULT 0,
    shein_paid REAL DEFAULT 0,
    customer_paid REAL DEFAULT 0,
    currency TEXT DEFAULT 'SAR',
    status TEXT DEFAULT 'new',
    shipment_id INTEGER,
    shipping_cost REAL DEFAULT 0,
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (shipment_id) REFERENCES shipments(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS order_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL,
    product_url TEXT,
    product_name TEXT NOT NULL,
    image_url TEXT,
    sku TEXT,
    color TEXT,
    size TEXT,
    quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
    customer_unit_price REAL NOT NULL DEFAULT 0 CHECK (customer_unit_price >= 0),
    shein_unit_price REAL NOT NULL DEFAULT 0 CHECK (shein_unit_price >= 0),
    status TEXT NOT NULL DEFAULT 'in_cart' CHECK (status IN (
      'in_cart', 'ordered', 'shipped', 'arrived', 'delivered',
      'cancelled_by_customer', 'out_of_stock'
    )),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS order_item_status_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id INTEGER NOT NULL,
    old_status TEXT,
    new_status TEXT NOT NULL,
    changed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (item_id) REFERENCES order_items(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_orders_customer ON orders(customer_name);
  CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
  CREATE INDEX IF NOT EXISTS idx_orders_shipment ON orders(shipment_id);
  CREATE INDEX IF NOT EXISTS idx_orders_date ON orders(order_date);
  CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);
  CREATE INDEX IF NOT EXISTS idx_order_items_status ON order_items(status);
  CREATE INDEX IF NOT EXISTS idx_item_history_item ON order_item_status_history(item_id, changed_at);
`);

// Safe additive migration for databases created before the SHEIN importer.
const orderItemColumns = db.prepare('PRAGMA table_info(order_items)').all().map(column => column.name);
if (!orderItemColumns.includes('sku')) {
  db.exec('ALTER TABLE order_items ADD COLUMN sku TEXT');
}

db.pragma('optimize');

// Seed default user (username: admin, password: admin123) if not exists
const userCount = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
if (userCount === 0) {
  const hash = bcrypt.hashSync('admin123', 10);
  db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run('admin', hash);
  console.log('✓ Default user created: admin / admin123');
}

// Seed default exchange rate
const exchangeRate = db.prepare('SELECT value FROM settings WHERE key = ?').get('exchange_rate');
if (!exchangeRate) {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run('exchange_rate', '425');
  console.log('✓ Default exchange rate set: 1 SAR = 425 YER');
}

// Helper: get setting
function getSetting(key) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : null;
}

function setSetting(key, value) {
  const existing = getSetting(key);
  if (existing !== null) {
    db.prepare('UPDATE settings SET value = ? WHERE key = ?').run(value, key);
  } else {
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run(key, value);
  }
}

module.exports = { db, getSetting, setSetting };
