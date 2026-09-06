const APP_IMPORT_URL = 'https://shein-orders-app.onrender.com/#shein-import=';

function encodePayload(payload) {
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  let binary = '';
  bytes.forEach(byte => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== 'OPEN_SHEIN_IMPORT' || !message.payload) return;
  chrome.storage.local.set({ lastSheinDraft: message.payload }, () => {
    chrome.tabs.create({ url: APP_IMPORT_URL + encodePayload(message.payload) });
    sendResponse({ ok: true });
  });
  return true;
});
