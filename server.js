// server.js - Main Express server
const express = require('express');
const session = require('express-session');
const cookieParser = require('cookie-parser');
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');
const { db, getSetting, setSetting } = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;
const HOST = '0.0.0.0';

// Middleware
app.use(express.json({ limit: '2mb' }));
app.use(cookieParser());
app.use(session({
  secret: process.env.SESSION_SECRET || 'shein-app-secret-change-in-production-' + Math.random().toString(36),
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
    SELECT * FROM orders
    ORDER BY order_date DESC, id DESC
  `).all();
  res.json(rows);
});

app.get('/api/orders/:id', requireAuth, (req, res) => {
  const row = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'الطلب غير موجود' });
  res.json(row);
});

app.post('/api/orders', requireAuth, (req, res) => {
  const {
    customer_name, customer_phone, order_number, order_date,
    customer_value, shein_paid, customer_paid, currency, status, notes
  } = req.body || {};

  if (!customer_name || !customer_name.trim()) {
    return res.status(400).json({ error: 'اسم الزبونة مطلوب' });
  }

  const stmt = db.prepare(`
    INSERT INTO orders
    (customer_name, customer_phone, order_number, order_date, customer_value, shein_paid, customer_paid, currency, status, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const info = stmt.run(
    customer_name.trim(),
    customer_phone || '',
    order_number || '',
    order_date || new Date().toISOString().split('T')[0],
    parseFloat(customer_value) || 0,
    parseFloat(shein_paid) || 0,
    parseFloat(customer_paid) || 0,
    currency || 'SAR',
    status || 'new',
    notes || ''
  );
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(info.lastInsertRowid);
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

  db.prepare(`
    UPDATE orders SET
      customer_name = COALESCE(?, customer_name),
      customer_phone = COALESCE(?, customer_phone),
      order_number = COALESCE(?, order_number),
      order_date = COALESCE(?, order_date),
      customer_value = COALESCE(?, customer_value),
      shein_paid = COALESCE(?, shein_paid),
      customer_paid = COALESCE(?, customer_paid),
      currency = COALESCE(?, currency),
      status = COALESCE(?, status),
      shipping_cost = COALESCE(?, shipping_cost),
      shipment_id = COALESCE(?, shipment_id),
      notes = COALESCE(?, notes),
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(
    customer_name, customer_phone, order_number, order_date,
    customer_value, shein_paid, customer_paid, currency, status,
    shipping_cost, shipment_id, notes,
    id
  );
  res.json(db.prepare('SELECT * FROM orders WHERE id = ?').get(id));
});

app.delete('/api/orders/:id', requireAuth, (req, res) => {
  const info = db.prepare('DELETE FROM orders WHERE id = ?').run(req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: 'الطلب غير موجود' });
  res.json({ ok: true });
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
  const { name, total_cost, currency, distribution, notes, order_ids, manual_costs } = req.body || {};
  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'اسم الشحنة مطلوب' });
  }
  const orderIds = Array.isArray(order_ids) ? order_ids : [];
  if (orderIds.length === 0) {
    return res.status(400).json({ error: 'يجب إضافة طلب واحد على الأقل للشحنة' });
  }

  const trx = db.transaction(() => {
    const info = db.prepare(`
      INSERT INTO shipments (name, total_cost, currency, distribution, notes)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      name.trim(),
      parseFloat(total_cost) || 0,
      currency || 'SAR',
      distribution || 'equal',
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
  res.json(rows);
});

app.get('/api/customers/:name', requireAuth, (req, res) => {
  const name = decodeURIComponent(req.params.name);
  const orders = db.prepare(`
    SELECT * FROM orders WHERE customer_name = ? ORDER BY order_date DESC, id DESC
  `).all(name);
  if (orders.length === 0) return res.status(404).json({ error: 'الزبونة غير موجودة' });

  const summary = db.prepare(`
    SELECT
      COUNT(*) AS order_count,
      SUM(customer_value) AS total_value,
      SUM(shein_paid) AS total_shein_paid,
      SUM(customer_value - shein_paid) AS total_commission,
      SUM(customer_paid) AS total_paid,
      SUM(shipping_cost) AS total_shipping,
      SUM(customer_value - customer_paid) AS total_remaining
    FROM orders WHERE customer_name = ?
  `).get(name);

  res.json({ name, phone: orders[0].customer_phone, summary, orders });
});

// ========== DASHBOARD ROUTES ==========
app.get('/api/dashboard', requireAuth, (req, res) => {
  const all = db.prepare('SELECT * FROM orders').all();
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
    ordered: 'تم الطلب من SHEIN',
    saudi: 'وصل السعودية',
    shipped_to_yemen: 'تم شحنه إلى اليمن',
    yemen: 'وصل اليمن',
    delivered: 'تم التسليم للزبونة'
  };
  for (const s of Object.keys(statusLabels)) {
    statusBreakdown[s] = all.filter(o => o.status === s).length;
  }

  // Customers count
  const customerCount = db.prepare(`
    SELECT COUNT(DISTINCT customer_name) AS c FROM orders
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
    WHERE order_date IS NOT NULL
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
