/**
 * @fileoverview Configuración de Mundo Helados Riohacha
 * 
 * Configuración específica para la heladería Mundo Helados
 * ubicada en Riohacha, Colombia.
 * 
 * @module config/businesses/heladeria1
 * @version 1.0.0
 */

'use strict';

module.exports = {
    // ===================================
    // INFORMACIÓN BÁSICA DEL NEGOCIO
    // ===================================
    business: {
        id: 'MUNDO_HELADOS_RIOHACHA',
        name: 'Mundo Helados Riohacha',
        shortName: 'Mundo Helados',
        type: 'retail',
        industry: 'food-service',
        city: 'Riohacha',
        department: 'La Guajira',
        country: 'Colombia',
        timezone: 'America/Bogota',
        language: 'es-CO',
        currency: 'COP'
    },

    // ===================================
    // CONTACTO Y UBICACIÓN
    // ===================================
    contact: {
        phone: '+57 300 000 0000',  // TODO: Actualizar con número real
        whatsapp: '+573000000000',  // TODO: Actualizar con número real
        email: 'contacto@mundohelados.com',
        website: null,
        
        address: {
            street: 'Calle Principal',  // TODO: Actualizar dirección
            neighborhood: 'Centro',
            city: 'Riohacha',
            department: 'La Guajira',
            postalCode: '440001',
            coordinates: {
                lat: 11.5444,
                lng: -72.9072
            },
            googleMapsUrl: null  // TODO: Agregar URL
        },
        
        socialMedia: {
            facebook: null,
            instagram: '@mundohelados',  // TODO: Verificar handle
            twitter: null,
            tiktok: null
        }
    },

    // ===================================
    // HORARIOS DE ATENCIÓN
    // ===================================
    schedule: {
        monday: { open: '09:00', close: '20:00', closed: false },
        tuesday: { open: '09:00', close: '20:00', closed: false },
        wednesday: { open: '09:00', close: '20:00', closed: false },
        thursday: { open: '09:00', close: '20:00', closed: false },
        friday: { open: '09:00', close: '21:00', closed: false },
        saturday: { open: '09:00', close: '21:00', closed: false },
        sunday: { open: '10:00', close: '20:00', closed: false },
        
        holidays: ['2025-01-01', '2025-12-25'],
        specialDays: [
            { date: '2025-12-24', open: '09:00', close: '14:00' },
            { date: '2025-12-31', open: '09:00', close: '14:00' }
        ]
    },

    // ===================================
    // CONFIGURACIÓN DEL BOT
    // ===================================
    bot: {
        welcomeMessage: `Holiii ☺️
¿Cómo estás? Somos Mundo Helados en Riohacha 🍦`,

        mainMenu: {
            options: [
                { id: '1', label: 'Ver nuestro menú y hacer un pedido', emoji: '🛍️' },
                { id: '2', label: 'Dirección y horarios', emoji: '📍' },
                { id: '3', label: 'Pedidos por encargo (litros, eventos y grandes cantidades)', emoji: '📦' }
            ],
            
            message: `*1)* 🛍️ Ver nuestro menú y hacer un pedido
*2)* 📍 Dirección y horarios
*3)* 📦 Pedidos por encargo (litros, eventos y grandes cantidades)

✨ Escribe solo el número de la opción (1, 2 o 3).
Si te equivocas, no pasa nada 💛`
        },

        infoMessage: `📍 *Mundo Helados - Riohacha*

*Dirección:*
[DIRECCIÓN] - Riohacha, La Guajira

*Horario:*
Lunes a Jueves: 9:00 AM - 8:00 PM
Viernes y Sábado: 9:00 AM - 9:00 PM
Domingo: 10:00 AM - 8:00 PM

*Contacto:*
📱 WhatsApp: [NÚMERO]
📧 Email: contacto@mundohelados.com

*Síguenos:*
📸 Instagram: @mundohelados`,

        phases: {
            enableBrowseImages: true,
            enableProductSelection: true,
            enableCustomOrders: true,
            enableReservations: true,
            enableAIAssistant: true
        },

        ai: {
            enabled: true,
            model: 'gemini-pro',
            temperature: 0.7,
            maxTokens: 500,
            systemPrompt: `Eres un asistente virtual amigable de Mundo Helados en Riohacha.
Tu objetivo es ayudar a los clientes a hacer pedidos de helados de manera rápida y eficiente.
Usa un tono cálido, amigable y profesional, típico de la Costa Caribe colombiana.
Si no entiendes algo, pide aclaración de forma amable.`
        },

        frustration: {
            enabled: true,
            maxErrors: 3,
            notifyAdmin: true,
            muteAfterErrors: false
        },

        greetings: {
            type: 'colombia',
            customGreetings: [
                'epa mundo helados',
                'hola mundo helados',
                'buenas mundo helados'
            ]
        }
    },

    // ===================================
    // CATÁLOGO DE PRODUCTOS
    // ===================================
    catalog: {
        categories: [
            {
                id: 'helados',
                name: 'Helados',
                emoji: '🍦',
                description: 'Deliciosos helados artesanales',
                active: true,
                order: 1
            },
            {
                id: 'cajas',
                name: 'Cajas de Helado',
                emoji: '📦',
                description: 'Cajas de helado para llevar',
                active: true,
                order: 2
            },
            {
                id: 'litros',
                name: 'Litros',
                emoji: '🥛',
                description: 'Helado por litros',
                active: true,
                order: 3
            },
            {
                id: 'especiales',
                name: 'Especiales',
                emoji: '⭐',
                description: 'Productos especiales y promociones',
                active: true,
                order: 4
            }
        ],

        products: {
            requireImage: true,
            allowCustomization: true,
            maxCustomOptions: 5,
            
            customFields: {
                sabores: {
                    enabled: true,
                    label: 'Sabores',
                    required: true,
                    multiple: true,
                    max: 3,
                    options: [
                        'Vainilla', 'Chocolate', 'Fresa', 'Arequipe', 'Coco',
                        'Ron Pasas', 'Galleta Oreo', 'Mantecado', 'Chicle',
                        'Mora', 'Guanábana', 'Maracuyá', 'Mango'
                    ]
                },
                toppings: {
                    enabled: true,
                    label: 'Toppings',
                    required: false,
                    multiple: true,
                    max: 3,
                    options: [
                        'Chispas de Chocolate', 'Confites M&M', 'Galleta Oreo',
                        'Fresas', 'Arequipe', 'Chocolate Líquido', 'Maní',
                        'Cerezas', 'Brownie', 'Sin Toppings'
                    ]
                }
            }
        },

        inventory: {
            trackStock: false,
            showOutOfStock: true,
            allowBackorder: false
        }
    },

    // ===================================
    // CHECKOUT Y PAGOS
    // ===================================
    checkout: {
        requiredFields: {
            name: true,
            phone: true,
            address: true,
            email: false
        },

        paymentMethods: [
            { id: 'efectivo', name: 'Efectivo 💵', enabled: true },
            { id: 'transferencia', name: 'Transferencia Bancaria 🏦', enabled: true },
            { id: 'nequi', name: 'Nequi 💜', enabled: true },
            { id: 'daviplata', name: 'Daviplata 🔴', enabled: true }
        ],

        delivery: {
            enabled: true,
            freeDeliveryMinAmount: 30000,
            deliveryFee: 3000,
            estimatedTime: '30-45 minutos',
            zones: [
                { name: 'Centro', fee: 3000 },
                { name: 'Zona Norte', fee: 5000 },
                { name: 'Zona Sur', fee: 5000 }
            ]
        },

        pickup: {
            enabled: true,
            estimatedTime: '20-30 minutos'
        },

        validation: {
            minOrderAmount: 5000,
            maxOrderAmount: 500000,
            maxItemsPerOrder: 20
        }
    },

    // ===================================
    // ADMINISTRACIÓN
    // ===================================
    admin: {
        jids: [
            // Agregar JIDs de administradores aquí
            // Ejemplo: '573001234567@s.whatsapp.net'
        ],

        notifications: {
            newOrder: true,
            orderCancelled: true,
            customerIssue: true,
            lowStock: false,
            dailySummary: false
        },

        commands: {
            prefix: '/',
            enabled: [
                'stats',
                'orders',
                'users',
                'broadcast',
                'reload',
                'clear',
                'mute',
                'unmute'
            ]
        }
    },

    // ===================================
    // INTEGRACIÓN CON BACKEND
    // ===================================
    backend: {
        apiBase: process.env.API_BASE || 'http://127.0.0.1:8001/api',
        timeout: 8000,
        
        endpoints: {
            products: '/productos/',
            productImage: '/producto_imagen/',
            search: '/buscar_producto/',
            orders: '/registrar_entrega/',
            reservations: '/registrar_entrega/',
            sabores: '/sabores/',
            toppings: '/toppings/'
        },

        sheets: {
            enabled: true,
            spreadsheetId: process.env.GOOGLE_SHEET_ID || '',
            worksheets: {
                orders: 'Entregas',
                products: 'Productos',
                reservations: 'Reservas'
            }
        }
    },

    // ===================================
    // CARACTERÍSTICAS ESPECIALES
    // ===================================
    features: {
        textParser: {
            enabled: true,
            confidence: 0.9
        },

        fuzzySearch: {
            enabled: true,
            threshold: 0.6
        },

        productCache: {
            enabled: true,
            ttl: 300000  // 5 minutos
        },

        logging: {
            level: process.env.LOG_LEVEL || 'info',
            saveConversations: true,
            saveErrors: true
        }
    }
};
