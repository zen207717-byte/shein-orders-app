// ============== APP.JS - Main Application Logic ==============

const STATUS_LABELS = {
  new: 'جديد',
  pending_review: 'بانتظار المراجعة',
  pending_shein_cart: 'بانتظار الإضافة لسلة SHEIN',
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

const SHIPMENT_STATUS_LABELS = {
  ordered_from_shein: 'تم الطلب من SHEIN', arrived_saudi: 'وصلت السعودية',
  shipped_to_yemen: 'شُحنت إلى اليمن', arrived_yemen: 'وصلت اليمن',
  completed: 'مكتملة', in_transit: 'قيد الشحن'
};

const ITEM_STATUS_LABELS = {
  pending_review: 'بانتظار المراجعة',
  pending_shein_cart: 'بانتظار الإضافة لسلة SHEIN',
  in_cart: 'في سلة SHEIN',
  ordered: 'تم الطلب من SHEIN',
  shipped: 'تم الشحن',
  arrived: 'وصلت',
  delivered: 'تم التسليم',
  change_required: 'يوجد تغيير — تحديث مطلوب',
  cancelled_by_customer: 'ملغاة من الزبونة',
  out_of_stock: 'نفدت من SHEIN',
  returned: 'مرتجع'
};

const EXCLUDED_ITEM_STATUSES = new Set(['cancelled_by_customer', 'out_of_stock', 'returned']);

const CURRENCY_SYMBOLS = { SAR: 'ر.س', YER: 'ر.ي' };

let state = {
  authenticated: false,
  username: '',
  exchangeRate: 425,
  orders: [],
  shipments: [],
  customers: [],
  dashboard: null,
  currentView: 'dashboard',
  selectedShipmentOrders: new Set(),
  manualCosts: {},
  currentOrderItems: [],
  currentOrderPayments: [],
  customerFormContext: null,
  importCustomers: [],
  importOrders: [],
  importSaving: false,
  pendingSheinImport: null,
  existingSheinItem: null
};

const SHEIN_IMPORT_STORAGE_KEY = 'pendingSheinImport';

// ============== API HELPER ==============
async function api(path, options = {}) {
  const opts = {
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    ...options
  };
  if (opts.body && typeof opts.body !== 'string') {
    opts.body = JSON.stringify(opts.body);
  }
  const res = await fetch('/api' + path, opts);
  if (res.status === 401) {
    showLogin();
    throw new Error('unauthorized');
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'خطأ غير معروف' }));
    throw new Error(err.error || 'خطأ في الطلب');
  }
  return res.json();
}

// ============== TOAST ==============
let toastTimer;
function toast(msg, type = '') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = 'toast show ' + type;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.className = 'toast ' + type;
  }, 2800);
}

// ============== FORMATTERS ==============
function fmt(num, currency = 'SAR') {
  const n = parseFloat(num) || 0;
  return n.toFixed(2) + ' ' + (currency || 'SAR');
}

function fmtNum(num) {
  const n = parseFloat(num) || 0;
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDate(d) {
  if (!d) return '';
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return d;
  return dt.toLocaleDateString('ar-EG', { year: 'numeric', month: 'short', day: 'numeric' });
}

function fmtMonth(m) {
  if (!m) return '';
  const [y, mo] = m.split('-');
  const months = ['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'];
  return months[parseInt(mo) - 1] + ' ' + y;
}

function convert(amount, from, to) {
  if (from === to) return amount;
  const rate = parseFloat(state.exchangeRate) || 425;
  if (from === 'SAR' && to === 'YER') return amount * rate;
  if (from === 'YER' && to === 'SAR') return amount / rate;
  return amount;
}

// ============== AUTH ==============
function showLogin() {
  document.getElementById('login-screen').style.display = 'flex';
  document.getElementById('app-screen').style.display = 'none';
}

async function showApp(username) {
  state.authenticated = true;
  state.username = username;
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('app-screen').style.display = 'flex';
  document.getElementById('side-menu-username').textContent = username;
  document.getElementById('login-error').textContent = '';
  document.getElementById('login-username').value = '';
  document.getElementById('login-password').value = '';
  await loadAll();
  await openPendingSheinImport();
}

document.getElementById('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const username = document.getElementById('login-username').value.trim();
  const password = document.getElementById('login-password').value;
  document.getElementById('login-error').textContent = '';
  try {
    const res = await api('/auth/login', { method: 'POST', body: { username, password } });
    await showApp(res.username);
    toast('أهلاً ' + res.username, 'success');
  } catch (err) {
    document.getElementById('login-error').textContent = err.message;
  }
});

document.getElementById('logout-btn').addEventListener('click', logout);
document.getElementById('side-logout').addEventListener('click', logout);

async function logout() {
  try { await api('/auth/logout', { method: 'POST' }); } catch (e) {}
  state.authenticated = false;
  showLogin();
  toast('تم تسجيل الخروج', 'success');
}

// ============== CHECK AUTH ON LOAD ==============
(async function init() {
  try {
    const status = await api('/auth/status');
    if (status.authenticated) {
      await showApp(status.username);
    } else {
      showLogin();
    }
  } catch (e) {
    showLogin();
  }
})();

// ============== MENU & NAV ==============
document.getElementById('menu-btn').addEventListener('click', toggleMenu);
document.getElementById('menu-overlay').addEventListener('click', closeMenu);

function toggleMenu() {
  document.getElementById('side-menu').classList.toggle('open');
  document.getElementById('menu-overlay').classList.toggle('open');
}
function closeMenu() {
  document.getElementById('side-menu').classList.remove('open');
  document.getElementById('menu-overlay').classList.remove('open');
}

function switchView(view) {
  state.currentView = view;
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById('view-' + view).classList.add('active');
  document.querySelectorAll('.menu-item').forEach(m => m.classList.remove('active'));
  document.querySelectorAll(`.menu-item[data-view="${view}"]`).forEach(m => m.classList.add('active'));
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll(`.tab[data-view="${view}"]`).forEach(t => t.classList.add('active'));
  const titles = {
    dashboard: 'لوحة التحكم',
    orders: 'الطلبات',
    customers: 'الزبائن',
    shipments: 'الشحنات',
    invoices: 'الفواتير',
    reports: 'التقارير',
    settings: 'الإعدادات'
  };
  document.getElementById('topbar-title').textContent = titles[view] || '';
  closeMenu();
  if (view === 'dashboard') loadDashboard();
  if (view === 'orders') loadOrders();
  if (view === 'customers') loadCustomers();
  if (view === 'shipments') loadShipments();
  if (view === 'invoices') renderInvoices();
  if (view === 'reports') loadReports();
  if (view === 'settings') loadSettings();
}

document.querySelectorAll('[data-view]').forEach(el => {
  el.addEventListener('click', (e) => {
    e.preventDefault();
    switchView(el.dataset.view);
  });
});

// ============== LOAD ALL ==============
async function loadAll() {
  await loadSettings(false);
  await Promise.all([loadDashboard(), loadOrders(), loadCustomers(), loadShipments()]);
}

// ============== DASHBOARD ==============
async function loadDashboard() {
  try {
    const data = await api('/dashboard');
    state.dashboard = data;
    document.getElementById('stat-order-count').textContent = data.order_count;
    document.getElementById('stat-customer-count').textContent = data.customer_count;
    document.getElementById('stat-total-value').textContent = fmtNum(data.total_value);
    document.getElementById('stat-shein-paid').textContent = fmtNum(data.total_shein_paid);
    document.getElementById('stat-commission').textContent = fmtNum(data.total_commission);
    document.getElementById('stat-shipping').textContent = fmtNum(data.total_shipping);
    document.getElementById('stat-received').textContent = fmtNum(data.total_received);
    document.getElementById('stat-remaining').textContent = fmtNum(data.total_remaining);

    // Status breakdown
    const sg = document.getElementById('status-grid');
    sg.innerHTML = '';
    for (const [key, label] of Object.entries(data.status_labels)) {
      const count = data.status_breakdown[key] || 0;
      const pill = document.createElement('div');
      pill.className = 'status-pill';
      pill.innerHTML = `<span>${label}</span><span class="status-pill-count">${count}</span>`;
      sg.appendChild(pill);
    }

    // Monthly report
    const ml = document.getElementById('monthly-list');
    if (!data.monthly || data.monthly.length === 0) {
      ml.innerHTML = '<div class="empty-state">لا توجد بيانات شهرية بعد</div>';
    } else {
      ml.innerHTML = '';
      for (const m of data.monthly) {
        const item = document.createElement('div');
        item.className = 'monthly-item';
        item.innerHTML = `
          <div class="monthly-item-header">
            <span>${fmtMonth(m.month)}</span>
            <span>${m.order_count} طلب</span>
          </div>
          <div class="monthly-item-stats">
            <div>قيمة الطلبات: <span>${fmtNum(m.total_value)}</span></div>
            <div>المدفوع لـ SHEIN: <span>${fmtNum(m.total_shein_paid)}</span></div>
            <div>العمولة: <span>${fmtNum(m.total_commission)}</span></div>
            <div>المستلم: <span>${fmtNum(m.total_received)}</span></div>
          </div>
        `;
        ml.appendChild(item);
      }
    }
  } catch (e) {
    console.error('dashboard error', e);
  }
}

// ============== ORDERS ==============
async function loadOrders() {
  try {
    state.orders = await api('/orders');
    renderOrders();
    populateStatusFilter();
  } catch (e) { console.error(e); }
}

function populateStatusFilter() {
  const sel = document.getElementById('orders-status-filter');
  const current = sel.value;
  sel.innerHTML = '<option value="">جميع الحالات</option>';
  for (const [key, label] of Object.entries(STATUS_LABELS)) {
    const opt = document.createElement('option');
    opt.value = key;
    opt.textContent = label;
    sel.appendChild(opt);
  }
  sel.value = current;
}

function renderOrders() {
  const search = (document.getElementById('orders-search')?.value || '').toLowerCase();
  const statusFilter = document.getElementById('orders-status-filter')?.value || '';
  const filtered = state.orders.filter(o => {
    if (statusFilter && o.status !== statusFilter) return false;
    if (search) {
      const hay = (o.customer_name + ' ' + (o.order_number || '') + ' ' + (o.customer_phone || '')).toLowerCase();
      if (!hay.includes(search)) return false;
    }
    return true;
  });

  const list = document.getElementById('orders-list');
  if (filtered.length === 0) {
    list.innerHTML = '<div class="empty-state"><div class="empty-state-icon">📦</div>لا توجد طلبات. أضف طلبك الأول!</div>';
    return;
  }
  list.innerHTML = '';
  for (const o of filtered) {
    const commission = (o.customer_value - o.shein_paid);
    const remaining = (o.customer_value - o.customer_paid);
    const card = document.createElement('div');
    card.className = 'order-card';
    card.innerHTML = `
      <div class="order-card-header">
        <div class="order-card-name">${escapeHtml(o.customer_name)}</div>
        <div class="order-card-date">${fmtDate(o.order_date)}</div>
      </div>
      <div class="order-card-status status-${o.status}">${STATUS_LABELS[o.status] || o.status}</div>
      <div class="order-card-items">🧾 ${o.item_count || 0} قطعة</div>
      <div class="order-card-row"><span>رقم الطلب:</span><strong>${escapeHtml(o.order_number || '-')}</strong></div>
      <div class="order-card-row"><span>قيمة الزبونة:</span><strong>${fmt(o.customer_value, o.currency)}</strong></div>
      <div class="order-card-row"><span>المدفوع لـ SHEIN:</span><strong>${fmt(o.shein_paid, o.currency)}</strong></div>
      <div class="order-card-row"><span>العمولة:</span><strong class="text-success">${fmt(commission, o.currency)}</strong></div>
      <div class="order-card-row"><span>المدفوع من الزبونة:</span><strong class="text-success">${fmt(o.customer_paid, o.currency)}</strong></div>
      <div class="order-card-row"><span>المتبقي:</span><strong class="text-danger">${fmt(remaining, o.currency)}</strong></div>
      <div class="order-card-actions">
        <button class="btn btn-outline btn-sm" onclick="openOrderModal('${o.id}')">✏️ تعديل</button>
        <button class="btn btn-outline btn-sm" onclick="openInvoice(${o.id})">🧾 فاتورة</button>
        <button class="btn btn-danger btn-sm" onclick="deleteOrder(${o.id})">أرشفة</button>
      </div>
    `;
    list.appendChild(card);
  }
}

document.getElementById('orders-search').addEventListener('input', renderOrders);
document.getElementById('orders-status-filter').addEventListener('change', renderOrders);

document.getElementById('add-order-btn').addEventListener('click', () => openOrderModal(null));
document.getElementById('import-shein-link-btn').addEventListener('click', () => {
  document.getElementById('shein-link-form').reset();
  document.getElementById('shein-link-error').textContent = '';
  document.getElementById('shein-link-modal').style.display = 'flex';
});
document.getElementById('export-orders-btn').addEventListener('click', () => {
  window.location.href = '/api/export/orders';
});

// ============== ORDER MODAL ==============
function openOrderModal(orderId) {
  const modal = document.getElementById('order-modal');
  const form = document.getElementById('order-form');
  form.reset();
  document.getElementById('order-id').value = '';
  document.getElementById('order-date').value = new Date().toISOString().split('T')[0];
  state.currentOrderItems = [];
  document.getElementById('order-items-section').style.display = 'none';
  document.getElementById('order-payments-section').style.display = 'none';
  document.getElementById('new-order-items-note').style.display = 'none';
  setOrderTotalsReadonly(false);

  // Populate status select
  const sel = document.getElementById('order-status');
  sel.innerHTML = '';
  for (const [key, label] of Object.entries(STATUS_LABELS)) {
    const opt = document.createElement('option');
    opt.value = key;
    opt.textContent = label;
    sel.appendChild(opt);
  }

  if (orderId) {
    document.getElementById('order-modal-title').textContent = 'تعديل الطلب';
    const o = state.orders.find(x => String(x.id) === String(orderId));
    if (o) {
      document.getElementById('order-id').value = o.id;
      document.getElementById('order-customer-name').value = o.customer_name;
      document.getElementById('order-customer-phone').value = o.customer_phone || '';
      document.getElementById('order-number').value = o.order_number || '';
      document.getElementById('order-date').value = o.order_date || '';
      document.getElementById('order-currency').value = o.currency || 'SAR';
      document.getElementById('order-customer-value').value = o.customer_value || '';
      document.getElementById('order-shein-paid').value = o.shein_paid || '';
      document.getElementById('order-customer-paid').value = o.customer_paid || '';
      document.getElementById('order-status').value = o.status || 'new';
      document.getElementById('order-notes').value = o.notes || '';
      loadOrderItems(o.id);
      loadOrderPayments(o.id);
    }
  } else {
    document.getElementById('order-modal-title').textContent = 'إضافة طلب جديد';
    document.getElementById('order-status').value = 'new';
    document.getElementById('order-items-section').style.display = 'none';
    document.getElementById('new-order-items-note').style.display = 'block';
    setOrderTotalsReadonly(false);
  }
  updateAutoCalc();
  modal.style.display = 'flex';
}

function setOrderTotalsReadonly(hasItems) {
  document.getElementById('order-customer-value').readOnly = hasItems;
  document.getElementById('order-shein-paid').readOnly = hasItems;
  document.getElementById('items-total-note').style.display = hasItems ? 'block' : 'none';
}

async function loadOrderItems(orderId) {
  try {
    state.currentOrderItems = await api('/orders/' + orderId + '/items');
    document.getElementById('order-items-section').style.display = 'block';
    document.getElementById('new-order-items-note').style.display = 'none';
    renderOrderItems();
    const hasItems = state.currentOrderItems.length > 0;
    setOrderTotalsReadonly(hasItems);
    if (hasItems) {
      const customerTotal = state.currentOrderItems.reduce((sum, item) => sum + item.customer_total, 0);
      const sheinTotal = state.currentOrderItems.reduce((sum, item) => sum + item.shein_total, 0);
      document.getElementById('order-customer-value').value = customerTotal.toFixed(2);
      document.getElementById('order-shein-paid').value = sheinTotal.toFixed(2);
      updateAutoCalc();
    }
  } catch (err) {
    toast(err.message, 'error');
  }
}

function renderOrderItems() {
  const list = document.getElementById('order-items-list');
  if (state.currentOrderItems.length === 0) {
    list.innerHTML = '<div class="empty-items">لا توجد قطع داخل هذا الطلب بعد.</div>';
    return;
  }
  list.innerHTML = state.currentOrderItems.map(item => {
    const image = item.image_url
      ? `<img src="${escapeHtml(item.image_url)}" alt="" loading="lazy" onerror="this.parentElement.classList.add('image-failed');this.remove()">`
      : '<span>🛍️</span>';
    const statusClass = EXCLUDED_ITEM_STATUSES.has(item.status) ? ' item-card-excluded' : '';
    return `
      <article class="item-card${statusClass}">
        <div class="item-card-image">${image}</div>
        <div class="item-card-content">
          <div class="item-card-top"><strong>${escapeHtml(item.product_name)}</strong><span class="item-status status-item-${item.status}">${ITEM_STATUS_LABELS[item.status]}</span></div>
          <div class="item-meta">${escapeHtml(item.color || 'بدون لون')} • ${escapeHtml(item.size || 'بدون مقاس')} • الكمية: ${item.quantity}</div>
          ${item.sku ? `<div class="item-meta">SKU: ${escapeHtml(item.sku)}</div>` : ''}
          ${item.status === 'cancelled_by_customer' && item.cancellation_reason ? `<div class="item-cancel-reason">سبب الإلغاء: ${escapeHtml(item.cancellation_reason)}</div>` : ''}
          <div class="item-prices"><span>للزبونة: <b>${fmt(item.customer_total, document.getElementById('order-currency').value)}</b></span><span>SHEIN: <b>${fmt(item.shein_total, document.getElementById('order-currency').value)}</b></span><span class="text-success">الربح: <b>${fmt(item.commission, document.getElementById('order-currency').value)}</b></span></div>
          <div class="item-card-actions">
            ${item.product_url ? `<a class="btn btn-outline btn-sm" href="${escapeHtml(item.product_url)}" target="_blank" rel="noopener noreferrer">فتح الرابط</a>` : ''}
            <button type="button" class="btn btn-outline btn-sm" onclick="openItemModal(${item.id})">تعديل القطعة</button>
          </div>
        </div>
      </article>`;
  }).join('');
}

document.getElementById('add-item-btn').addEventListener('click', () => openItemModal(null));

function openItemModal(itemId) {
  const orderId = document.getElementById('order-id').value;
  if (!orderId) return toast('احفظ الطلب أولًا', 'warning');
  document.getElementById('item-form').reset();
  document.getElementById('item-id').value = '';
  document.getElementById('item-quantity').value = '1';
  const statusSelect = document.getElementById('item-status');
  statusSelect.innerHTML = Object.entries(ITEM_STATUS_LABELS)
    .map(([value, label]) => `<option value="${value}">${label}</option>`).join('');
  if (itemId) {
    const item = state.currentOrderItems.find(x => String(x.id) === String(itemId));
    if (!item) return;
    document.getElementById('item-modal-title').textContent = 'تعديل القطعة';
    document.getElementById('item-id').value = item.id;
    document.getElementById('item-product-url').value = item.product_url || '';
    document.getElementById('item-product-name').value = item.product_name || '';
    document.getElementById('item-image-url').value = item.image_url || '';
    document.getElementById('item-sku').value = item.sku || '';
    document.getElementById('item-color').value = item.color || '';
    document.getElementById('item-size').value = item.size || '';
    document.getElementById('item-quantity').value = item.quantity;
    document.getElementById('item-customer-price').value = item.customer_unit_price;
    document.getElementById('item-shein-price').value = item.shein_unit_price;
    document.getElementById('item-status').value = item.status;
    document.getElementById('item-cancellation-reason').value = item.cancellation_reason || '';
  } else {
    document.getElementById('item-modal-title').textContent = 'إضافة قطعة';
    document.getElementById('item-status').value = 'in_cart';
  }
  updateItemCalc();
  updateItemImagePreview();
  document.getElementById('item-modal').style.display = 'flex';
}

['item-quantity', 'item-customer-price', 'item-shein-price', 'item-status'].forEach(id => {
  document.getElementById(id).addEventListener('input', updateItemCalc);
  document.getElementById(id).addEventListener('change', updateItemCalc);
});
document.getElementById('item-image-url').addEventListener('input', updateItemImagePreview);

function updateItemCalc() {
  const quantity = parseInt(document.getElementById('item-quantity').value, 10) || 0;
  const customerPrice = parseFloat(document.getElementById('item-customer-price').value) || 0;
  const sheinPrice = parseFloat(document.getElementById('item-shein-price').value) || 0;
  const excluded = EXCLUDED_ITEM_STATUSES.has(document.getElementById('item-status').value);
  const customerTotal = excluded ? 0 : quantity * customerPrice;
  const sheinTotal = excluded ? 0 : quantity * sheinPrice;
  document.getElementById('item-customer-total').textContent = customerTotal.toFixed(2);
  document.getElementById('item-shein-total').textContent = sheinTotal.toFixed(2);
  document.getElementById('item-commission').textContent = (customerTotal - sheinTotal).toFixed(2);
  document.getElementById('item-excluded-warning').style.display = excluded ? 'block' : 'none';
  document.getElementById('item-cancellation-group').style.display =
    document.getElementById('item-status').value === 'cancelled_by_customer' ? 'block' : 'none';
}

function updateItemImagePreview() {
  const url = document.getElementById('item-image-url').value.trim();
  const preview = document.getElementById('item-image-preview');
  preview.style.display = url ? 'flex' : 'none';
  preview.innerHTML = url ? `<img src="${escapeHtml(url)}" alt="معاينة صورة المنتج" onerror="this.parentElement.style.display='none'">` : '';
}

document.getElementById('item-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const itemId = document.getElementById('item-id').value;
  const orderId = document.getElementById('order-id').value;
  const data = {
    product_url: document.getElementById('item-product-url').value.trim(),
    product_name: document.getElementById('item-product-name').value.trim(),
    image_url: document.getElementById('item-image-url').value.trim(),
    sku: document.getElementById('item-sku').value.trim(),
    color: document.getElementById('item-color').value.trim(),
    size: document.getElementById('item-size').value.trim(),
    quantity: parseInt(document.getElementById('item-quantity').value, 10),
    customer_unit_price: parseFloat(document.getElementById('item-customer-price').value),
    shein_unit_price: parseFloat(document.getElementById('item-shein-price').value),
    status: document.getElementById('item-status').value,
    cancellation_reason: document.getElementById('item-cancellation-reason').value.trim()
  };
  try {
    if (itemId) await api('/order-items/' + itemId, { method: 'PUT', body: data });
    else await api('/orders/' + orderId + '/items', { method: 'POST', body: data });
    closeModal('item-modal');
    await loadOrderItems(orderId);
    await Promise.all([loadOrders(), loadDashboard(), loadCustomers()]);
    toast(itemId ? 'تم تحديث القطعة' : 'تمت إضافة القطعة', 'success');
  } catch (err) {
    toast(err.message, 'error');
  }
});

async function loadOrderPayments(orderId) {
  try {
    state.currentOrderPayments = await api('/orders/' + orderId + '/payments');
    const section = document.getElementById('order-payments-section');
    section.style.display = 'block';
    const list = document.getElementById('order-payments-list');
    list.innerHTML = state.currentOrderPayments.length ? state.currentOrderPayments.map(p => `
      <div class="payment-row"><span>${fmtDate(p.payment_date)}${p.notes ? ' — ' + escapeHtml(p.notes) : ''}</span><strong>${fmt(p.amount, p.currency)}</strong></div>`).join('')
      : '<div class="empty-items">لا توجد دفعات مسجلة.</div>';
  } catch (err) { toast(err.message, 'error'); }
}

document.getElementById('add-payment-btn').addEventListener('click', () => {
  if (!document.getElementById('order-id').value) return toast('احفظ الطلب أولًا', 'warning');
  document.getElementById('payment-form').reset();
  document.getElementById('payment-date').value = new Date().toISOString().split('T')[0];
  document.getElementById('payment-currency').value = document.getElementById('order-currency').value;
  document.getElementById('payment-modal').style.display = 'flex';
});

document.getElementById('payment-form').addEventListener('submit', async event => {
  event.preventDefault();
  const orderId = document.getElementById('order-id').value;
  try {
    await api('/orders/' + orderId + '/payments', { method: 'POST', body: {
      amount: Number(document.getElementById('payment-amount').value),
      currency: document.getElementById('payment-currency').value,
      payment_date: document.getElementById('payment-date').value,
      notes: document.getElementById('payment-notes').value.trim()
    }});
    closeModal('payment-modal');
    await Promise.all([loadOrderPayments(orderId), loadOrders(), loadDashboard(), loadCustomers()]);
    const refreshed = state.orders.find(o => String(o.id) === String(orderId));
    if (refreshed) document.getElementById('order-customer-paid').value = refreshed.customer_paid;
    updateAutoCalc();
    toast('تم تسجيل الدفعة', 'success');
  } catch (err) { toast(err.message, 'error'); }
});

function decodeImportPayload(value) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const bytes = Uint8Array.from(atob(normalized), char => char.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes));
}

function captureSheinImportDraft() {
  const hashPrefix = '#shein-import=';
  const queryPayload = location.pathname === '/import/shein'
    ? new URLSearchParams(location.search).get('data')
    : null;
  const encoded = queryPayload || (location.hash.startsWith(hashPrefix) ? location.hash.slice(hashPrefix.length) : null);
  if (!encoded) return;
  try {
    sessionStorage.setItem(SHEIN_IMPORT_STORAGE_KEY, JSON.stringify(decodeImportPayload(encoded)));
  } catch (_) {
    sessionStorage.removeItem(SHEIN_IMPORT_STORAGE_KEY);
  }
  history.replaceState(null, '', '/');
}

async function openPendingSheinImport() {
  if (!state.authenticated) return;
  const stored = sessionStorage.getItem(SHEIN_IMPORT_STORAGE_KEY);
  if (!stored) return;
  try {
    const payload = JSON.parse(stored);
    state.pendingSheinImport = payload;
    await openSheinImportPreview(payload);
  } catch (_) {
    sessionStorage.removeItem(SHEIN_IMPORT_STORAGE_KEY);
    toast('تعذر قراءة بيانات القطعة من الإضافة', 'error');
  }
}

captureSheinImportDraft();

async function fetchExistingSheinItem(syncKey) {
  if (!syncKey) return null;
  const response = await fetch('/api/import/shein-item/' + encodeURIComponent(syncKey), {
    credentials: 'include'
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error('تعذر التحقق من حالة القطعة المحفوظة');
  return response.json();
}

function importChanges(existing, incoming) {
  if (!existing) return [];
  const fields = [
    ['اللون', 'color'], ['المقاس', 'size'], ['الكمية', 'quantity'],
    ['السعر', 'customer_unit_price', 'price']
  ];
  return fields.flatMap(([label, oldKey, newKey = oldKey]) => {
    const before = String(existing[oldKey] ?? '').trim();
    const after = String(incoming[newKey] ?? '').trim();
    return before !== after ? [`${label}: ${before || 'فارغ'} ← ${after || 'فارغ'}`] : [];
  });
}

async function openSheinImportPreview(item) {
  const existing = await fetchExistingSheinItem(item.sync_key);
  state.existingSheinItem = existing;
  document.getElementById('import-product-name').value = item.product_name || '';
  document.getElementById('import-product-url').value = item.product_url || '';
  document.getElementById('import-image-url').value = item.image_url || '';
  document.getElementById('import-color').value = item.color || '';
  document.getElementById('import-size').value = item.size || '';
  document.getElementById('import-quantity').value = Number.isInteger(Number(item.quantity)) && Number(item.quantity) > 0 ? Number(item.quantity) : 1;
  document.getElementById('import-sku').value = item.sku || '';
  document.getElementById('import-customer-price').value = Number.isFinite(Number(item.price)) ? Number(item.price) : '';
  document.getElementById('import-shein-price').value = Number.isFinite(Number(item.price)) ? Number(item.price) : '';
  const changes = importChanges(existing, item);
  const alert = document.getElementById('import-alert');
  if (existing && changes.length) {
    alert.innerHTML = '<strong>تحديث القطعة المحفوظة نفسها بعد مراجعتك:</strong><br>' + changes.map(escapeHtml).join('<br>');
  } else if (existing) {
    alert.textContent = 'هذه القطعة محفوظة ومتزامنة بالفعل. لن يتم إنشاء نسخة مكررة.';
  } else {
    alert.textContent = item.import_warning || 'راجع البيانات واختر الطلب قبل الحفظ. الحقول غير المقروءة تُترك فارغة.';
  }
  await refreshImportCustomerList(existing);
  updateImportImagePreview();
  document.getElementById('shein-import-modal').style.display = 'flex';
}

document.getElementById('shein-link-form').addEventListener('submit', async event => {
  event.preventDefault();
  const url = document.getElementById('shein-link-url').value.trim();
  const error = document.getElementById('shein-link-error');
  const button = document.getElementById('shein-link-submit');
  error.textContent = '';
  button.disabled = true;
  button.textContent = 'جارٍ قراءة الرابط…';
  try {
    const payload = await api('/import/shein-link', { method: 'POST', body: { url } });
    state.pendingSheinImport = payload;
    sessionStorage.setItem(SHEIN_IMPORT_STORAGE_KEY, JSON.stringify(payload));
    closeModal('shein-link-modal');
    await openSheinImportPreview(payload);
  } catch (err) {
    error.textContent = err.message;
  } finally {
    button.disabled = false;
    button.textContent = 'فتح شاشة المراجعة';
  }
});

function renderImportOrders(customerId, preferredOrderId = '') {
  const orderSelect = document.getElementById('import-order-id');
  const customer = state.importCustomers.find(c => String(c.id) === String(customerId));
  const orders = state.importOrders.filter(order => String(order.customer_id) === String(customerId));
  orderSelect.innerHTML = '<option value="new">➕ إنشاء طلب جديد</option>' + orders.map(order =>
    `<option value="${order.id}">${escapeHtml(order.order_number || ('طلب #' + order.id))} — ${STATUS_LABELS[order.status] || order.status}</option>`
  ).join('');
  orderSelect.value = preferredOrderId && orders.some(order => String(order.id) === String(preferredOrderId))
    ? String(preferredOrderId) : (orders[0] ? String(orders[0].id) : 'new');
  document.getElementById('import-order-help').textContent = orders.length
    ? `لدى ${customer ? customer.name : 'الزبونة'} ${orders.length} طلب. يمكنك اختيار أحدها أو إنشاء طلب جديد.`
    : 'لا يوجد لهذه الزبونة طلب بعد؛ سيتم إنشاء طلب جديد عند تأكيد حفظ القطعة.';
}

async function refreshImportCustomerList(existing = state.existingSheinItem) {
  const customerSelect = document.getElementById('import-customer-id');
  const previousCustomer = customerSelect.value;
  const previousOrder = document.getElementById('import-order-id').value;
  const [customers, orders] = await Promise.all([api('/customers'), api('/orders')]);
  state.importCustomers = customers;
  state.importOrders = orders;
  state.customers = customers;
  state.orders = orders;
  customerSelect.innerHTML = '<option value="">اختر الزبونة</option>' + customers.map(customer =>
    `<option value="${customer.id}">${escapeHtml(customer.name)}${Number(customer.order_count) === 0 ? ' — بدون طلب' : ''}</option>`
  ).join('');
  let selectedCustomer = previousCustomer;
  if (existing) {
    const existingOrder = orders.find(order => String(order.id) === String(existing.order_id));
    selectedCustomer = existingOrder?.customer_id || '';
  }
  if (!customers.some(customer => String(customer.id) === String(selectedCustomer))) selectedCustomer = '';
  customerSelect.value = String(selectedCustomer || '');
  customerSelect.disabled = Boolean(existing);
  document.getElementById('import-order-id').disabled = Boolean(existing);
  document.getElementById('import-add-customer-btn').style.display = existing ? 'none' : 'inline-flex';
  if (selectedCustomer) renderImportOrders(selectedCustomer, existing?.order_id || previousOrder);
  else {
    document.getElementById('import-order-id').innerHTML = '<option value="">اختر الزبونة أولًا</option>';
    document.getElementById('import-order-help').textContent = customers.length ? '' : 'لا توجد زبائن بعد. أضف زبونة جديدة للمتابعة.';
  }
}

function updateImportImagePreview() {
  const url = document.getElementById('import-image-url').value.trim();
  const preview = document.getElementById('import-image-preview');
  preview.style.display = url ? 'flex' : 'none';
  preview.innerHTML = url ? `<img src="${escapeHtml(url)}" alt="معاينة صورة المنتج" onerror="this.parentElement.style.display='none'">` : '';
}
document.getElementById('import-image-url').addEventListener('input', updateImportImagePreview);
document.getElementById('import-add-customer-btn').addEventListener('click', () => openCustomerForm('import'));
document.getElementById('import-refresh-list-btn').addEventListener('click', async () => {
  try { await refreshImportCustomerList(); toast('تم تحديث قائمة الزبائن', 'success'); }
  catch (err) { toast(err.message, 'error'); }
});
document.getElementById('import-customer-id').addEventListener('change', event => renderImportOrders(event.target.value));

document.getElementById('shein-import-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (state.importSaving) return;
  const customerId = document.getElementById('import-customer-id').value;
  let orderId = document.getElementById('import-order-id').value;
  if (!customerId) return toast('اختر الزبونة أولًا', 'error');
  state.importSaving = true;
  const submitButton = event.submitter || event.target.querySelector('button[type="submit"]');
  if (submitButton) submitButton.disabled = true;
  try {
    const body = {
    order_id: orderId === 'new' ? null : Number(orderId),
    customer_id: Number(customerId),
    create_new_order: orderId === 'new',
    product_name: document.getElementById('import-product-name').value.trim(),
    product_url: document.getElementById('import-product-url').value.trim(),
    image_url: document.getElementById('import-image-url').value.trim(),
    color: document.getElementById('import-color').value.trim(),
    size: document.getElementById('import-size').value.trim(),
    quantity: Number(document.getElementById('import-quantity').value),
    sku: document.getElementById('import-sku').value.trim(),
    customer_unit_price: Number(document.getElementById('import-customer-price').value),
    shein_unit_price: Number(document.getElementById('import-shein-price').value),
    sync_key: state.pendingSheinImport?.sync_key,
    source_signature: state.pendingSheinImport?.source_signature,
    receipt_token: state.pendingSheinImport?.receipt_token,
    source: state.pendingSheinImport?.source || ''
  };
    const saved = await api('/import/shein-item', { method: 'POST', body });
    const nativePayload = {
      ...saved,
      product_name: body.product_name, product_url: body.product_url, image_url: body.image_url,
      color: body.color, size: body.size, quantity: body.quantity,
      price: body.customer_unit_price, sku: body.sku,
      source_signature: body.source_signature
    };
    if (window.UmMarwanBridge && typeof window.UmMarwanBridge.onOrderSaved === 'function') {
      window.UmMarwanBridge.onOrderSaved(JSON.stringify(nativePayload));
    }
    state.pendingSheinImport = null;
    sessionStorage.removeItem(SHEIN_IMPORT_STORAGE_KEY);
    state.existingSheinItem = saved;
    closeModal('shein-import-modal');
    await Promise.all([loadOrders(), loadDashboard(), loadCustomers()]);
    toast(body.source === 'shein-android-webview'
      ? 'تم حفظ طلب الزبون. باقي إضافة القطعة إلى سلة SHEIN.'
      : 'تم حفظ قطعة SHEIN داخل الطلب بحالة في السلة', 'success');
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    state.importSaving = false;
    if (submitButton) submitButton.disabled = false;
  }
});

// Called only by the trusted Android WebView after an explicit/verified cart action.
window.__umMarwanConfirmSheinCart = async itemId => {
  try {
    const item = await api(`/order-items/${Number(itemId)}/confirm-shein-cart`, { method: 'POST' });
    await Promise.all([loadOrders(), loadDashboard()]);
    if (window.UmMarwanBridge && typeof window.UmMarwanBridge.onCartConfirmed === 'function') {
      window.UmMarwanBridge.onCartConfirmed(JSON.stringify(item));
    }
    return true;
  } catch (error) {
    toast(error.message, 'error');
    return false;
  }
};

window.__umMarwanMarkCustomerConfirmed = async itemId => {
  await api(`/order-items/${Number(itemId)}/customer-confirmed`, { method: 'POST' });
  toast('تم تسجيل تأكيد الزبون', 'success');
};

function closeModal(id) {
  document.getElementById(id).style.display = 'none';
}

document.querySelectorAll('[data-close]').forEach(btn => {
  btn.addEventListener('click', () => closeModal(btn.dataset.close));
});
document.querySelectorAll('.modal-backdrop').forEach(bd => {
  bd.addEventListener('click', () => {
    const modal = bd.closest('.modal');
    if (modal) modal.style.display = 'none';
  });
});

// Auto-calc on inputs
['order-customer-value', 'order-shein-paid', 'order-customer-paid', 'order-currency'].forEach(id => {
  document.getElementById(id).addEventListener('input', updateAutoCalc);
  document.getElementById(id).addEventListener('change', updateAutoCalc);
});

function updateAutoCalc() {
  const cv = parseFloat(document.getElementById('order-customer-value').value) || 0;
  const sp = parseFloat(document.getElementById('order-shein-paid').value) || 0;
  const cp = parseFloat(document.getElementById('order-customer-paid').value) || 0;
  const commission = cv - sp;
  const rate = cv > 0 ? (commission / cv * 100) : 0;
  const remaining = cv - cp;
  document.getElementById('auto-commission').textContent = commission.toFixed(2);
  document.getElementById('auto-commission-rate').textContent = rate.toFixed(1) + '%';
  document.getElementById('auto-remaining').textContent = remaining.toFixed(2);
}

document.getElementById('order-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = document.getElementById('order-id').value;
  const data = {
    customer_name: document.getElementById('order-customer-name').value.trim(),
    customer_phone: document.getElementById('order-customer-phone').value.trim(),
    order_number: document.getElementById('order-number').value.trim(),
    order_date: document.getElementById('order-date').value,
    currency: document.getElementById('order-currency').value,
    customer_value: parseFloat(document.getElementById('order-customer-value').value) || 0,
    shein_paid: parseFloat(document.getElementById('order-shein-paid').value) || 0,
    customer_paid: parseFloat(document.getElementById('order-customer-paid').value) || 0,
    status: document.getElementById('order-status').value,
    notes: document.getElementById('order-notes').value.trim()
  };
  try {
    if (id) {
      await api('/orders/' + id, { method: 'PUT', body: data });
      toast('تم تحديث الطلب', 'success');
    } else {
      const created = await api('/orders', { method: 'POST', body: data });
      toast('تم حفظ الطلب، أضف القطع الآن', 'success');
      await loadOrders();
      openOrderModal(created.id);
      return;
    }
    closeModal('order-modal');
    await loadOrders();
    await loadDashboard();
    await loadCustomers();
  } catch (err) {
    toast(err.message, 'error');
  }
});

async function deleteOrder(id) {
  if (!confirm('هل تريد أرشفة هذا الطلب؟ سيبقى محفوظًا في قاعدة البيانات.')) return;
  try {
    await api('/orders/' + id, { method: 'DELETE' });
    toast('تمت أرشفة الطلب بدون حذف سجلاته', 'success');
    await loadOrders();
    await loadDashboard();
    await loadCustomers();
  } catch (err) {
    toast(err.message, 'error');
  }
}

// ============== CUSTOMERS ==============
async function loadCustomers() {
  try {
    state.customers = await api('/customers');
    renderCustomers();
  } catch (e) { console.error(e); }
}

function renderCustomers() {
  const search = (document.getElementById('customers-search')?.value || '').toLowerCase();
  const filtered = state.customers.filter(c => {
    if (!search) return true;
    return (c.name + ' ' + (c.phone || '')).toLowerCase().includes(search);
  });
  const list = document.getElementById('customers-list');
  if (filtered.length === 0) {
    list.innerHTML = '<div class="empty-state"><div class="empty-state-icon">👥</div>لا توجد زبائن بعد</div>';
    return;
  }
  list.innerHTML = '';
  for (const c of filtered) {
    const card = document.createElement('div');
    card.className = 'customer-card';
    card.onclick = () => openCustomerModal(c.id);
    card.innerHTML = `
      <div class="customer-card-name">${escapeHtml(c.name)} <small>${c.customer_type === 'cash' ? 'كاش' : 'بحساب'}</small></div>
      <div class="customer-card-phone">${escapeHtml(c.phone || 'لا يوجد رقم')}</div>
      <div class="customer-card-stats">
        <div class="customer-card-stat">
          <div class="customer-card-stat-value">${c.order_count}</div>
          <div class="customer-card-stat-label">طلب</div>
        </div>
        <div class="customer-card-stat">
          <div class="customer-card-stat-value">${fmtNum(c.total_paid)}</div>
          <div class="customer-card-stat-label">مدفوع</div>
        </div>
        <div class="customer-card-stat">
          <div class="customer-card-stat-value customer-card-remaining">${fmtNum(c.total_remaining)}</div>
          <div class="customer-card-stat-label">متبقي</div>
        </div>
      </div>
    `;
    list.appendChild(card);
  }
}

document.getElementById('customers-search').addEventListener('input', renderCustomers);
document.getElementById('add-customer-btn').addEventListener('click', () => openCustomerForm(null));
document.getElementById('export-customers-btn').addEventListener('click', () => {
  window.location.href = '/api/export/customers';
});

async function openCustomerModal(id) {
  try {
    const data = await api('/customers/' + id);
    document.getElementById('customer-modal-title').textContent = 'تفاصيل: ' + data.name;
    const summary = document.getElementById('customer-summary');
    const s = data.summary;
    summary.innerHTML = `
      <div class="customer-summary-name">${escapeHtml(data.name)}</div>
      <div class="customer-summary-phone">${escapeHtml(data.phone || 'لا يوجد رقم')}</div>
      <div class="customer-summary-stats">
        <div class="customer-summary-stat">
          <div class="customer-summary-stat-label">عدد الطلبات</div>
          <div class="customer-summary-stat-value">${s.order_count}</div>
        </div>
        <div class="customer-summary-stat">
          <div class="customer-summary-stat-label">إجمالي القيمة</div>
          <div class="customer-summary-stat-value">${fmtNum(s.total_value)}</div>
        </div>
        <div class="customer-summary-stat">
          <div class="customer-summary-stat-label">المدفوع لـ SHEIN</div>
          <div class="customer-summary-stat-value">${fmtNum(s.total_shein_paid)}</div>
        </div>
        <div class="customer-summary-stat">
          <div class="customer-summary-stat-label">إجمالي العمولات</div>
          <div class="customer-summary-stat-value">${fmtNum(s.total_commission)}</div>
        </div>
        <div class="customer-summary-stat">
          <div class="customer-summary-stat-label">ما دفعته</div>
          <div class="customer-summary-stat-value">${fmtNum(s.total_paid)}</div>
        </div>
        <div class="customer-summary-stat">
          <div class="customer-summary-stat-label">المتبقي عليها</div>
          <div class="customer-summary-stat-value">${fmtNum(s.total_remaining)}</div>
        </div>
      </div>
    `;
    const list = document.getElementById('customer-orders');
    list.innerHTML = '';
    for (const o of data.orders) {
      const card = document.createElement('div');
      card.className = 'order-card';
      const commission = o.customer_value - o.shein_paid;
      const remaining = o.customer_value - o.customer_paid;
      card.innerHTML = `
        <div class="order-card-header">
          <div class="order-card-name">${escapeHtml(o.order_number || ('طلب #' + o.id))}</div>
          <div class="order-card-date">${fmtDate(o.order_date)}</div>
        </div>
        <div class="order-card-status status-${o.status}">${STATUS_LABELS[o.status] || o.status}</div>
        <div class="order-card-row"><span>قيمة الطلب:</span><strong>${fmt(o.customer_value, o.currency)}</strong></div>
        <div class="order-card-row"><span>المدفوع لـ SHEIN:</span><strong>${fmt(o.shein_paid, o.currency)}</strong></div>
        <div class="order-card-row"><span>العمولة:</span><strong class="text-success">${fmt(commission, o.currency)}</strong></div>
        <div class="order-card-row"><span>المتبقي:</span><strong class="text-danger">${fmt(remaining, o.currency)}</strong></div>
      `;
      list.appendChild(card);
    }
    document.getElementById('customer-modal').style.display = 'flex';
  } catch (err) {
    toast(err.message, 'error');
  }
}

function openCustomerForm(context = null) {
  state.customerFormContext = context;
  document.getElementById('customer-form').reset();
  document.getElementById('customer-id').value = '';
  document.getElementById('customer-form-modal').style.display = 'flex';
}

document.getElementById('customer-form').addEventListener('submit', async event => {
  event.preventDefault();
  try {
    const customer = await api('/customers', { method: 'POST', body: {
      name: document.getElementById('customer-name').value.trim(),
      phone: document.getElementById('customer-phone').value.trim(),
      address: document.getElementById('customer-address').value.trim(),
      notes: document.getElementById('customer-notes').value.trim(),
      customer_type: document.getElementById('customer-type').value
    }});
    closeModal('customer-form-modal');
    await loadCustomers();
    if (state.customerFormContext === 'import') {
      await refreshImportCustomerList();
      document.getElementById('import-customer-id').value = String(customer.id);
      renderImportOrders(customer.id, 'new');
      document.getElementById('shein-import-modal').style.display = 'flex';
    }
    state.customerFormContext = null;
    toast('تمت إضافة الزبونة', 'success');
  } catch (err) { toast(err.message, 'error'); }
});

// ============== SHIPMENTS ==============
async function loadShipments() {
  try {
    state.shipments = await api('/shipments');
    renderShipments();
  } catch (e) { console.error(e); }
}

function renderShipments() {
  const list = document.getElementById('shipments-list');
  if (state.shipments.length === 0) {
    list.innerHTML = '<div class="empty-state"><div class="empty-state-icon">🚚</div>لا توجد شحنات. أنشئ شحنتك الأولى!</div>';
    return;
  }
  list.innerHTML = '';
  for (const s of state.shipments) {
    const card = document.createElement('div');
    card.className = 'shipment-card';
    card.innerHTML = `
      <div class="shipment-card-name">${escapeHtml(s.name)}</div>
      <div class="shipment-card-meta">${s.order_count} طلب • ${fmtDate(s.created_at)}</div>
      <div class="order-card-status">${SHIPMENT_STATUS_LABELS[s.status] || s.status || 'تم الطلب من SHEIN'}</div>
      <div class="shipment-card-stats">
        <span>التكلفة: <strong>${fmt(s.total_cost, s.currency)}</strong></span>
        <span>التوزيع: <strong>${s.distribution === 'equal' ? 'بالتساوي' : 'يدوي'}</strong></span>
      </div>
      <div class="shipment-card-actions">
        <button class="btn btn-outline btn-sm" onclick="viewShipment(${s.id})">👁️ عرض</button>
        <button class="btn btn-danger btn-sm" onclick="deleteShipment(${s.id})">🗑️ حذف</button>
      </div>
    `;
    list.appendChild(card);
  }
}

document.getElementById('add-shipment-btn').addEventListener('click', openShipmentModal);

async function openShipmentModal() {
  const modal = document.getElementById('shipment-modal');
  const form = document.getElementById('shipment-form');
  form.reset();
  state.selectedShipmentOrders = new Set();
  state.manualCosts = {};
  document.getElementById('shipment-name').value = '';
  document.getElementById('shipment-total-cost').value = '0';
  document.getElementById('shipment-status').value = 'ordered_from_shein';
  document.getElementById('manual-costs-section').style.display = 'none';

  // Load orders without shipment
  const availableOrders = state.orders.filter(o => !o.shipment_id);
  const list = document.getElementById('shipment-orders-list');
  if (availableOrders.length === 0) {
    list.innerHTML = '<div class="empty-state" style="padding:20px;">لا توجد طلبات متاحة للشحن. أضف طلبات أولاً.</div>';
  } else {
    list.innerHTML = '';
    for (const o of availableOrders) {
      const item = document.createElement('label');
      item.className = 'shipment-pick-item';
      item.innerHTML = `
        <input type="checkbox" data-order-id="${o.id}">
        <div class="shipment-pick-info">
          <div class="shipment-pick-name">${escapeHtml(o.customer_name)}</div>
          <div class="shipment-pick-meta">طلب #${escapeHtml(o.order_number || o.id)} • ${fmt(o.customer_value, o.currency)}</div>
        </div>
      `;
      list.appendChild(item);
    }
    list.querySelectorAll('input[type="checkbox"]').forEach(cb => {
      cb.addEventListener('change', (e) => {
        const id = e.target.dataset.orderId;
        if (e.target.checked) {
          state.selectedShipmentOrders.add(id);
        } else {
          state.selectedShipmentOrders.delete(id);
          delete state.manualCosts[id];
        }
        updateManualCostsList();
      });
    });
  }
  modal.style.display = 'flex';
}

document.querySelectorAll('input[name="distribution"]').forEach(r => {
  r.addEventListener('change', () => {
    document.getElementById('manual-costs-section').style.display =
      document.querySelector('input[name="distribution"]:checked').value === 'manual' ? 'block' : 'none';
    updateManualCostsList();
  });
});

function updateManualCostsList() {
  const list = document.getElementById('manual-costs-list');
  if (state.selectedShipmentOrders.size === 0) {
    list.innerHTML = '<div class="text-muted text-center" style="padding:8px;">اختر طلبات أولاً</div>';
    document.getElementById('manual-total').textContent = '0.00';
    return;
  }
  list.innerHTML = '';
  let total = 0;
  for (const id of state.selectedShipmentOrders) {
    const order = state.orders.find(o => String(o.id) === String(id));
    if (!order) continue;
    const row = document.createElement('div');
    row.className = 'manual-cost-row';
    row.innerHTML = `
      <span style="flex:1;font-size:13px;">${escapeHtml(order.customer_name)}</span>
      <input type="number" class="input manual-cost-input" data-order-id="${id}" value="${state.manualCosts[id] || 0}" step="0.01" min="0" style="max-width:140px;">
    `;
    list.appendChild(row);
  }
  list.querySelectorAll('.manual-cost-input').forEach(inp => {
    inp.addEventListener('input', () => {
      state.manualCosts[inp.dataset.orderId] = parseFloat(inp.value) || 0;
      recalcManualTotal();
    });
  });
  recalcManualTotal();
}

function recalcManualTotal() {
  let total = 0;
  for (const v of Object.values(state.manualCosts)) total += parseFloat(v) || 0;
  document.getElementById('manual-total').textContent = total.toFixed(2);
}

document.getElementById('shipment-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const distribution = document.querySelector('input[name="distribution"]:checked').value;
  const data = {
    name: document.getElementById('shipment-name').value.trim(),
    total_cost: parseFloat(document.getElementById('shipment-total-cost').value) || 0,
    currency: document.getElementById('shipment-currency').value,
    status: document.getElementById('shipment-status').value,
    distribution,
    notes: document.getElementById('shipment-notes').value.trim(),
    order_ids: Array.from(state.selectedShipmentOrders),
    manual_costs: distribution === 'manual' ? state.manualCosts : {}
  };
  if (data.order_ids.length === 0) {
    toast('اختر طلباً واحداً على الأقل', 'error');
    return;
  }
  try {
    await api('/shipments', { method: 'POST', body: data });
    toast('تم إنشاء الشحنة', 'success');
    closeModal('shipment-modal');
    await loadShipments();
    await loadOrders();
    await loadDashboard();
  } catch (err) {
    toast(err.message, 'error');
  }
});

async function viewShipment(id) {
  try {
    const s = await api('/shipments/' + id);
    let msg = `الشحنة: ${s.name}\nعدد الطلبات: ${s.orders.length}\nالتكلفة الإجمالية: ${fmt(s.total_cost, s.currency)}\nالتوزيع: ${s.distribution === 'equal' ? 'بالتساوي' : 'يدوي'}\n\nالطلبات:\n`;
    for (const o of s.orders) {
      msg += `- ${o.customer_name} (${fmt(o.customer_value, o.currency)} | شحن: ${fmt(o.shipping_cost, s.currency)})\n`;
    }
    alert(msg);
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function deleteShipment(id) {
  if (!confirm('هل أنت متأكد من حذف هذه الشحنة؟ الطلبات ستبقى بدون شحنة.')) return;
  try {
    await api('/shipments/' + id, { method: 'DELETE' });
    toast('تم حذف الشحنة', 'success');
    await loadShipments();
    await loadOrders();
    await loadDashboard();
  } catch (err) {
    toast(err.message, 'error');
  }
}

// ============== INVOICES ==============
function renderInvoices() {
  const list = document.getElementById('invoices-list');
  const search = (document.getElementById('invoices-search').value || '').toLowerCase();
  const orders = state.orders.filter(o => (o.customer_name + ' ' + (o.order_number || '')).toLowerCase().includes(search));
  list.innerHTML = orders.length ? orders.map(o => `
    <div class="order-card"><div class="order-card-header"><strong>${escapeHtml(o.customer_name)}</strong><span>${fmtDate(o.order_date)}</span></div>
    <div class="order-card-row"><span>${escapeHtml(o.order_number || ('طلب #' + o.id))}</span><strong>${fmt(o.customer_value, o.currency)}</strong></div>
    <button class="btn btn-primary btn-sm" onclick="openInvoice(${o.id})">عرض وطباعة الفاتورة</button></div>`).join('')
    : '<div class="empty-state">لا توجد فواتير مطابقة.</div>';
}
document.getElementById('invoices-search').addEventListener('input', renderInvoices);

async function openInvoice(orderId) {
  try {
    const data = await api('/invoices/' + orderId);
    const active = data.items.filter(i => !EXCLUDED_ITEM_STATUSES.has(i.status));
    const excluded = data.items.filter(i => EXCLUDED_ITEM_STATUSES.has(i.status));
    const rows = items => items.map(i => `<tr><td>${escapeHtml(i.product_name)}</td><td>${escapeHtml(i.color || '-')}</td><td>${escapeHtml(i.size || '-')}</td><td>${i.quantity}</td><td>${fmt(i.customer_unit_price, data.order.currency)}</td><td>${fmt(i.customer_total, data.order.currency)}</td></tr>`).join('');
    document.getElementById('invoice-content').innerHTML = `
      <div class="invoice-title"><h2>حسابات أم مروان</h2><div>فاتورة ${escapeHtml(data.order.order_number || ('#' + data.order.id))}</div></div>
      <p><strong>الزبونة:</strong> ${escapeHtml(data.order.customer_name)} &nbsp; <strong>التاريخ:</strong> ${fmtDate(data.order.order_date)}</p>
      <table class="data-table"><thead><tr><th>القطعة</th><th>اللون</th><th>المقاس</th><th>الكمية</th><th>السعر</th><th>الإجمالي</th></tr></thead><tbody>${rows(active)}</tbody></table>
      <div class="invoice-totals"><p>الإجمالي: <strong>${fmt(data.totals.total, data.order.currency)}</strong></p><p>المدفوع: <strong>${fmt(data.totals.paid, data.order.currency)}</strong></p><p>المتبقي: <strong>${fmt(data.totals.remaining, data.order.currency)}</strong></p><p>حالة الطلب: <strong>${STATUS_LABELS[data.order.status] || data.order.status}</strong></p></div>
      ${excluded.length ? `<h3>سجل القطع المستبعدة</h3><table class="data-table excluded-table"><tbody>${rows(excluded)}</tbody></table>` : ''}`;
    document.getElementById('invoice-modal').style.display = 'flex';
  } catch (err) { toast(err.message, 'error'); }
}
document.getElementById('print-invoice-btn').addEventListener('click', () => window.print());

// ============== REPORTS ==============
async function loadReports() {
  const customerSelect = document.getElementById('report-customer');
  const selected = customerSelect.value;
  customerSelect.innerHTML = '<option value="">كل الزبائن</option>' + state.customers.map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');
  customerSelect.value = selected;
  const statusSelect = document.getElementById('report-status');
  if (statusSelect.options.length <= 1) statusSelect.innerHTML += Object.entries(STATUS_LABELS).map(([v,l]) => `<option value="${v}">${l}</option>`).join('');
  const query = new URLSearchParams();
  [['date_from','report-date-from'], ['date_to','report-date-to'], ['customer_id','report-customer'], ['status','report-status']].forEach(([key,id]) => {
    const value = document.getElementById(id).value; if (value) query.set(key, value);
  });
  try {
    const report = await api('/reports?' + query.toString());
    const metrics = [['إجمالي المبيعات','sales'],['إجمالي المدفوع','paid'],['المتبقي','remaining'],['العمولة/الربح','commission'],['مصاريف الشحن','shipping']];
    document.getElementById('report-summary').innerHTML = metrics.map(([label,key]) => `<div class="stat-card"><div class="stat-label">${label}</div><div class="stat-value">${fmtNum(report.totals[key])}</div></div>`).join('');
    const simpleItems = items => items.length ? items.map(i => `<li>${escapeHtml(i.product_name)}${i.cancellation_reason ? ' — ' + escapeHtml(i.cancellation_reason) : ''}</li>`).join('') : '<li>لا يوجد</li>';
    document.getElementById('report-details').innerHTML = `
      <div class="report-grid"><section class="card"><h3>الطلبات حسب الحالة</h3><ul>${report.status_breakdown.map(s => `<li>${STATUS_LABELS[s.status] || s.status}: ${s.count}</li>`).join('') || '<li>لا يوجد</li>'}</ul></section>
      <section class="card"><h3>الزبائن ذوو المبالغ المتبقية</h3><ul>${report.due_customers.map(c => `<li>${escapeHtml(c.name)}: ${fmtNum(c.remaining)}</li>`).join('') || '<li>لا يوجد</li>'}</ul></section>
      <section class="card"><h3>القطع الملغاة</h3><ul>${simpleItems(report.cancelled_items)}</ul></section>
      <section class="card"><h3>القطع النافدة من SHEIN</h3><ul>${simpleItems(report.out_of_stock_items)}</ul></section>
      <section class="card report-wide"><h3>التقرير الشهري</h3><div class="table-wrap"><table class="data-table"><thead><tr><th>الشهر</th><th>الطلبات</th><th>المبيعات</th><th>المدفوع</th><th>المتبقي</th><th>العمولة</th><th>الشحن</th></tr></thead><tbody>${report.monthly.map(m => `<tr><td>${fmtMonth(m.month)}</td><td>${m.order_count}</td><td>${fmtNum(m.sales)}</td><td>${fmtNum(m.paid)}</td><td>${fmtNum(m.remaining)}</td><td>${fmtNum(m.commission)}</td><td>${fmtNum(m.shipping)}</td></tr>`).join('')}</tbody></table></div></section></div>`;
  } catch (err) { toast(err.message, 'error'); }
}
document.getElementById('run-report-btn').addEventListener('click', loadReports);

// ============== SETTINGS ==============
async function loadSettings(showUpdate = true) {
  try {
    const s = await api('/settings');
    state.exchangeRate = parseFloat(s.exchange_rate) || 425;
    document.getElementById('exchange-rate').value = s.exchange_rate;
    document.getElementById('rate-preview').textContent = s.exchange_rate;
  } catch (e) { console.error(e); }
}

document.getElementById('exchange-rate').addEventListener('input', (e) => {
  document.getElementById('rate-preview').textContent = e.target.value || '?';
});

document.getElementById('save-settings-btn').addEventListener('click', async () => {
  const rate = document.getElementById('exchange-rate').value;
  try {
    await api('/settings', { method: 'PUT', body: { exchange_rate: rate } });
    toast('تم حفظ سعر الصرف', 'success');
    await loadSettings(false);
  } catch (err) {
    toast(err.message, 'error');
  }
});

document.getElementById('change-password-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const cur = document.getElementById('current-password').value;
  const nw = document.getElementById('new-password').value;
  const cf = document.getElementById('confirm-password').value;
  if (nw !== cf) {
    toast('كلمة المرور الجديدة غير متطابقة', 'error');
    return;
  }
  try {
    await api('/auth/change-password', { method: 'POST', body: { currentPassword: cur, newPassword: nw } });
    toast('تم تغيير كلمة المرور بنجاح', 'success');
    e.target.reset();
  } catch (err) {
    toast(err.message, 'error');
  }
});

// ============== UTIL ==============
function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
