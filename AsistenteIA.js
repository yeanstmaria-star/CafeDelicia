// Archivo: AsistenteIA.js
// Clase simulada para manejar la lógica de la IA (Gemini API) como un Asistente Barista.

class AsistenteIA {
    constructor() {
        console.log("AsistenteIA: Inicializado (Simulación de Asistente Barista - Conversación).");
    }

    /**
     * Procesa la transcripción de voz para extraer los items, personalizaciones y generar la respuesta conversacional.
     * @param {string} transcripcion - El texto transcrito de la llamada.
     * @returns {object} Objeto con 'items' encontrados, 'mensajeRespuesta' (el script de la barista), y el 'costo total'.
     */
    async procesarOrden(transcripcion) {
        console.log(`IA procesando transcripción recibida: "${transcripcion}"`);
        
        // --- 1. CONFIGURACIÓN DEL MENÚ Y PRECIOS SIMULADOS ---
        const itemPriceMap = {
            'Café Americano': 2.50,
            'Capuchino': 3.50,
            'Latte de Vainilla': 3.75,
            'Muffin de Arándanos': 2.00,
            'Sándwich de Pavo': 6.50,
        };
        
        const customizationPrice = 0.75;
        
        // Mapeo de palabras clave (base items y personalizaciones)
        const keywordMap = {
            'americano': { name: 'Café Americano', type: 'base', area: 'barra' },
            'capuchino': { name: 'Capuchino', type: 'base', area: 'barra' },
            'latte': { name: 'Latte de Vainilla', type: 'base', area: 'barra' },
            'vainilla': { name: 'Latte de Vainilla', type: 'base', area: 'barra' },
            'muffin': { name: 'Muffin de Arándanos', type: 'base', area: 'cocina' },
            'arándanos': { name: 'Muffin de Arándanos', type: 'base', area: 'cocina' },
            'arándano': { name: 'Muffin de Arándanos', type: 'base', area: 'cocina' },
            'sándwich': { name: 'Sándwich de Pavo', type: 'base', area: 'cocina' },
            'pavo': { name: 'Sándwich de Pavo', type: 'base', area: 'cocina' },
            
            // Palabras clave para simular extras/personalización (con costo)
            'avena': { name: 'Leche de Avena', type: 'custom', appliesTo: ['barra'] },
            'almendra': { name: 'Leche de Almendra', type: 'custom', appliesTo: ['barra'] },
            'shot': { name: 'Shot Extra de Espresso', type: 'custom', appliesTo: ['barra'] },
            'crema': { name: 'Crema Batida', type: 'custom', appliesTo: ['barra'] },
            
            // Palabras clave para simular upselling (sin costo, solo texto)
            'pan dulce': { name: 'Pan Dulce (Upsell)', type: 'upsell' },
            'galleta': { name: 'Galleta (Upsell)', type: 'upsell' },
        };

        // --- 2. EXTRACCIÓN DE ITEMS Y PERSONALIZACIÓN ---
        const itemsEncontrados = [];
        const personalizaciones = [];
        const transcripcionLower = transcripcion.toLowerCase();
        let total = 0;
        
        const words = transcripcionLower.match(/\b(\w+)\b/g) || [];
        const foundBaseNames = new Set();
        
        for (const word of words) {
            const match = keywordMap[word];
            if (match) {
                if (match.type === 'base') {
                    if (!foundBaseNames.has(match.name)) {
                        itemsEncontrados.push({ 
                            nombre: match.name, 
                            precio: itemPriceMap[match.name],
                            area_preparacion: match.area 
                        });
                        total += itemPriceMap[match.name];
                        foundBaseNames.add(match.name);
                    }
                } else if (match.type === 'custom') {
                    // Solo agregamos la personalización si hay un item de barra
                    const hasBarItem = itemsEncontrados.some(item => item.area_preparacion === 'barra');
                    if (hasBarItem && !personalizaciones.some(c => c.name === match.name)) {
                        personalizaciones.push({ name: match.name, cost: customizationPrice });
                        total += customizationPrice;
                    }
                }
            }
        }

        // Caso especial: Si el usuario solo dice "café", asumimos Americano.
        if (transcripcionLower.includes('café') && itemsEncontrados.length === 0) {
             const americano = 'Café Americano';
             itemsEncontrados.push({ nombre: americano, precio: itemPriceMap[americano], area_preparacion: 'barra' });
             total += itemPriceMap[americano];
             foundBaseNames.add(americano);
        }

        // --- 3. GENERACIÓN DEL SCRIPT CONVERSACIONAL (Respuesta Única) ---
        let mensajeRespuesta = "";
        
        if (itemsEncontrados.length > 0) {
            // A. Saludo inicial (Simulado)
            mensajeRespuesta += "¡Hola! ¡Gracias por elegir Cafe Delicia! ";
            
            // B. Personalización del pedido (Simulado)
            let itemSummary = itemsEncontrados.map(item => item.nombre).join(' y ');
            
            if (personalizaciones.length > 0) {
                const customNames = personalizaciones.map(c => c.name).join(', ');
                itemSummary += ` con el extra de ${customNames}.`;
            } else {
                // Si la IA no encontró personalización, la simula.
                mensajeRespuesta += "Ya que has pedido tu café, ¿quieres agregar un shot extra de espresso o cambiar la leche por alguna alternativa como almendra o avena? ";
                // Asumimos que la respuesta fue "No" o fue silenciosa, y continuamos al upselling.
            }
            
            // C. Upselling o pedido adicional (Simulado)
            mensajeRespuesta += "¡Perfecto! ¿Quieres agregar algo más a tu orden, como un pan dulce o un sándwich, para acompañar tu bebida? ";
            
            // D. Resumen del pedido (Generado)
            mensajeRespuesta += `Muy bien. Entonces, tu pedido es: ${itemSummary}. `;
            
            // Formatear el total
            const totalFormat = total.toFixed(2); 
            mensajeRespuesta += `El total es de $${totalFormat}. `;
            
            // E. Confirmación de pago e Información de identificación
            mensajeRespuesta += "¿Prefieres pagar ahora por teléfono o cuando llegues a la cafetería? Si eliges pagar al llegar, ¿podrías decirme tu nombre y número de teléfono para registrar el pedido?`;"
            
            console.log(`IA: Total simulado: $${totalFormat}`);
        } else {
            mensajeRespuesta = "Lo siento, no pude identificar ningún producto del menú en su orden. Por favor, intente de nuevo y hable claramente. Por ejemplo, diga 'Quiero un café americano y un muffin'.";
            console.log("IA: No se identificó ningún item.");
        }

        // La función debe devolver los items BASE (para la BD) y el mensaje de respuesta (para Twilio)
        return {
            items: itemsEncontrados, // La base de datos solo almacena los ítems principales
            mensajeRespuesta: mensajeRespuesta
        };
    }
}

module.exports = AsistenteIA;
