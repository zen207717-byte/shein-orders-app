const DEFAULT_APP_BASE_URL = 'https://shein-orders-app.onrender.com';
const input = document.getElementById('app-base-url');
const status = document.getElementById('status');

chrome.storage.local.get({ appBaseUrl: DEFAULT_APP_BASE_URL }, values => {
  input.value = values.appBaseUrl;
});

document.getElementById('save').addEventListener('click', () => {
  try {
    const url = new URL(input.value.trim());
    const allowed = url.protocol === 'https:' &&
      (url.hostname === 'shein-orders-app.onrender.com' || url.hostname.endsWith('.onrender.com'));
    if (!allowed) throw new Error();
    chrome.storage.local.set({ appBaseUrl: url.origin }, () => {
      input.value = url.origin;
      status.textContent = 'تم حفظ الرابط.';
    });
  } catch (_) {
    status.textContent = 'أدخل رابط HTTPS صالحًا لخدمة Render.';
  }
});
