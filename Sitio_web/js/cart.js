// Estado del carrito
let cart = {
    items: [],
    total: 0
};

// Funciones del carrito
function addToCart(product) {
    const existingItem = cart.items.find(item => item.id === product.id);
    if (existingItem) {
        existingItem.quantity += 1;
    } else {
        cart.items.push({ ...product, quantity: 1 });
    }
    updateCart();
}

function removeFromCart(productId) {
    cart.items = cart.items.filter(item => item.id !== productId);
    updateCart();
}

function updateQuantity(productId, quantity) {
    const item = cart.items.find(item => item.id === productId);
    if (item) {
        item.quantity = Math.max(0, quantity);
        if (item.quantity === 0) {
            removeFromCart(productId);
        }
    }
    updateCart();
}

function updateCart() {
    // Actualizar el contador del carrito
    const cartCount = document.getElementById('cart-count');
    const totalItems = cart.items.reduce((sum, item) => sum + item.quantity, 0);
    cartCount.textContent = totalItems;
    cartCount.classList.toggle('hidden', totalItems === 0);

    // Actualizar el contenido del carrito
    const cartItems = document.getElementById('cart-items');
    cartItems.innerHTML = cart.items.map(item => `
        <div class="flex justify-between items-center py-2 border-b border-gray-200">
            <div class="flex items-center">
                <img src="${item.image}" alt="${item.name}" class="w-16 h-16 object-cover rounded">
                <div class="ml-4">
                    <h3 class="font-medium">${item.name}</h3>
                    <p class="text-gray-600">$${item.price}</p>
                </div>
            </div>
            <div class="flex items-center">
                <button onclick="updateQuantity(${item.id}, ${item.quantity - 1})" class="px-2 py-1 bg-gray-200 rounded">-</button>
                <span class="mx-2">${item.quantity}</span>
                <button onclick="updateQuantity(${item.id}, ${item.quantity + 1})" class="px-2 py-1 bg-gray-200 rounded">+</button>
            </div>
        </div>
    `).join('');

    // Actualizar el total
    cart.total = cart.items.reduce((sum, item) => sum + (item.price * item.quantity), 0);
    const cartTotal = document.getElementById('cart-total');
    cartTotal.textContent = `$${cart.total.toFixed(2)}`;
}

// Toggle del carrito
function toggleCart() {
    const cart = document.getElementById('cart-sidebar');
    cart.classList.toggle('translate-x-full');
}
