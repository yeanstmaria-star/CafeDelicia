// Archivo: AsistenteIA.js
// Clase simulada para manejar la lógica de la IA (Gemini API).

class AsistenteIA {
    constructor() {
        console.log("AsistenteIA: Inicializado (Simulación de Gemini API para procesar órdenes).");
    }

    /**
     * Procesa la transcripción de voz para extraer los items del menú.
     * @param {string} transcripcion - El texto transcrito de la llamada.
     * @param {string[]} menuItems - Lista de nombres de productos disponibles.
     * @returns {object} Objeto con 'items' encontrados y 'mensajeRespuesta'.
     */
    async procesarOrden(transcripcion, menuItems) {
        console.log(`IA procesando transcripción recibida: "${transcripcion}"`);
        
        // Mapeo flexible para simular la comprensión de un LLM real.
        const keywordMap = {
            'americano': 'Café Americano',
            'capuchino': 'Capuchino', // <-- ¡Aseguramos la palabra clave!
            'latte': 'Latte de Vainilla',
            'vainilla': 'Latte de Vainilla',
            'muffin': 'Muffin de Arándanos',
            'arándanos': 'Muffin de Arándanos',
            'sándwich': 'Sándwich de Pavo',
            'pavo': 'Sándwich de Pavo',
            'sandwich': 'Sándwich de Pavo', 
        };
        
        const itemsEncontrados = [];
        const transcripcionLower = transcripcion.toLowerCase();
        
        // Tokenizar la transcripción para buscar palabras clave
        const words = transcripcionLower.match(/\b(\w+)\b/g) || [];
        
        const foundNames = new Set();
        
        for (const word of words) {
            if (keywordMap[word]) {
                const itemName = keywordMap[word];
                if (!foundNames.has(itemName)) {
                    itemsEncontrados.push({ nombre: itemName });
                    foundNames.add(itemName);
                }
            }
        }

        // Caso especial: Si el usuario solo dice "café" sin modificador y no se encontró nada, asumimos Americano
        if (transcripcionLower.includes('café') && itemsEncontrados.length === 0) {
             const americano = 'Café Americano';
             itemsEncontrados.push({ nombre: americano });
             foundNames.add(americano);
        }
        
        let mensajeRespuesta;
        
        if (itemsEncontrados.length > 0) {
             const nombres = itemsEncontrados.map(item => item.nombre).join(' y ');
             mensajeRespuesta = `He identificado ${itemsEncontrados.length} productos: ${nombres}.`;
             console.log(`IA: Items identificados: ${nombres}`);
        } else {
             mensajeRespuesta = "Lo siento, no pude identificar ningún producto del menú en su orden. Por favor, intente de nuevo.";
             console.log("IA: No se identificó ningún item.");
        }

        return {
            items: itemsEncontrados,
            mensajeRespuesta: mensajeRespuesta
        };
    }
}

module.exports = AsistenteIA;
