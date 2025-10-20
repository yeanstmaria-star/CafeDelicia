// Archivo: AsistenteIA.js
// Clase simulada para manejar la lógica de la IA (Gemini API).

class AsistenteIA {
    constructor() {
        console.log("AsistenteIA: Inicializado (Simulación de Asistente Barista - Conversación).");
    }

    /**
     * Extrae los items, personalizaciones y calcula el total de la transcripción actual.
     * La IA se centra solo en la identificación de productos y extras.
     * @param {string} transcripcion - El texto transcrito de la llamada.
     * @returns {object} Objeto con 'items' encontrados (incluyendo precio y área), 'personalizaciones', y el 'costo total'.
     */
    async identificarItems(transcripcion) {
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
            'sandwich': { name: 'Sándwich de Pavo', type: 'base', area: 'cocina' },
            
            // Palabras clave para personalización (con costo)
            'avena': { name: 'Leche de Avena', type: 'custom', appliesTo: ['barra'] },
            'almendra': { name: 'Leche de Almendra', type: 'custom', appliesTo: ['barra'] },
            'shot': { name: 'Shot Extra de Espresso', type: 'custom', appliesTo: ['barra'] },
            'crema': { name: 'Crema Batida', type: 'custom', appliesTo: ['barra'] },
            'sirope': { name: 'Sirope Adicional', type: 'custom', appliesTo: ['barra'] },
            'extra': { name: 'Extra (General)', type: 'custom', appliesTo: ['barra'] },
            
            // Palabras clave para UpSell (solo ayuda a identificar respuesta positiva)
            'sí': { name: 'Aceptó UpSell', type: 'upsell' },
            'claro': { name: 'Aceptó UpSell', type: 'upsell' },
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
                    // La personalización se añade siempre, el servidor se encarga de aplicarla a un item de barra
                    const customName = match.name;
                    if (!personalizaciones.some(c => c.name === customName)) {
                        personalizaciones.push({ name: customName, cost: customizationPrice });
                        // No sumamos el costo aquí, lo hará el servidor para evitar duplicados si se llama varias veces.
                    }
                }
            }
        }

        // Caso especial: Si el usuario solo dice "café" sin modificador, asumimos Americano.
        if (transcripcionLower.includes('café') && itemsEncontrados.length === 0) {
             const americano = 'Café Americano';
             itemsEncontrados.push({ nombre: americano, precio: itemPriceMap[americano], area_preparacion: 'barra' });
             total += itemPriceMap[americano];
             foundBaseNames.add(americano);
        }
        
        // Simulación de identificación de pago para el último paso.
        const pagoAhora = transcripcionLower.includes('ahora') || transcripcionLower.includes('teléfono');
        
        return {
            items: itemsEncontrados,
            personalizaciones: personalizaciones,
            totalInicial: total,
            pagoAhora: pagoAhora,
            // Simulación de upselling (respuesta afirmativa)
            aceptaUpsell: transcripcionLower.includes('sí') || transcripcionLower.includes('claro') || transcripcionLower.includes('algo más')
        };
    }
}

module.exports = AsistenteIA;
