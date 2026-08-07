'use strict';

// ISSUE #35 - Ambiente DEV (sandbox-dev)
// Copia de seguros_mascotas.config.js con datos de prueba
// Usar: BUSINESS_CONFIG=sandbox-dev.config.js en .env

module.exports = {
    business: {
        id: 'SANDBOX_DEV',
        name: 'TE ASEGURAMOS [DEV]',
        shortName: 'DEV-TE ASEGURAMOS',
        brand: 'TE ASEGURAMOS',
        partner: 'Seguros Mundial',
        type: 'seguros_mascotas',
        industry: 'insurance',
        city: 'Bogota',
        department: 'Cundinamarca',
        country: 'Colombia',
        timezone: 'America/Bogota',
        language: 'es-CO',
        currency: 'COP'
    },

    contact: {
        phone: '+57 313 877 7115',
        whatsapp: '+573138777115',
        email: 'dev@seguros.co',
        website: 'https://example.com/dev',
        address: {
            street: 'Av DEV #123',
            neighborhood: 'Centro',
            city: 'Bogota',
            department: 'Cundinamarca',
            postalCode: '110111',
            coordinates: { lat: 4.711, lng: -74.0721 },
            googleMapsUrl: null
        }
    },

    admin: {
        business_admin_jids: [
            '573138777115@c.us'
        ],
        system_admin_jids: [
            '573138777115@c.us'
        ],
        jids: [],
        notifications: {
            newOrder: true,
            orderCancelled: true,
            customerIssue: true,
            lowStock: false,
            dailySummary: false
        },
        commands: {
            prefix: '/',
            enabled: ['stats', 'users', 'broadcast', 'reload', 'clear', 'mute', 'unmute']
        }
    },

    bot: {
        welcomeMessage: `🐾 [DEV] Hola, bienvenido a TE ASEGURAMOS [DEV]
Aliados de Seguros Mundial

ENTORNO DE PRUEBAS - NO USAR EN PRODUCCION

Sabemos que tu mascota es parte de tu familia.

¿A quien deseas proteger hoy?

1️⃣ Perro 🐶
2️⃣ Gato 🐱`,

        frustration: {
            enabled: true,
            maxErrors: 2,
            notifyAdmin: true,
            muteAfterErrors: true
        },

        insuranceFlow: {
            enabled: true,
            images: {
                gato: 'assets/plan_gato.jpeg',
                perroPlus: 'assets/plan_perro_plus.jpeg',
                perroPremium: 'assets/plan_perro_premium.jpeg'
            },
            messages: {
                gato: `🐱 *Plan Gatos [DEV]*

💰 *Valor anual: $200.900*

📅 Vigencia: 1 ano

ENTORNO DE PRUEBAS

1️⃣ Elegir este plan
2️⃣ Volver al menu`,

                perroPlus: `🐶 *Plan PLUS [DEV]*

💰 *Valor anual: $259.900*

📅 Vigencia: 1 ano

ENTORNO DE PRUEBAS

1️⃣ Elegir este plan
2️⃣ Ver plan PREMIUM`,

                perroPremium: `🐶 *Plan PREMIUM [DEV]*

💰 *Valor anual: $354.900*

📅 Vigencia: 1 ano

ENTORNO DE PRUEBAS

1️⃣ Elegir este plan
2️⃣ Volver a planes`,

                final: `💛 [DEV] Perfecto, {nombre}.

ENTORNO DE PRUEBAS - Los datos no seran procesados realmente.

¡Gracias por proteger a tu companero de vida! 🐾`
            }
        }
    },

    catalog: {
        categories: [],
        products: { requireImage: false, allowCustomization: false, maxCustomOptions: 0, customFields: {} },
        inventory: { trackStock: false, showOutOfStock: true, allowBackorder: false }
    },

    checkout: {
        requiredFields: { name: true, phone: true, address: false, email: false },
        paymentMethods: [{ id: 'transferencia', name: 'Transferencia Bancaria', enabled: true }],
        delivery: { enabled: false, freeDeliveryMinAmount: 0, deliveryFee: 0, estimatedTime: '', zones: [] },
        pickup: { enabled: false, estimatedTime: '' },
        validation: { minOrderAmount: 0, maxOrderAmount: 0, maxItemsPerOrder: 0 }
    },

    backend: {
        apiBase: process.env.API_BASE || 'http://127.0.0.1:8002/api',
        timeout: 8000,
        endpoints: {
            products: '', productImage: '', search: '', orders: '', reservations: ''
        },
        sheets: {
            enabled: false,
            spreadsheetId: '',
            worksheets: {}
        }
    },

    features: {
        textParser: { enabled: false, confidence: 0.9 },
        fuzzySearch: { enabled: false, threshold: 0.6 },
        productCache: { enabled: false, ttl: 300000 },
        logging: { level: 'debug', saveConversations: true, saveErrors: true }
    }
};
