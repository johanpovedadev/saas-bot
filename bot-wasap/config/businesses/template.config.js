/**
 * @fileoverview Template de Configuración por Negocio
 * 
 * Este archivo es una plantilla para crear configuraciones
 * de diferentes negocios. Copia este archivo y personaliza
 * según tu negocio.
 * 
 * @module config/businesses/template
 * @version 1.0.0
 */

'use strict';

/**
 * Configuración de negocio - TEMPLATE
 * 
 * Copia este archivo y renómbralo según tu negocio
 * Ejemplo: heladeria1.config.js, pizzeria.config.js, etc.
 */
module.exports = {
    // ===================================
    // INFORMACIÓN BÁSICA DEL NEGOCIO
    // ===================================
    business: {
        id: 'TEMPLATE_BUSINESS',                    // ID único del negocio
        name: 'Nombre del Negocio',                 // Nombre completo
        shortName: 'Negocio',                       // Nombre corto
        type: 'retail',                              // Tipo: retail, food, service, etc.
        industry: 'food-service',                    // Industria
        city: 'Ciudad',                              // Ciudad
        country: 'Colombia',                         // País
        timezone: 'America/Bogota',                  // Zona horaria
        language: 'es-CO',                           // Idioma principal
        currency: 'COP'                              // Moneda
    },

    // ===================================
    // CONTACTO Y UBICACIÓN
    // ===================================
    contact: {
        phone: '+57 300 000 0000',                   // Teléfono principal
        whatsapp: '+573000000000',                   // WhatsApp (sin espacios)
        email: 'contacto@negocio.com',               // Email
        website: 'https://www.negocio.com',          // Sitio web
        
        address: {
            street: 'Calle 123 #45-67',              // Dirección
            neighborhood: 'Barrio',                  // Barrio
            city: 'Ciudad',                          // Ciudad
            department: 'Departamento',              // Departamento
            postalCode: '000000',                    // Código postal
            coordinates: {
                lat: 0.000000,                       // Latitud
                lng: 0.000000                        // Longitud
            },
            googleMapsUrl: 'https://maps.google.com/...'  // URL de Google Maps
        },
        
        socialMedia: {
            facebook: 'https://facebook.com/negocio',
            instagram: '@negocio',
            twitter: '@negocio',
            tiktok: '@negocio'
        }
    },

    // ===================================
    // HORARIOS DE ATENCIÓN
    // ===================================
    schedule: {
        monday: { open: '09:00', close: '18:00', closed: false },
        tuesday: { open: '09:00', close: '18:00', closed: false },
        wednesday: { open: '09:00', close: '18:00', closed: false },
        thursday: { open: '09:00', close: '18:00', closed: false },
        friday: { open: '09:00', close: '18:00', closed: false },
        saturday: { open: '09:00', close: '14:00', closed: false },
        sunday: { open: '00:00', close: '00:00', closed: true },
        
        holidays: [],  // Array de fechas cerradas: ['2025-01-01', '2025-12-25']
        specialDays: [] // Días con horario especial: [{ date: '2025-12-24', open: '09:00', close: '14:00' }]
    },

    // ===================================
    // CONFIGURACIÓN DEL BOT
    // ===================================
    bot: {
        // Mensajes de bienvenida
        welcomeMessage: `¡Hola! 👋
Bienvenido a [NOMBRE NEGOCIO]

¿En qué podemos ayudarte hoy?`,

        // Menú principal
        mainMenu: {
            options: [
                { id: '1', label: 'Ver productos', emoji: '🛍️' },
                { id: '2', label: 'Información y contacto', emoji: '📍' },
                { id: '3', label: 'Hacer un pedido especial', emoji: '📦' }
            ],
            
            message: `Selecciona una opción:

*1)* 🛍️ Ver productos
*2)* 📍 Información y contacto  
*3)* 📦 Hacer un pedido especial

Escribe el número de la opción que deseas.`
        },

        // Información del negocio para mostrar
        infoMessage: `📍 *[NOMBRE NEGOCIO]*

*Dirección:*
Calle 123 #45-67, Barrio, Ciudad

*Horario:*
Lunes a Viernes: 9:00 AM - 6:00 PM
Sábado: 9:00 AM - 2:00 PM
Domingo: Cerrado

*Contacto:*
📱 WhatsApp: +57 300 000 0000
📧 Email: contacto@negocio.com
🌐 Web: www.negocio.com

*Síguenos:*
📘 Facebook: /negocio
📸 Instagram: @negocio`,

        // Configuración de fases
        phases: {
            enableBrowseImages: true,        // Habilitar navegación de imágenes
            enableProductSelection: true,    // Habilitar selección de productos
            enableCustomOrders: true,        // Habilitar pedidos personalizados
            enableReservations: true,        // Habilitar reservas
            enableAIAssistant: true          // Habilitar asistente IA
        },

        // Configuración de MIA (AI Assistant)
        ai: {
            enabled: true,
            model: 'gemini-pro',
            temperature: 0.7,
            maxTokens: 500,
            systemPrompt: 'Eres un asistente virtual de [NOMBRE NEGOCIO]...'
        },

        // Frustración del usuario
        frustration: {
            enabled: true,
            maxErrors: 3,
            notifyAdmin: true,
            muteAfterErrors: false
        },

        // Saludos
        greetings: {
            type: 'colombia',  // colombia, mexico, spain, generic
            customGreetings: []
        }
    },

    // ===================================
    // CATÁLOGO DE PRODUCTOS
    // ===================================
    catalog: {
        // Categorías de productos
        categories: [
            {
                id: 'cat1',
                name: 'Categoría 1',
                emoji: '🍦',
                description: 'Descripción de categoría',
                active: true,
                order: 1
            }
        ],

        // Configuración de productos
        products: {
            requireImage: false,             // Requiere imagen por producto
            allowCustomization: true,        // Permite personalización
            maxCustomOptions: 5,             // Máximo de opciones personalizadas
            
            // Campos personalizados
            customFields: {
                sabores: {
                    enabled: true,
                    label: 'Sabores',
                    required: false,
                    multiple: true,
                    max: 3
                },
                toppings: {
                    enabled: true,
                    label: 'Toppings',
                    required: false,
                    multiple: true,
                    max: 3
                }
            }
        },

        // Inventario
        inventory: {
            trackStock: false,               // Rastrear inventario
            showOutOfStock: true,            // Mostrar productos agotados
            allowBackorder: false            // Permitir pedidos sin stock
        }
    },

    // ===================================
    // CHECKOUT Y PAGOS
    // ===================================
    checkout: {
        // Campos requeridos
        requiredFields: {
            name: true,
            phone: true,
            address: true,
            email: false
        },

        // Métodos de pago
        paymentMethods: [
            { id: 'efectivo', name: 'Efectivo', enabled: true },
            { id: 'transferencia', name: 'Transferencia', enabled: true },
            { id: 'nequi', name: 'Nequi', enabled: true },
            { id: 'daviplata', name: 'Daviplata', enabled: true },
            { id: 'tarjeta', name: 'Tarjeta', enabled: false }
        ],

        // Delivery
        delivery: {
            enabled: true,
            freeDeliveryMinAmount: 30000,    // Monto mínimo para envío gratis
            deliveryFee: 3000,               // Costo de envío
            estimatedTime: '30-45 minutos',  // Tiempo estimado
            zones: []                        // Zonas de delivery
        },

        // Pickup
        pickup: {
            enabled: true,
            estimatedTime: '20-30 minutos'
        },

        // Validación
        validation: {
            minOrderAmount: 10000,           // Monto mínimo de pedido
            maxOrderAmount: 500000,          // Monto máximo de pedido
            maxItemsPerOrder: 20             // Máximo items por pedido
        }
    },

    // ===================================
    // ADMINISTRACIÓN
    // ===================================
    admin: {
        // JIDs de administradores
        jids: [
            // '573001234567@s.whatsapp.net'
        ],

        // Notificaciones
        notifications: {
            newOrder: true,                  // Notificar nuevo pedido
            orderCancelled: true,            // Notificar pedido cancelado
            customerIssue: true,             // Notificar problema de cliente
            lowStock: false,                 // Notificar stock bajo
            dailySummary: false              // Resumen diario
        },

        // Comandos
        commands: {
            prefix: '/',                     // Prefijo de comandos
            enabled: [
                'stats',
                'orders',
                'users',
                'broadcast',
                'reload'
            ]
        }
    },

    // ===================================
    // INTEGRACIÓN CON BACKEND
    // ===================================
    backend: {
        apiBase: 'http://127.0.0.1:8001/api',
        timeout: 8000,
        
        endpoints: {
            products: '/productos/',
            orders: '/registrar_entrega/',
            reservations: '/registrar_entrega/',
            search: '/buscar_producto/'
        },

        // Google Sheets (si aplica)
        sheets: {
            enabled: false,
            spreadsheetId: '',
            credentials: {}
        }
    },

    // ===================================
    // CARACTERÍSTICAS ESPECIALES
    // ===================================
    features: {
        // Parser de texto
        textParser: {
            enabled: true,
            confidence: 0.9
        },

        // Búsqueda fuzzy
        fuzzySearch: {
            enabled: true,
            threshold: 0.6
        },

        // Cache de productos
        productCache: {
            enabled: true,
            ttl: 300000  // 5 minutos
        },

        // Logs
        logging: {
            level: 'info',  // debug, info, warn, error
            saveConversations: true,
            saveErrors: true
        }
    }
};
