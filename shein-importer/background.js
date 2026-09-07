const DEFAULT_APP_BASE_URL = 'https://shein-orders-app.onrender.com';
const activeReceipts = new Set();

function encodePayload(payload) {
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  let binary = '';
  bytes.forEach(byte => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'GET_SHEIN_SYNC_STATE' && message.syncKey) {
    chrome.storage.local.get({ sheinSyncStates: {}, pendingSheinImports: {} }, ({ sheinSyncStates, pendingSheinImports }) => {
      Object.entries(pendingSheinImports).forEach(([token, entry]) => startWatchingReceipt(token, entry.baseUrl));
      sendResponse({ ok: true, state: sheinSyncStates[message.syncKey] || null });
    });
    return true;
  }
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

    const receiptToken = crypto.randomUUID().replace(/-/g, '');
    const payload = { ...message.payload, receipt_token: receiptToken };
    chrome.storage.local.get({ pendingSheinImports: {} }, ({ pendingSheinImports }) => {
      pendingSheinImports[receiptToken] = { baseUrl, syncKey: payload.sync_key, createdAt: Date.now() };
      chrome.storage.local.set({ lastSheinDraft: payload, pendingSheinImports }, () => {
      const url = `${baseUrl}/import/shein?data=${encodeURIComponent(encodePayload(payload))}`;
      chrome.tabs.create({ url });
      startWatchingReceipt(receiptToken, baseUrl);
      sendResponse({ ok: true });
      });
    });
  });
  return true;
});

function startWatchingReceipt(receiptToken, baseUrl) {
  if (activeReceipts.has(receiptToken)) return;
  activeReceipts.add(receiptToken);
  watchReceipt(receiptToken, baseUrl);
}

async function watchReceipt(receiptToken, baseUrl, attempts = 0) {
  if (attempts > 300) {
    activeReceipts.delete(receiptToken);
    chrome.storage.local.get({ pendingSheinImports: {} }, ({ pendingSheinImports }) => {
      delete pendingSheinImports[receiptToken];
      chrome.storage.local.set({ pendingSheinImports });
    });
    return;
  }
  try {
    const response = await fetch(`${baseUrl}/api/import/shein-status/${encodeURIComponent(receiptToken)}`);
    const result = await response.json();
    if (result.status === 'synced') {
      chrome.storage.local.get({ sheinSyncStates: {}, pendingSheinImports: {} }, data => {
        data.sheinSyncStates[result.sync_key] = {
          itemId: result.item_id,
          signature: result.source_signature,
          syncedAt: Date.now()
        };
        delete data.pendingSheinImports[receiptToken];
        chrome.storage.local.set(data, () => {
          chrome.tabs.query({ url: ['https://shein.com/*', 'https://*.shein.com/*'] }, tabs => {
            tabs.forEach(tab => chrome.tabs.sendMessage(tab.id, {
              type: 'SHEIN_SYNC_CONFIRMED', syncKey: result.sync_key,
              signature: result.source_signature, itemId: result.item_id
            }, () => void chrome.runtime.lastError));
          });
        });
      });
      activeReceipts.delete(receiptToken);
      return;
    }
  } catch (_) {}
  setTimeout(() => watchReceipt(receiptToken, baseUrl, attempts + 1), 2000);
}

chrome.runtime.onStartup.addListener(() => {
  chrome.storage.local.get({ pendingSheinImports: {} }, ({ pendingSheinImports }) => {
    Object.entries(pendingSheinImports).forEach(([token, entry]) => startWatchingReceipt(token, entry.baseUrl));
  });
});
