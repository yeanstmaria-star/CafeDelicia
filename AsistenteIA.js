// Archivo: AsistenteIA.js
// VERSIÓN DE PRODUCCIÓN
// Clase responsable de la lógica de conversación y la integración con el LLM (Gemini).
// La IA controla el estado de la conversación y extrae los ítems de la orden.
// Se conecta a la base de datos en tiempo real para obtener el menú y calcular precios.

const axios = require('axios');

// Configuración de la API (tomada de .env)
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const API_URL = `https://generativelabnguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${GEMINI_API_KEY}`;

// Configuración de reintentos
const MAX_RETRIES = 3;
const INITIAL_DELAY_MS = 1000;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

// Precios de personalizaciones (podrían estar en la base de datos en el futuro)
const PRECIOS_EXTRAS = {
    'leche de avena': 1.00,
    'leche de almendra': 1.00,
    'shot extra de espresso': 1.50,
    'tamaño grande': 0.75
};

class AsistenteIA {
    // El constructor ahora recibe la instancia de la base de datos
    constructor(db) {
        this.db = db; // Almacena la conexión a la base de datos
        if (!this.db) {
            throw new Error("AsistenteIA requiere una instancia de base de datos para funcionar.");
        }
        console.log(`AsistenteIA: Inicializado en MODO PRODUCCIÓN.`);
    }

    // El esquema JSON que el LLM debe seguir
    get JSON_SCHEMA() {
        return {
            type: "OBJECT",
            properties: {
                "next_stage": { "type": "STRING", "description": "El nuevo estado de la conversación. Debe ser uno de: INITIAL_ORDER, CUSTOMIZATION, UPSELL_FINAL, CONFIRMATION, IDENTIFICATION, FINALIZED." },
                "items_update": {
                    "type": "ARRAY", "description": "Lista COMPLETA y ACTUALIZADA de productos confirmados por el cliente.",
                    "items": {
                        "type": "OBJECT",
                        "properties": {
                            "nombre": { "type": "STRING" },
                            "personalizaciones": { "type": "ARRAY", "items": { "type": "STRING" } },
                            "area_preparacion": { "type": "STRING", "description": "El área de preparación del menú (barra o cocina)." }
                        },
                        "required": ["nombre", "area_preparacion"]
                    }
                },
                "nombre_cliente": { "type": "STRING", "description": "El nombre del cliente si fue mencionado." },
                "telefono_cliente": { "type": "STRING", "description": "El número de teléfono si fue mencionado." },
                "llm_response_text": { "type": "STRING", "description": "Respuesta AMABLE y CONCISA del barista (máximo 15 palabras)." }
            },
            required: ["next_stage", "items_update", "llm_response_text"]
        };
    }

    // Función para calcular el total basado en los ítems y el menú de la BD
    _calculateTotal(items, menu) {
        let total = 0;
        const menuMap = new Map(menu.map(item => [item.nombre, parseFloat(item.precio)]));

        items.forEach(item => {
            // Suma el precio base del producto
            total += menuMap.get(item.nombre) || 0;
            // Suma el precio de las personalizaciones
            (item.personalizaciones || []).forEach(custom => {
                const customKey = custom.toLowerCase();
                total += PRECIOS_EXTRAS[customKey] || 0;
            });
        });
        return parseFloat(total.toFixed(2));
    }

    async procesarConversacion(transcripcion, estadoActual) {
        console.log(`IA procesando transcripción: "${transcripcion}" | Etapa: ${estadoActual.stage}`);

        if (!GEMINI_API_KEY) {
            console.error("[ERROR CRÍTICO] La clave de API de Gemini no está configurada.");
            return { mensaje: "Error de configuración del sistema.", estadoActualizado: estadoActual };
        }

        // Obtiene el menú de la base de datos en tiempo real para cada llamada
        const menu = await this.db.obtenerMenu();
        const prompt = `
            INSTRUCCIÓN: Eres un barista de IA. Analiza la transcripción, actualiza la orden, determina el siguiente estado y genera una respuesta CONCISA.
            MENÚ DISPONIBLE: ${JSON.stringify(menu.map(p => ({ nombre: p.nombre, area: p.area_preparacion })))}
            ESTADO ACTUAL DE LA ORDEN: ${JSON.stringify({ items: estadoActual.items, stage: estadoActual.stage })}
            TRANSCRIPCIÓN DEL CLIENTE: "${transcripcion}"
            REGLA: Tu respuesta de texto debe ser natural y de máximo 15 palabras. Devuelve el JSON completo.
        `;

        const payload = {
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
                responseMimeType: "application/json",
                responseSchema: this.JSON_SCHEMA
            },
            systemInstruction: {
                parts: [{ text: "Eres un Barista IA. Analiza RÁPIDAMENTE la transcripción y devuelve SOLO el objeto JSON. Prioriza la velocidad y la concisión." }]
            }
        };

        let resultText = null;
        try {
            for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
                try {
                    const response = await axios.post(API_URL, payload, { timeout: 15000 });
                    resultText = response.data?.candidates?.[0]?.content?.parts?.[0]?.text;
                    if (resultText) break;
                    throw new Error("EMPTY_TEXT_RESPONSE");
                } catch (error) {
                    const status = error.response?.status;
                    const isRetryable = [503, 429, 500].includes(status) || error.code === 'ECONNABORTED';
                    if (attempt < MAX_RETRIES - 1 && isRetryable) {
                        const delayTime = INITIAL_DELAY_MS * (2 ** attempt) + Math.random() * 500;
                        console.warn(`[REINTENTO #${attempt + 1}] Error ${status || 'de red'}. Reintentando en ${Math.round(delayTime)}ms.`);
                        await delay(delayTime);
                    } else {
                        throw error;
                    }
                }
            }
            if (!resultText) throw new Error("MAX_RETRIES_EXCEEDED");

            const aiResponse = JSON.parse(resultText);
            const itemsActualizados = aiResponse.items_update || [];
            
            // Calcula el total con la nueva lógica de precios
            const totalCalculado = this._calculateTotal(itemsActualizados, menu);

            const nuevoEstado = {
                ...estadoActual,
                stage: aiResponse.next_stage,
                items: itemsActualizados,
                total: totalCalculado, // Total actualizado
                nombreCliente: aiResponse.nombre_cliente || estadoActual.nombreCliente,
                telefonoCliente: aiResponse.telefono_cliente || estadoActual.telefonoCliente || estadoActual.caller,
            };
            
            // Si la IA confirma la orden, inyecta el total en el mensaje de respuesta.
            let mensajeFinal = aiResponse.llm_response_text;
            if (nuevoEstado.stage === 'CONFIRMATION' || nuevoEstado.stage === 'FINALIZED') {
                if (!mensajeFinal.toLowerCase().includes('total')) {
                    mensajeFinal += ` El total es de $${totalCalculado.toFixed(2)}.`;
                }
            }
            
            console.log(`[DIAGNÓSTICO] Respuesta de IA exitosa. Nuevo estado: ${nuevoEstado.stage}`);
            return {
                mensaje: mensajeFinal,
                estadoActualizado: nuevoEstado
            };

        } catch (error) {
            let logDetails = "Error desconocido";
            if (error.message.includes("JSON.parse")) logDetails = "Fallo de parseo de JSON.";
            else if (error.response) logDetails = `Fallo de API (HTTP ${error.response.status}).`;
            else logDetails = `Error de red o reintentos fallidos.`;
            
            console.error(`[FALLBACK] Se activa el manejo de errores: ${logDetails}`);
            return {
                mensaje: "Lo siento, hubo un problema técnico. ¿Podrías repetir, por favor?",
                estadoActualizado: { ...estadoActual, transcripcionPendiente: transcripcion }
            };
        }
    }
}

module.exports = AsistenteIA;

