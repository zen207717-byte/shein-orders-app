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

  CREATE INDEX IF NOT EXISTS idx_orders_customer ON orders(customer_name);
  CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
  CREATE INDEX IF NOT EXISTS idx_orders_shipment ON orders(shipment_id);
  CREATE INDEX IF NOT EXISTS idx_orders_date ON orders(order_date);
`);

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
