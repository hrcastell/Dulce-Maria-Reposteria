// ─── State ────────────────────────────────────────────────────────────────────
let allProducts = [];

// ─── Helpers ──────────────────────────────────────────────────────────────────
function formatPrice(n) {
  return new Intl.NumberFormat('es-CL').format(Math.round(n));
}

function getImageUrl(url) {
  if (!url) return null;
  let result;
  if (url.startsWith('https://hrcastell.com/uploads/')) {
    result = url.replace('https://hrcastell.com/uploads/', 'https://api.dulcemaria.hrcastell.com/uploads/');
  } else if (url.startsWith('http://') || url.startsWith('https://')) {
    result = url;
  } else {
    const base = API_BASE.replace(/\/$/, '');
    const path = url.startsWith('/') ? url : '/' + url;
    result = base + path;
  }
  console.log('[catalog getImageUrl] input:', url, '→ output:', result);
  return result;
}

// ─── Catalog loading ──────────────────────────────────────────────────────────
async function loadCatalog() {
  try {
    const res = await fetch(`${API_BASE}/catalog/products`);
    const data = await res.json();
    if (data.ok && data.items) {
      allProducts = data.items;
      renderCatalog(allProducts);
    } else {
      showCatalogEmpty();
    }
  } catch (e) {
    console.error('Error loading catalog:', e);
    showCatalogEmpty();
  }
}

function showCatalogEmpty() {
  document.getElementById('catalog-loading').classList.add('hidden');
  document.getElementById('catalog-empty').classList.remove('hidden');
}

function renderCatalog(products) {
  document.getElementById('catalog-loading').classList.add('hidden');

  if (!products || products.length === 0) {
    showCatalogEmpty();
    return;
  }

  const grid = document.getElementById('catalog-grid');
  grid.classList.remove('hidden');
  grid.innerHTML = products.map(product => productCard(product)).join('');
}

function productCard(product) {
  const imgUrl = getImageUrl(product.thumb_url);
  const hasVariants = product.variants && product.variants.length > 0;
  const totalStock = hasVariants
    ? product.variants.reduce((s, v) => s + (v.stock_qty || 0), 0)
    : (product.stock_qty || 0);
  const outOfStock = totalStock === 0;

  const imgHtml = imgUrl
    ? `<img src="${imgUrl}" alt="${product.name}" class="w-full aspect-[4/3] object-cover group-hover:scale-105 transition-transform duration-500 ease-out" loading="lazy" onerror="this.parentElement.innerHTML='<div class=\\'w-full aspect-[4/3] bg-dm-pink/10 flex items-center justify-center text-4xl\\'>🍰</div>'">`
    : `<div class="w-full aspect-[4/3] bg-dm-pink/10 flex items-center justify-center text-4xl">🍰</div>`;

  const variantSelect = hasVariants ? `
    <select id="variant-${product.id}" onchange="onVariantChange('${product.id}')"
      class="w-full border border-dm-cream rounded-xl px-3 py-2 text-sm mb-3 font-body text-dm-brown bg-white focus:outline-none focus:ring-2 focus:ring-dm-mint transition-all duration-200">
      ${product.variants.filter(v => v.is_active !== false).map(v =>
        `<option value="${v.id}" data-price="${v.price_clp ?? product.price_clp}" data-stock="${v.stock_qty}">${v.name}${v.price_clp && v.price_clp !== product.price_clp ? ' — $' + formatPrice(v.price_clp) : ''}</option>`
      ).join('')}
    </select>` : '';

  const addBtn = outOfStock
    ? `<button disabled class="w-full bg-dm-cream text-dm-brown/40 px-4 py-2.5 rounded-xl text-sm font-body font-medium cursor-not-allowed">Sin stock</button>`
    : `<button onclick="addToCartFromCard('${product.id}')"
         id="add-btn-${product.id}"
         class="w-full bg-dm-brown text-white px-4 py-2.5 rounded-xl hover:bg-dm-pink hover:text-dm-brown transition-all duration-300 text-sm font-body font-semibold shadow-sm hover:shadow-md">
         Agregar al carrito
       </button>`;

  return `
    <div class="group bg-white rounded-2xl border border-dm-cream overflow-hidden hover:shadow-lg hover:shadow-dm-brown/5 transition-all duration-300 ease-out" id="card-${product.id}">
      <div class="overflow-hidden">${imgHtml}</div>
      <div class="p-4">
        <h3 class="font-display text-base font-bold text-dm-brown mb-1 leading-snug">${product.name}</h3>
        ${product.description ? `<p class="font-body text-dm-brown/50 text-xs mb-3 line-clamp-2 leading-relaxed">${product.description}</p>` : ''}
        <div class="flex justify-between items-center mb-3">
          <span class="inline-flex items-center px-2.5 py-1 bg-dm-brown text-white rounded-lg font-body text-sm font-bold" id="price-${product.id}">$${formatPrice(product.price_clp)}</span>
          ${outOfStock
            ? '<span class="text-[10px] font-body font-semibold uppercase tracking-wider bg-red-50 text-red-500 px-2 py-1 rounded-full">Sin stock</span>'
            : `<span class="text-[10px] font-body font-medium text-dm-brown/40">Stock: <span id="stock-${product.id}">${totalStock}</span></span>`}
        </div>
        ${variantSelect}
        ${addBtn}
      </div>
    </div>`;
}

function onVariantChange(productId) {
  const product = allProducts.find(p => p.id === productId);
  if (!product) return;
  const select = document.getElementById(`variant-${productId}`);
  const option = select.options[select.selectedIndex];
  const price = parseInt(option.dataset.price);
  const stock = parseInt(option.dataset.stock);

  document.getElementById(`price-${productId}`).textContent = `$${formatPrice(price)}`;
  document.getElementById(`stock-${productId}`).textContent = stock;

  const btn = document.getElementById(`add-btn-${productId}`);
  if (btn) {
    if (stock === 0) {
      btn.disabled = true;
      btn.textContent = 'Sin stock';
      btn.className = 'w-full bg-dm-cream text-dm-brown/40 px-4 py-2.5 rounded-xl text-sm font-body font-medium cursor-not-allowed';
    } else {
      btn.disabled = false;
      btn.textContent = 'Agregar al carrito';
      btn.className = 'w-full bg-dm-brown text-white px-4 py-2.5 rounded-xl hover:bg-dm-pink hover:text-dm-brown transition-all duration-300 text-sm font-body font-semibold shadow-sm hover:shadow-md';
    }
  }
}

function addToCartFromCard(productId) {
  const product = allProducts.find(p => p.id === productId);
  if (!product) return;

  const hasVariants = product.variants && product.variants.length > 0;
  let variantId = null, variantName = null, price = product.price_clp, stock = product.stock_qty;

  if (hasVariants) {
    const select = document.getElementById(`variant-${productId}`);
    if (select) {
      const option = select.options[select.selectedIndex];
      variantId = option.value;
      variantName = option.text.split(' — ')[0].trim();
      price = parseInt(option.dataset.price);
      stock = parseInt(option.dataset.stock);
    }
  }

  const key = variantId ? `${productId}__${variantId}` : productId;

  const item = {
    key,
    product_id: productId,
    variant_id: variantId,
    name: product.name + (variantName ? ` (${variantName})` : ''),
    price,
    qty: 1,
    stock,
    image: getImageUrl(product.thumb_url)
  };

  // Delegar al carrito global
  if (typeof addToCart === 'function') {
    addToCart(item);
  } else {
    console.error('Funcionalidad del carrito no disponible (addToCart no existe).');
  }
}

// ─── Init ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', loadCatalog);
