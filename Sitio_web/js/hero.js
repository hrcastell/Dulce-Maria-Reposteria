// Hero/Carousel logic
async function loadHero() {
  const container = document.querySelector('.carousel');
  if (!container) return;

  try {
    const res = await fetch(`${API_BASE}/public/hero`);
    const data = await res.json();

    if (!data.ok || !data.items || data.items.length === 0) {
      console.log('No active hero slides found.');
      return;
    }

    renderHero(data.items);
    
    // Initialize carousel after rendering
    if (window.initCarousel) {
      window.initCarousel();
    }
  } catch (e) {
    console.error('Error loading hero:', e);
  }
}

function renderHero(slides) {
  const container = document.querySelector('.carousel');
  
  // Create slides HTML
  const slidesHtml = slides.map((slide, index) => {
    // Construct image URL safely
    let imgUrl = slide.image_url;
    if (imgUrl && !imgUrl.startsWith('http')) {
      // Handle relative paths from backend
      const base = API_BASE.replace(/\/$/, '');
      const path = imgUrl.startsWith('/') ? imgUrl : '/' + imgUrl;
      imgUrl = base + path;
    }

    return `
      <div class="carousel-slide absolute inset-0 transition-opacity duration-500 ease-in-out opacity-0 z-0">
        <div class="relative h-full w-full">
          <!-- Background Image -->
          <div class="absolute inset-0 bg-cover bg-center" style="background-image: url('${imgUrl}')"></div>
          
          <!-- Overlay -->
          <div class="absolute inset-0 bg-black/30"></div>

          <!-- Content -->
          <div class="absolute inset-0 flex items-center justify-center">
            <div class="text-center px-4 max-w-4xl mx-auto">
              ${slide.title ? `<h1 class="text-5xl font-bold text-white mb-6 drop-shadow-lg">${slide.title}</h1>` : ''}
              ${slide.subtitle ? `<p class="text-2xl text-white mb-8 drop-shadow-md font-medium">${slide.subtitle}</p>` : ''}
              
              ${slide.button_text ? `
                <a href="${slide.button_link || '#'}" 
                   class="inline-block bg-pink-500 text-white px-8 py-3 rounded-full hover:bg-pink-400 transition-colors font-semibold shadow-lg hover:shadow-xl transform hover:-translate-y-1 duration-200">
                  ${slide.button_text}
                </a>
              ` : ''}
            </div>
          </div>
        </div>
      </div>
    `;
  }).join('');

  // Create indicators HTML
  const indicatorsHtml = `
    <div class="carousel-indicators absolute bottom-8 left-1/2 transform -translate-x-1/2 flex space-x-3 z-20">
      ${slides.map((_, index) => `
        <button onclick="showSlide(${index})" class="carousel-dot w-3 h-3 rounded-full bg-white/50 hover:bg-pink-500 transition-all duration-300"></button>
      `).join('')}
    </div>
  `;

  // Create controls HTML
  const controlsHtml = `
    <div class="carousel-controls">
      <button onclick="prevSlide()" class="absolute left-4 top-1/2 transform -translate-y-1/2 bg-white/20 hover:bg-white/40 p-3 rounded-full backdrop-blur-sm transition-all z-20 text-white border border-white/30">
        <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
        </svg>
      </button>
      <button onclick="nextSlide()" class="absolute right-4 top-1/2 transform -translate-y-1/2 bg-white/20 hover:bg-white/40 p-3 rounded-full backdrop-blur-sm transition-all z-20 text-white border border-white/30">
        <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
        </svg>
      </button>
    </div>
  `;

  // Inject content
  container.innerHTML = slidesHtml + controlsHtml + indicatorsHtml;
}

// Initialize on load
document.addEventListener('DOMContentLoaded', loadHero);
