'use strict';

module.exports = {
    business: {
        id: 'SEGUROS_MASCOTAS',
        name: 'Seguros Mascotas',
        shortName: 'Seguros Mascotas',
        type: 'seguros_mascotas',
        industry: 'insurance',
        city: 'Bogotá',
        department: 'Cundinamarca',
        country: 'Colombia',
        timezone: 'America/Bogota',
        language: 'es-CO',
        currency: 'COP'
    },

    contact: {
        phone: '+57 313 877 7115',
        whatsapp: '+573138777115',
        email: 'seguros@mascotas.co',
        website: 'https://www.segurosmundial.com.co/pagos/',

        address: {
            street: 'Av Principal #123',
            neighborhood: 'Centro',
            city: 'Bogotá',
            department: 'Cundinamarca',
            postalCode: '110111',
            coordinates: { lat: 4.711, lng: -74.0721 },
            googleMapsUrl: null
        },

        socialMedia: {
            facebook: null,
            instagram: null,
            twitter: null,
            tiktok: null
        }
    },

    schedule: {
        monday: { open: '08:00', close: '18:00', closed: false },
        tuesday: { open: '08:00', close: '18:00', closed: false },
        wednesday: { open: '08:00', close: '18:00', closed: false },
        thursday: { open: '08:00', close: '18:00', closed: false },
        friday: { open: '08:00', close: '18:00', closed: false },
        saturday: { open: '09:00', close: '14:00', closed: false },
        sunday: { open: '00:00', close: '00:00', closed: true },
        holidays: [],
        specialDays: []
    },

    bot: {
        welcomeMessage: `🐾 Hola, bienvenido

Sabemos que tu mascota es parte de tu familia ❤️
Aquí puedes protegerla fácil, rápido y sin complicaciones.

¿A quién quieres cuidar hoy?

1️⃣ Perro 🐶
2️⃣ Gato 🐱`,

        mainMenu: {
            options: [
                { id: '1', label: 'Perro 🐶', emoji: '🐶' },
                { id: '2', label: 'Gato 🐱', emoji: '🐱' }
            ],
            message: `🐾 Sabemos que tu mascota es parte de tu familia ❤️

¿A quién quieres cuidar hoy?

1️⃣ Perro 🐶
2️⃣ Gato 🐱

Escribe el número de la opción.`
        },

        infoMessage: `📍 *Seguros Mascotas*

Protege a tu mascota con los mejores planes.

*Contacto:*
📱 WhatsApp: +57 313 877 7115
🌐 Web: segurosmundial.com.co/pagos/`,

        phases: {
            enableBrowseImages: false,
            enableProductSelection: false,
            enableCustomOrders: false,
            enableReservations: false,
            enableAIAssistant: false
        },

        ai: {
            enabled: false,
            model: '',
            temperature: 0.7,
            maxTokens: 0,
            systemPrompt: ''
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
                'hola seguro mascotas',
                'hola seguros mascotas',
                'buenas seguro mascotas',
                'proteccion mascotas',
                'seguro perro',
                'seguro gato',
                'quiero proteger'
            ]
        },

        // 🐾 FLUJO COMPLETO DE SEGURO MASCOTAS
        insuranceFlow: {
            enabled: true,

            // Imágenes (rutas relativas a bot-wasap/)
            images: {
                gato: 'assets/plan_gato.jpeg',
                perroPlus: 'assets/plan_perro_plus.jpeg',
                perroPremium: 'assets/plan_perro_premium.jpeg'
            },

            messages: {
                gato: `🐱 Protección para tu gato en todo momento

✨ Atención veterinaria
✨ Cobertura por accidentes
✨ Asistencia exequial

¿Deseas continuar?

1️⃣ Sí, continuar`,

                perroPlus: `🐶 Plan PLUS

Protección esencial para tu compañero de vida 🐾

1️⃣ Elegir este plan
2️⃣ Ver plan PREMIUM`,

                perroPremium: `🐶 Plan PREMIUM

Máxima protección para quien más quieres ❤️

1️⃣ Elegir este plan`,

                datosTitular: `Perfecto 🙌

Vamos a proteger a tu mascota 🐾

✍️ ¿Cuál es tu nombre completo?`,

                datosTitularDocumento: `📄 ¿Qué tipo de documento tienes?`,

                datosTitularNumero: `🔢 ¿Cuál es tu número de identificación?`,

                datosTitularFechaExp: `📅 ¿Fecha de expedición del documento?`,

                datosTitularCiudad: `📍 ¿Ciudad?`,

                datosTitularDireccion: `🏠 ¿Dirección?`,

                datosTitularContacto: `📞 ¿Número de contacto?`,

                datosTitularEmail: `📧 ¿Correo electrónico?`,

                datosMascotaNombre: `🐾 ¿Cómo se llama tu mascota?`,

                datosMascotaEdad: `🎂 ¿Año de nacimiento?`,

                datosMascotaRaza: `🦴 ¿Qué raza es?`,

                datosMascotaColor: `🎨 ¿Color de la mascota?`,

                datosMascotaGenero: `⚧️ ¿Género?

1️⃣ Macho
2️⃣ Hembra`,

                confirmacion: `💛 Ya casi terminamos

Confirma tu información:

👤 {nombre}
🐾 {mascota}
📦 {plan}

1️⃣ Confirmar
2️⃣ Corregir`,

                pago: `✨ Estás a un paso de proteger a quien amas

Realiza tu pago aquí:

https://www.segurosmundial.com.co/pagos/

Cuando termines escribe:
LISTO`,

                final: `🎉 ¡Listo!

Tu solicitud fue registrada 💛

Un asesor validará tu pago y te enviará la póliza.

Gracias por cuidar a tu compañero de vida 🐾`,

                error: `❌ Opción no válida

Por favor selecciona una opción del menú.`
            }
        }
    },

    catalog: {
        categories: [],
        products: {
            requireImage: false,
            allowCustomization: false,
            maxCustomOptions: 0,
            customFields: {}
        },
        inventory: {
            trackStock: false,
            showOutOfStock: true,
            allowBackorder: false
        }
    },

    checkout: {
        requiredFields: {
            name: true,
            phone: true,
            address: false,
            email: false
        },
        paymentMethods: [
            { id: 'transferencia', name: 'Transferencia Bancaria 🏦', enabled: true }
        ],
        delivery: {
            enabled: false,
            freeDeliveryMinAmount: 0,
            deliveryFee: 0,
            estimatedTime: '',
            zones: []
        },
        pickup: {
            enabled: false,
            estimatedTime: ''
        },
        validation: {
            minOrderAmount: 0,
            maxOrderAmount: 0,
            maxItemsPerOrder: 0
        }
    },

    admin: {
        jids: [
            '573138777115@c.us'
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
            enabled: ['stats', 'users', 'broadcast', 'reload', 'clear', 'mute', 'unmute']
        }
    },

    backend: {
        apiBase: process.env.API_BASE || 'http://127.0.0.1:8001/api',
        timeout: 8000,
        endpoints: {
            products: '',
            productImage: '',
            search: '',
            orders: '',
            reservations: ''
        },
        sheets: {
            enabled: false,
            spreadsheetId: '',
            worksheets: {}
        }
    },

    features: {
        textParser: {
            enabled: false,
            confidence: 0.9
        },
        fuzzySearch: {
            enabled: false,
            threshold: 0.6
        },
        productCache: {
            enabled: false,
            ttl: 300000
        },
        logging: {
            level: 'info',
            saveConversations: true,
            saveErrors: true
        }
    }
};
