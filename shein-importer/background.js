const DEFAULT_APP_BASE_URL = 'https://shein-orders-app.onrender.com';

function encodePayload(payload) {
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  let binary = '';
  bytes.forEach(byte => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== 'OPEN_SHEIN_IMPORT' || !message.payload) return;
  chrome.storage.local.get({ appBaseUrl: DEFAULT_APP_BASE_URL }, ({ appBaseUrl }) => {
    let baseUrl = DEFAULT_APP_BASE_URL;
    try {
      const configured = new URL(appBaseUrl);
      if (configured.protocol === 'https:' &&
          (configured.hostname === 'shein-orders-app.onrender.com' || configured.hostname.endsWith('.onrender.com'))) {
        baseUrl = configured.origin;
      }
    } catch (_) {}

    chrome.storage.local.set({ lastSheinDraft: message.payload }, () => {
      const url = `${baseUrl}/import/shein?data=${encodeURIComponent(encodePayload(message.payload))}`;
      chrome.tabs.create({ url });
      sendResponse({ ok: true });
    });
  });
  return true;
});
