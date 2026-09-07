(() => {
  const CART_MOUNTED_ATTR = 'data-shein-importer-mounted';
  const CART_BUTTON_CLASS = 'am-shein-importer__cart-button';
  const CART_MOUNT_CLASS = 'am-shein-importer__cart-mount';
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
    const cartTitle = root.querySelector('.bsc-cart-item-goods-title__content[title], a[title]');
    const productName = cartTitle?.getAttribute('title') || firstText(root, ['h1', '[data-testid*="product-title"]', '[class*="goods-title"]', '[class*="product-name"]', 'a[title]']);
    const readableLink = cartTitle?.getAttribute('href') || root.querySelector('a[href*="shein.com"], a[href*="-p-"]')?.href || '';
    const productLink = readableLink || (isWholePage ? location.href.split('#')[0] : '');
    const rawImageUrl = (isWholePage ? attr(document, 'meta[property="og:image"]', 'content') : '')
      || attr(root, 'img.j-cart-main-img', 'src') || attr(root, 'img', 'src');
    const imageUrl = rawImageUrl ? new URL(rawImageUrl, location.href).href : '';
    const priceText = firstText(root, ['.bsc-cart-item-goods-price-v2__sale-price', '.bsc-cart-item-mini__price', '[data-testid*="price"]', '.product-intro__head-mainprice', '[class*="salePrice"]', '[class*="price"]']);
    const cartOption = root.querySelector('.bsc-cart-item-goods-sale-attr[aria-label]')?.getAttribute('aria-label') || '';
    const [cartColor = '', cartSize = ''] = cartOption.split('/').map(value => value.trim());
    const color = cartColor || selectedText(root, ['[data-attr-name*="Color"] [role="radio"]', '[class*="color"] [role="radio"]', '[class*="color"] li']) || firstText(root, ['[class*="color"]']);
    const size = cartSize || selectedText(root, ['[data-attr-name*="Size"] [role="radio"]', '[class*="size"] [role="radio"]', '[class*="size"] li']) || firstText(root, ['[class*="size"]']);
    const quantityValue = root.querySelector('input[aria-label="Quantity input"], input[type="number"], input[class*="quantity"]')?.value;
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
    document.documentElement.setAttribute(CART_MOUNTED_ATTR, '1');
    const button = document.createElement('button');
    button.id = 'am-shein-import-button';
    button.type = 'button';
    button.textContent = 'حفظ هذه القطعة للزبونة';
    button.addEventListener('click', () => openImport(button, document));
    document.documentElement.appendChild(button);
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
    });
  }

  if (/cart|shopping.?bag/i.test(location.pathname)) {
    addCartButtons();
    let refreshTimer;
    new MutationObserver(() => {
      clearTimeout(refreshTimer);
      refreshTimer = setTimeout(addCartButtons, 80);
    }).observe(document.body, { childList: true, subtree: true });
  } else {
    addProductPageButton();
  }
})();
