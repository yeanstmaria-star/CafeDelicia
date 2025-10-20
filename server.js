// Archivo: server.js
// Servidor Express completo para el sistema de órdenes por voz.
// Implementa conversación multi-turno con Twilio TwiML y manejo de estado.
// Esta versión utiliza un bucle de conversación unificado para una experiencia más natural.

// --- 1. SETUP INICIAL ---
require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const twilio = require('twilio');

const Database = require('./Database');
const AsistenteIA = require('./AsistenteIA');

const app = express();
const PORT = process.env.PORT || 3000;

const ADMIN_API_KEY = process.env.ADMIN_API_KEY;

const db = new Database();
const asistenteIA = new AsistenteIA();

// Almacenamiento temporal para el estado de la conversación.
const conversationState = {};

// --- 2. MIDDLEWARES Y UTILIDADES ---

app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

app.use((req, res, next) => {
    if (!req.originalUrl.includes('/admin') && !req.originalUrl.includes('/ordenes-activas')) {
        console.log(`[LOG] ${new Date().toISOString()} - ${req.method} ${req.originalUrl}`);
    }
    next();
});

function protegerRuta(req, res, next) {
    const apiKey = req.headers['x-api-key'];
    if (apiKey && apiKey === ADMIN_API_KEY) {
        return next();
    }
    res.status(401).json({ error: 'No autorizado. Se requiere un encabezado X-API-Key válido.' });
}

async function enviarNotificacion(area, orden) {
    const items = orden.items || [];
    console.log(`[NOTIFICACIÓN ${area.toUpperCase()}] Nueva orden #${orden.id} para ${orden.nombreCliente}.`);
    console.log(`Detalles: ${items.map(i => i.nombre).join(' | ')}`);
}

function procesarNotificaciones(orden) {
    const itemsPorArea = (orden.items || []).reduce((acc, item) => {
        const area = item.area_preparacion || 'general';
        acc[area] = acc[area] || [];
        acc[area].push(item);
        return acc;
    }, {});

    for (const area in itemsPorArea) {
        enviarNotificacion(area, { ...orden, items: itemsPorArea[area] });
    }
}

// --- 3. GESTIÓN DE ESTADO DE CONVERSACIÓN ---

function getOrCreateState(caller, callSid) {
    if (conversationState[callSid]) {
        return conversationState[callSid];
    }
    const newState = {
        caller: caller,
        callSid: callSid,
        items: [],
        personalizaciones: [],
        total: 0.00,
        stage: 'INITIAL_ORDER',
        nombreCliente: 'Cliente Anónimo',
        telefonoCliente: caller,
    };
    conversationState[callSid] = newState;
    return newState;
}

function updateState(callSid, updates) {
    if (conversationState[callSid]) {
        conversationState[callSid] = { ...conversationState[callSid], ...updates };
    }
}

function deleteState(callSid) {
    console.log(`[ESTADO] Eliminando estado de conversación para CallSid: ${callSid}`);
    delete conversationState[callSid];
}


// --- 4. RUTAS FRONTEND Y ADMIN ---

app.get('/', async (req, res, next) => {
    try {
        const menu = await db.obtenerMenu();
        const menuHTML = menu.map(p =>
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
                    <p class="text-gray-600 mb-6">El backend está operativo y conectado a PostgreSQL. El asistente ahora mantiene una **conversación interactiva y natural**.</p>
                    <div class="mb-6 border p-4 rounded-lg bg-gray-50">
                        <h2 class="text-xl font-semibold text-gray-800 mb-3">Menú (Base de Datos)</h2>
                        <ul class="list-disc list-inside text-gray-700 space-y-1">${menuHTML}</ul>
                    </div>
                    <div class="p-4 bg-green-100 border-l-4 border-green-500 text-green-700 rounded-lg">
                        <p><strong>ESTADO: IA CONVERSACIONAL HABILITADA</strong></p>
                        <p><strong>Ruta de Twilio:</strong> <code>/twilio-conversation</code></p>
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

app.get('/ordenes-activas', async (req, res, next) => {
    try {
        const ordenesActivas = await db.obtenerOrdenesActivas();
        res.json(ordenesActivas);
    } catch (error) {
        next(error);
    }
});


// --- 5. LÓGICA DE CONVERSACIÓN UNIFICADA CON TWILIO ---

// Ruta inicial y de bucle para toda la conversación
app.post('/twilio-conversation', async (req, res, next) => {
    const { Caller, CallSid, SpeechResult } = req.body;
    const VoiceResponse = twilio.twiml.VoiceResponse;
    const twiml = new VoiceResponse();

    try {
        const estadoActual = getOrCreateState(Caller, CallSid);

        // Si es la primera interacción (no hay SpeechResult), dar el saludo inicial.
        if (!SpeechResult) {
            twiml.say({ language: 'es-MX', voice: 'Polly.Lupe' }, '¡Hola! Bienvenido a Cafe Delicia. ¿Qué te gustaría ordenar hoy?');
        } else {
            // Procesar la respuesta del cliente con la IA
            const respuestaIA = await asistenteIA.procesarConversacion(SpeechResult, estadoActual);
            updateState(CallSid, respuestaIA.estadoActualizado);

            twiml.say({ language: 'es-MX', voice: 'Polly.Lupe' }, respuestaIA.mensaje);

            // Si la orden está finalizada, guardar en DB y colgar.
            if (respuestaIA.estadoActualizado.stage === 'FINALIZED') {
                const estadoFinal = respuestaIA.estadoActualizado;
                const transcripcionFinal = `Pedido de ${estadoFinal.nombreCliente} (${estadoFinal.telefonoCliente}). Total: $${estadoFinal.total.toFixed(2)}. Items: ${estadoFinal.items.map(i => i.nombre).join(', ')}.`;
                
                const nuevaOrden = await db.agregarOrden(estadoFinal.items, estadoFinal.telefonoCliente, transcripcionFinal, estadoFinal.nombreCliente);
                
                procesarNotificaciones(nuevaOrden);
                
                twiml.say({ language: 'es-MX', voice: 'Polly.Lupe' }, `Tu orden ha sido registrada con el número ${nuevaOrden.id}. ¡Gracias por llamar a Cafe Delicia!`);
                twiml.hangup();
                deleteState(CallSid); // Limpiar estado al final
                
                res.type('text/xml');
                return res.send(twiml.toString());
            }
        }
        
        // Continuar la conversación: esperar la siguiente respuesta del cliente
        twiml.gather({
            input: 'speech',
            action: '/twilio-conversation', // Vuelve a esta misma ruta para continuar el bucle
            method: 'POST',
            timeout: 3, // Reducido para minimizar silencios
            language: 'es-MX'
        });

        res.type('text/xml');
        res.send(twiml.toString());

    } catch (error) {
        next(error);
    }
});


// --- 6. RUTAS DEL PANEL DE ADMINISTRACIÓN (SIN CAMBIOS) ---
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
                
                <div id="api-key-info" class="bg-indigo-100 p-4 rounded-xl mb-6 shadow-md text-sm border-2 border-indigo-300">
                    <p class="font-bold text-indigo-800">CLAVE DE ADMINISTRACIÓN (X-API-Key):</p>
                    <code id="admin-key" class="block bg-indigo-200 p-2 rounded mt-1 select-all font-mono text-base">${ADMIN_API_KEY}</code>
                </div>

                <div class="flex justify-between items-center mb-4">
                    <h2 class="text-2xl font-semibold text-gray-700">Órdenes Activas</h2>
                    <button onclick="fetchOrders()" class="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg shadow-md transition">Refrescar</button>
                </div>
                
                <div id="orders-list" class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6"></div>

            </div>

            <script>
                const ADMIN_API_KEY = document.getElementById('admin-key').textContent.trim();
                const API_BASE_URL = window.location.origin;
                
                // ... (El resto del script del admin panel no necesita cambios) ...

                async function updateStatus(orderId, currentStatus) {
                    const statusMap = {
                        'recibida': 'en_preparacion',
                        'en_preparacion': 'lista_para_servir',
                        'lista_para_servir': 'completada',
                        'completada': 'completada'
                    };
                    const nextStatus = statusMap[currentStatus];
                    if (!nextStatus || currentStatus === 'completada') return;

                    try {
                        const response = await fetch(API_BASE_URL + '/ordenes/' + orderId + '/estado', {
                            method: 'PUT',
                            headers: { 'Content-Type': 'application/json', 'X-API-Key': ADMIN_API_KEY },
                            body: JSON.stringify({ estado: nextStatus })
                        });
                        if (response.ok) fetchOrders();
                        else console.error('Error al actualizar');
                    } catch (error) {
                        console.error('Fallo de red al actualizar');
                    }
                }
                
                function getStatusColor(status) {
                    const colors = {
                        recibida: 'bg-yellow-100 text-yellow-800 ring-yellow-400',
                        en_preparacion: 'bg-blue-100 text-blue-800 ring-blue-400',
                        lista_para_servir: 'bg-green-100 text-green-800 ring-green-400',
                        completada: 'bg-gray-200 text-gray-700 ring-gray-400'
                    };
                    return colors[status] || 'bg-red-100 text-red-800';
                }

                function renderOrders(orders) {
                    const list = document.getElementById('orders-list');
                    list.innerHTML = orders.length === 0 ? '<p class="text-center col-span-full p-8 text-gray-500">No hay órdenes activas.</p>' : '';
                    orders.forEach(order => {
                        const date = new Date(order.fecha).toLocaleTimeString('es-MX');
                        const card = document.createElement('div');
                        card.className = 'bg-white p-6 rounded-xl shadow-lg border-t-4 border-indigo-400';
                        
                        const isCompletada = order.estado === 'completada';
                        const nextStatusText = {
                            recibida: 'A Preparación',
                            en_preparacion: 'Lista para Servir',
                            lista_para_servir: 'Completada'
                        }[order.estado] || 'Finalizado';

                        card.innerHTML = \`
                            <div class="flex justify-between items-start mb-3">
                                <h3 class="text-2xl font-bold text-gray-900">#\${order.id}</h3>
                                <span class="px-3 py-1 text-xs font-semibold rounded-full \${getStatusColor(order.estado)}">\${order.estado.toUpperCase().replace('_', ' ')}</span>
                            </div>
                            <p class="text-sm text-gray-500 mb-1">Cliente: \${order.nombre_cliente || 'Anónimo'}</p>
                            <p class="text-sm text-gray-500 mb-2">Hora: \${date} | Tel: \${order.telefono}</p>
                            <p class="mb-4 text-gray-700 italic border-l-4 pl-3">"\${order.transcripcion}"</p>
                            <div class="pt-4 border-t">
                                <button onclick="updateStatus(\${order.id}, '\${order.estado}')" class="w-full text-white font-medium py-2 rounded-lg transition \${isCompletada ? 'bg-gray-400 cursor-not-allowed' : 'bg-blue-500 hover:bg-blue-600'}" \${isCompletada ? 'disabled' : ''}>
                                    \${nextStatusText}
                                </button>
                            </div>
                        \`;
                        list.appendChild(card);
                    });
                }

                async function fetchOrders() {
                    try {
                        const response = await fetch(API_BASE_URL + '/ordenes-activas');
                        const orders = await response.json();
                        renderOrders(orders);
                    } catch (error) {
                        console.error('Fallo al obtener órdenes:', error);
                    }
                }
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
    if (req.originalUrl.includes('twilio')) {
        const VoiceResponse = twilio.twiml.VoiceResponse;
        const twiml = new VoiceResponse();
        if (req.body.CallSid) { deleteState(req.body.CallSid); }
        twiml.say({ language: 'es-MX', voice: 'Polly.Lupe' }, 'Lo sentimos, ha ocurrido un error en el sistema. Por favor, inténtelo de nuevo más tarde.');
        twiml.hangup();
        res.type('text/xml');
        return res.status(500).send(twiml.toString());
    }
    res.status(500).json({ error: 'Ocurrió un error interno del servidor.', details: error.message });
});

// --- 8. INICIALIZACIÓN DEL SERVIDOR ---
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

