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
    document.documentElement.setAttribute(CART_MOUNTED_ATTR, '1');
    const button = document.createElement('button');
    button.id = 'am-shein-import-button';
    button.type = 'button';
    button.textContent = 'حفظ هذه القطعة للزبونة';
    button.addEventListener('click', () => openImport(button, document));
    document.documentElement.appendChild(button);
  }

  function findCartItemRows() {
    const productLinks = [...document.querySelectorAll(
      'a[href*="-p-"], a[href*="/product/"], a[href*="goods_id="]'
    )];
    const rows = new Set();

    productLinks.forEach(link => {
      let node = link.parentElement;
      let levels = 0;
      while (node && node !== document.body && levels < 10) {
        const hasImage = Boolean(node.querySelector('img'));
        const hasPrice = Boolean(node.querySelector(
          '[class*="price" i], [data-testid*="price" i], [class*="amount" i]'
        )) || /(?:\$|US\$|SAR|ر\.س)\s*\d|\d[\d,.]*\s*(?:\$|SAR|ر\.س)/i.test(text(node));
        const hasCartControl = Boolean(node.querySelector(
          'input[type="checkbox"], [role="checkbox"], input[type="number"], '
          + '[class*="quantity" i], [class*="qty" i]'
        ));
        const hasItemIdentity = node.matches(
          '[data-cart-item-id], [data-goods-id], [data-testid*="cart-item" i], '
          + '[class~="cart-item"], [class*="cartItem"], [class*="product-item" i], '
          + '[class*="productItem"], .product-list__item, li'
        );

        if (hasImage && hasPrice && hasCartControl && hasItemIdentity) {
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

  function addCartButtons() {
    findCartItemRows().forEach(row => {
      const existingButton = row.querySelector(`:scope > .${CART_MOUNT_CLASS} > .${CART_BUTTON_CLASS}`);
      if (row.getAttribute(CART_MOUNTED_ATTR) === '1' && existingButton) return;

      row.querySelectorAll(`:scope > .${CART_MOUNT_CLASS}`).forEach(mount => mount.remove());
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
      row.appendChild(mount);
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
