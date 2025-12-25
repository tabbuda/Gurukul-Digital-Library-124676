const CACHE_NAME = "gurukul-erp-v1";
const ASSETS_TO_CACHE = [
    "./",
    "./index.html",
    "./style.css",
    "./app.js",
    "./manifest.json",
    // External Fonts & Icons (Optional: Inhe offline ke liye download karke local rakhna better hai)
    "https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap",
    "https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css"
];

// 1. INSTALL EVENT (Files ko Cache me daalo)
self.addEventListener("install", (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            console.log("[Service Worker] Caching Assets");
            return cache.addAll(ASSETS_TO_CACHE);
        })
    );
});

// 2. ACTIVATE EVENT (Purana Cache delete karo agar version change ho)
self.addEventListener("activate", (event) => {
    event.waitUntil(
        caches.keys().then((keyList) => {
            return Promise.all(
                keyList.map((key) => {
                    if (key !== CACHE_NAME) {
                        return caches.delete(key);
                    }
                })
            );
        })
    );
    return self.clients.claim();
});

// 3. FETCH EVENT (Offline first strategy)
self.addEventListener("fetch", (event) => {
    // Google Script API calls ko cache mat karo (Network First)
    if (event.request.url.includes("script.google.com")) {
        event.respondWith(
            fetch(event.request).catch(() => {
                // Agar internet nahi hai, to error return karo (App.js sambhal lega)
                return new Response(JSON.stringify({ status: 'offline' }));
            })
        );
        return;
    }

    // Baaki sab static files ke liye (Cache First)
    event.respondWith(
        caches.match(event.request).then((cachedResponse) => {
            return cachedResponse || fetch(event.request);
        })
    );
});