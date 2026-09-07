# حسابات أم مروان – SHEIN

تطبيق ويب لإدارة طلبات SHEIN، عربي كامل، متوافق مع الجوال.

## المميزات

- ✅ **قاعدة بيانات حقيقية على السيرفر** (SQLite) - لا تضيع البيانات
- ✅ **تسجيل دخول آمن** (username + password)
- ✅ **دعم العملات**: ريال سعودي (SAR) وريال يمني (YER) مع تحويل تلقائي
- ✅ **إدارة الطلبات** مع حساب تلقائي للعمولة والنسبة والمتبقي
- ✅ **قطع مستقلة داخل كل طلب** مع الرابط والصورة واللون والمقاس والكمية والأسعار والحالة
- ✅ **سجل حالات القطعة** مع إبقاء القطع الملغاة أو النافدة واستبعادها من الإجماليات
- ✅ **6 حالات للطلب**: جديد → تم الطلب → وصل السعودية → شحن لليمن → وصل اليمن → تم التسليم
- ✅ **إدارة الشحنات**: إنشاء شحنة + توزيع التكلفة (بالتساوي أو يدوي)
- ✅ **صفحات الزبائن**: ملخص + جميع الطلبات
- ✅ **لوحة تحكم شاملة**: إحصائيات + تقرير شهري
- ✅ **تصدير CSV** للطلبات والزبائن
- ✅ **تصميم RTL عربي** متجاوب مع الجوال
- ✅ **PWA**: يمكن إضافته للشاشة الرئيسية كتطبيق

## بيانات الدخول الأولى

- **اسم المستخدم**: `admin`
- **كلمة المرور**: القيمة السرية لمتغير البيئة `INITIAL_ADMIN_PASSWORD`

لا توجد كلمة مرور ثابتة داخل الكود. هذا المتغير مطلوب فقط عند إنشاء قاعدة بيانات جديدة.

## تشغيل محلي

```bash
cd /workspace/shein-app
npm install
SESSION_SECRET='نص-عشوائي-طويل-جداً' INITIAL_ADMIN_PASSWORD='اختر-كلمة-قوية' node server.js
```

ثم افتح: `http://localhost:3000`

## النشر على Render.com (موصى به للإنتاج)

1. أنشئ حساب على [render.com](https://render.com)
2. ارفع المشروع على GitHub
3. في Render: **New** → **Web Service** → اختر الـ repo
4. الإعدادات:
   - **Build Command**: `npm install`
   - **Start Command**: `node server.js`
   - **Plan**: Free
5. أضف **Disk**:
   - **Mount Path**: `/workspace/shein-app/data`
   - **Size**: 1GB (مجاني)
6. **Environment Variables**:
   - `SESSION_SECRET`: أي نص عشوائي طويل
   - `INITIAL_ADMIN_PASSWORD`: كلمة مرور قوية لأول حساب مدير عند إنشاء قاعدة بيانات جديدة
   - `PORT`: 3000

## النشر على Railway

1. [railway.app](https://railway.app) → **New Project** → **Deploy from GitHub**
2. أضف **Volume** mounted at `/app/data`
3. Railway سيكتشف Node.js تلقائياً

## النشر الذاتي (VPS)

```bash
# على السيرفر
git clone <repo> shein-app
cd shein-app
npm install
npm install -g pm2
pm2 start server.js --name shein-app
pm2 startup
pm2 save

# Nginx reverse proxy (اختياري)
# /etc/nginx/sites-available/shein
server {
  listen 80;
  server_name your-domain.com;
  location / {
    proxy_pass http://localhost:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
  }
}
```

## API Endpoints

### المصادقة
- `POST /api/auth/login` - تسجيل دخول
- `POST /api/auth/logout` - تسجيل خروج
- `GET /api/auth/status` - حالة المصادقة
- `POST /api/auth/change-password` - تغيير كلمة المرور

### الطلبات
- `GET /api/orders` - قائمة الطلبات
- `POST /api/orders` - إضافة طلب
- `PUT /api/orders/:id` - تعديل طلب
- `DELETE /api/orders/:id` - حذف طلب

### قطع الطلب
- `GET /api/orders/:orderId/items` - عرض قطع الطلب
- `POST /api/orders/:orderId/items` - إضافة قطعة للطلب
- `PUT /api/order-items/:id` - تعديل بيانات القطعة أو حالتها
- `GET /api/order-items/:id/history` - سجل تغييرات حالة القطعة
- `POST /api/import/shein-item` - حفظ مسودة SHEIN بعد مراجعتها واختيار الطلب

## إضافة SHEIN المحلية (تجريبية)

مجلد `shein-importer` يحتوي إضافة Chrome بنظام Manifest V3. تقرأ البيانات الظاهرة
من صفحة المنتج أو سلة SHEIN، ثم تفتح شاشة مراجعة داخل التطبيق لاختيار الزبونة والطلب.
الإضافة لا تطلب صلاحية Cookies ولا تحتوي أي مفتاح سري.

### الشحنات
- `GET /api/shipments` - قائمة الشحنات
- `GET /api/shipments/:id` - تفاصيل شحنة
- `POST /api/shipments` - إنشاء شحنة
- `DELETE /api/shipments/:id` - حذف شحنة

### الزبائن
- `GET /api/customers` - قائمة الزبائن مع الملخص
- `GET /api/customers/:name` - تفاصيل زبونة

### الإحصائيات
- `GET /api/dashboard` - لوحة التحكم
- `GET /api/settings` - الإعدادات
- `PUT /api/settings` - تحديث الإعدادات

### التصدير
- `GET /api/export/orders` - تصدير الطلبات CSV
- `GET /api/export/customers` - تصدير الزبائن CSV

## هيكل قاعدة البيانات

```sql
users (id, username, password_hash, created_at)
orders (id, customer_name, customer_phone, order_number, order_date,
        customer_value, shein_paid, customer_paid, currency, status,
        shipment_id, shipping_cost, notes, created_at, updated_at)
shipments (id, name, total_cost, currency, distribution, status, notes, created_at)
order_items (id, order_id, product_url, product_name, image_url, color, size,
             quantity, customer_unit_price, shein_unit_price, status, created_at, updated_at)
order_item_status_history (id, item_id, old_status, new_status, changed_at)
settings (key, value)
```

## المميزات التقنية

- **Backend**: Node.js + Express + better-sqlite3
- **Frontend**: Vanilla JS (لا dependencies، سريع)
- **Session**: express-session (cookie-based)
- **Password**: bcrypt (10 rounds)
- **DB**: SQLite (file-based، صفر setup)

## الأمان

- كلمات المرور مشفرة بـ bcrypt
- Sessions مخزنة في memory (في الإنتاج: استخدم Redis)
- جميع routes محمية بـ `requireAuth` middleware
- HTTP-only cookies (لا يمكن الوصول من JS)

## الترخيص

خاص - استخدام داخلي فقط
