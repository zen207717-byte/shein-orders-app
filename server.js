// server.js - Main Express server
const express = require('express');
const session = require('express-session');
const cookieParser = require('cookie-parser');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const { db, getSetting, setSetting } = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;
const HOST = '0.0.0.0';
const SESSION_SECRET = process.env.SESSION_SECRET;
if (!SESSION_SECRET || SESSION_SECRET.length < 16) {
  throw new Error('SESSION_SECRET must be set to at least 16 characters');
}

// Middleware
app.use(express.json({ limit: '2mb' }));
app.use(cookieParser());
app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
    sameSite: 'lax'
  }
}));

// Auth middleware
function requireAuth(req, res, next) {
  if (req.session && req.session.userId) return next();
  return res.status(401).json({ error: 'unauthorized' });
}

const ITEM_STATUSES = new Set([
  'pending_review', 'pending_shein_cart', 'in_cart', 'ordered', 'shipped',
  'arrived', 'delivered', 'change_required', 'cancelled_by_customer',
  'out_of_stock', 'returned'
]);
const EXCLUDED_ITEM_STATUSES = new Set(['cancelled_by_customer', 'out_of_stock', 'returned']);

function isHttpUrl(value) {
  if (!value) return true;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch (_) {
    return false;
  }
}

function itemTotals(item) {
  const quantity = Number(item.quantity) || 0;
  const excluded = EXCLUDED_ITEM_STATUSES.has(item.status);
  const customerTotal = excluded ? 0 : quantity * (Number(item.customer_unit_price) || 0);
  const sheinTotal = excluded ? 0 : quantity * (Number(item.shein_unit_price) || 0);
  return {
    customer_total: customerTotal,
    shein_total: sheinTotal,
    commission: customerTotal - sheinTotal,
    excluded_from_totals: excluded
  };
}

function hydrateItem(item) {
  return { ...item, ...itemTotals(item) };
}

function syncOrderTotals(orderId) {
  const totals = db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN status NOT IN ('cancelled_by_customer', 'out_of_stock')
        THEN quantity * customer_unit_price ELSE 0 END), 0) AS customer_value,
      COALESCE(SUM(CASE WHEN status NOT IN ('cancelled_by_customer', 'out_of_stock')
        THEN quantity * shein_unit_price ELSE 0 END), 0) AS shein_paid
    FROM order_items WHERE order_id = ?
  `).get(orderId);
  db.prepare(`
    UPDATE orders SET customer_value = ?, shein_paid = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(totals.customer_value, totals.shein_paid, orderId);
}

function validateItemInput(body) {
  const productName = String(body.product_name || '').trim();
  const quantity = Number(body.quantity);
  const customerPrice = Number(body.customer_unit_price);
  const sheinPrice = Number(body.shein_unit_price);
  const status = body.status || 'in_cart';
  if (!productName) return 'اسم أو وصف المنتج مطلوب';
  if (!Number.isInteger(quantity) || quantity < 1) return 'الكمية يجب أن تكون رقمًا صحيحًا أكبر من صفر';
  if (!Number.isFinite(customerPrice) || customerPrice < 0 || customerPrice > 10000000) return 'السعر الظاهر للزبونة غير صحيح';
  if (!Number.isFinite(sheinPrice) || sheinPrice < 0 || sheinPrice > 10000000) return 'السعر الفعلي لـ SHEIN غير صحيح';
  if (!ITEM_STATUSES.has(status)) return 'حالة القطعة غير صحيحة';
  if (!isHttpUrl(body.product_url)) return 'رابط المنتج غير صحيح';
  if (!isHttpUrl(body.image_url)) return 'رابط الصورة غير صحيح';
  return null;
}

function syncOrderPayments(orderId) {
  const order = db.prepare('SELECT currency FROM orders WHERE id = ?').get(orderId);
  if (!order) return 0;
  const rate = Number(getSetting('exchange_rate')) || 425;
  const payments = db.prepare('SELECT amount, currency FROM payments WHERE order_id = ?').all(orderId);
  const total = payments.reduce((sum, payment) => {
    const amount = Number(payment.amount) || 0;
    if (payment.currency === order.currency) return sum + amount;
    if (payment.currency === 'SAR' && order.currency === 'YER') return sum + amount * rate;
    if (payment.currency === 'YER' && order.currency === 'SAR') return sum + amount / rate;
    return sum;
  }, 0);
  db.prepare('UPDATE orders SET customer_paid = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(total, orderId);
  return total;
}

function getOrCreateCustomer(name, phone = '') {
  const cleanName = String(name || '').trim();
  if (!cleanName) return null;
  db.prepare(`INSERT OR IGNORE INTO customers (name, phone) VALUES (?, ?)`).run(cleanName, String(phone || '').trim());
  if (phone) db.prepare(`UPDATE customers SET phone = CASE WHEN TRIM(phone) = '' THEN ? ELSE phone END,
    updated_at = CURRENT_TIMESTAMP WHERE name = ? COLLATE NOCASE`).run(String(phone).trim(), cleanName);
  return db.prepare('SELECT * FROM customers WHERE name = ? COLLATE NOCASE').get(cleanName);
}

function validSyncValue(value, maxLength = 300, minLength = 3) {
  return typeof value === 'string' && value.length >= minLength && value.length <= maxLength && /^[A-Za-z0-9:._-]+$/.test(value);
}

function parseSheinUrl(value) {
  try {
    const url = new URL(String(value || '').trim());
    const hostname = url.hostname.toLowerCase();
    if (url.protocol !== 'https:' || (hostname !== 'shein.com' && !hostname.endsWith('.shein.com'))) return null;
    url.hash = '';
    for (const key of [...url.searchParams.keys()]) {
      if (!['goods_id', 'sku', 'skucode'].includes(key.toLowerCase())) url.searchParams.delete(key);
    }
    return url;
  } catch (_) { return null; }
}

function decodeHtml(value = '') {
  return String(value).replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
}

function metaContent(html, key) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const patterns = [
    new RegExp(`<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']*)["']`, 'i'),
    new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${escaped}["']`, 'i')
  ];
  for (const pattern of patterns) { const match = html.match(pattern); if (match) return decodeHtml(match[1]).trim(); }
  return '';
}

function firstJsonLdProduct(html) {
  for (const match of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const parsed = JSON.parse(decodeHtml(match[1]));
      const entries = Array.isArray(parsed) ? parsed : (parsed['@graph'] || [parsed]);
      const product = entries.find(entry => String(entry?.['@type'] || '').toLowerCase() === 'product');
      if (product) return product;
    } catch (_) {}
  }
  return {};
}

function safePrice(value) {
  const match = String(value ?? '').replace(/,/g, '').match(/\d+(?:\.\d{1,2})?/);
  const price = match ? Number(match[0]) : NaN;
  return Number.isFinite(price) && price >= 0 && price <= 10000000 ? price : '';
}

async function fetchPublicSheinPage(initialUrl) {
  let current = initialUrl;
  for (let redirects = 0; redirects < 4; redirects += 1) {
    const response = await fetch(current, {
      redirect: 'manual', signal: AbortSignal.timeout(8000),
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; UmMarwanImporter/1.0)', Accept: 'text/html' }
    });
    if (response.status >= 300 && response.status < 400) {
      const next = parseSheinUrl(new URL(response.headers.get('location') || '', current).href);
      if (!next) throw new Error('تحويل الرابط خرج عن نطاق SHEIN');
      current = next;
      continue;
    }
    if (!response.ok) throw new Error(`تعذر قراءة صفحة SHEIN (${response.status})`);
    return { html: (await response.text()).slice(0, 3000000), url: current };
  }
  throw new Error('رابط SHEIN يحتوي تحويلات كثيرة');
}

// ========== AUTH ROUTES ==========
app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'بيانات الدخول مطلوبة' });
  }
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'اسم المستخدم أو كلمة المرور غير صحيحة' });
  }
  req.session.userId = user.id;
  req.session.username = user.username;
  res.json({ ok: true, username: user.username });
});

app.post('/api/auth/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/api/auth/status', (req, res) => {
  if (req.session && req.session.userId) {
    return res.json({ authenticated: true, username: req.session.username });
  }
  res.json({ authenticated: false });
});

app.post('/api/auth/change-password', requireAuth, (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: 'كلمة المرور الحالية والجديدة مطلوبة' });
  }
  if (newPassword.length < 4) {
    return res.status(400).json({ error: 'كلمة المرور الجديدة يجب أن تكون 4 أحرف على الأقل' });
  }
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
  if (!bcrypt.compareSync(currentPassword, user.password_hash)) {
    return res.status(401).json({ error: 'كلمة المرور الحالية غير صحيحة' });
  }
  const hash = bcrypt.hashSync(newPassword, 10);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, user.id);
  res.json({ ok: true });
});

// ========== SETTINGS ROUTES ==========
app.get('/api/settings', requireAuth, (req, res) => {
  res.json({
    exchange_rate: getSetting('exchange_rate') || '425'
  });
});

app.put('/api/settings', requireAuth, (req, res) => {
  const { exchange_rate } = req.body || {};
  if (exchange_rate !== undefined) {
    const rate = parseFloat(exchange_rate);
    if (isNaN(rate) || rate <= 0) {
      return res.status(400).json({ error: 'سعر الصرف غير صحيح' });
    }
    setSetting('exchange_rate', String(rate));
  }
  res.json({ ok: true, exchange_rate: getSetting('exchange_rate') });
});

// ========== ORDERS ROUTES ==========
app.get('/api/orders', requireAuth, (req, res) => {
  const rows = db.prepare(`
    SELECT orders.*,
      (SELECT COUNT(*) FROM order_items WHERE order_id = orders.id) AS item_count
    FROM orders
    WHERE archived_at IS NULL
    ORDER BY order_date DESC, id DESC
  `).all();
  res.json(rows);
});

app.get('/api/orders/:id', requireAuth, (req, res) => {
  const row = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'الطلب غير موجود' });
  const items = db.prepare('SELECT * FROM order_items WHERE order_id = ? ORDER BY id ASC').all(row.id).map(hydrateItem);
  const payments = db.prepare('SELECT * FROM payments WHERE order_id = ? ORDER BY payment_date DESC, id DESC').all(row.id);
  res.json({ ...row, items, payments });
});

// ========== ORDER ITEMS ROUTES ==========
app.get('/api/orders/:orderId/items', requireAuth, (req, res) => {
  const order = db.prepare('SELECT id FROM orders WHERE id = ?').get(req.params.orderId);
  if (!order) return res.status(404).json({ error: 'الطلب غير موجود' });
  const items = db.prepare('SELECT * FROM order_items WHERE order_id = ? ORDER BY id ASC').all(order.id);
  res.json(items.map(hydrateItem));
});

app.post('/api/orders/:orderId/items', requireAuth, (req, res) => {
  const order = db.prepare('SELECT id FROM orders WHERE id = ?').get(req.params.orderId);
  if (!order) return res.status(404).json({ error: 'الطلب غير موجود' });
  const error = validateItemInput(req.body || {});
  if (error) return res.status(400).json({ error });
  const body = req.body;
  const trx = db.transaction(() => {
    const info = db.prepare(`
      INSERT INTO order_items
      (order_id, product_url, product_name, image_url, sku, color, size, quantity,
       customer_unit_price, shein_unit_price, status, cancellation_reason)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      order.id, String(body.product_url || '').trim(), String(body.product_name).trim(),
      String(body.image_url || '').trim(), String(body.sku || '').trim(), String(body.color || '').trim(),
      String(body.size || '').trim(), Number(body.quantity), Number(body.customer_unit_price),
      Number(body.shein_unit_price), body.status || 'in_cart',
      body.status === 'cancelled_by_customer' ? String(body.cancellation_reason || '').trim() : ''
    );
    db.prepare(`
      INSERT INTO order_item_status_history (item_id, old_status, new_status)
      VALUES (?, NULL, ?)
    `).run(info.lastInsertRowid, body.status || 'in_cart');
    syncOrderTotals(order.id);
    return info.lastInsertRowid;
  });
  const itemId = trx();
  res.status(201).json(hydrateItem(db.prepare('SELECT * FROM order_items WHERE id = ?').get(itemId)));
});

app.put('/api/order-items/:id', requireAuth, (req, res) => {
  const existing = db.prepare('SELECT * FROM order_items WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'القطعة غير موجودة' });
  const body = { ...existing, ...(req.body || {}) };
  const error = validateItemInput(body);
  if (error) return res.status(400).json({ error });
  const trx = db.transaction(() => {
    db.prepare(`
      UPDATE order_items SET product_url = ?, product_name = ?, image_url = ?, sku = ?, color = ?, size = ?,
        quantity = ?, customer_unit_price = ?, shein_unit_price = ?, status = ?, cancellation_reason = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(
      String(body.product_url || '').trim(), String(body.product_name).trim(),
      String(body.image_url || '').trim(), String(body.sku || '').trim(), String(body.color || '').trim(), String(body.size || '').trim(),
      Number(body.quantity), Number(body.customer_unit_price), Number(body.shein_unit_price), body.status,
      body.status === 'cancelled_by_customer' ? String(body.cancellation_reason || '').trim() : '', existing.id
    );
    if (body.status !== existing.status) {
      db.prepare(`
        INSERT INTO order_item_status_history (item_id, old_status, new_status) VALUES (?, ?, ?)
      `).run(existing.id, existing.status, body.status);
    }
    syncOrderTotals(existing.order_id);
  });
  trx();
  res.json(hydrateItem(db.prepare('SELECT * FROM order_items WHERE id = ?').get(existing.id)));
});

app.get('/api/order-items/:id/history', requireAuth, (req, res) => {
  const item = db.prepare('SELECT id FROM order_items WHERE id = ?').get(req.params.id);
  if (!item) return res.status(404).json({ error: 'القطعة غير موجودة' });
  res.json(db.prepare(`
    SELECT * FROM order_item_status_history WHERE item_id = ? ORDER BY changed_at DESC, id DESC
  `).all(item.id));
});

// A receipt is an opaque, one-time capability. It exposes no customer/order data.
app.get('/api/import/shein-status/:token', (req, res) => {
  if (!validSyncValue(req.params.token, 100, 20)) return res.status(400).json({ error: 'invalid_receipt' });
  const receipt = db.prepare(`
    SELECT sync_key, source_signature, item_id
    FROM shein_import_receipts WHERE receipt_token = ?
  `).get(req.params.token);
  if (!receipt) return res.json({ status: 'pending' });
  res.json({ status: 'synced', ...receipt });
});

app.get('/api/import/shein-item/:syncKey', requireAuth, (req, res) => {
  const item = db.prepare('SELECT * FROM order_items WHERE sync_key = ?').get(req.params.syncKey);
  if (!item) return res.status(404).json({ error: 'not_found' });
  res.json(hydrateItem(item));
});

// Mobile-friendly import from a public SHEIN product link. No cookies or SHEIN login are used.
app.post('/api/import/shein-link', requireAuth, async (req, res) => {
  const requestedUrl = parseSheinUrl(req.body?.url);
  if (!requestedUrl) return res.status(400).json({ error: 'ألصق رابطًا صحيحًا من نطاق SHEIN يبدأ بـ https://' });

  let finalUrl = requestedUrl;
  let html = '';
  let warning = '';
  try {
    const page = await fetchPublicSheinPage(requestedUrl);
    finalUrl = page.url;
    html = page.html;
  } catch (_) {
    warning = 'لم يتمكن النظام من قراءة بيانات المنتج من SHEIN. يمكنك إكمال الحقول يدويًا ثم الحفظ.';
  }

  const product = html ? firstJsonLdProduct(html) : {};
  const offers = Array.isArray(product.offers) ? product.offers[0] : (product.offers || {});
  const image = Array.isArray(product.image) ? product.image[0] : product.image;
  const productName = String(product.name || metaContent(html, 'og:title') || '').trim();
  const imageUrl = String(image || metaContent(html, 'og:image') || '').trim();
  const price = safePrice(offers.price ?? metaContent(html, 'product:price:amount'));
  const color = String(product.color || '').trim();
  const size = String(product.size || '').trim();
  let absoluteImage = '';
  try { const parsedImage = new URL(String(imageUrl || ''), finalUrl); if (parsedImage.protocol === 'https:') absoluteImage = parsedImage.href; } catch (_) {}
  const canonical = finalUrl.origin + finalUrl.pathname + finalUrl.search;
  const identityHash = crypto.createHash('sha256').update(canonical).digest('hex').slice(0, 28);
  const mutableHash = crypto.createHash('sha256').update([color, size, price || '', 1].join('|')).digest('hex').slice(0, 20);
  if (!warning && !productName && !imageUrl && price === '') {
    warning = 'فتح النظام الرابط، لكن SHEIN لم يرسل بيانات المنتج العامة. أكمل الحقول يدويًا.';
  }
  res.json({
    source: 'shein-mobile-link', product_name: productName, product_url: canonical,
    image_url: absoluteImage,
    color, size, quantity: 1, price, sku: String(product.sku || '').trim(),
    sync_key: `shein:link:v1:${identityHash}`, source_signature: `v1:${mutableHash}`,
    receipt_token: crypto.randomBytes(24).toString('hex'), import_warning: warning
  });
});

// Receives a reviewed SHEIN draft from the app UI. The extension never sends auth data.
app.post('/api/import/shein-item', requireAuth, (req, res) => {
  const body = req.body || {};
  if (!validSyncValue(body.sync_key, 300, 8) || !validSyncValue(body.source_signature) ||
      !validSyncValue(body.receipt_token, 100, 20)) {
    return res.status(400).json({ error: 'بيانات المزامنة غير صحيحة' });
  }
  const orderId = Number(body.order_id);
  const customerId = Number(body.customer_id);
  const createNewOrder = body.create_new_order === true;
  const selectedOrder = Number.isInteger(orderId) && orderId > 0
    ? db.prepare('SELECT id, customer_id FROM orders WHERE id = ? AND archived_at IS NULL').get(orderId)
    : null;
  const selectedCustomer = createNewOrder && Number.isInteger(customerId) && customerId > 0
    ? db.prepare('SELECT * FROM customers WHERE id = ?').get(customerId)
    : null;
  if (!selectedOrder && !selectedCustomer) return res.status(404).json({ error: 'اختر زبونة وطلبًا صحيحًا لإضافة القطعة' });

  const isAndroid = body.source === 'shein-android-webview';
  const targetCustomerId = selectedOrder?.customer_id || selectedCustomer?.id;
  if (!targetCustomerId || (customerId && Number(targetCustomerId) !== customerId)) {
    return res.status(400).json({ error: 'الطلب لا يتبع الزبونة المحددة' });
  }
  // Extension imports keep their historical key. Android imports are scoped to
  // the customer, so two customers requesting the same SHEIN variant stay separate.
  const storedSyncKey = isAndroid ? `${body.sync_key}:customer:${targetCustomerId}` : body.sync_key;
  if (!validSyncValue(storedSyncKey, 300, 8)) return res.status(400).json({ error: 'معرف المزامنة طويل جدًا' });
  const initialStatus = isAndroid ? 'pending_shein_cart' : 'in_cart';
  const item = {
    product_url: body.product_url,
    product_name: body.product_name,
    image_url: body.image_url,
    sku: body.sku,
    color: body.color,
    size: body.size,
    quantity: body.quantity,
    customer_unit_price: body.customer_unit_price,
    shein_unit_price: body.shein_unit_price,
    status: initialStatus
  };
  const error = validateItemInput(item);
  if (error) return res.status(400).json({ error });

  const trx = db.transaction(() => {
    const existing = db.prepare('SELECT * FROM order_items WHERE sync_key = ?').get(storedSyncKey);
    let itemId;
    if (existing) {
      itemId = existing.id;
      db.prepare(`
        UPDATE order_items SET product_url = ?, product_name = ?, image_url = ?, sku = ?,
          color = ?, size = ?, quantity = ?, customer_unit_price = ?, shein_unit_price = ?,
          source_signature = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(
        String(item.product_url || '').trim(), String(item.product_name).trim(),
        String(item.image_url || '').trim(), String(item.sku || '').trim(),
        String(item.color || '').trim(), String(item.size || '').trim(), Number(item.quantity),
        Number(item.customer_unit_price), Number(item.shein_unit_price), body.source_signature, itemId
      );
      syncOrderTotals(existing.order_id);
    } else {
      let targetOrderId = selectedOrder?.id;
      if (!targetOrderId) {
        const created = db.prepare(`INSERT INTO orders
          (customer_id, customer_name, customer_phone, order_date, currency, status)
          VALUES (?, ?, ?, DATE('now'), 'SAR', ?)`)
          .run(selectedCustomer.id, selectedCustomer.name, selectedCustomer.phone || '', initialStatus);
        targetOrderId = created.lastInsertRowid;
      }
      const info = db.prepare(`
        INSERT INTO order_items
        (order_id, product_url, product_name, image_url, sku, color, size, quantity,
         customer_unit_price, shein_unit_price, status, sync_key, source_signature)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        targetOrderId, String(item.product_url || '').trim(), String(item.product_name).trim(),
        String(item.image_url || '').trim(), String(item.sku || '').trim(),
        String(item.color || '').trim(), String(item.size || '').trim(), Number(item.quantity),
        Number(item.customer_unit_price), Number(item.shein_unit_price), initialStatus, storedSyncKey, body.source_signature
      );
      itemId = info.lastInsertRowid;
      db.prepare(`INSERT INTO order_item_status_history (item_id, old_status, new_status)
        VALUES (?, NULL, ?)`).run(itemId, initialStatus);
      syncOrderTotals(targetOrderId);
    }
    db.prepare(`INSERT OR REPLACE INTO shein_import_receipts
      (receipt_token, sync_key, source_signature, item_id) VALUES (?, ?, ?, ?)`)
      .run(body.receipt_token, storedSyncKey, body.source_signature, itemId);
    return itemId;
  });

  const itemId = trx();
  const saved = db.prepare(`SELECT i.*, o.customer_name FROM order_items i
    JOIN orders o ON o.id = i.order_id WHERE i.id = ?`).get(itemId);
  res.status(201).json(hydrateItem(saved));
});

app.post('/api/order-items/:id/confirm-shein-cart', requireAuth, (req, res) => {
  const existing = db.prepare(`SELECT i.*, o.customer_name FROM order_items i
    JOIN orders o ON o.id = i.order_id WHERE i.id = ?`).get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'القطعة غير موجودة' });
  if (!['pending_shein_cart', 'change_required', 'in_cart'].includes(existing.status)) {
    return res.status(409).json({ error: 'لا يمكن تأكيد السلة في الحالة الحالية' });
  }
  if (existing.status !== 'in_cart') {
    db.transaction(() => {
      db.prepare(`UPDATE order_items SET status = 'in_cart', shein_cart_confirmed_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(existing.id);
      db.prepare(`INSERT INTO order_item_status_history (item_id, old_status, new_status)
        VALUES (?, ?, 'in_cart')`).run(existing.id, existing.status);
      db.prepare(`UPDATE orders SET status = 'in_cart', updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND status IN ('pending_review', 'pending_shein_cart')`).run(existing.order_id);
    })();
  }
  const item = db.prepare(`SELECT i.*, o.customer_name FROM order_items i
    JOIN orders o ON o.id = i.order_id WHERE i.id = ?`).get(existing.id);
  res.json(hydrateItem(item));
});

app.post('/api/order-items/:id/customer-confirmed', requireAuth, (req, res) => {
  const info = db.prepare(`UPDATE order_items SET customer_confirmed = 1, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?`).run(req.params.id);
  if (!info.changes) return res.status(404).json({ error: 'القطعة غير موجودة' });
  res.json({ ok: true, item_id: Number(req.params.id) });
});

app.post('/api/orders', requireAuth, (req, res) => {
  const {
    customer_name, customer_phone, order_number, order_date,
    customer_value, shein_paid, customer_paid, currency, status, notes
  } = req.body || {};

  if (!customer_name || !customer_name.trim()) {
    return res.status(400).json({ error: 'اسم الزبونة مطلوب' });
  }

  const orderId = db.transaction(() => {
    const customer = getOrCreateCustomer(customer_name, customer_phone);
    const info = db.prepare(`
      INSERT INTO orders
      (customer_id, customer_name, customer_phone, order_number, order_date, customer_value, shein_paid, customer_paid, currency, status, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)
    `).run(
      customer.id, customer.name, customer_phone || customer.phone || '', order_number || '',
      order_date || new Date().toISOString().split('T')[0], parseFloat(customer_value) || 0,
      parseFloat(shein_paid) || 0, currency || 'SAR', status || 'new', notes || ''
    );
    const initialPaid = Number(customer_paid) || 0;
    if (initialPaid > 0) db.prepare(`INSERT INTO payments
      (order_id, amount, currency, payment_date, notes) VALUES (?, ?, ?, ?, ?)`)
      .run(info.lastInsertRowid, initialPaid, currency || 'SAR', order_date || new Date().toISOString().split('T')[0], 'دفعة أولى');
    syncOrderPayments(info.lastInsertRowid);
    return info.lastInsertRowid;
  })();
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
  res.json(order);
});

app.put('/api/orders/:id', requireAuth, (req, res) => {
  const id = req.params.id;
  const existing = db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'الطلب غير موجود' });

  const {
    customer_name, customer_phone, order_number, order_date,
    customer_value, shein_paid, customer_paid, currency, status, shipping_cost, shipment_id, notes
  } = req.body || {};
  const hasItems = db.prepare('SELECT EXISTS(SELECT 1 FROM order_items WHERE order_id = ?) AS found').get(id).found === 1;
  const effectiveCustomerValue = hasItems ? existing.customer_value : customer_value;
  const effectiveSheinPaid = hasItems ? existing.shein_paid : shein_paid;
  const customer = customer_name ? getOrCreateCustomer(customer_name, customer_phone) : null;

  db.prepare(`
    UPDATE orders SET
      customer_name = COALESCE(?, customer_name),
      customer_id = COALESCE(?, customer_id),
      customer_phone = COALESCE(?, customer_phone),
      order_number = COALESCE(?, order_number),
      order_date = COALESCE(?, order_date),
      customer_value = COALESCE(?, customer_value),
      shein_paid = COALESCE(?, shein_paid),
      customer_paid = customer_paid,
      currency = COALESCE(?, currency),
      status = COALESCE(?, status),
      shipping_cost = COALESCE(?, shipping_cost),
      shipment_id = COALESCE(?, shipment_id),
      notes = COALESCE(?, notes),
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(
    customer_name, customer?.id || null, customer_phone, order_number, order_date,
    effectiveCustomerValue, effectiveSheinPaid, currency, status,
    shipping_cost, shipment_id, notes,
    id
  );
  if (hasItems) syncOrderTotals(id);
  res.json(db.prepare('SELECT * FROM orders WHERE id = ?').get(id));
});

app.delete('/api/orders/:id', requireAuth, (req, res) => {
  const info = db.prepare('UPDATE orders SET archived_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: 'الطلب غير موجود' });
  res.json({ ok: true });
});

// ========== PAYMENTS ROUTES ==========
app.get('/api/orders/:orderId/payments', requireAuth, (req, res) => {
  const order = db.prepare('SELECT id FROM orders WHERE id = ?').get(req.params.orderId);
  if (!order) return res.status(404).json({ error: 'الطلب غير موجود' });
  res.json(db.prepare('SELECT * FROM payments WHERE order_id = ? ORDER BY payment_date DESC, id DESC').all(order.id));
});

app.post('/api/orders/:orderId/payments', requireAuth, (req, res) => {
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.orderId);
  if (!order) return res.status(404).json({ error: 'الطلب غير موجود' });
  const amount = Number(req.body?.amount);
  if (!Number.isFinite(amount) || amount <= 0 || amount > 1000000000) return res.status(400).json({ error: 'مبلغ الدفعة غير صحيح' });
  const currency = req.body?.currency || order.currency;
  if (!['SAR', 'YER'].includes(currency)) return res.status(400).json({ error: 'عملة الدفعة غير صحيحة' });
  const paymentId = db.transaction(() => {
    const info = db.prepare(`INSERT INTO payments (order_id, amount, currency, payment_date, notes)
      VALUES (?, ?, ?, ?, ?)`).run(order.id, amount, currency,
      req.body?.payment_date || new Date().toISOString().slice(0, 10), String(req.body?.notes || '').trim());
    syncOrderPayments(order.id);
    return info.lastInsertRowid;
  })();
  res.status(201).json(db.prepare('SELECT * FROM payments WHERE id = ?').get(paymentId));
});

// ========== SHIPMENTS ROUTES ==========
app.get('/api/shipments', requireAuth, (req, res) => {
  const shipments = db.prepare(`
    SELECT s.*,
      (SELECT COUNT(*) FROM orders o WHERE o.shipment_id = s.id) AS order_count
    FROM shipments s
    ORDER BY s.created_at DESC
  `).all();
  res.json(shipments);
});

app.get('/api/shipments/:id', requireAuth, (req, res) => {
  const shipment = db.prepare('SELECT * FROM shipments WHERE id = ?').get(req.params.id);
  if (!shipment) return res.status(404).json({ error: 'الشحنة غير موجودة' });
  const orders = db.prepare('SELECT * FROM orders WHERE shipment_id = ? ORDER BY id ASC').all(req.params.id);
  res.json({ ...shipment, orders });
});

app.post('/api/shipments', requireAuth, (req, res) => {
  const { name, total_cost, currency, distribution, status, notes, order_ids, manual_costs } = req.body || {};
  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'اسم الشحنة مطلوب' });
  }
  const orderIds = Array.isArray(order_ids) ? order_ids : [];
  if (orderIds.length === 0) {
    return res.status(400).json({ error: 'يجب إضافة طلب واحد على الأقل للشحنة' });
  }

  const trx = db.transaction(() => {
    const info = db.prepare(`
      INSERT INTO shipments (name, total_cost, currency, distribution, status, notes)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      name.trim(),
      parseFloat(total_cost) || 0,
      currency || 'SAR',
      distribution || 'equal',
      status || 'in_transit',
      notes || ''
    );
    const shipmentId = info.lastInsertRowid;

    // Link orders to shipment and distribute shipping cost
    if (distribution === 'manual' && manual_costs && typeof manual_costs === 'object') {
      const updateStmt = db.prepare(`
        UPDATE orders SET shipment_id = ?, shipping_cost = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `);
      for (const oid of orderIds) {
        const cost = parseFloat(manual_costs[oid]) || 0;
        updateStmt.run(shipmentId, cost, oid);
      }
    } else {
      // equal distribution
      const perOrderCost = (parseFloat(total_cost) || 0) / orderIds.length;
      const updateStmt = db.prepare(`
        UPDATE orders SET shipment_id = ?, shipping_cost = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `);
      for (const oid of orderIds) {
        updateStmt.run(shipmentId, perOrderCost, oid);
      }
    }
    return shipmentId;
  });

  const shipmentId = trx();
  res.json(db.prepare('SELECT * FROM shipments WHERE id = ?').get(shipmentId));
});

app.put('/api/shipments/:id', requireAuth, (req, res) => {
  const existing = db.prepare('SELECT * FROM shipments WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'الشحنة غير موجودة' });
  const allowed = new Set(['ordered_from_shein', 'arrived_saudi', 'shipped_to_yemen', 'arrived_yemen', 'completed']);
  const status = req.body?.status || existing.status;
  if (!allowed.has(status) && status !== 'in_transit') return res.status(400).json({ error: 'حالة الشحنة غير صحيحة' });
  db.prepare(`UPDATE shipments SET status = ?, saudi_arrival_date = ?, yemen_shipping_date = ?,
    yemen_arrival_date = ?, notes = ? WHERE id = ?`).run(status,
    req.body?.saudi_arrival_date ?? existing.saudi_arrival_date,
    req.body?.yemen_shipping_date ?? existing.yemen_shipping_date,
    req.body?.yemen_arrival_date ?? existing.yemen_arrival_date,
    String(req.body?.notes ?? existing.notes ?? ''), existing.id);
  res.json(db.prepare('SELECT * FROM shipments WHERE id = ?').get(existing.id));
});

app.delete('/api/shipments/:id', requireAuth, (req, res) => {
  const id = req.params.id;
  const trx = db.transaction(() => {
    db.prepare('UPDATE orders SET shipment_id = NULL, shipping_cost = 0 WHERE shipment_id = ?').run(id);
    db.prepare('DELETE FROM shipments WHERE id = ?').run(id);
  });
  trx();
  res.json({ ok: true });
});

// ========== CUSTOMERS ROUTES ==========
app.get('/api/customers', requireAuth, (req, res) => {
  const rows = db.prepare(`
    SELECT c.*,
      COUNT(o.id) AS order_count,
      COALESCE(SUM(o.customer_value), 0) AS total_value,
      COALESCE(SUM(o.customer_paid), 0) AS total_paid,
      COALESCE(SUM(o.customer_value - o.customer_paid), 0) AS total_remaining
    FROM customers c LEFT JOIN orders o ON o.customer_id = c.id AND o.archived_at IS NULL
    GROUP BY c.id ORDER BY c.name COLLATE NOCASE
  `).all();
  res.json(rows);
});

app.post('/api/customers', requireAuth, (req, res) => {
  const name = String(req.body?.name || '').trim();
  const customerType = req.body?.customer_type === 'cash' ? 'cash' : 'account';
  if (!name) return res.status(400).json({ error: 'اسم الزبونة مطلوب' });
  const duplicate = db.prepare('SELECT id FROM customers WHERE name = ? COLLATE NOCASE').get(name);
  if (duplicate) return res.status(409).json({ error: 'هذه الزبونة موجودة بالفعل', customer_id: duplicate.id });
  const info = db.prepare('INSERT INTO customers (name, phone, address, notes, customer_type) VALUES (?, ?, ?, ?, ?)')
    .run(name, String(req.body?.phone || '').trim(), String(req.body?.address || '').trim(), String(req.body?.notes || '').trim(), customerType);
  res.status(201).json(db.prepare('SELECT * FROM customers WHERE id = ?').get(info.lastInsertRowid));
});

app.put('/api/customers/:id', requireAuth, (req, res) => {
  const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(req.params.id);
  if (!customer) return res.status(404).json({ error: 'الزبونة غير موجودة' });
  const name = String(req.body?.name ?? customer.name).trim();
  if (!name) return res.status(400).json({ error: 'اسم الزبونة مطلوب' });
  try {
    db.transaction(() => {
      db.prepare(`UPDATE customers SET name = ?, phone = ?, address = ?, notes = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
        .run(name, String(req.body?.phone ?? customer.phone ?? '').trim(), String(req.body?.address ?? customer.address ?? '').trim(), String(req.body?.notes ?? customer.notes ?? '').trim(), customer.id);
      db.prepare('UPDATE orders SET customer_name = ?, customer_phone = COALESCE(NULLIF(?, \'\'), customer_phone) WHERE customer_id = ?')
        .run(name, String(req.body?.phone ?? customer.phone ?? '').trim(), customer.id);
    })();
  } catch (error) {
    if (String(error.message).includes('UNIQUE')) return res.status(409).json({ error: 'اسم الزبونة مستخدم بالفعل' });
    throw error;
  }
  res.json(db.prepare('SELECT * FROM customers WHERE id = ?').get(customer.id));
});

app.get('/api/customers/:id', requireAuth, (req, res) => {
  const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(req.params.id);
  if (!customer) return res.status(404).json({ error: 'الزبونة غير موجودة' });
  const orders = db.prepare(`
    SELECT * FROM orders WHERE customer_id = ? AND archived_at IS NULL ORDER BY order_date DESC, id DESC
  `).all(customer.id);

  const summary = db.prepare(`
    SELECT
      COUNT(*) AS order_count,
      SUM(customer_value) AS total_value,
      SUM(shein_paid) AS total_shein_paid,
      SUM(customer_value - shein_paid) AS total_commission,
      SUM(customer_paid) AS total_paid,
      SUM(shipping_cost) AS total_shipping,
      SUM(customer_value - customer_paid) AS total_remaining
    FROM orders WHERE customer_id = ? AND archived_at IS NULL
  `).get(customer.id);

  res.json({ ...customer, summary, orders });
});

// ========== DASHBOARD ROUTES ==========
app.get('/api/dashboard', requireAuth, (req, res) => {
  const all = db.prepare('SELECT * FROM orders WHERE archived_at IS NULL').all();
  const orderCount = all.length;
  const totalValue = all.reduce((s, o) => s + (o.customer_value || 0), 0);
  const totalSheinPaid = all.reduce((s, o) => s + (o.shein_paid || 0), 0);
  const totalCommission = all.reduce((s, o) => s + ((o.customer_value || 0) - (o.shein_paid || 0)), 0);
  const totalShipping = all.reduce((s, o) => s + (o.shipping_cost || 0), 0);
  const totalReceived = all.reduce((s, o) => s + (o.customer_paid || 0), 0);
  const totalRemaining = all.reduce((s, o) => s + ((o.customer_value || 0) - (o.customer_paid || 0)), 0);

  // Status breakdown
  const statusBreakdown = {};
  const statusLabels = {
    new: 'جديد',
    pending_review: 'بانتظار المراجعة',
    pending_shein_cart: 'طلبات تحتاج إكمال في SHEIN',
    in_cart: 'في سلة SHEIN',
    ordered: 'تم الطلب من SHEIN',
    shipped: 'تم الشحن',
    arrived: 'وصل',
    saudi: 'وصل السعودية',
    shipped_to_yemen: 'تم شحنه إلى اليمن',
    yemen: 'وصل اليمن',
    delivered: 'تم التسليم',
    change_required: 'يوجد تغيير — تحديث مطلوب',
    cancelled_by_customer: 'ملغاة من الزبونة',
    out_of_stock: 'نفدت من SHEIN',
    returned: 'مرتجع'
  };
  for (const s of Object.keys(statusLabels)) {
    statusBreakdown[s] = all.filter(o => o.status === s).length;
  }
  statusBreakdown.pending_shein_cart = db.prepare(`SELECT COUNT(*) AS c FROM order_items
    WHERE status = 'pending_shein_cart'`).get().c;

  // Customers count
  const customerCount = db.prepare(`
    SELECT COUNT(*) AS c FROM customers
  `).get().c;

  // Monthly report (last 12 months)
  const monthly = db.prepare(`
    SELECT
      strftime('%Y-%m', order_date) AS month,
      COUNT(*) AS order_count,
      SUM(customer_value) AS total_value,
      SUM(shein_paid) AS total_shein_paid,
      SUM(customer_value - shein_paid) AS total_commission,
      SUM(customer_paid) AS total_received
    FROM orders
    WHERE order_date IS NOT NULL AND archived_at IS NULL
    GROUP BY strftime('%Y-%m', order_date)
    ORDER BY month DESC
    LIMIT 12
  `).all();

  res.json({
    order_count: orderCount,
    customer_count: customerCount,
    total_value: totalValue,
    total_shein_paid: totalSheinPaid,
    total_commission: totalCommission,
    total_shipping: totalShipping,
    total_received: totalReceived,
    total_remaining: totalRemaining,
    status_breakdown: statusBreakdown,
    status_labels: statusLabels,
    monthly: monthly
  });
});

// ========== INVOICES & REPORTS ==========
app.get('/api/invoices/:orderId', requireAuth, (req, res) => {
  const order = db.prepare('SELECT * FROM orders WHERE id = ? AND archived_at IS NULL').get(req.params.orderId);
  if (!order) return res.status(404).json({ error: 'الطلب غير موجود' });
  const items = db.prepare('SELECT * FROM order_items WHERE order_id = ? ORDER BY id').all(order.id).map(hydrateItem);
  const payments = db.prepare('SELECT * FROM payments WHERE order_id = ? ORDER BY payment_date, id').all(order.id);
  res.json({ order, items, payments, totals: {
    total: order.customer_value,
    paid: order.customer_paid,
    remaining: order.customer_value - order.customer_paid,
    shipping: order.shipping_cost,
    commission: order.customer_value - order.shein_paid
  }});
});

app.get('/api/reports', requireAuth, (req, res) => {
  const where = ['o.archived_at IS NULL'];
  const params = [];
  if (req.query.date_from) { where.push('o.order_date >= ?'); params.push(req.query.date_from); }
  if (req.query.date_to) { where.push('o.order_date <= ?'); params.push(req.query.date_to); }
  if (req.query.customer_id) { where.push('o.customer_id = ?'); params.push(Number(req.query.customer_id)); }
  if (req.query.status) { where.push('o.status = ?'); params.push(req.query.status); }
  const clause = where.join(' AND ');
  const orders = db.prepare(`SELECT o.* FROM orders o WHERE ${clause}`).all(...params);
  const ids = orders.map(order => order.id);
  const itemRows = ids.length ? db.prepare(`SELECT oi.* FROM order_items oi WHERE oi.order_id IN (${ids.map(() => '?').join(',')})`).all(...ids) : [];
  const statusRows = db.prepare(`SELECT o.status, COUNT(*) AS count FROM orders o WHERE ${clause} GROUP BY o.status`).all(...params);
  const monthly = db.prepare(`SELECT strftime('%Y-%m', o.order_date) AS month, COUNT(*) AS order_count,
    SUM(o.customer_value) AS sales, SUM(o.customer_paid) AS paid,
    SUM(o.customer_value - o.customer_paid) AS remaining,
    SUM(o.customer_value - o.shein_paid) AS commission, SUM(o.shipping_cost) AS shipping
    FROM orders o WHERE ${clause} GROUP BY month ORDER BY month DESC`).all(...params);
  const totals = orders.reduce((sum, order) => ({
    sales: sum.sales + Number(order.customer_value || 0),
    paid: sum.paid + Number(order.customer_paid || 0),
    remaining: sum.remaining + Number(order.customer_value - order.customer_paid || 0),
    commission: sum.commission + Number(order.customer_value - order.shein_paid || 0),
    shipping: sum.shipping + Number(order.shipping_cost || 0)
  }), { sales: 0, paid: 0, remaining: 0, commission: 0, shipping: 0 });
  const dueCustomers = db.prepare(`SELECT c.id, c.name, SUM(o.customer_value - o.customer_paid) AS remaining
    FROM customers c JOIN orders o ON o.customer_id = c.id WHERE ${clause}
    GROUP BY c.id HAVING remaining > 0 ORDER BY remaining DESC`).all(...params);
  res.json({ totals, status_breakdown: statusRows, monthly, due_customers: dueCustomers,
    cancelled_items: itemRows.filter(item => item.status === 'cancelled_by_customer').map(hydrateItem),
    out_of_stock_items: itemRows.filter(item => item.status === 'out_of_stock').map(hydrateItem) });
});

// ========== EXPORT ROUTES ==========
function toCSV(rows, headers) {
  const escape = (val) => {
    if (val === null || val === undefined) return '';
    const s = String(val);
    if (s.includes(',') || s.includes('"') || s.includes('\n')) {
      return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
  };
  const lines = [headers.map(h => escape(h.label)).join(',')];
  for (const r of rows) {
    lines.push(headers.map(h => escape(h.value(r))).join(','));
  }
  return lines.join('\n');
}

const statusLabelMap = {
  new: 'جديد',
  ordered: 'تم الطلب من SHEIN',
  saudi: 'وصل السعودية',
  shipped_to_yemen: 'تم شحنه إلى اليمن',
  yemen: 'وصل اليمن',
  delivered: 'تم التسليم للزبونة'
};

app.get('/api/export/orders', requireAuth, (req, res) => {
  const orders = db.prepare('SELECT * FROM orders ORDER BY order_date DESC, id DESC').all();
  const csv = toCSV(orders, [
    { label: 'الرقم', value: r => r.id },
    { label: 'اسم الزبونة', value: r => r.customer_name },
    { label: 'رقم الهاتف', value: r => r.customer_phone },
    { label: 'رقم الطلب', value: r => r.order_number },
    { label: 'تاريخ الطلب', value: r => r.order_date },
    { label: 'قيمة الزبونة', value: r => r.customer_value },
    { label: 'العملة', value: r => r.currency },
    { label: 'المدفوع لـ SHEIN', value: r => r.shein_paid },
    { label: 'العمولة', value: r => (r.customer_value - r.shein_paid).toFixed(2) },
    { label: 'المدفوع من الزبونة', value: r => r.customer_paid },
    { label: 'المتبقي على الزبونة', value: r => (r.customer_value - r.customer_paid).toFixed(2) },
    { label: 'تكلفة الشحن', value: r => r.shipping_cost },
    { label: 'الحالة', value: r => statusLabelMap[r.status] || r.status },
    { label: 'ملاحظات', value: r => r.notes }
  ]);

  // BOM for Excel Arabic support
  const bom = '\ufeff';
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="orders-${new Date().toISOString().split('T')[0]}.csv"`);
  res.send(bom + csv);
});

app.get('/api/export/customers', requireAuth, (req, res) => {
  const customers = db.prepare(`
    SELECT
      customer_name AS name,
      MAX(customer_phone) AS phone,
      COUNT(*) AS order_count,
      SUM(customer_value) AS total_value,
      SUM(customer_paid) AS total_paid,
      SUM(customer_value - customer_paid) AS total_remaining
    FROM orders
    GROUP BY customer_name
    ORDER BY customer_name ASC
  `).all();
  const csv = toCSV(customers, [
    { label: 'اسم الزبونة', value: r => r.name },
    { label: 'رقم الهاتف', value: r => r.phone },
    { label: 'عدد الطلبات', value: r => r.order_count },
    { label: 'إجمالي قيمة الطلبات', value: r => r.total_value },
    { label: 'إجمالي المدفوع', value: r => r.total_paid },
    { label: 'إجمالي المتبقي', value: r => r.total_remaining }
  ]);
  const bom = '\ufeff';
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="customers-${new Date().toISOString().split('T')[0]}.csv"`);
  res.send(bom + csv);
});

// ========== STATIC FILES ==========
app.use(express.static(path.join(__dirname, 'public')));

// SPA fallback
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, HOST, () => {
  console.log(`✓ Server running on http://${HOST}:${PORT}`);
});
