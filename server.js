// Archivo: server.js
// VERSIÓN CORREGIDA: Pasa la instancia de la base de datos (db) al constructor de AsistenteIA.

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

// Inicialización de dependencias
const db = new Database();
// --- CORRECCIÓN CRÍTICA ---
// Se pasa la instancia 'db' al constructor de AsistenteIA para que pueda acceder al menú.
const asistenteIA = new AsistenteIA(db);
// -------------------------

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
    res.status(401).json({ error: 'No autorizado.' });
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
        caller, callSid, items: [], total: 0.00, stage: 'INITIAL_ORDER',
        nombreCliente: 'Cliente Anónimo', telefonoCliente: caller,
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
            <!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><title>Sistema de Órdenes IA</title><script src="https://cdn.tailwindcss.com"></script><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
            <body class="bg-gray-50 p-8 font-sans">
                <div class="max-w-xl mx-auto bg-white p-6 rounded-xl shadow-2xl">
                    <h1 class="text-3xl font-bold text-indigo-600 mb-4 border-b pb-2">Sistema de Pedidos por Voz</h1>
                    <p class="text-gray-600 mb-6">El backend está en <strong>modo producción</strong>. La IA utiliza el menú de la base de datos en tiempo real.</p>
                    <div class="mb-6 border p-4 rounded-lg bg-gray-50"><h2 class="text-xl font-semibold text-gray-800 mb-3">Menú (Base de Datos)</h2><ul class="list-disc list-inside text-gray-700 space-y-1">${menuHTML}</ul></div>
                    <div class="p-4 bg-green-100 border-l-4 border-green-500 text-green-700 rounded-lg">
                        <p><strong>Ruta de Twilio:</strong> <code>/twilio-conversation</code></p>
                        <p><strong>Panel Admin:</strong> <a href="/admin" class="text-indigo-600 hover:underline">/admin</a></p>
                    </div>
                </div>
            </body></html>`;
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

app.post('/twilio-conversation', async (req, res, next) => {
    const { Caller, CallSid, SpeechResult } = req.body;
    const VoiceResponse = twilio.twiml.VoiceResponse;
    const twiml = new VoiceResponse();

    try {
        const estadoActual = getOrCreateState(Caller, CallSid);

        if (!SpeechResult) {
            twiml.say({ language: 'es-MX', voice: 'Polly.Lupe' }, '¡Hola! Bienvenido a Cafe Delicia. ¿Qué te gustaría ordenar hoy?');
        } else {
            const respuestaIA = await asistenteIA.procesarConversacion(SpeechResult, estadoActual);
            updateState(CallSid, respuestaIA.estadoActualizado);

            twiml.say({ language: 'es-MX', voice: 'Polly.Lupe' }, respuestaIA.mensaje);

            if (respuestaIA.estadoActualizado.stage === 'FINALIZED') {
                const estadoFinal = respuestaIA.estadoActualizado;
                
                const nuevaOrden = await db.agregarOrden({
                    items: estadoFinal.items,
                    telefono: estadoFinal.telefonoCliente,
                    nombre: estadoFinal.nombreCliente,
                    total: estadoFinal.total
                });
                
                procesarNotificaciones(nuevaOrden);
                
                twiml.say({ language: 'es-MX', voice: 'Polly.Lupe' }, `Tu orden ha sido registrada con el número ${nuevaOrden.id}. ¡Gracias por llamar!`);
                twiml.hangup();
                deleteState(CallSid);
                
                res.type('text/xml');
                return res.send(twiml.toString());
            }
        }
        
        twiml.gather({
            input: 'speech', action: '/twilio-conversation', method: 'POST',
            timeout: 3, language: 'es-MX'
        });

        res.type('text/xml');
        res.send(twiml.toString());

    } catch (error) {
        next(error);
    }
});


// --- 6. RUTAS DEL PANEL DE ADMINISTRACIÓN ---
app.get('/admin', async (req, res) => {
    const html = `
        <!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><title>Panel de Administración</title><script src="https://cdn.tailwindcss.com"></script></head>
        <body class="bg-gray-100 p-6">
            <div class="max-w-5xl mx-auto">
                <h1 class="text-3xl font-extrabold text-gray-800 mb-6">Panel de Administración</h1>
                <div id="api-key-info" class="bg-indigo-100 p-4 rounded-xl mb-6"><p class="font-bold text-indigo-800">CLAVE DE ADMIN (X-API-Key):</p><code id="admin-key" class="block bg-indigo-200 p-2 rounded mt-1">${ADMIN_API_KEY}</code></div>
                <div class="flex justify-between items-center mb-4"><h2 class="text-2xl font-semibold">Órdenes Activas</h2><button onclick="fetchOrders()" class="bg-green-600 text-white px-4 py-2 rounded-lg">Refrescar</button></div>
                <div id="orders-list" class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6"></div>
            </div>
            <script>
                const ADMIN_API_KEY = document.getElementById('admin-key').textContent.trim();
                const API_BASE_URL = window.location.origin;
                
                async function updateStatus(orderId, currentStatus) {
                    const statusMap = { 'recibida': 'en_preparacion', 'en_preparacion': 'lista_para_servir', 'lista_para_servir': 'completada' };
                    const nextStatus = statusMap[currentStatus];
                    if (!nextStatus) return;
                    try {
                        const res = await fetch(API_BASE_URL + '/ordenes/' + orderId + '/estado', {
                            method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-API-Key': ADMIN_API_KEY },
                            body: JSON.stringify({ estado: nextStatus })
                        });
                        if (res.ok) fetchOrders();
                    } catch (e) { console.error('Fallo de red'); }
                }
                function getStatusColor(s) { const c = { recibida: 'bg-yellow-100 text-yellow-800', en_preparacion: 'bg-blue-100 text-blue-800', lista_para_servir: 'bg-green-100 text-green-800', completada: 'bg-gray-200 text-gray-700' }; return c[s] || ''; }
                function renderOrders(orders) {
                    const list = document.getElementById('orders-list');
                    list.innerHTML = orders.length === 0 ? '<p class="text-center col-span-full p-8">No hay órdenes activas.</p>' : '';
                    orders.forEach(o => {
                        const card = document.createElement('div');
                        card.className = 'bg-white p-6 rounded-xl shadow-lg';
                        const itemsHTML = (o.items || []).map(i => \`<li>\${i.nombre} \${i.personalizaciones ? '(' + i.personalizaciones.join(', ') + ')' : ''}</li>\`).join('');
                        const isDone = o.estado === 'completada';
                        const nextText = { recibida: 'A Preparación', en_preparacion: 'Lista', lista_para_servir: 'Completar' }[o.estado] || 'Finalizado';
                        card.innerHTML = \`
                            <div class="flex justify-between"><h3 class="text-2xl font-bold">#\${o.id}</h3><span class="px-3 py-1 text-xs font-semibold rounded-full \${getStatusColor(o.estado)}">\${o.estado.toUpperCase().replace('_', ' ')}</span></div>
                            <p class="text-sm text-gray-500 mb-2">Cliente: \${o.nombre_cliente || 'Anónimo'} | Total: $\${parseFloat(o.total || 0).toFixed(2)}</p>
                            <ul class="list-disc list-inside mb-4">\${itemsHTML}</ul>
                            <button onclick="updateStatus(\${o.id}, '\${o.estado}')" class="w-full text-white py-2 rounded-lg \${isDone ? 'bg-gray-400' : 'bg-blue-500'}" \${isDone ? 'disabled' : ''}>\${nextText}</button>
                        \`;
                        list.appendChild(card);
                    });
                }
                async function fetchOrders() {
                    try { const res = await fetch(API_BASE_URL + '/ordenes-activas'); renderOrders(await res.json()); }
                    catch (e) { console.error('Fallo al obtener órdenes'); }
                }
                window.onload = fetchOrders;
            </script>
        </body></html>`;
    res.send(html);
});

app.put('/ordenes/:id/estado', protegerRuta, async (req, res, next) => {
    const { id } = req.params;
    const { estado } = req.body;
    try {
        const orden = await db.actualizarEstadoOrden(id, estado);
        res.json({ message: `Orden ${id} actualizada`, orden });
    } catch (error) {
        next(error);
    }
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
        twiml.say({ language: 'es-MX', voice: 'Polly.Lupe' }, 'Lo sentimos, ha ocurrido un error en el sistema. Por favor, inténtelo de nuevo.');
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

