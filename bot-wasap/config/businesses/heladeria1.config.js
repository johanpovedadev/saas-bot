/**
 * @fileoverview Configuración de Empanadas Riohacha
 * 
 * Configuración específica para la tienda Empanadas Riohacha
 * ubicada en Riohacha, Colombia.
 * 
 * @module config/businesses/empanadas1
 * @version 1.0.0
 */

'use strict';

module.exports = {
    // ===================================
    // INFORMACIÓN BÁSICA DEL NEGOCIO
    // ===================================
    business: {
        id: 'EMPANADAS_RIOHACHA',
        name: 'Empanadas Riohacha',
        shortName: 'Empanadas',
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
        email: 'contacto@empanadasriohacha.com',
        website: null,
        
        address: {
            street: 'Calle Principal',  // TODO: Actualizar dirección
            neighborhood: 'Centro',
            city: 'Riohacha',
            department: 'La Guajira',
            postalCode: '110111',
            coordinates: {
                lat: 4.711,
                lng: -74.0721
            },
            googleMapsUrl: null  // TODO: Agregar URL
        },
        
        socialMedia: {
            facebook: null,
            instagram: '@empanadasriohacha',  // TODO: Verificar handle
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
        welcomeMessage: `¡Hola! 👋
Bienvenido a Empanadas Riohacha 🥟
¿Listo para pedir las mejores empanadas de la ciudad?`,

        mainMenu: {
            options: [
                { id: '1', label: 'Ver productos y precios de empanadas', emoji: '🥟' },
                { id: '2', label: 'Dirección y horarios', emoji: '📍' },
                { id: '3', label: 'Pedidos para eventos o grandes cantidades', emoji: '📦' }
            ],
            
            message: `*1)* 🥟 Ver productos y precios de empanadas
*2)* 📍 Dirección y horarios
*3)* 📦 Pedidos para eventos o grandes cantidades

✨ Escribe solo el número de la opción (1, 2 o 3).
Si te equivocas, no pasa nada 💛`
        },

        infoMessage: `📍 *Empanadas Riohacha*

*Dirección:*
[DIRECCIÓN] - Riohacha, La Guajira

*Horario:*
Lunes a Jueves: 9:00 AM - 8:00 PM
Viernes y Sábado: 9:00 AM - 9:00 PM
Domingo: 10:00 AM - 8:00 PM

*Contacto:*
📱 WhatsApp: [NÚMERO]
📧 Email: contacto@empanadasriohacha.com

*Síguenos:*
📸 Instagram: @empanadasriohacha`,

        phases: {
            enableBrowseImages: false, // Desactivar imágenes en el menú
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
            systemPrompt: `Eres un asistente virtual amigable de Empanadas Riohacha.
Tu objetivo es ayudar a los clientes a hacer pedidos de empanadas de manera rápida y eficiente.
Usa un tono cálido, amigable y profesional, típico de la región Caribe colombiana.
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
                'epa empanadas riohacha',
                'hola empanadas riohacha',
                'buenas empanadas riohacha'
            ]
        }
    },

    // ===================================
    // CATÁLOGO DE PRODUCTOS
    // ===================================
    catalog: {
        categories: [
            {
                id: 'empanadas',
                name: 'Empanadas',
                emoji: '🥟',
                description: 'Empanadas artesanales de diferentes sabores',
                active: true,
                order: 1
            },
            {
                id: 'bebidas',
                name: 'Bebidas',
                emoji: '🥤',
                description: 'Bebidas frías y calientes',
                active: true,
                order: 2
            },
            {
                id: 'salsas',
                name: 'Salsas',
                emoji: '🧂',
                description: 'Salsas para acompañar tus empanadas',
                active: true,
                order: 3
            }
        ],

        products: {
            requireImage: false,
            allowCustomization: true,
            maxCustomOptions: 3,
            
            customFields: {
                relleno: {
                    enabled: true,
                    label: 'Tipo de relleno',
                    required: true,
                    multiple: false,
                    options: [
                        'Carne', 'Pollo', 'Queso', 'Mixta', 'Vegetariana'
                    ]
                },
                salsa: {
                    enabled: true,
                    label: 'Salsa',
                    required: false,
                    multiple: true,
                    max: 2,
                    options: [
                        'Aji', 'Rosada', 'Mayo', 'Mostaza', 'Sin Salsa'
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
            // Ejemplo: '573001234567@c.us'
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
    },    // ===================================
    // INTEGRACIÓN CON BACKEND
    // ===================================
    backend: {
        apiBase: process.env.API_BASE || 'http://127.0.0.1:8000/api',
        timeout: 8000,
        
        endpoints: {
            products: '/productos/',
            productImage: '/producto_imagen/',
            search: '/buscar_producto/',
            orders: '/registrar_entrega/',
            reservations: '/registrar_entrega/'
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
