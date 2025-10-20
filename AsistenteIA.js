// Archivo: AsistenteIA.js
// Clase responsable de la lógica de conversación y la integración con el LLM (Gemini).
// La IA real controla la transición de estados y la extracción de ítems de la orden.

const axios = require('axios'); // Ya incluido en package.json
const { getFirestore } = require('firebase/firestore'); // Usado para simular acceso al menú

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
                            }
                        },
                        "required": ["nombre"]
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
                    "description": "El mensaje de respuesta amable del barista para el cliente, basado en el estado actual y la transcripción."
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
        const prompt = `Actúa como un barista experto, amable y eficiente. Tu tarea es analizar la transcripción del cliente y determinar el nuevo estado de la conversación, la orden confirmada y generar una respuesta.

        --- CONTEXTO ---
        MENÚ DISPONIBLE: ${JSON.stringify(menu)}
        ESTADO ACTUAL DE LA ORDEN: ${JSON.stringify({ items: estadoActual.items, stage: estadoActual.stage })}
        TRANSCRIPCIÓN DEL CLIENTE: "${transcripcion}"

        --- INSTRUCCIONES DE ESTADO ---
        1. **INITIAL_ORDER**: Esperando el primer pedido.
        2. **CUSTOMIZATION**: Se pidió una bebida, esperando personalizaciones (leche, shots). Si la transcripción no tiene personalizaciones, ve a UPSELL_FINAL.
        3. **UPSELL_FINAL**: Orden casi completa. Pregunta si desean algo más (ej. un postre si solo pidió café). Si dice 'No', ve a CONFIRMATION.
        4. **CONFIRMATION**: El cliente dijo que es todo. Genera un resumen de la orden y espera la confirmación final ('Sí' o 'No'). Si dice 'Sí', ve a IDENTIFICATION.
        5. **IDENTIFICATION**: La orden fue confirmada. Pide el nombre y número de teléfono.
        6. **FINALIZED**: Se tienen todos los datos y la orden está lista para ser enviada a la base de datos.

        Genera únicamente un objeto JSON que siga el esquema provisto. La llave 'items_update' debe contener la lista completa y consolidada de todos los productos confirmados hasta ahora. Si el cliente niega o cancela algo, retíralo de la lista.
        `;
        
        // Configuración para la respuesta JSON estructurada
        const payload = {
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
                responseMimeType: "application/json",
                responseSchema: this.JSON_SCHEMA
            },
            systemInstruction: {
                parts: [{ text: "Eres un Barista IA y tu única función es analizar la conversación y devolver un objeto JSON estructurado." }]
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
                telefonoCliente: aiResponse.telefono_cliente || estadoActual.telefonoCliente,
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
