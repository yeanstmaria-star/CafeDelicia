// Archivo: server.js
// Servidor Express completo para el sistema de órdenes por voz.
// Utiliza dependencias reales (dotenv, pg, axios, twilio) importadas como módulos.

// --- 1. SETUP INICIAL ---
require('dotenv').config(); // Cargar variables de entorno desde .env
const express = require('express');
const bodyParser = require('body-parser');
const twilio = require('twilio'); 

// Importar clases reales (asumiendo que están en la misma carpeta)
const Database = require('./Database');
const AsistenteIA = require('./AsistenteIA');

const app = express();
const PORT = process.env.PORT || 3000;

// Variables de entorno requeridas
const ADMIN_API_KEY = process.env.ADMIN_API_KEY; // Clave de seguridad para admin
const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;

// Inicialización de dependencias
const db = new Database(); // Conexión a PostgreSQL
const asistenteIA = new AsistenteIA(); // Conexión a Gemini API

// --- 2. MIDDLEWARES GENERALES Y SEGURIDAD ---

app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

// Middleware de Logging
app.use((req, res, next) => {
    console.log(`[LOG] ${new Date().toISOString()} - ${req.method} ${req.originalUrl}`);
    next();
});

// Middleware de Autenticación para proteger rutas sensibles
function protegerRuta(req, res, next) {
    const apiKey = req.headers['x-api-key'];
    if (apiKey && apiKey === ADMIN_API_KEY) {
        return next();
    }
    // Si la clave es incorrecta o falta
    res.status(401).json({ error: 'No autorizado. Se requiere un encabezado X-API-Key válido.' });
}

// Lógica de notificación (Simulada, pero usaría Twilio para SMS/WhatsApp)
async function enviarNotificacion(area, orden) {
    console.log(`[NOTIFICACIÓN ${area.toUpperCase()}] Nueva orden #${orden.id} recibida.`);
    console.log(`Detalles: ${orden.items.map(i => i.nombre).join(', ')}`);
    // Aquí iría el código real para enviar un SMS a la Cocina/Barra vía Twilio
}

// Procesa la orden y llama a notificar usando el campo 'area_preparacion'
function procesarNotificaciones(orden) {
    const itemsPorArea = orden.items.reduce((acc, item) => {
        // Agrupa los items por su área de preparación definida en la BD
        const area = item.area_preparacion || 'general';
        acc[area] = acc[area] || [];
        acc[area].push(item);
        return acc;
    }, {});

    for (const area in itemsPorArea) {
        // Llama a la función de notificación para cada área
        enviarNotificacion(area, { ...orden, items: itemsPorArea[area] });
    }
}

// --- 3. RUTAS DE LA APLICACIÓN ---

// Ruta Principal (Muestra el menú real de la BD)
app.get('/', async (req, res, next) => {
    try {
        const menu = await db.obtenerMenu();
        
        const menuHTML = menu.map(p => 
            `<li>${p.nombre} (<span class="font-semibold">${p.area_preparacion.toUpperCase()}</span>)</li>`
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
                    <p class="text-gray-600 mb-6">El backend está operativo y conectado a PostgreSQL. Menú:</p>
                    
                    <div class="mb-6 border p-4 rounded-lg bg-gray-50">
                        <h2 class="text-xl font-semibold text-gray-800 mb-3">Menú (Base de Datos)</h2>
                        <ul class="list-disc list-inside text-gray-700 space-y-1">${menuHTML}</ul>
                    </div>
                    
                    <div class="p-4 bg-yellow-100 border-l-4 border-yellow-500 text-yellow-700 rounded-lg">
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

// Ruta para procesar la llamada de Twilio (Voice URL)
app.post('/twilio-voice', async (req, res) => {
    const VoiceResponse = twilio.twiml.VoiceResponse;
    const twiml = new VoiceResponse();
    
    twiml.say({ language: 'es-MX', voice: 'Polly.Lupe' }, 'Hola. Gracias por llamar. Por favor, diga su pedido ahora.');
    
    // Twilio Gather para capturar la voz
    twiml.gather({
        input: 'speech',
        action: '/twilio-process', // La acción que se llama después de la transcripción
        method: 'POST',
        timeout: 3,
        language: 'es-MX'
    });

    twiml.say({ language: 'es-MX', voice: 'Polly.Lupe' }, 'Lo siento, no pude escuchar su orden. Por favor, llame de nuevo.');
    res.type('text/xml');
    res.send(twiml.toString());
});

// Ruta para procesar la transcripción de voz de Twilio
app.post('/twilio-process', async (req, res, next) => {
    const VoiceResponse = twilio.twiml.VoiceResponse;
    const twiml = new VoiceResponse();
    const { SpeechResult, Caller } = req.body;
    
    try {
        if (SpeechResult) {
            const transcripcion = SpeechResult;
            // Obtener el menú real de la BD para dar contexto a la IA
            const menuItems = (await db.obtenerMenu()).map(p => p.nombre);

            // CORRECCIÓN LÓGICA: Usar procesarOrden, no procesarVoz
            // 1. Procesar la voz con la IA real (AsistenteIA.js)
            const iaResultado = await asistenteIA.procesarOrden(transcripcion, menuItems);

            if (iaResultado.items.length > 0) {
                // 2. Almacenar la orden en la BD real
                const nuevaOrden = await db.agregarOrden(iaResultado.items, Caller, transcripcion);
                
                // 3. Notificar a las áreas de preparación (Cocina/Barra)
                procesarNotificaciones(nuevaOrden);

                // 4. Responder al cliente
                twiml.say({ language: 'es-MX', voice: 'Polly.Lupe' }, `${iaResultado.mensajeRespuesta} Su orden ha sido registrada con el número ${nuevaOrden.id}. Gracias.`);
            } else {
                 // Si la IA no identificó items
                 twiml.say({ language: 'es-MX', voice: 'Polly.Lupe' }, `${iaResultado.mensajeRespuesta}`);
            }
        } else {
            twiml.say({ language: 'es-MX', voice: 'Polly.Lupe' }, 'No recibí ninguna orden de voz. Por favor, llame de nuevo y hable claramente.');
        }

        res.type('text/xml');
        res.send(twiml.toString());
    } catch (error) {
        next(error);
    }
});

// --- 4. RUTAS DEL PANEL DE ADMINISTRACIÓN (PROTEGIDAS) ---

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
                    alertDiv.innerHTML = \`
                        <div class="bg-white p-6 rounded-lg shadow-2xl max-w-sm w-full">
                            <h3 class="text-xl font-bold mb-3 text-red-600">Alerta</h3>
                            <p class="text-gray-700 mb-4">\${message}</p>
                            <button id="close-alert" class="w-full bg-red-500 hover:bg-red-600 text-white font-medium py-2 rounded-lg transition duration-150">Cerrar</button>
                        </div>
                    \`;
                    document.body.appendChild(alertDiv);
                    document.getElementById('close-alert').onclick = () => document.body.removeChild(alertDiv);
                }

                async function updateStatus(orderId, newStatus) {
                    const statusMap = {
                        'recibida': 'A Preparación',
                        'en_preparacion': 'Lista para Servir',
                        'lista_para_servir': 'Completada',
                        'completada': 'Completada'
                    };
                    
                    if (!confirm(\`¿Estás seguro de cambiar la orden #\${orderId} a "\${statusMap[newStatus]}"?\`)) return;

                    try {
                        const response = await fetch(\`\${API_BASE_URL}/ordenes/\${orderId}/estado\`, {
                            method: 'PUT',
                            headers: {
                                'Content-Type': 'application/json',
                                'X-API-Key': ADMIN_API_KEY // Uso de la clave de seguridad para la ruta protegida
                            },
                            body: JSON.stringify({ estado: newStatus })
                        });

                        const result = await response.json();
                        if (response.ok) {
                            console.log(result.message);
                            fetchOrders(); // Refrescar la lista después de la actualización
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
                        
                        // CORRECCIÓN SINTAXIS: Usando backticks (`) para la cadena HTML para evitar SyntaxError
                        card.innerHTML = `
                            <div class="flex justify-between items-start mb-3">
                                <h3 class="text-2xl font-bold text-gray-900">#${order.id}</h3>
                                <span class="px-3 py-1 text-xs font-semibold rounded-full ${getStatusColor(order.estado)}">
                                    ${order.estado.toUpperCase().replace('_', ' ')}
                                </span>
                            </div>
                            <p class="text-sm text-gray-500 mb-2">Hora: ${date} | Teléfono: ${order.telefono}</p>
                            <p class="mb-4 text-gray-700 italic border-l-4 pl-3 border-gray-200">"${order.transcripcion}"</p>
                            <div class="space-y-2 pt-4 border-t border-gray-100">
                                <p class="font-semibold text-gray-800">Cambiar Estado:</p>
                                
                                <button onclick="updateStatus(${order.id}, 'en_preparacion')" 
                                    class="w-full bg-blue-500 hover:bg-blue-600 text-white font-medium py-2 rounded-lg transition duration-150 shadow-md ${order.estado !== 'recibida' ? 'opacity-50 cursor-not-allowed' : ''}" 
                                    ${order.estado !== 'recibida' ? 'disabled' : ''}>
                                    A Preparación
                                </button>
                                
                                <button onclick="updateStatus(${order.id}, 'lista_para_servir')" 
                                    class="w-full bg-yellow-500 hover:bg-yellow-600 text-white font-medium py-2 rounded-lg transition duration-150 shadow-md ${order.estado !== 'en_preparacion' ? 'opacity-50 cursor-not-allowed' : ''}" 
                                    ${order.estado !== 'en_preparacion' ? 'disabled' : ''}>
                                    Lista para Servir
                                </button>
                                
                                <button onclick="updateStatus(${order.id}, 'completada')" 
                                    class="w-full bg-green-500 hover:bg-green-600 text-white font-medium py-2 rounded-lg transition duration-150 shadow-md">
                                    Completada
                                </button>
                            </div>
                        `;
                        list.appendChild(card);
                    });
                }

                async function fetchOrders() {
                    document.getElementById('loader').classList.remove('hidden');
                    try {
                        const response = await fetch(`${API_BASE_URL}/ordenes-activas`);
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

// --- 5. MANEJADOR DE ERRORES GLOBAL ---
// Centraliza el manejo de fallos para toda la aplicación

app.use((error, req, res, next) => {
    console.error('[ERROR GLOBAL]', error);
    if (res.headersSent) {
        return next(error);
    }
    // Asegura que Twilio reciba una respuesta válida en caso de error
    if (req.originalUrl.includes('twilio')) {
        const VoiceResponse = twilio.twiml.VoiceResponse;
        const twiml = new VoiceResponse();
        twiml.say({ language: 'es-MX', voice: 'Polly.Lupe' }, 'Lo sentimos, ha ocurrido un error grave en el sistema. Por favor, inténtelo de nuevo más tarde.');
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
// Nota: La verificación de tablas debe ejecutarse una vez antes de escuchar
db.verificarTablas().then(() => {
    console.log("Tablas verificadas exitosamente.");
    app.listen(PORT, () => {
        console.log(`Servidor Express escuchando en el puerto ${PORT}`);
        console.log(`URL Local: http://localhost:${PORT}`);
    });
}).catch(error => {
    console.error("Error fatal al inicializar la base de datos:", error);
    process.exit(1);
});
