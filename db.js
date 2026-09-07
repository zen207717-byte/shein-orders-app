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

  CREATE TABLE IF NOT EXISTS customers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL COLLATE NOCASE UNIQUE,
    phone TEXT,
    address TEXT,
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
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

  CREATE TABLE IF NOT EXISTS payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL,
    amount REAL NOT NULL CHECK (amount > 0),
    currency TEXT NOT NULL DEFAULT 'SAR' CHECK (currency IN ('SAR', 'YER')),
    payment_date DATE NOT NULL,
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE RESTRICT
  );

  CREATE INDEX IF NOT EXISTS idx_orders_customer ON orders(customer_name);
  CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
  CREATE INDEX IF NOT EXISTS idx_orders_shipment ON orders(shipment_id);
  CREATE INDEX IF NOT EXISTS idx_orders_date ON orders(order_date);
  CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);
  CREATE INDEX IF NOT EXISTS idx_order_items_status ON order_items(status);
  CREATE INDEX IF NOT EXISTS idx_item_history_item ON order_item_status_history(item_id, changed_at);
  CREATE INDEX IF NOT EXISTS idx_payments_order ON payments(order_id, payment_date);
  CREATE INDEX IF NOT EXISTS idx_customers_name ON customers(name);
`);

// Safe additive migration for databases created before the SHEIN importer.
const orderItemColumns = db.prepare('PRAGMA table_info(order_items)').all().map(column => column.name);
if (!orderItemColumns.includes('sku')) {
  db.exec('ALTER TABLE order_items ADD COLUMN sku TEXT');
}
if (!orderItemColumns.includes('sync_key')) {
  db.exec('ALTER TABLE order_items ADD COLUMN sync_key TEXT');
}
if (!orderItemColumns.includes('source_signature')) {
  db.exec('ALTER TABLE order_items ADD COLUMN source_signature TEXT');
}
if (!orderItemColumns.includes('cancellation_reason')) {
  db.exec('ALTER TABLE order_items ADD COLUMN cancellation_reason TEXT');
}
const orderColumns = db.prepare('PRAGMA table_info(orders)').all().map(column => column.name);
if (!orderColumns.includes('customer_id')) db.exec('ALTER TABLE orders ADD COLUMN customer_id INTEGER');
if (!orderColumns.includes('archived_at')) db.exec('ALTER TABLE orders ADD COLUMN archived_at DATETIME');
const shipmentColumns = db.prepare('PRAGMA table_info(shipments)').all().map(column => column.name);
if (!shipmentColumns.includes('saudi_arrival_date')) db.exec('ALTER TABLE shipments ADD COLUMN saudi_arrival_date DATE');
if (!shipmentColumns.includes('yemen_shipping_date')) db.exec('ALTER TABLE shipments ADD COLUMN yemen_shipping_date DATE');
if (!shipmentColumns.includes('yemen_arrival_date')) db.exec('ALTER TABLE shipments ADD COLUMN yemen_arrival_date DATE');
db.exec(`
  CREATE UNIQUE INDEX IF NOT EXISTS idx_order_items_sync_key
    ON order_items(sync_key) WHERE sync_key IS NOT NULL AND sync_key <> '';
  CREATE TABLE IF NOT EXISTS shein_import_receipts (
    receipt_token TEXT PRIMARY KEY,
    sync_key TEXT NOT NULL,
    source_signature TEXT NOT NULL,
    item_id INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (item_id) REFERENCES order_items(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_shein_receipts_created ON shein_import_receipts(created_at);
`);

// Preserve old order-based customers and payment totals during the additive migration.
db.exec(`
  INSERT OR IGNORE INTO customers (name, phone)
  SELECT TRIM(customer_name), MAX(customer_phone) FROM orders
  WHERE TRIM(customer_name) <> '' GROUP BY TRIM(customer_name);
  UPDATE orders SET customer_id = (
    SELECT id FROM customers WHERE customers.name = orders.customer_name COLLATE NOCASE
  ) WHERE customer_id IS NULL;
  INSERT INTO payments (order_id, amount, currency, payment_date, notes)
  SELECT o.id, o.customer_paid, o.currency, COALESCE(o.order_date, DATE('now')), 'رصيد مدفوع سابق قبل سجل الدفعات'
  FROM orders o WHERE o.customer_paid > 0
    AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.order_id = o.id);
`);

db.pragma('optimize');

// Seed the first admin only from a deployment secret; existing databases are untouched.
const userCount = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
if (userCount === 0) {
  const initialPassword = process.env.INITIAL_ADMIN_PASSWORD;
  if (!initialPassword || initialPassword.length < 8) {
    throw new Error('INITIAL_ADMIN_PASSWORD must be set to at least 8 characters for first setup');
  }
  const hash = bcrypt.hashSync(initialPassword, 10);
  db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run('admin', hash);
  console.log('✓ Initial admin user created');
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
