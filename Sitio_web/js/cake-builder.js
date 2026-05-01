// ─── State ────────────────────────────────────────────────────────────────────
let BASE_PRICE = 30000; // Valor por defecto, se actualiza desde API
let cakeCategories = [];
let cakeSelections = {};   // { categoryType: { id, label, extra_price_clp } }
let currentStep = 0;

// ─── Helpers ──────────────────────────────────────────────────────────────────
function fmtPrice(n) {
  return new Intl.NumberFormat('es-CL').format(Math.round(n || 0));
}

function calcCakePrice() {
  const extras = Object.values(cakeSelections).reduce((s, sel) => s + (sel?.extra_price_clp || 0), 0);
  return BASE_PRICE + extras;
}

function updatePriceDisplay() {
  const total = calcCakePrice();
  const deposit = Math.ceil(total * 0.5);
  const pd = document.getElementById('cake-price-display');
  const dd = document.getElementById('cake-deposit-display');
  if (pd) pd.textContent = `$${fmtPrice(total)}`;
  if (dd) dd.textContent = `$${fmtPrice(deposit)}`;
}

// ─── Load Config ──────────────────────────────────────────────────────────────
async function loadCakeBuilder() {
  try {
    const res = await fetch(`${API_BASE}/public/cake-builder`);
    const data = await res.json();
    console.log('Cake Builder Config:', data); // Debug log

    if (!data.ok || !data.categories || data.categories.length === 0) {
      document.getElementById('cake-loading').innerHTML = '<p class="font-body text-dm-brown/40 text-sm">No hay opciones disponibles aún.</p>';
      return;
    }
    
    // Set base price from API if available
    if (data.base_price) {
      console.log('Setting BASE_PRICE to:', data.base_price); // Debug log
      BASE_PRICE = Number(data.base_price);
    }

    cakeCategories = data.categories.filter(c => c.options && c.options.length > 0);
    // Pre-select defaults
    for (const cat of cakeCategories) {
      const def = cat.options.find(o => o.is_default) || cat.options[0];
      if (def) {
        cakeSelections[cat.type] = { id: def.id, label: def.label, extra_price_clp: def.extra_price_clp || 0, category_id: cat.id };
      }
    }
    document.getElementById('cake-loading').classList.add('hidden');
    document.getElementById('cake-stepper').classList.remove('hidden');
    renderProgressBar();
    renderCurrentStep();
    updatePriceDisplay();
  } catch (e) {
    console.error('Error loading cake builder:', e);
    document.getElementById('cake-loading').innerHTML = '<p class="font-body text-dm-brown/40 text-sm">Error al cargar opciones. Intenta más tarde.</p>';
  }
}

// ─── Render ───────────────────────────────────────────────────────────────────
function renderProgressBar() {
  const bar = document.getElementById('cake-progress-bar');
  if (!bar) return;
  bar.innerHTML = cakeCategories.map((cat, i) => {
    const isActive = i === currentStep;
    const isDone = i < currentStep;
    return `
      <div class="flex-1 flex flex-col items-center">
        <div class="w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold transition-colors font-body
          ${isDone ? 'bg-dm-mint text-dm-brown' : isActive ? 'bg-dm-pink text-dm-brown' : 'bg-dm-cream text-dm-brown/40'}">
          ${isDone ? '✓' : i + 1}
        </div>
        <span class="text-xs mt-1 font-body ${isActive ? 'text-dm-brown font-semibold' : 'text-dm-brown/40'} hidden sm:block">${cat.label}</span>
      </div>
      ${i < cakeCategories.length - 1 ? `<div class="flex-1 h-0.5 mt-4 ${i < currentStep ? 'bg-dm-mint' : 'bg-dm-cream'}"></div>` : ''}
    `;
  }).join('');
}

function renderCurrentStep() {
  if (cakeCategories.length === 0) return;
  const cat = cakeCategories[currentStep];
  const isLastStep = currentStep === cakeCategories.length - 1;
  const selected = cakeSelections[cat.type];

  const container = document.getElementById('cake-steps-container');
  container.innerHTML = `
    <div class="p-6 sm:p-8">
      <h3 class="font-display text-2xl font-bold text-dm-brown mb-1">${cat.label}</h3>
      <p class="font-body text-dm-brown/40 text-sm mb-6">Elige una opción para continuar</p>
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
        ${cat.options.map(opt => {
          const isSel = selected?.id === opt.id;
          return `
            <button
              onclick="selectCakeOption('${cat.type}', '${opt.id}', '${opt.label.replace(/'/g, "\\'")}', ${opt.extra_price_clp || 0}, '${cat.id}')"
              class="text-left p-4 rounded-xl border-2 transition-all duration-200 font-body ${isSel
                ? 'border-dm-pink bg-dm-pink/10 shadow-sm'
                : 'border-dm-cream hover:border-dm-mint hover:bg-dm-mint/10'}"
            >
              <div class="flex justify-between items-start">
                <span class="font-semibold text-dm-brown">${opt.label}</span>
                ${isSel ? '<span class="text-dm-pink text-xl">✓</span>' : ''}
              </div>
              ${opt.description ? `<p class="text-sm text-dm-brown/50 mt-1">${opt.description}</p>` : ''}
              <span class="text-sm font-medium mt-2 block ${opt.extra_price_clp > 0 ? 'text-dm-brown' : 'text-dm-brown/40'}">
                ${opt.extra_price_clp > 0 ? `+$${fmtPrice(opt.extra_price_clp)}` : 'Incluido'}
              </span>
            </button>
          `;
        }).join('')}
      </div>
    </div>
  `;

  // Nav buttons
  const prevBtn = document.getElementById('cake-prev-btn');
  const nextBtn = document.getElementById('cake-next-btn');
  if (prevBtn) prevBtn.classList.toggle('hidden', currentStep === 0);
  if (nextBtn) nextBtn.textContent = isLastStep ? '🎂 Pedir mi torta →' : 'Siguiente →';
}

function selectCakeOption(type, id, label, extraPrice, categoryId) {
  cakeSelections[type] = { id, label, extra_price_clp: extraPrice, category_id: categoryId };
  renderCurrentStep();
  updatePriceDisplay();
}

function cakeNext() {
  if (currentStep < cakeCategories.length - 1) {
    currentStep++;
    renderProgressBar();
    renderCurrentStep();
  } else {
    openCakeModal();
  }
}

function cakePrev() {
  if (currentStep > 0) {
    currentStep--;
    renderProgressBar();
    renderCurrentStep();
  }
}

// ─── Modal ────────────────────────────────────────────────────────────────────
function openCakeModal() {
  const total = calcCakePrice();
  const deposit = Math.ceil(total * 0.5);

  // Config summary
  const summaryEl = document.getElementById('cake-config-summary');
  if (summaryEl) {
    summaryEl.innerHTML = cakeCategories.map(cat => {
      const sel = cakeSelections[cat.type];
      return `<div class="flex justify-between font-body">
        <span class="text-dm-brown/50">${cat.label}:</span>
        <span class="font-medium text-dm-brown">${sel?.label || '—'}${sel?.extra_price_clp > 0 ? ` (+$${fmtPrice(sel.extra_price_clp)})` : ''}</span>
      </div>`;
    }).join('');
  }

  const mt = document.getElementById('cake-modal-total');
  const md = document.getElementById('cake-modal-deposit');
  if (mt) mt.textContent = `$${fmtPrice(total)}`;
  if (md) md.textContent = `$${fmtPrice(deposit)}`;

  document.getElementById('cake-modal-step-1').classList.remove('hidden');
  document.getElementById('cake-modal-step-2').classList.add('hidden');
  document.getElementById('cake-modal-error').classList.add('hidden');
  document.getElementById('cake-order-modal').classList.remove('hidden');
}

function closeCakeModal() {
  document.getElementById('cake-order-modal').classList.add('hidden');
}

async function submitCakeOrder() {
  const name = document.getElementById('cake-customer-name').value.trim();
  const phone = document.getElementById('cake-customer-phone').value.trim();
  const address = document.getElementById('cake-customer-address').value.trim();
  const notes = document.getElementById('cake-customer-notes').value.trim();
  const errEl = document.getElementById('cake-modal-error');
  const btn = document.getElementById('cake-confirm-btn');

  if (!name || !phone) {
    errEl.textContent = 'Por favor completa tu nombre y teléfono.';
    errEl.classList.remove('hidden');
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Registrando pedido...';
  errEl.classList.add('hidden');

  const total = calcCakePrice();
  const extrasTotal = Object.values(cakeSelections).reduce((s, sel) => s + (sel?.extra_price_clp || 0), 0);

  const body = {
    customer_name: name,
    customer_phone: phone,
    customer_address: address || null,
    notes: notes || null,
    base_price_clp: BASE_PRICE,
    extras_price_clp: extrasTotal,
    total_price_clp: total,
  };

  // Assign option IDs by category type
  for (const cat of cakeCategories) {
    const sel = cakeSelections[cat.type];
    if (sel?.id) {
      const keyMap = {
        SIZE: 'size_option_id',
        LAYERS: 'layers_option_id',
        SPONGE: 'sponge_option_id',
        FILLING: 'filling_option_id',
        DECORATION: 'decoration_option_id',
      };
      if (keyMap[cat.type]) body[keyMap[cat.type]] = sel.id;
    }
  }

  try {
    const res = await fetch(`${API_BASE}/public/cake-builder/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || 'Error al registrar el pedido');

    const orderNum = data.order_number;
    const deposit = data.deposit_clp;
    document.getElementById('cake-order-number-display').textContent = orderNum;

    const configText = cakeCategories.map(c => `${c.label}: ${cakeSelections[c.type]?.label || '—'}`).join(', ');
    const msg = encodeURIComponent(`Hola! Quiero enviar el comprobante del abono para mi pedido de torta ${orderNum} — ${configText} — Abono: $${fmtPrice(deposit)}`);
    document.getElementById('cake-whatsapp-link').href = `https://wa.me/56932423459?text=${msg}`;

    document.getElementById('cake-modal-step-1').classList.add('hidden');
    document.getElementById('cake-modal-step-2').classList.remove('hidden');
  } catch (e) {
    errEl.textContent = e.message || 'Ocurrió un error. Intenta de nuevo.';
    errEl.classList.remove('hidden');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Enviar pedido';
  }
}

// ─── Init ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', loadCakeBuilder);
