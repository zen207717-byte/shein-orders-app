(() => {
  const CART_MOUNTED_ATTR = 'data-shein-importer-mounted';
  const CART_BUTTON_CLASS = 'am-shein-importer__cart-button';
  const CART_MOUNT_CLASS = 'am-shein-importer__cart-mount';
  const SYNCED_CLASS = 'am-shein-importer__cart-button--synced';
  const CHANGED_CLASS = 'am-shein-importer__cart-button--changed';
  const text = element => element?.textContent?.trim() || '';
  const attr = (root, selector, name) => root.querySelector(selector)?.getAttribute(name) || '';
  const firstText = (root, selectors) => {
    for (const selector of selectors) {
      const value = text(root.querySelector(selector));
      if (value) return value;
    }
    return '';
  };
  const selectedText = (root, selectors) => {
    for (const selector of selectors) {
      const elements = [...root.querySelectorAll(selector)];
      const selected = elements.find(el => el.matches('[aria-checked="true"], [aria-selected="true"], .active, .selected, .is-selected'));
      const value = text(selected);
      if (value) return value;
    }
    return '';
  };
  const parsePrice = value => {
    const match = String(value).replace(/,/g, '').match(/\d+(?:\.\d+)?/);
    return match ? Number(match[0]) : '';
  };
  const normalize = value => String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
  const stableUrlPart = value => {
    try {
      const url = new URL(value, location.href);
      return url.hostname + url.pathname;
    } catch (_) { return ''; }
  };
  const hash = value => {
    let result = 2166136261;
    for (let i = 0; i < value.length; i += 1) {
      result ^= value.charCodeAt(i);
      result = Math.imul(result, 16777619);
    }
    return (result >>> 0).toString(36);
  };

  function addSyncIdentity(item, root) {
    const visibleGoodsId = root.querySelector('[data-goods-id], [data-goods_id]')?.getAttribute('data-goods-id')
      || root.querySelector('[data-goods_id]')?.getAttribute('data-goods_id') || '';
    const identity = [item.sku, visibleGoodsId, stableUrlPart(item.product_url), normalize(item.product_name), stableUrlPart(item.image_url)].join('|');
    const mutable = [normalize(item.color), normalize(item.size), Number(item.price) || 0, Number(item.quantity) || 1].join('|');
    return { ...item, sync_key: `shein:v1:${hash(identity)}:${hash(identity.split('').reverse().join(''))}`, source_signature: `v1:${hash(mutable)}` };
  }

  function scrapeVisibleProduct(root = document) {
    const isWholePage = root === document;
    const cartTitle = root.querySelector('.bsc-cart-item-goods-title__content[title], a[title]');
    const productName = cartTitle?.getAttribute('title') || firstText(root, ['h1', '[data-testid*="product-title"]', '[class*="goods-title"]', '[class*="product-name"]', 'a[title]']);
    const readableLink = cartTitle?.getAttribute('href') || '';
    const productLink = readableLink || (isWholePage ? location.href.split('#')[0] : '');
    const productImage = root.querySelector('img.j-cart-main-img, img');
    const rawImageUrl = (isWholePage ? attr(document, 'meta[property="og:image"]', 'content') : '')
      || productImage?.currentSrc || productImage?.getAttribute('src') || '';
    const imageUrl = rawImageUrl ? new URL(rawImageUrl, location.href).href : '';
    const cartSalePrice = root.querySelector(
      '.bsc-cart-item-goods-price-v1__sale-price[aria-label], '
      + '.bsc-cart-item-goods-price-v2__sale-price[aria-label]'
    );
    const priceText = cartSalePrice?.getAttribute('aria-label') || (isWholePage
      ? firstText(root, ['[data-testid*="price"]', '.product-intro__head-mainprice', '[class*="salePrice"]', '[class*="price"]'])
      : '');
    const cartOption = root.querySelector('.bsc-cart-item-goods-sale-attr[aria-label]')?.getAttribute('aria-label') || '';
    const [cartColor = '', cartSize = ''] = cartOption.split('/').map(value => value.trim());
    const color = cartColor || selectedText(root, ['[data-attr-name*="Color"] [role="radio"]', '[class*="color"] [role="radio"]', '[class*="color"] li']) || firstText(root, ['[class*="color"]']);
    const size = cartSize || selectedText(root, ['[data-attr-name*="Size"] [role="radio"]', '[class*="size"] [role="radio"]', '[class*="size"] li']) || firstText(root, ['[class*="size"]']);
    const quantityValue = root.querySelector('input[aria-label="Quantity input"], input[type="number"], input[class*="quantity"]')?.value;
    const skuText = firstText(root, ['[data-testid*="sku"]', '[class*="sku"]']);
    const skuMatch = skuText.match(/(?:SKU|رمز المنتج)\s*[:：]?\s*([\w-]+)/i);
    return addSyncIdentity({
      source: 'shein-extension',
      product_name: productName,
      product_url: productLink,
      image_url: imageUrl,
      color,
      size,
      quantity: Number(quantityValue) > 0 ? Number(quantityValue) : 1,
      price: parsePrice(priceText),
      sku: skuMatch ? skuMatch[1] : ''
    }, root);
  }

  function setButtonState(button, item, savedState) {
    const desiredClass = savedState
      ? (savedState.signature === item.source_signature ? SYNCED_CLASS : CHANGED_CLASS)
      : '';
    const desiredText = desiredClass === SYNCED_CLASS ? '✓ تمت المزامنة'
      : desiredClass === CHANGED_CLASS ? 'يوجد تغيير — تحديث'
        : 'حفظ هذه القطعة للزبونة';
    if (button.textContent === desiredText && button.dataset.syncKey === item.sync_key &&
        button.dataset.signature === item.source_signature &&
        button.classList.contains(desiredClass || CART_BUTTON_CLASS)) return;
    button.classList.remove(SYNCED_CLASS, CHANGED_CLASS);
    button.disabled = false;
    button.dataset.syncKey = item.sync_key;
    button.dataset.signature = item.source_signature;
    if (savedState && savedState.signature === item.source_signature) {
      button.classList.add(SYNCED_CLASS);
      button.textContent = desiredText;
      button.dataset.itemId = savedState.itemId || '';
    } else if (savedState) {
      button.classList.add(CHANGED_CLASS);
      button.textContent = desiredText;
      button.dataset.itemId = savedState.itemId || '';
    } else {
      button.textContent = desiredText;
      delete button.dataset.itemId;
    }
  }

  function refreshButtonState(button, root) {
    const item = scrapeVisibleProduct(root);
    chrome.runtime.sendMessage({ type: 'GET_SHEIN_SYNC_STATE', syncKey: item.sync_key }, response => {
      setButtonState(button, item, response?.state || null);
    });
  }

  function openImport(button, root) {
    const item = scrapeVisibleProduct(root);
    button.disabled = true;
    button.textContent = 'جارٍ فتح المعاينة…';
    chrome.runtime.sendMessage({ type: 'OPEN_SHEIN_IMPORT', payload: item }, () => {
      refreshButtonState(button, root);
    });
  }

  function addProductPageButton() {
    if (document.getElementById('am-shein-import-button')) return;
    document.documentElement.setAttribute(CART_MOUNTED_ATTR, '1');
    const button = document.createElement('button');
    button.id = 'am-shein-import-button';
    button.type = 'button';
    button.textContent = 'حفظ هذه القطعة للزبونة';
    button.addEventListener('click', () => openImport(button, document));
    document.documentElement.appendChild(button);
    refreshButtonState(button, document);
  }

  function findCartItemRows() {
    const quantityInputs = [...document.querySelectorAll('input[aria-label="Quantity input"]')];
    const rows = new Set();

    quantityInputs.forEach(quantityInput => {
      let node = quantityInput.parentElement;
      let levels = 0;
      while (node && node !== document.body && levels < 10) {
        const hasTitleLink = Boolean(node.querySelector('a[title]'));
        const hasImage = Boolean(node.querySelector('img.j-cart-main-img'));
        const hasPrice = Boolean(node.querySelector(
          '.bsc-cart-item-goods-price-v2__sale-price, .bsc-cart-item-mini__price, [class*="price" i]'
        ));

        if (hasTitleLink && hasImage && hasPrice &&
            node.querySelectorAll('input[aria-label="Quantity input"]').length === 1) {
          rows.add(node);
          break;
        }
        node = node.parentElement;
        levels += 1;
      }
    });

    return [...rows].filter(row =>
      ![...rows].some(other => other !== row && row.contains(other))
    );
  }

  function findQtyActions(row) {
    return row.querySelector('.bsc-cart-item-goods-qty')
      || row.querySelector('input[aria-label="Quantity input"]')?.parentElement?.parentElement
      || row;
  }

  function addCartButtons() {
    findCartItemRows().forEach(row => {
      const existingButton = row.querySelector(`.${CART_MOUNT_CLASS} > .${CART_BUTTON_CLASS}`);
      if (row.getAttribute(CART_MOUNTED_ATTR) === '1' && existingButton) return;

      row.querySelectorAll(`.${CART_MOUNT_CLASS}`).forEach(mount => mount.remove());
      row.setAttribute(CART_MOUNTED_ATTR, '1');

      const mount = document.createElement('div');
      mount.className = CART_MOUNT_CLASS;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = CART_BUTTON_CLASS;
      button.textContent = 'حفظ هذه القطعة للزبونة';
      button.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        openImport(button, row);
      });
      mount.appendChild(button);
      findQtyActions(row).appendChild(mount);
      refreshButtonState(button, row);
    });
  }

  chrome.runtime.onMessage.addListener(message => {
    if (message?.type !== 'SHEIN_SYNC_CONFIRMED') return;
    document.querySelectorAll(`.${CART_BUTTON_CLASS}, #am-shein-import-button`).forEach(button => {
      if (button.dataset.syncKey === message.syncKey) {
        setButtonState(button, {
          sync_key: message.syncKey,
          source_signature: button.dataset.signature
        }, { signature: message.signature, itemId: message.itemId });
      }
    });
  });

  if (/cart|shopping.?bag/i.test(location.pathname)) {
    addCartButtons();
    const refreshChangedQuantity = event => {
      if (!event.target.matches('input[aria-label="Quantity input"]')) return;
      const row = findCartItemRows().find(candidate => candidate.contains(event.target));
      const button = row?.querySelector(`.${CART_BUTTON_CLASS}`);
      if (button) refreshButtonState(button, row);
    };
    document.addEventListener('input', refreshChangedQuantity, true);
    document.addEventListener('change', refreshChangedQuantity, true);
    let refreshTimer;
    new MutationObserver(() => {
      clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => {
        addCartButtons();
        findCartItemRows().forEach(row => {
          const button = row.querySelector(`.${CART_BUTTON_CLASS}`);
          if (button) refreshButtonState(button, row);
        });
      }, 80);
    }).observe(document.body, { childList: true, subtree: true });
  } else {
    addProductPageButton();
  }
})();
