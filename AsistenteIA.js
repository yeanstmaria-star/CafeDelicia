// Archivo: AsistenteIA.js
// Clase responsable de la lógica de conversación y la integración con el LLM (Gemini).
// La IA real controla la transición de estados y la extracción de ítems de la orden.

const axios = require('axios'); // Ya incluido en package.json
// Eliminada la línea de require de firebase/firestore que causaba el error de dependencia.

// Configuración de la API (tomada de .env.example)
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${GEMINI_API_KEY}`;


class AsistenteIA {
    constructor() {
        console.log(`AsistenteIA: Inicializado (Simulación de Asistente Barista - Conversación).`);
        // NOTA: En un entorno real, la conexión a la base de datos se pasaría aquí 
        // para que la IA tenga acceso al menú en tiempo real.
    }

    // El esquema JSON que el LLM debe seguir para determinar el estado y los ítems.
    get JSON_SCHEMA() {
        return {
            type: "OBJECT",
            properties: {
                "next_stage": {
                    "type": "STRING",
                    "description": "El nuevo estado de la conversación. Debe ser uno de: INITIAL_ORDER, CUSTOMIZATION, UPSELL_FINAL, CONFIRMATION, IDENTIFICATION, FINALIZED."
                },
                "items_update": {
                    "type": "ARRAY",
                    "description": "Lista completa de todos los productos y personalizaciones que el cliente ha CONFIRMADO hasta ahora en toda la conversación.",
                    "items": {
                        "type": "OBJECT",
                        "properties": {
                            "nombre": { "type": "STRING", "description": "Nombre del producto (ej: Capuchino, Muffin de Arándano)." },
                            "personalizaciones": { 
                                "type": "ARRAY", 
                                "items": { "type": "STRING" },
                                "description": "Modificaciones (ej: leche de avena, shot extra)."
                            },
                            // NUEVO: Campo para que la IA sepa dónde enviar el ítem.
                            "area_preparacion": { "type": "STRING", "description": "El área de preparación del menú (barra o cocina)." } 
                        },
                        // Se agrega area_preparacion como campo obligatorio en el objeto de ítem.
                        "required": ["nombre", "area_preparacion"] 
                    }
                },
                "nombre_cliente": {
                    "type": "STRING",
                    "description": "El nombre del cliente si fue mencionado. Usa 'Cliente Anónimo' si no se mencionó."
                },
                "telefono_cliente": {
                    "type": "STRING",
                    "description": "El número de teléfono del cliente si fue mencionado. Usa el CallSid como fallback si no se mencionó."
                },
                "llm_response_text": {
                    "type": "STRING",
                    "description": "El mensaje de respuesta AMABLE Y CONCISA del barista para el cliente, basado en el estado actual y la transcripción. NO DEBE EXCEDER LAS 15 PALABRAS."
                }
            },
            required: ["next_stage", "items_update", "llm_response_text"]
        };
    }

    // Simulación de menú para el prompt del LLM (en un entorno real se obtendría de la DB)
    getMenuContexto() {
        return [
            { nombre: "Capuchino", precio: 4.50, area_preparacion: 'barra' },
            { nombre: "Latte Vainilla", precio: 5.00, area_preparacion: 'barra' },
            { nombre: "Té Chai", precio: 4.00, area_preparacion: 'barra' },
            { nombre: "Muffin de Arándanos", precio: 3.50, area_preparacion: 'cocina' },
            { nombre: "Croissant", precio: 2.50, area_preparacion: 'cocina' }
        ];
    }

    async procesarConversacion(transcripcion, estadoActual) {
        console.log(`IA procesando transcripción recibida: "${transcripcion}" en etapa: ${estadoActual.stage}`);

        // Construir el prompt para el LLM
        const menu = this.getMenuContexto();
        const prompt = `INSTRUCCIÓN RÁPIDA: Eres un barista. Analiza la transcripción, actualiza la orden, determina el nuevo estado y genera una respuesta CONCISA.

        MENÚ: ${JSON.stringify(menu)}
        ESTADO ACTUAL: ${JSON.stringify({ items: estadoActual.items, stage: estadoActual.stage })}
        CLIENTE DICE: "${transcripcion}"
        
        Sigue los estados: INITIAL_ORDER -> CUSTOMIZATION -> UPSELL_FINAL -> CONFIRMATION -> IDENTIFICATION -> FINALIZED.
        Genera el JSON completo. La respuesta de texto debe ser natural pero *máximo 15 palabras*.
        `;
        
        // Configuración para la respuesta JSON estructurada
        const payload = {
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
                responseMimeType: "application/json",
                responseSchema: this.JSON_SCHEMA
            },
            // Instrucción de sistema más corta y orientada a la velocidad
            systemInstruction: {
                parts: [{ text: "Eres un Barista IA. Analiza RÁPIDAMENTE la transcripción y devuelve SOLO el objeto JSON estructurado. Prioriza la velocidad y concisión en la respuesta de texto." }]
            }
        };

        try {
            // Llama a la API de Gemini
            const response = await axios.post(API_URL, payload, {
                headers: { 'Content-Type': 'application/json' }
            });

            const resultText = response.data?.candidates?.[0]?.content?.parts?.[0]?.text;
            if (!resultText) throw new Error("Respuesta JSON vacía o inválida de la IA.");

            const aiResponse = JSON.parse(resultText);

            // Actualizar el estado de la aplicación con la respuesta de la IA
            const nuevoEstado = {
                ...estadoActual,
                stage: aiResponse.next_stage,
                items: aiResponse.items_update || [],
                nombreCliente: aiResponse.nombre_cliente || estadoActual.nombreCliente,
                telefonoCliente: aiResponse.telefono_cliente || estadoActual.telefonocliente,
                // NOTA: La IA debe recalcular el total en el prompt (omitido aquí por simplicidad)
            };

            return {
                mensaje: aiResponse.llm_response_text,
                estadoActualizado: nuevoEstado
            };

        } catch (error) {
            console.error("[ERROR GEMINI] Fallo en la llamada a la IA:", error.response?.data || error.message);
            // Fallback en caso de error de la IA
            return {
                mensaje: "Lo siento, mi conexión con la cocina está fallando. ¿Podrías repetir tu pedido por favor?",
                estadoActualizado: estadoActual
            };
        }
    }
}

module.exports = AsistenteIA;
