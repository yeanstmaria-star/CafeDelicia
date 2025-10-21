// Archivo: AsistenteIA.js
// VERSIÓN DE PRODUCCIÓN - Impulsado por Anthropic Claude 3 Haiku
// Utiliza la API de Anthropic para una conversación más natural y robusta.

const axios = require('axios');

// Configuración de la API de Anthropic (tomada de .env)
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || '';
const API_URL = 'https://api.anthropic.com/v1/messages';

// Configuración de reintentos
const MAX_RETRIES = 2;
const INITIAL_DELAY_MS = 1000;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

// Precios de personalizaciones
const PRECIOS_EXTRAS = {
    'leche de avena': 1.00,
    'leche de almendra': 1.00,
    'shot extra de espresso': 1.50,
    'tamaño grande': 0.75
};

class AsistenteIA {
    constructor(db) {
        this.db = db;
        if (!this.db) {
            throw new Error("AsistenteIA requiere una instancia de base de datos para funcionar.");
        }
        console.log(`AsistenteIA: Inicializado en MODO PRODUCCIÓN con Anthropic Claude.`);
    }

    // El esquema JSON que Claude debe seguir (definido como una "herramienta")
    get JSON_TOOL_SCHEMA() {
        return {
            name: "actualizar_estado_orden",
            description: "Actualiza el estado de la orden del cliente basado en la conversación.",
            input_schema: {
                type: "object",
                properties: {
                    "next_stage": { type: "string", description: "El nuevo estado de la conversación. Uno de: INITIAL_ORDER, CUSTOMIZATION, UPSELL_FINAL, CONFIRMATION, IDENTIFICATION, FINALIZED." },
                    "items_update": {
                        type: "array", description: "Lista COMPLETA y ACTUALIZADA de productos confirmados por el cliente.",
                        items: {
                            type: "object",
                            properties: {
                                "nombre": { type: "string" },
                                "personalizaciones": { type: "array", "items": { type: "string" } },
                                "area_preparacion": { type: "string", description: "El área de preparación del menú (barra o cocina)." }
                            },
                            required: ["nombre", "area_preparacion"]
                        }
                    },
                    "nombre_cliente": { type: "string" },
                    "telefono_cliente": { type: "string" },
                    "llm_response_text": { type: "string", description: "Respuesta AMABLE y CONCISA del barista (máximo 15 palabras)." }
                },
                required: ["next_stage", "items_update", "llm_response_text"]
            }
        };
    }

    _calculateTotal(items, menu) {
        let total = 0;
        const menuMap = new Map(menu.map(item => [item.nombre, parseFloat(item.precio)]));
        items.forEach(item => {
            total += menuMap.get(item.nombre) || 0;
            (item.personalizaciones || []).forEach(custom => {
                total += PRECIOS_EXTRAS[custom.toLowerCase()] || 0;
            });
        });
        return parseFloat(total.toFixed(2));
    }

    async procesarConversacion(transcripcion, estadoActual) {
        console.log(`IA (Claude) procesando: "${transcripcion}" | Etapa: ${estadoActual.stage}`);

        if (!ANTHROPIC_API_KEY) {
            console.error("[ERROR CRÍTICO] La clave de API de Anthropic no está configurada.");
            return { mensaje: "Error de configuración del sistema.", estadoActualizado: estadoActual };
        }

        const menu = await this.db.obtenerMenu();
        const system_prompt = `
            Eres un barista de IA para "Cafe Delicia". Tu tarea es atender un pedido por teléfono.
            Sé amable, rápido y conciso. Sigue el flujo de la conversación y actualiza el estado de la orden.
            Tu respuesta de texto NO DEBE EXCEDER 15 PALABRAS.
            Analiza la transcripción del cliente, considera el estado actual de la orden y usa la herramienta 'actualizar_estado_orden' para devolver el nuevo estado y tu respuesta.
            REGLA IMPORTANTE: Si el cliente confirma la orden pero el nombre del cliente es 'Cliente Anónimo', tu 'next_stage' DEBE ser 'IDENTIFICATION' para pedir el nombre. NO pases a 'FINALIZED' sin un nombre.
        `;
        const user_prompt = `
            MENÚ DISPONIBLE: ${JSON.stringify(menu.map(p => ({ nombre: p.nombre, area: p.area_preparacion })))}
            ESTADO ACTUAL DE LA ORDEN: ${JSON.stringify({ items: estadoActual.items, stage: estadoActual.stage, nombreCliente: estadoActual.nombreCliente })}
            TRANSCRIPCIÓN DEL CLIENTE: "${transcripcion}"
        `;

        const payload = {
            model: "claude-3-haiku-20240307", // Modelo rápido y económico
            system: system_prompt,
            messages: [{ role: "user", content: user_prompt }],
            max_tokens: 1024,
            tools: [this.JSON_TOOL_SCHEMA],
            tool_choice: {
                type: "tool",
                name: "actualizar_estado_orden"
            }
        };

        try {
            for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
                try {
                    const response = await axios.post(API_URL, payload, {
                        headers: {
                            'x-api-key': ANTHROPIC_API_KEY,
                            'anthropic-version': '2023-06-01',
                            'content-type': 'application/json'
                        },
                        timeout: 6000
                    });

                    const toolCall = response.data?.content?.find(block => block.type === 'tool_use');
                    if (toolCall && toolCall.input) {
                        const aiResponse = toolCall.input;
                        const itemsActualizados = aiResponse.items_update || [];
                        const totalCalculado = this._calculateTotal(itemsActualizados, menu);

                        const nuevoEstado = {
                            ...estadoActual,
                            stage: aiResponse.next_stage,
                            items: itemsActualizados,
                            total: totalCalculado,
                            nombreCliente: aiResponse.nombre_cliente || estadoActual.nombreCliente,
                            telefonoCliente: aiResponse.telefono_cliente || estadoActual.telefonoCliente || estadoActual.caller,
                        };

                        let mensajeFinal = aiResponse.llm_response_text;
                        if ((nuevoEstado.stage === 'CONFIRMATION' || nuevoEstado.stage === 'FINALIZED') && !mensajeFinal.toLowerCase().includes('total')) {
                            mensajeFinal += ` El total es de $${totalCalculado.toFixed(2)}.`;
                        }

                        console.log(`[DIAGNÓSTICO] Respuesta de Claude exitosa. Nuevo estado: ${nuevoEstado.stage}`);
                        return { mensaje: mensajeFinal, estadoActualizado: nuevoEstado };
                    }
                    throw new Error("NO_TOOL_CALL_IN_RESPONSE");

                } catch (error) {
                    const status = error.response?.status;
                    const isRetryable = [503, 429, 500, 529].includes(status) || error.code === 'ECONNABORTED';
                    if (attempt < MAX_RETRIES - 1 && isRetryable) {
                        const delayTime = INITIAL_DELAY_MS * (2 ** attempt);
                        console.warn(`[REINTENTO #${attempt + 1}] Error ${status || 'de red'}. Reintentando en ${Math.round(delayTime)}ms.`);
                        await delay(delayTime);
                    } else {
                        throw error;
                    }
                }
            }
            throw new Error("MAX_RETRIES_EXCEEDED");

        } catch (error) {
            let logDetails;
            if (error.response) {
                logDetails = `Fallo de API (HTTP ${error.response.status}).`;
                console.error("Detalles del error de Anthropic:", error.response.data);
            } else {
                logDetails = `Error de red o reintentos fallidos.`;
            }
            
            console.error(`[FALLBACK] Se activa el manejo de errores: ${logDetails}`);
            return {
                mensaje: "Lo siento, hubo un problema técnico. ¿Podrías repetir, por favor?",
                estadoActualizado: { ...estadoActual, transcripcionPendiente: transcripcion }
            };
        }
    }
}

module.exports = AsistenteIA;

