// API_BASE viene de config.js
// Estado del carrito global
let cartItems = [];

// Función principal para agregar al carrito (llamada desde catalog.js y cake-builder.js)
function addToCart(item) {
  const existing = cartItems.find(i => i.key === item.key);
  const currentQty = existing ? existing.qty : 0;

  if (currentQty + item.qty > item.stock) {
    alert(`Lo sentimos, solo hay ${item.stock} unidad(es) disponible(s).`);
    return false;
  }

  if (existing) {
    existing.qty += item.qty;
  } else {
    cartItems.push(item);
  }

  updateCartUI();
  
  // Feedback visual si existe el botón (solo si viene de catálogo)
  if (item.product_id) {
      const btn = document.getElementById(`add-btn-${item.product_id}`);
      if (btn) {
        const originalText = btn.textContent;
        btn.textContent = '✓ Agregado';
        setTimeout(() => { btn.textContent = originalText; }, 1200);
      }
  }
  return true;
}

// ─── Cart UI ──────────────────────────────────────────────────────────────────
function updateCartUI() {
  const totalItems = cartItems.reduce((s, i) => s + i.qty, 0);
  const totalPrice = cartItems.reduce((s, i) => s + i.price * i.qty, 0);

  const countEl = document.getElementById('cart-count');
  if (countEl) {
    countEl.textContent = totalItems;
    countEl.classList.toggle('hidden', totalItems === 0);
  }

  const totalEl = document.getElementById('cart-total');
  if (totalEl) totalEl.textContent = `$${formatPrice(totalPrice)}`;

  const cartItemsEl = document.getElementById('cart-items');
  if (cartItemsEl) {
    if (cartItems.length === 0) {
        cartItemsEl.innerHTML = '<p class="font-body text-dm-brown/40 text-center mt-12 text-sm">Tu carrito está vacío</p>';
    } else {
        cartItemsEl.innerHTML = cartItems.map(item => `
        <div class="flex items-center gap-3 py-3 border-b border-dm-cream/60">
          ${item.image
            ? `<img src="${item.image}" class="w-14 h-14 object-cover rounded-xl flex-shrink-0 shadow-sm" onerror="this.style.display='none'">`
            : `<div class="w-14 h-14 bg-dm-pink/10 rounded-xl flex items-center justify-center flex-shrink-0 text-xl">🍰</div>`}
          <div class="flex-1 min-w-0">
            <p class="font-body text-sm font-medium text-dm-brown truncate">${item.name}</p>
            <p class="font-body text-sm text-dm-pink font-semibold">$${formatPrice(item.price)}</p>
          </div>
          <div class="flex items-center gap-1 flex-shrink-0">
            <button onclick="changeQty('${item.key}', -1)" class="w-7 h-7 bg-dm-cream rounded-full text-dm-brown hover:bg-dm-pink hover:text-white transition-colors duration-200 flex items-center justify-center font-bold text-xs">−</button>
            <span class="w-6 text-center font-body text-sm font-medium text-dm-brown">${item.qty}</span>
            <button onclick="changeQty('${item.key}', 1)" class="w-7 h-7 bg-dm-cream rounded-full text-dm-brown hover:bg-dm-pink hover:text-white transition-colors duration-200 flex items-center justify-center font-bold text-xs" ${item.qty >= item.stock ? 'disabled style="opacity:0.4;cursor:not-allowed"' : ''}>+</button>
            <button onclick="removeItem('${item.key}')" class="ml-1 text-red-400 hover:text-red-600 text-lg leading-none transition-colors duration-200">×</button>
          </div>
        </div>`).join('');
    }
  }
}

function changeQty(key, delta) {
  const item = cartItems.find(i => i.key === key);
  if (!item) return;
  const newQty = item.qty + delta;
  
  if (newQty <= 0) {
    removeItem(key);
  } else if (newQty > item.stock) {
    alert(`Solo hay ${item.stock} unidad(es) disponible(s).`);
  } else {
    item.qty = newQty;
    updateCartUI();
  }
}

function removeItem(key) {
  cartItems = cartItems.filter(i => i.key !== key);
  updateCartUI();
}

function toggleCart() {
  const sidebar = document.getElementById('cart-sidebar');
  if (sidebar) sidebar.classList.toggle('translate-x-full');
}

// Helper para formatear precio (duplicado pero útil tenerlo aquí si catalog.js falla)
function formatPrice(n) {
  return new Intl.NumberFormat('es-CL').format(Math.round(n || 0));
}

// ─── Payment Modal ────────────────────────────────────────────────────────────
function openPaymentModal() {
  if (cartItems.length === 0) {
    alert('Tu carrito está vacío.');
    return;
  }
  const total = cartItems.reduce((s, i) => s + i.price * i.qty, 0);

  const summaryEl = document.getElementById('payment-order-summary');
  if (summaryEl) {
      summaryEl.innerHTML = cartItems.map(i =>
        `<div class="flex justify-between text-sm py-1 font-body">
          <span class="text-dm-brown/70">${i.name} × ${i.qty}</span>
          <span class="font-medium text-dm-brown">$${formatPrice(i.price * i.qty)}</span>
        </div>`
      ).join('');
  }
  
  const totalPayEl = document.getElementById('payment-total');
  if (totalPayEl) totalPayEl.textContent = `$${formatPrice(total)}`;

  document.getElementById('payment-step-1').classList.remove('hidden');
  document.getElementById('payment-step-2').classList.add('hidden');
  document.getElementById('payment-error').classList.add('hidden');
  document.getElementById('payment-modal').classList.remove('hidden');
}

function closePaymentModal() {
  document.getElementById('payment-modal').classList.add('hidden');
}

async function confirmOrder() {
  const name = document.getElementById('customer-name').value.trim();
  const phone = document.getElementById('customer-phone').value.trim();
  const address = document.getElementById('customer-address').value.trim();
  const errEl = document.getElementById('payment-error');

  if (!name || !phone) {
    errEl.textContent = 'Por favor completa tu nombre y teléfono.';
    errEl.classList.remove('hidden');
    return;
  }

  const btn = document.getElementById('confirm-btn');
  btn.disabled = true;
  btn.textContent = 'Registrando pedido...';
  errEl.classList.add('hidden');

  try {
    const body = {
      customer_name: name,
      customer_phone: phone,
      customer_address: address,
      items: cartItems.map(i => ({
        product_id: i.product_id,
        variant_id: i.variant_id || null,
        product_name: i.name,
        qty: i.qty,
        unit_price_clp: i.price
      }))
    };

    const res = await fetch(`${API_BASE}/public/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await res.json();

    if (!data.ok) throw new Error(data.error || 'Error al registrar el pedido');

    const orderNum = data.order_number || data.order_id?.slice(0, 8).toUpperCase();
    document.getElementById('order-number-display').textContent = `#${orderNum}`;

    const total = cartItems.reduce((s, i) => s + i.price * i.qty, 0);
    const summary = cartItems.map(i => `${i.name} x${i.qty}`).join(', ');
    const msg = encodeURIComponent(`Hola! Adjunto comprobante de pago para el pedido #${orderNum} — ${summary} — Total: $${formatPrice(total)}`);
    document.getElementById('whatsapp-confirm-link').href = `https://wa.me/56932423459?text=${msg}`;

    document.getElementById('payment-step-1').classList.add('hidden');
    document.getElementById('payment-step-2').classList.remove('hidden');

    cartItems = [];
    updateCartUI();
  } catch (e) {
    errEl.textContent = e.message || 'Ocurrió un error. Intenta de nuevo.';
    errEl.classList.remove('hidden');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Confirmar pedido';
  }
}
