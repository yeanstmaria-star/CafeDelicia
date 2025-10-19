// Archivo: AsistenteIA.js
// Clase responsable de interactuar con la API de Gemini para procesar el lenguaje natural.

const axios = require('axios');

class AsistenteIA {
    constructor() {
        this.apiKey = process.env.GEMINI_API_KEY;
        this.apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${this.apiKey}`;
        
        if (!this.apiKey) {
            console.error("ADVERTENCIA: GEMINI_API_KEY no está configurada. El procesamiento de IA fallará.");
        }
    }

    /**
     * @private
     * Maneja la lógica de reintento con retroceso exponencial (Exponential Backoff)
     */
    async makeApiCallWithRetry(payload, maxRetries = 5) {
        let lastError = null;
        for (let i = 0; i < maxRetries; i++) {
            try {
                const response = await axios.post(this.apiUrl, payload, {
                    headers: { 'Content-Type': 'application/json' }
                });
                
                // Si la respuesta es exitosa, retorna los datos.
                return response.data;
            } catch (error) {
                // Registrar el error sin usar console.error si es un reintento.
                lastError = error;
                if (i < maxRetries - 1) {
                    const delay = Math.pow(2, i) * 1000 + Math.random() * 1000;
                    // console.log(`Error de API, reintentando en ${delay.toFixed(0)}ms...`);
                    await new Promise(resolve => setTimeout(resolve, delay));
                }
            }
        }
        // Si fallan todos los reintentos, lanzar el último error.
        throw new Error(`Fallo de la API de Gemini después de ${maxRetries} intentos. Último error: ${lastError.message}`);
    }

    /**
     * Procesa la transcripción de voz para identificar productos y cantidades.
     * @param {string} transcripcion - El texto de la llamada del cliente.
     * @param {Array<Object>} menu - La lista de productos disponibles desde la base de datos.
     * @returns {Promise<Array<Object>>} Una lista de items ordenados [{ nombre: 'Capuchino', cantidad: 1 }, ...]
     */
    async procesarOrden(transcripcion, menu) {
        if (!this.apiKey) {
             throw new Error("GEMINI_API_KEY no está configurada. No se puede procesar la orden.");
        }
        
        // Formatear el menú para que la IA lo entienda
        const menuString = menu.map(p => `"${p.nombre}"`).join(', ');

        const systemPrompt = `Eres un agente de procesamiento de lenguaje natural altamente preciso para un sistema de pedidos.
El usuario te proporcionará una transcripción de voz (el pedido del cliente).
Tu ÚNICA tarea es extraer los items del menú y las cantidades del pedido.
El menú disponible es: [${menuString}].
Debes ignorar cualquier item que NO esté en esta lista exacta.
Tu respuesta DEBE ser un arreglo JSON estricto que siga el esquema proporcionado.`;

        const userQuery = `La transcripción del cliente es: "${transcripcion}". Por favor, extrae el pedido.`;

        // Esquema JSON para la respuesta (Structured Output)
        const responseSchema = {
            type: "ARRAY",
            description: "Lista de todos los items que el cliente ha pedido y la cantidad.",
            items: {
                type: "OBJECT",
                properties: {
                    "nombre": { 
                        "type": "STRING", 
                        "description": "El nombre exacto del producto, DEBE coincidir con un item del menú." 
                    },
                    "cantidad": { 
                        "type": "INTEGER", 
                        "description": "La cantidad solicitada del producto." 
                    }
                },
                required: ["nombre", "cantidad"]
            }
        };

        const payload = {
            contents: [{ parts: [{ text: userQuery }] }],
            systemInstruction: { parts: [{ text: systemPrompt }] },
            generationConfig: {
                responseMimeType: "application/json",
                responseSchema: responseSchema
            }
        };

        try {
            const data = await this.makeApiCallWithRetry(payload);

            // Intentar parsear la respuesta
            const jsonText = data.candidates?.[0]?.content?.parts?.[0]?.text;
            if (jsonText) {
                const parsedItems = JSON.parse(jsonText);
                
                // Pequeña validación para asegurar que es un array de objetos
                if (Array.isArray(parsedItems)) {
                    // Filtra cualquier ítem que Gemini haya podido generar con cantidad 0 o nombre vacío.
                    return parsedItems.filter(item => item.cantidad > 0 && item.nombre);
                }
            }
            
            // Si el parsing falla o la estructura es inesperada, retorna vacío.
            console.warn("La respuesta de Gemini no pudo ser parseada o estaba vacía.");
            return [];
            
        } catch (error) {
            console.error("Error al procesar la orden con Gemini:", error.message);
            // En caso de error de API o reintento fallido, devolvemos un array vacío.
            return []; 
        }
    }
}

module.exports = AsistenteIA;
