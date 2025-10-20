// Archivo: server.js
// Servidor Express completo para el sistema de órdenes por voz.
// Implementa conversación multi-turno con Twilio TwiML y manejo de estado.

// --- 1. SETUP INICIAL ---
require('dotenv').config(); 
const express = require('express');
const bodyParser = require('body-parser');
const twilio = require('twilio'); 

const Database = require('./Database');
const AsistenteIA = require('./AsistenteIA');

const app = express();
const PORT = process.env.PORT || 3000;

// Constantes de configuración (obtenidas de variables de entorno)
const ADMIN_API_KEY = process.env.ADMIN_API_KEY;

const db = new Database(); 
const asistenteIA = new AsistenteIA(); 

// Almacenamiento temporal para el estado de la conversación.
// Esto permite que el estado persista entre las múltiples peticiones de Twilio para la misma llamada (CallSid).
const conversationState = {}; 

// --- 2. MIDDLEWARES GENERALES Y SEGURIDAD ---

app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

// Middleware de Logging
app.use((req, res, next) => {
    // Excluir logs de rutas de prueba o admin para mantener limpio el registro
    if (!req.originalUrl.includes('/admin') && !req.originalUrl.includes('/ordenes-activas')) {
        console.log(`[LOG] ${new Date().toISOString()} - ${req.method} ${req.originalUrl}`);
    }
    next();
});

// Middleware de Autenticación para proteger rutas sensibles
function protegerRuta(req, res, next) {
    const apiKey = req.headers['x-api-key'];
    if (apiKey && apiKey === ADMIN_API_KEY) {
        return next();
    }
    res.status(401).json({ error: 'No autorizado. Se requiere un encabezado X-API-Key válido.' });
}

// Lógica de notificación (Simulada para el log)
async function enviarNotificacion(area, orden) {
    const items = orden.items || []; 
    console.log(`[NOTIFICACIÓN ${area.toUpperCase()}] Nueva orden #${orden.id} recibida. Área: ${area}`);
    console.log(`Detalles: ${items.map(i => i.nombre).join(' | ')}`);
}

function procesarNotificaciones(orden) {
    const itemsSeguros = orden.items || []; 
    
    // Agrupa items para notificación (barra o cocina)
    const itemsPorArea = itemsSeguros.reduce((acc, item) => {
        // Usa el área definida en AsistenteIA.js
        const area = item.area_preparacion || 'general'; 
        acc[area] = acc[area] || [];
        acc[area].push(item);
        return acc;
    }, {});

    for (const area in itemsPorArea) {
        enviarNotificacion(area, { ...orden, items: itemsPorArea[area] });
    }
}

// --- 3. FUNCIONES DE GESTIÓN DE ESTADO ---

function createInitialState(caller, callSid) {
    const defaultState = {
        caller: caller,
        callSid: callSid,
        items: [],
        personalizaciones: [],
        total: 0.00,
        stage: 'INITIAL_ORDER',
        nombreCliente: 'Cliente Anónimo',
        telefonoCliente: caller, // Usamos el CallerID de Twilio por defecto
    };
    conversationState[callSid] = defaultState;
    return defaultState;
}

function updateState(callSid, updates) {
    if (conversationState[callSid]) {
        conversationState[callSid] = { ...conversationState[callSid], ...updates };
        return conversationState[callSid];
    }
    return null;
}

function deleteState(callSid) {
    console.log(`[ESTADO] Eliminando estado de conversación para CallSid: ${callSid}`);
    delete conversationState[callSid];
}

// --- 4. RUTAS DE LA APLICACIÓN (FRONTEND) ---

// Ruta Principal (Muestra el menú real de la BD)
app.get('/', async (req, res, next) => {
    try {
        const menu = await db.obtenerMenu();
        const menuHTML = menu.map(p => 
            // FIX APLICADO AQUÍ: Asegura que p.precio es un número antes de toFixed
            `<li>${p.nombre} (<span class="font-semibold">${p.area_preparacion.toUpperCase()}</span>) - $${parseFloat(p.precio ?? 0).toFixed(2)}</li>`
        ).join('');

        const html = `
            <!DOCTYPE html>
            <html lang="es">
            <head>
                <meta charset="UTF-8">
                <title>Sistema de Órdenes IA</title>
                <script src="https://cdn.tailwindcss.com"></script>
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
            </head>
            <body class="bg-gray-50 p-8 font-sans">
                <div class="max-w-xl mx-auto bg-white p-6 rounded-xl shadow-2xl">
                    <h1 class="text-3xl font-bold text-indigo-600 mb-4 border-b pb-2">Sistema de Pedidos por Voz</h1>
                    <p class="text-gray-600 mb-6">El backend está operativo y conectado a PostgreSQL. El asistente ahora mantiene una **conversación interactiva**.</p>
                    
                    <div class="mb-6 border p-4 rounded-lg bg-gray-50">
                        <h2 class="text-xl font-semibold text-gray-800 mb-3">Menú (Base de Datos)</h2>
                        <ul class="list-disc list-inside text-gray-700 space-y-1">${menuHTML}</ul>
                    </div>
                    
                    <div class="p-4 bg-green-100 border-l-4 border-green-500 text-green-700 rounded-lg">
                        <p><strong>ESTADO: CONVERSACIÓN MULTI-TURNO HABILITADA</strong></p>
                        <p>Llama al número Twilio. La asistente esperará tu respuesta en cada paso.</p>
                        <p><strong>Ruta de Twilio:</strong> <code>/twilio-voice</code></p>
                        <p><strong>Panel Admin:</strong> <a href="/admin" class="text-indigo-600 hover:underline">/admin</a></p>
                    </div>
                </div>
            </body>
            </html>
        `;
        res.send(html);
    } catch (error) {
        next(error);
    }
});

// Ruta para obtener órdenes activas (consulta la BD real)
app.get('/ordenes-activas', async (req, res, next) => {
    try {
        const ordenesActivas = await db.obtenerOrdenesActivas();
        res.json(ordenesActivas);
    } catch (error) {
        next(error);
    }
});

// --- 5. RUTAS DEL FLUJO CONVERSACIONAL DE TWILIO (TwiML) ---

// 5.1. RUTA INICIAL: /twilio-voice (Llamada entrante)
app.post('/twilio-voice', async (req, res) => {
    const { Caller, CallSid } = req.body;
    const VoiceResponse = twilio.twiml.VoiceResponse;
    const twiml = new VoiceResponse();
    
    // Inicializa el estado de la conversación para esta llamada
    createInitialState(Caller, CallSid);

    twiml.say({ language: 'es-MX', voice: 'Polly.Lupe' }, '¡Hola! Bienvenido a Cafe Delicia. ¿Qué te gustaría ordenar hoy?');
    
    // Pasa a la primera fase de procesamiento (Orden Base)
    twiml.gather({
        input: 'speech',
        action: '/twilio-process-order-base',
        method: 'POST',
        timeout: 4,
        language: 'es-MX'
    });

    res.type('text/xml');
    res.send(twiml.toString());
});

// 5.2. FASE 1: /twilio-process-order-base (Recibe el pedido inicial)
app.post('/twilio-process-order-base', async (req, res, next) => {
    const { SpeechResult, CallSid } = req.body;
    const VoiceResponse = twilio.twiml.VoiceResponse;
    const twiml = new VoiceResponse();
    let state = conversationState[CallSid];

    if (!state || !SpeechResult) {
        twiml.say({ language: 'es-MX', voice: 'Polly.Lupe' }, 'No pude escuchar su orden. Por favor, llame de nuevo.');
        // No borramos el estado aquí, dejamos que expire o se sobreescriba.
        res.type('text/xml');
        return res.send(twiml.toString());
    }

    try {
        const iaResultado = await asistenteIA.identificarItems(SpeechResult);

        if (iaResultado.items.length === 0) {
            twiml.say({ language: 'es-MX', voice: 'Polly.Lupe' }, 'Lo siento, no pude identificar ningún producto en el menú. Por favor, intente de nuevo.');
            twiml.redirect({ method: 'POST' }, '/twilio-voice'); 
            res.type('text/xml');
            return res.send(twiml.toString());
        }

        // 1. Actualiza el estado con los items base
        // NOTA: Reiniciamos personalizaciones y total, ya que este es el punto de partida.
        state = updateState(CallSid, { 
            items: iaResultado.items, 
            personalizaciones: iaResultado.personalizaciones,
            total: iaResultado.totalInicial,
            stage: 'CUSTOMIZATION'
        });
        
        const tieneItemDeBarra = state.items.some(item => item.area_preparacion === 'barra');
        
        // 2. Transición a la siguiente fase: Customización o Upselling
        if (tieneItemDeBarra) {
            const primerItem = state.items.find(item => item.area_preparacion === 'barra').nombre;
            twiml.say({ language: 'es-MX', voice: 'Polly.Lupe' }, `¡Excelente! Un ${primerItem} anotado. ¿Te gustaría agregar un shot extra de espresso o cambiar la leche por alguna alternativa como almendra o avena?`);
            
            twiml.gather({
                input: 'speech',
                action: '/twilio-process-customizations',
                method: 'POST',
                timeout: 3,
                language: 'es-MX'
            });
        } else {
            // Si no hay café, saltamos directamente al Upselling
            twiml.say({ language: 'es-MX', voice: 'Polly.Lupe' }, '¡Perfecto! Un ' + iaResultado.items.map(i => i.nombre).join(' y un ') + ' anotado. ¿Quieres agregar algo más, como una bebida o pan dulce, para acompañar?');
            twiml.gather({
                input: 'speech',
                action: '/twilio-process-upsell',
                method: 'POST',
                timeout: 3,
                language: 'es-MX'
            });
        }

        res.type('text/xml');
        res.send(twiml.toString());
    } catch (error) {
        next(error);
    }
});

// 5.3. FASE 2: /twilio-process-customizations (Recibe la respuesta de personalización)
app.post('/twilio-process-customizations', async (req, res, next) => {
    const { SpeechResult, CallSid } = req.body;
    const VoiceResponse = twilio.twiml.VoiceResponse;
    const twiml = new VoiceResponse();
    let state = conversationState[CallSid];
    
    if (!state) {
        twiml.say({ language: 'es-MX', voice: 'Polly.Lupe' }, 'Hubo un error en su conexión. Por favor, llame de nuevo.');
        res.type('text/xml');
        return res.send(twiml.toString());
    }

    try {
        let mensajeBarista = 'Entendido.';
        if (SpeechResult) {
             const iaResultado = await asistenteIA.identificarItems(SpeechResult);
             
             // Agregamos personalizaciones si las identificó y recalculamos el total
             if (iaResultado.personalizaciones.length > 0) {
                 const newCustoms = iaResultado.personalizaciones;
                 // Asumimos que la personalización es un costo fijo (0.75) por tipo, no por cantidad.
                 const newTotal = state.total + newCustoms.length * 0.75; 
                 
                 // Actualizamos el estado con las personalizaciones y el nuevo total
                 updateState(CallSid, { 
                     personalizaciones: [...state.personalizaciones, ...newCustoms], 
                     total: newTotal,
                     stage: 'UPSELL'
                 });
                 mensajeBarista = `¡Anotado! ${newCustoms.map(c => c.name).join(' y ')} añadido.`;
             } else if (SpeechResult.toLowerCase().includes('no')) {
                 mensajeBarista = 'Perfecto, sin extras entonces.';
             }
        } else {
             mensajeBarista = 'Continuamos.';
        }

        // Transición a la siguiente fase: Upselling
        twiml.say({ language: 'es-MX', voice: 'Polly.Lupe' }, mensajeBarista);
        twiml.say({ language: 'es-MX', voice: 'Polly.Lupe' }, '¿Quieres agregar algo más a tu orden, como un pan dulce o un sándwich, para acompañar?');
        
        twiml.gather({
            input: 'speech',
            action: '/twilio-process-upsell',
            method: 'POST',
            timeout: 3,
            language: 'es-MX'
        });

        res.type('text/xml');
        res.send(twiml.toString());
    } catch (error) {
        next(error);
    }
});

// 5.4. FASE 3: /twilio-process-upsell (Recibe la respuesta de upselling/adicionales)
app.post('/twilio-process-upsell', async (req, res, next) => {
    const { SpeechResult, CallSid } = req.body;
    const VoiceResponse = twilio.twiml.VoiceResponse;
    const twiml = new VoiceResponse();
    let state = conversationState[CallSid];

    if (!state) {
        twiml.say({ language: 'es-MX', voice: 'Polly.Lupe' }, 'Hubo un error en su conexión. Por favor, llame de nuevo.');
        res.type('text/xml');
        return res.send(twiml.toString());
    }

    try {
        if (SpeechResult) {
            const iaResultado = await asistenteIA.identificarItems(SpeechResult);

            // Revisa si aceptó un upselling o añadió nuevos items
            if (iaResultado.items.length > 0 || iaResultado.aceptaUpsell) {
                
                let nuevosItems = [];
                let mensajeAdicional = '';

                // Si identificó nuevos items que no estaban en la orden (solo se considera el upselling como un nuevo item)
                if (iaResultado.items.length > 0) {
                    nuevosItems = iaResultado.items.filter(newItem => 
                        !state.items.some(existingItem => existingItem.nombre === newItem.nombre)
                    );

                    if (nuevosItems.length > 0) {
                        const newTotal = state.total + nuevosItems.reduce((sum, item) => sum + parseFloat(item.precio ?? 0), 0);
                        
                        updateState(CallSid, { 
                            items: [...state.items, ...nuevosItems], 
                            total: newTotal,
                            stage: 'PAYMENT'
                        });
                        mensajeAdicional = `¡Genial! Añadido ${nuevosItems.map(i => i.nombre).join(' y ')}.`;
                    }
                } else if (iaResultado.aceptaUpsell) {
                     // Si solo dijo "sí", respondemos positivamente pero no añadimos nada a la BD (ya que no dijo qué).
                     mensajeAdicional = '¡Perfecto! Agrega lo que quieras a tu orden inicial.';
                } else {
                     mensajeAdicional = 'De acuerdo, mantendremos su orden como está.';
                }
                
                twiml.say({ language: 'es-MX', voice: 'Polly.Lupe' }, mensajeAdicional);

            } else {
                twiml.say({ language: 'es-MX', voice: 'Polly.Lupe' }, 'De acuerdo, no hay problema.');
            }
        } else {
            twiml.say({ language: 'es-MX', voice: 'Polly.Lupe' }, 'Continuamos con su orden inicial.');
        }

        // 1. Resumen final (se actualiza el estado por si hubo upselling)
        state = conversationState[CallSid]; // Re-leer el estado actualizado
        let itemSummary = state.items.map(item => item.nombre).join(' y ');
        if (state.personalizaciones.length > 0) {
            itemSummary += ` con ${state.personalizaciones.map(c => c.name).join(', ')}.`;
        }
        
        const totalFormat = state.total.toFixed(2);
        twiml.say({ language: 'es-MX', voice: 'Polly.Lupe' }, `Muy bien. Su pedido es: ${itemSummary}. El total es de $${totalFormat}.`);
        
        // 2. Pregunta de Pago
        twiml.say({ language: 'es-MX', voice: 'Polly.Lupe' }, '¿Prefieres pagar ahora por teléfono o cuando llegues a la cafetería?');
        twiml.gather({
            input: 'speech',
            action: '/twilio-process-payment',
            method: 'POST',
            timeout: 3,
            language: 'es-MX'
        });

        res.type('text/xml');
        res.send(twiml.toString());
    } catch (error) {
        next(error);
    }
});

// 5.5. FASE 4: /twilio-process-payment (Recibe la preferencia de pago)
app.post('/twilio-process-payment', async (req, res, next) => {
    const { SpeechResult, CallSid } = req.body;
    const VoiceResponse = twilio.twiml.VoiceResponse;
    const twiml = new VoiceResponse();
    let state = conversationState[CallSid];

    if (!state) {
        twiml.say({ language: 'es-MX', voice: 'Polly.Lupe' }, 'Hubo un error en su conexión. Por favor, llame de nuevo.');
        res.type('text/xml');
        return res.send(twiml.toString());
    }

    try {
        const iaResultado = await asistenteIA.identificarItems(SpeechResult || "");
        
        // 1. Manejo de Pago
        if (iaResultado.pagoAhora) {
            // Si el cliente dijo 'ahora' o 'teléfono'
            twiml.say({ language: 'es-MX', voice: 'Polly.Lupe' }, '¡Excelente! Puede pagar con tarjeta al llegar a la cafetería.');
        } else {
            // Pago al llegar
            twiml.say({ language: 'es-MX', voice: 'Polly.Lupe' }, '¡Excelente! Entonces, pagas al llegar. Para registrar tu pedido, ¿podrías decirme tu nombre completo y número de teléfono?');
        }

        // 2. Finalización y Almacenamiento de la orden
        
        // Preparamos los items para la BD (combinando base + personalizaciones)
        const finalItems = state.items.map(item => {
            const isBarItem = item.area_preparacion === 'barra';
            let name = item.nombre;
            if (isBarItem && state.personalizaciones.length > 0) {
                 name += ` (${state.personalizaciones.map(c => c.name).join(', ')})`;
            }
            return {
                nombre: name,
                area_preparacion: item.area_preparacion,
                // Usamos parseFloat aquí por seguridad, aunque este precio es solo informativo
                precio: parseFloat(item.precio ?? 0)
            };
        });
        
        const transcripcionFinal = `Pedido de ${state.caller} (Total: $${state.total.toFixed(2)}). Items: ${finalItems.map(i => i.nombre).join(', ')}.`;
        
        // Usamos el número de Twilio si no se especificó un número en esta fase (SpeechResult)
        const numeroCliente = state.telefonoCliente; 

        // Generamos la orden en la BD
        const nuevaOrden = await db.agregarOrden(finalItems, numeroCliente, transcripcionFinal);
        
        // 3. Notificar a las áreas
        procesarNotificaciones(nuevaOrden);

        // 4. Respuesta final y despedida
        twiml.say({ language: 'es-MX', voice: 'Polly.Lupe' }, `Su orden ha sido registrada con el número ${nuevaOrden.id}. Estará lista en breve. ¡Te esperamos en Cafe Delicia!`);
        
        // 5. Limpiamos el estado al finalizar
        deleteState(CallSid);

        res.type('text/xml');
        res.send(twiml.toString());
    } catch (error) {
        next(error);
    }
});

// 5.6. Manejo de Fallbacks si Twilio no recibe respuesta o hay error de transcripción
app.post('/twilio-process-order-base-fallback', (req, res) => {
    const VoiceResponse = twilio.twiml.VoiceResponse;
    const twiml = new VoiceResponse();
    twiml.say({ language: 'es-MX', voice: 'Polly.Lupe' }, 'Parece que no escuché nada. Por favor, ¿podría repetir su orden?');
    twiml.redirect('/twilio-voice'); // Reinicia la conversación
    res.type('text/xml');
    res.send(twiml.toString());
});


// --- 6. RUTAS DEL PANEL DE ADMINISTRACIÓN (PROTEGIDAS) ---

// Ruta protegida para actualizar el estado de una orden
app.put('/ordenes/:id/estado', protegerRuta, async (req, res, next) => {
    const { id } = req.params;
    const { estado } = req.body;
    try {
        const ordenActualizada = await db.actualizarEstadoOrden(id, estado);
        res.json({ message: `Orden ${id} actualizada a estado: ${estado}`, orden: ordenActualizada });
    } catch (error) {
        next(error);
    }
});

// Ruta protegida para reiniciar la DB de órdenes
app.post('/reiniciar', protegerRuta, async (req, res, next) => {
    try {
        const result = await db.reiniciarOrdenes();
        res.json(result);
    } catch (error) {
        next(error);
    }
});

// Ruta para el HTML del panel de administración (Frontend JS para interactuar con el backend)
app.get('/admin', async (req, res) => {
    const html = `
        <!DOCTYPE html>
        <html lang="es">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Panel de Administración</title>
            <script src="https://cdn.tailwindcss.com"></script>
        </head>
        <body class="bg-gray-100 p-6">
            <div class="max-w-5xl mx-auto">
                <h1 class="text-3xl font-extrabold text-gray-800 mb-6 border-b pb-3">Panel de Administración de Órdenes</h1>
                
                <div id="loader" class="text-center p-4 text-gray-500 hidden">Cargando órdenes...</div>
                
                <div id="api-key-info" class="bg-indigo-100 p-4 rounded-xl mb-6 shadow-md text-sm border-2 border-indigo-300">
                    <p class="font-bold text-indigo-800">CLAVE DE ADMINISTRACIÓN (X-API-Key):</p>
                    <code id="admin-key" class="block bg-indigo-200 p-2 rounded mt-1 select-all font-mono text-base">${ADMIN_API_KEY}</code>
                    <p class="mt-2 text-indigo-700">Utiliza esta clave en el encabezado <code>X-API-Key</code> para las operaciones sensibles.</p>
                </div>

                <div class="flex justify-between items-center mb-4">
                    <h2 class="text-2xl font-semibold text-gray-700">Órdenes Activas</h2>
                    <button onclick="fetchOrders()" class="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg shadow-md transition duration-150 transform hover:scale-105">
                        <svg class="w-4 h-4 inline-block mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path></svg>
                        Refrescar
                    </button>
                </div>
                
                <div id="orders-list" class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    <!-- Las órdenes se renderizarán aquí -->
                </div>

            </div>

            <script>
                // Cliente JS para el panel de administración
                const ADMIN_API_KEY = document.getElementById('admin-key').textContent.trim();
                const API_BASE_URL = window.location.origin;

                function showCustomAlert(message) {
                    const alertDiv = document.createElement('div');
                    alertDiv.className = 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50';
                    
                    alertDiv.innerHTML = '<div class="bg-white p-6 rounded-lg shadow-2xl max-w-sm w-full">' +
                                         '<h3 class="text-xl font-bold mb-3 text-red-600">Alerta</h3>' +
                                         '<p class="text-gray-700 mb-4">' + message + '</p>' +
                                         '<button id="close-alert" class="w-full bg-red-500 hover:bg-red-600 text-white font-medium py-2 rounded-lg transition duration-150">Cerrar</button>' +
                                         '</div>';

                    document.body.appendChild(alertDiv);
                    document.getElementById('close-alert').onclick = () => document.body.removeChild(alertDiv);
                }

                async function updateStatus(orderId, newStatus) {
                    const statusMap = {
                        'recibida': 'en_preparacion',
                        'en_preparacion': 'lista_para_servir',
                        'lista_para_servir': 'completada',
                        // Si ya está completada, la siguiente acción es solo completada.
                        'completada': 'completada' 
                    };
                    
                    const nextStatus = statusMap[newStatus];
                    if (!nextStatus || newStatus === 'completada') return;

                    showCustomAlert('La funcionalidad de confirmación necesita una implementación modal. Continuaremos con la acción para debug. Orden #' + orderId + ' a "' + nextStatus.toUpperCase().replace('_', ' ') + '".');

                    try {
                        const response = await fetch(API_BASE_URL + '/ordenes/' + orderId + '/estado', {
                            method: 'PUT',
                            headers: {
                                'Content-Type': 'application/json',
                                'X-API-Key': ADMIN_API_KEY
                            },
                            body: JSON.stringify({ estado: nextStatus })
                        });

                        const result = await response.json();
                        if (response.ok) {
                            console.log(result.message);
                            fetchOrders();
                        } else {
                            console.error('Error al actualizar:', result.error);
                            showCustomAlert('Error al actualizar el estado: ' + (result.error || 'Fallo de autenticación.'));
                        }
                    } catch (error) {
                        console.error('Fallo en la conexión:', error);
                        showCustomAlert('Error de red al actualizar el estado.');
                    }
                }

                function getStatusColor(status) {
                    switch (status) {
                        case 'recibida': return 'bg-yellow-100 text-yellow-800 ring-1 ring-yellow-400';
                        case 'en_preparacion': return 'bg-blue-100 text-blue-800 ring-1 ring-blue-400';
                        case 'lista_para_servir': return 'bg-green-100 text-green-800 ring-1 ring-green-400';
                        case 'completada': return 'bg-gray-200 text-gray-700 ring-1 ring-gray-400';
                        default: return 'bg-red-100 text-red-800 ring-1 ring-red-400';
                    }
                }
                
                function renderOrders(orders) {
                    const list = document.getElementById('orders-list');
                    list.innerHTML = orders.length === 0 ? '<p class="text-center col-span-full p-8 text-gray-500 bg-white rounded-xl shadow-inner">🎉 ¡No hay órdenes activas! 🎉</p>' : '';

                    orders.forEach(order => {
                        const date = new Date(order.fecha).toLocaleTimeString('es-MX', {hour: '2-digit', minute:'2-digit', second:'2-digit'});
                        const card = document.createElement('div');
                        card.className = 'bg-white p-6 rounded-xl shadow-lg border-t-4 border-indigo-400 hover:shadow-xl transition duration-300';
                        
                        const statusClass = getStatusColor(order.estado);
                        const isRecibida = order.estado === 'recibida';
                        const isEnPreparacion = order.estado === 'en_preparacion';
                        const isLista = order.estado === 'lista_para_servir';
                        const isCompletada = order.estado === 'completada';
                        
                        // Determinar el texto del botón de acción
                        let nextButtonText = 'A Preparación';
                        if (isEnPreparacion) nextButtonText = 'Lista para Servir';
                        if (isLista) nextButtonText = 'Completada';
                        if (isCompletada) nextButtonText = 'Completada (Finalizado)';
                        
                        // Determinar la clase del botón de acción
                        let nextButtonColor = 'bg-blue-500 hover:bg-blue-600';
                        if (isEnPreparacion) nextButtonColor = 'bg-yellow-500 hover:bg-yellow-600';
                        if (isLista) nextButtonColor = 'bg-green-500 hover:bg-green-600';
                        if (isCompletada) nextButtonColor = 'bg-gray-400 cursor-not-allowed';


                        card.innerHTML = '<div class="flex justify-between items-start mb-3">' +
                                         '<h3 class="text-2xl font-bold text-gray-900">#' + order.id + '</h3>' +
                                         '<span class="px-3 py-1 text-xs font-semibold rounded-full ' + statusClass + '">' +
                                         order.estado.toUpperCase().replace('_', ' ') +
                                         '</span>' +
                                         '</div>' +
                                         '<p class="text-sm text-gray-500 mb-2">Hora: ' + date + ' | Teléfono: ' + order.telefono + '</p>' +
                                         '<p class="mb-4 text-gray-700 italic border-l-4 pl-3 border-gray-200">"' + order.transcripcion + '"</p>' +
                                         '<div class="space-y-2 pt-4 border-t border-gray-100">' +
                                         '<p class="font-semibold text-gray-800">Acción:</p>' +
                                         
                                         '<button onclick="updateStatus(' + order.id + ', \'' + order.estado + '\')" ' +
                                         'class="w-full text-white font-medium py-2 rounded-lg transition duration-150 shadow-md ' + nextButtonColor + (isCompletada ? ' opacity-50' : '') + '" ' +
                                         (isCompletada ? 'disabled' : '') + '>' +
                                         nextButtonText +
                                         '</button>' +
                                         
                                         '</div>';

                        list.appendChild(card);
                    });
                }

                async function fetchOrders() {
                    document.getElementById('loader').classList.remove('hidden');
                    try {
                        const response = await fetch(API_BASE_URL + '/ordenes-activas');
                        const orders = await response.json();
                        renderOrders(orders);
                    } catch (error) {
                        document.getElementById('orders-list').innerHTML = '<p class="text-center col-span-full p-8 text-red-500 bg-white rounded-xl shadow-inner">❌ Error al cargar las órdenes. Verifica tu conexión a la BD.</p>';
                        console.error('Fallo al obtener órdenes:', error);
                    } finally {
                        document.getElementById('loader').classList.add('hidden');
                    }
                }

                // Cargar órdenes al iniciar la página
                window.onload = fetchOrders;
            </script>
        </body>
        </html>
    `;
    res.send(html);
});

// --- 7. MANEJADOR DE ERRORES GLOBAL ---
app.use((error, req, res, next) => {
    console.error('[ERROR GLOBAL]', error);
    if (res.headersSent) {
        return next(error);
    }
    // Asegura que Twilio reciba una respuesta válida en caso de error
    if (req.originalUrl.includes('twilio')) {
        const VoiceResponse = twilio.twiml.VoiceResponse;
        const twiml = new VoiceResponse();
        // Intentamos limpiar el estado de la llamada que falló
        if (req.body.CallSid) { deleteState(req.body.CallSid); } 
        twiml.say({ language: 'es-MX', voice: 'Polly.Lupe' }, 'Lo sentimos, ha ocurrido un error grave en el sistema. Por favor, inténtelo de nuevo más tarde.');
        twiml.hangup();
        res.type('text/xml');
        return res.status(500).send(twiml.toString());
    }
    
    // Para peticiones HTTP normales (API y Admin)
    res.status(500).json({ 
        error: 'Ocurrió un error interno del servidor.', 
        details: error.message 
    });
});

// Inicialización del Servidor
db.verificarTablas().then(() => {
    console.log("Inicialización segura exitosa. Servidor listo.");
    app.listen(PORT, () => {
        console.log(`Servidor Express escuchando en el puerto ${PORT}`);
        console.log(`URL Local: http://localhost:${PORT}`);
    });
}).catch(error => {
    console.error("Error fatal al inicializar la base de datos:", error);
    process.exit(1);
});
