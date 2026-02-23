// Variables para el carousel
let currentSlide = 0;
let slides = [];
let dots = [];
let autoplayInterval;

// Funciones del carousel
function showSlide(index) {
    if (!slides || slides.length === 0) return;

    // Ajustar el índice si se pasa de los límites
    if (index >= slides.length) {
        currentSlide = 0;
    } else if (index < 0) {
        currentSlide = slides.length - 1;
    } else {
        currentSlide = index;
    }

    // Ocultar todos los slides
    slides.forEach(slide => {
        slide.style.opacity = '0';
        slide.style.zIndex = '0';
    });

    // Mostrar el slide actual
    if (slides[currentSlide]) {
        slides[currentSlide].style.opacity = '1';
        slides[currentSlide].style.zIndex = '1';
    }

    // Actualizar los dots
    if (dots && dots.length > 0) {
        dots.forEach((dot, idx) => {
            dot.classList.toggle('bg-pink-500', idx === currentSlide);
            dot.classList.toggle('bg-gray-300', idx !== currentSlide);
        });
    }
}

function nextSlide() {
    showSlide(currentSlide + 1);
}

function prevSlide() {
    showSlide(currentSlide - 1);
}

function startAutoplay() {
    stopAutoplay(); // Detener el autoplay existente si lo hay
    autoplayInterval = setInterval(nextSlide, 5000); // Cambiar slide cada 5 segundos
}

function stopAutoplay() {
    if (autoplayInterval) {
        clearInterval(autoplayInterval);
    }
}

// Inicializar el carousel manualmente
function initCarousel() {
    slides = document.querySelectorAll('.carousel-slide');
    dots = document.querySelectorAll('.carousel-dot');
    
    if (slides.length === 0) return;

    // Mostrar el primer slide
    showSlide(0);
    
    // Iniciar autoplay
    startAutoplay();
    
    // Pausar autoplay cuando el mouse está sobre el carousel
    const carousel = document.querySelector('.carousel');
    if (carousel) {
        carousel.addEventListener('mouseenter', stopAutoplay);
        carousel.addEventListener('mouseleave', startAutoplay);
    }
}

// Exponer las funciones al scope global
window.nextSlide = nextSlide;
window.prevSlide = prevSlide;
window.showSlide = showSlide;
window.initCarousel = initCarousel;
