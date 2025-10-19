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
        // Esto permite que el usuario diga "café" y se mapee a "Café Americano".
        const keywordMap = {
            'americano': 'Café Americano',
            'café': 'Café Americano',
            'latte': 'Latte de Vainilla',
            'vainilla': 'Latte de Vainilla',
            'muffin': 'Muffin de Arándanos',
            'arándanos': 'Muffin de Arándanos',
            'sándwich': 'Sándwich de Pavo',
            'pavo': 'Sándwich de Pavo',
            'sandwich': 'Sándwich de Pavo', // Variación de ortografía común
        };
        
        const itemsEncontrados = [];
        const transcripcionLower = transcripcion.toLowerCase();
        
        // Tokenizar la transcripción para buscar palabras clave
        // Usamos una expresión regular simple para encontrar palabras completas.
        const words = transcripcionLower.match(/\b(\w+)\b/g) || [];
        
        const foundNames = new Set();
        
        for (const word of words) {
            if (keywordMap[word]) {
                const itemName = keywordMap[word];
                if (!foundNames.has(itemName)) {
                    // Solo agregamos el item si no ha sido agregado ya (para evitar duplicados)
                    itemsEncontrados.push({ nombre: itemName });
                    foundNames.add(itemName);
                }
            }
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
