(() => {
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

  function scrapeVisibleProduct(root = document) {
    const isWholePage = root === document;
    const productName = firstText(root, ['h1', '[data-testid*="product-title"]', '[class*="goods-title"]', '[class*="product-name"]', 'a[title]']);
    const productLink = root.querySelector('a[href*="shein.com"], a[href*="-p-"]')?.href || location.href.split('#')[0];
    const imageUrl = (isWholePage ? attr(document, 'meta[property="og:image"]', 'content') : '') || attr(root, 'img', 'src');
    const priceText = firstText(root, ['[data-testid*="price"]', '.product-intro__head-mainprice', '[class*="salePrice"]', '[class*="price"]']);
    const color = selectedText(root, ['[data-attr-name*="Color"] [role="radio"]', '[class*="color"] [role="radio"]', '[class*="color"] li']) || firstText(root, ['[class*="color"]']);
    const size = selectedText(root, ['[data-attr-name*="Size"] [role="radio"]', '[class*="size"] [role="radio"]', '[class*="size"] li']) || firstText(root, ['[class*="size"]']);
    const quantityValue = root.querySelector('input[type="number"], input[class*="quantity"]')?.value;
    const skuText = firstText(root, ['[data-testid*="sku"]', '[class*="sku"]']);
    const skuMatch = skuText.match(/(?:SKU|رمز المنتج)\s*[:：]?\s*([\w-]+)/i);
    return {
      source: 'shein-extension',
      product_name: productName,
      product_url: productLink,
      image_url: imageUrl,
      color,
      size,
      quantity: Number(quantityValue) > 0 ? Number(quantityValue) : 1,
      price: parsePrice(priceText),
      sku: skuMatch ? skuMatch[1] : ''
    };
  }

  function openImport(button, root) {
    button.disabled = true;
    button.textContent = 'جارٍ فتح المعاينة…';
    chrome.runtime.sendMessage({ type: 'OPEN_SHEIN_IMPORT', payload: scrapeVisibleProduct(root) }, () => {
      button.disabled = false;
      button.textContent = 'حفظ هذه القطعة للزبونة';
    });
  }

  function addProductPageButton() {
    if (document.getElementById('am-shein-import-button')) return;
    const button = document.createElement('button');
    button.id = 'am-shein-import-button';
    button.type = 'button';
    button.textContent = 'حفظ هذه القطعة للزبونة';
    button.addEventListener('click', () => openImport(button, document));
    document.documentElement.appendChild(button);
  }

  function addCartButtons() {
    const rows = document.querySelectorAll('[data-testid*="cart-item"], [class*="cart-item"], [class*="cartItem"], .product-list__item');
    rows.forEach(row => {
      if (row.dataset.amSheinImportReady === '1') return;
      row.dataset.amSheinImportReady = '1';
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'am-shein-cart-import-button';
      button.textContent = 'حفظ هذه القطعة للزبونة';
      button.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        openImport(button, row);
      });
      row.appendChild(button);
    });
  }

  if (/cart|shopping.?bag/i.test(location.pathname)) {
    addCartButtons();
    new MutationObserver(addCartButtons).observe(document.body, { childList: true, subtree: true });
  } else {
    addProductPageButton();
  }
})();
