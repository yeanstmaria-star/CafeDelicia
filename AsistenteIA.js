// Archivo: AsistenteIA.js
// Simula la lógica de un asistente de IA conversacional (como Gemini) para un barista.
// Esta versión es más flexible, responde preguntas y maneja un diálogo natural.

class AsistenteIA {
    constructor() {
        console.log("AsistenteIA: Inicializado (Simulación de Asistente Barista - Conversación).");

        // Base de conocimiento para la IA: productos, extras y palabras clave.
        // Esto simula la información que la IA usaría para entender al cliente.
        this.knowledgeBase = {
            productos: [
                { nombre: 'Café Americano', precio: 3.50, area: 'barra', keywords: ['americano', 'café solo', 'café negro'] },
                { nombre: 'Capuchino', precio: 4.50, area: 'barra', keywords: ['capuchino'] },
                { nombre: 'Latte de Vainilla', precio: 5.00, area: 'barra', keywords: ['latte', 'vainilla'] },
                { nombre: 'Sándwich de Pavo', precio: 5.00, area: 'cocina', keywords: ['sándwich', 'pavo'], descripcion: 'Nuestro sándwich de pavo viene con pan artesanal, pavo horneado, queso suizo, lechuga y tomate.' },
                { nombre: 'Muffin de Arándanos', precio: 3.00, area: 'cocina', keywords: ['muffin', 'arándano', 'arándanos', 'panecillo'], descripcion: 'Un muffin esponjoso horneado con arándanos frescos.' }
            ],
            personalizaciones: [
                { id: 'shot_espresso', name: 'Shot Extra de Espresso', precio: 1.00, keywords: ['shot', 'espresso', 'extra de café'] },
                { id: 'leche_almendra', name: 'Leche de Almendra', precio: 0.75, keywords: ['almendra'] },
                { id: 'leche_avena', name: 'Leche de Avena', precio: 0.75, keywords: ['avena'] }
            ],
            palabrasClavePreguntas: ['qué lleva', 'ingredientes', 'qué otros', 'opciones', 'tienes de postre'],
            palabrasClavePositivas: ['sí', 'si', 'claro', 'me gustaría', 'añade'],
            palabrasClaveNegativas: ['no', 'nada más', 'eso es todo'],
            palabrasClavePago: {
                ahora: ['ahora', 'teléfono', 'aquí'],
                llegar: ['llegar', 'allá', 'cafetería']
            }
        };
    }

    /**
     * Analiza la transcripción para determinar la intención del cliente.
     * @param {string} transcripcion La transcripción de voz del cliente.
     * @returns {string} La intención identificada ('ORDENANDO', 'PREGUNTANDO', 'CONFIRMANDO_SI', 'CONFIRMANDO_NO', 'PAGO', 'IDENTIFICACION').
     */
    determinarIntencion(transcripcion) {
        const texto = transcripcion.toLowerCase();

        if (this.knowledgeBase.palabrasClavePreguntas.some(k => texto.includes(k))) {
            return 'PREGUNTANDO';
        }

        if (this.knowledgeBase.productos.some(p => p.keywords.some(k => texto.includes(k)))) {
            return 'ORDENANDO';
        }

        if (this.knowledgeBase.personalizaciones.some(p => p.keywords.some(k => texto.includes(k)))) {
            return 'ORDENANDO'; // Personalizar también es parte de la orden
        }
        
        // Expresión regular para detectar nombres (dos palabras con mayúscula)
        if (/\b[A-Z][a-z]+ [A-Z][a-z]+\b/.test(transcripcion)) {
             return 'IDENTIFICACION';
        }

        // Expresión regular para detectar números de teléfono (simplificada)
        if (/\b\d{7,10}\b/.test(texto.replace(/\s/g, ''))) {
             return 'IDENTIFICACION';
        }

        if (this.knowledgeBase.palabrasClavePago.ahora.some(k => texto.includes(k)) || this.knowledgeBase.palabrasClavePago.llegar.some(k => texto.includes(k))) {
            return 'PAGO';
        }
        
        if (this.knowledgeBase.palabrasClavePositivas.some(k => texto.includes(k))) {
            return 'CONFIRMANDO_SI';
        }

        if (this.knowledgeBase.palabrasClaveNegativas.some(k => texto.includes(k))) {
            return 'CONFIRMANDO_NO';
        }

        return 'DESCONOCIDO';
    }

    /**
     * Procesa la transcripción del cliente basándose en el estado actual de la conversación.
     * @param {string} transcripcion La voz del cliente convertida a texto.
     * @param {object} estadoActual El estado de la conversación (items, etapa, etc.).
     * @returns {object} Un objeto con la respuesta de la IA y el estado actualizado.
     */
    async procesarConversacion(transcripcion, estadoActual) {
        console.log(`IA procesando transcripción recibida: "${transcripcion}" en etapa: ${estadoActual.stage}`);
        const intencion = this.determinarIntencion(transcripcion);

        let respuesta = {
            mensaje: "Lo siento, no te entendí. ¿Podrías repetirlo?",
            estadoActualizado: estadoActual
        };

        switch (intencion) {
            case 'ORDENANDO':
                respuesta = this.procesarPedido(transcripcion, estadoActual);
                break;
            case 'PREGUNTANDO':
                respuesta = this.responderPregunta(transcripcion, estadoActual);
                break;
            case 'CONFIRMANDO_SI':
                respuesta = this.procesarConfirmacionPositiva(estadoActual);
                break;
            case 'CONFIRMANDO_NO':
                respuesta = this.procesarConfirmacionNegativa(estadoActual);
                break;
            case 'PAGO':
                respuesta = this.procesarPago(transcripcion, estadoActual);
                break;
            case 'IDENTIFICACION':
                respuesta = this.procesarIdentificacion(transcripcion, estadoActual);
                break;
        }

        return respuesta;
    }
    
    /**
     * Extrae el nombre y el teléfono de la transcripción.
     * @param {string} transcripcion - La transcripción de la voz.
     * @returns {object} - Un objeto con el nombre y el teléfono.
     */
    extraerDatosCliente(transcripcion) {
        let nombre = null;
        let telefono = null;

        // Extraer nombre (dos palabras que empiezan con mayúscula)
        const nombreMatch = transcripcion.match(/\b[A-Z][a-z]+ [A-Z][a-z]+\b/);
        if (nombreMatch) {
            nombre = nombreMatch[0];
        }

        // Extraer número de teléfono (secuencia de 7 a 10 dígitos)
        const telefonoMatch = transcripcion.replace(/\s/g, '').match(/\b\d{7,10}\b/);
        if (telefonoMatch) {
            telefono = telefonoMatch[0];
        }

        return { nombre, telefono };
    }


    /**
     * Procesa una transcripción que contiene un pedido.
     */
    procesarPedido(transcripcion, estadoActual) {
        const texto = transcripcion.toLowerCase();
        let itemsEncontrados = [];
        let personalizacionesEncontradas = [];
        
        // Identificar productos principales
        this.knowledgeBase.productos.forEach(producto => {
            if (producto.keywords.some(k => texto.includes(k)) && !estadoActual.items.some(i => i.nombre === producto.nombre)) {
                itemsEncontrados.push({ ...producto, area_preparacion: producto.area });
            }
        });
        
        // Identificar personalizaciones
        this.knowledgeBase.personalizaciones.forEach(custom => {
            if (custom.keywords.some(k => texto.includes(k)) && !estadoActual.personalizaciones.some(p => p.id === custom.id)) {
                personalizacionesEncontradas.push(custom);
            }
        });

        const itemsActualizados = [...estadoActual.items, ...itemsEncontrados];
        const personalizacionesActualizadas = [...estadoActual.personalizaciones, ...personalizacionesEncontradas];
        const totalActualizado = this.calcularTotal(itemsActualizados, personalizacionesActualizadas);
        
        // Actualizar el estado con los nuevos items
        const estadoActualizado = {
            ...estadoActual,
            items: itemsActualizados,
            personalizaciones: personalizacionesActualizadas,
            total: totalActualizado,
        };

        // Generar respuesta y determinar la siguiente etapa
        let mensaje = `¡Anotado! ${[...itemsEncontrados.map(i => i.nombre), ...personalizacionesEncontradas.map(p => p.name)].join(' y ')}.`;
        
        // Transición de etapa lógica
        const tieneBebida = estadoActualizado.items.some(i => i.area === 'barra');
        const tieneComida = estadoActualizado.items.some(i => i.area === 'cocina');

        if (tieneBebida && estadoActual.stage === 'INITIAL_ORDER') {
            mensaje += ' ¿Deseas alguna personalización como leche de avena o un shot extra de espresso?';
            estadoActualizado.stage = 'CUSTOMIZATION';
        } else if (tieneBebida && tieneComida) {
            mensaje += ' ¡Excelente combinación! ¿Algo más para ti?';
            estadoActualizado.stage = 'UPSELL_FINAL';
        } else {
            mensaje += ' ¿Te gustaría añadir algo más a tu pedido?';
            estadoActualizado.stage = 'UPSELL';
        }
        
        return { mensaje, estadoActualizado };
    }

    /**
     * Responde a preguntas sobre el menú.
     */
    responderPregunta(transcripcion, estadoActual) {
        const texto = transcripcion.toLowerCase();
        let mensaje = "Claro, te cuento. ";

        if (texto.includes('postres') || texto.includes('muffin')) {
            const postres = this.knowledgeBase.productos.filter(p => p.area === 'cocina' && p.nombre.toLowerCase().includes('muffin'));
            mensaje += `De postre, te puedo ofrecer ${postres.map(p => p.nombre).join(' o ')}.`;
        } else if (texto.includes('sándwich')) {
            const sandwich = this.knowledgeBase.productos.find(p => p.nombre.includes('Sándwich'));
            mensaje += `El ${sandwich.nombre} lleva ${sandwich.descripcion}.`;
        } else {
            mensaje = "Puedes pedir cafés, sándwiches o muffins. ¿Qué te gustaría saber?";
        }
        
        mensaje += " ¿Deseas ordenar algo de esto?";
        
        // No cambiamos el estado, solo respondemos la pregunta
        return { mensaje, estadoActualizado: estadoActual };
    }

    /**
     * Procesa una confirmación positiva (ej. "sí").
     */
    procesarConfirmacionPositiva(estadoActual) {
        let mensaje = '¡Perfecto!';
        let estadoActualizado = { ...estadoActual };

        // Lógica simple basada en la etapa actual
        if (estadoActual.stage === 'UPSELL' || estadoActual.stage === 'UPSELL_FINAL') {
            mensaje = 'Genial, ¿qué más te gustaría añadir?';
            // Mantenemos la etapa para que el siguiente input sea una orden
        } else {
            // Si dice "sí" en otra etapa, es ambiguo. Pedimos clarificación.
            mensaje = '¿Sí a qué, disculpa? ¿Podrías ser más específico?';
        }

        return { mensaje, estadoActualizado };
    }

    /**
     * Procesa una confirmación negativa (ej. "no, gracias").
     */
    procesarConfirmacionNegativa(estadoActual) {
        // Si el cliente dice no, pasamos directamente al resumen del pedido.
        return this.generarResumen(estadoActual);
    }
    
    /**
     * Procesa la preferencia de pago del cliente.
     */
    procesarPago(transcripcion, estadoActual) {
        const texto = transcripcion.toLowerCase();
        let mensaje = "";
        let estadoActualizado = { ...estadoActual, stage: 'IDENTIFICATION' };

        if (this.knowledgeBase.palabrasClavePago.ahora.some(k => texto.includes(k))) {
            mensaje = 'Entendido, pagarás ahora. (Simulación: El pago se procesaría aquí). Para registrar tu pedido, por favor dime tu nombre y número de teléfono.';
        } else {
            mensaje = 'Perfecto, pagarás al llegar. Para registrar tu pedido, por favor dime tu nombre y número de teléfono.';
        }

        return { mensaje, estadoActualizado };
    }
    
    /**
     * Procesa el nombre y teléfono del cliente.
     */
    procesarIdentificacion(transcripcion, estadoActual) {
        const { nombre, telefono } = this.extraerDatosCliente(transcripcion);
        
        let mensaje = "";
        let estadoActualizado = { ...estadoActual };

        if (nombre) {
            estadoActualizado.nombreCliente = nombre;
            mensaje += `Nombre ${nombre} registrado. `;
        }
        if (telefono) {
            estadoActualizado.telefonoCliente = telefono;
            mensaje += `Teléfono ${telefono} registrado. `;
        }
        
        if (!nombre && !telefono) {
            mensaje = 'No pude entender tu nombre o teléfono. ¿Podrías repetirlo, por favor?';
        } else {
            estadoActualizado.stage = 'FINALIZED'; // Marcamos la orden como lista para ser guardada
            mensaje += "¡Gracias! Tu pedido está listo para ser registrado.";
        }

        return { mensaje, estadoActualizado };
    }


    /**
     * Genera el resumen final del pedido antes de la confirmación.
     */
    generarResumen(estadoActual) {
        let mensaje = "Muy bien. Entonces, tu pedido final es: ";
        let itemSummary = estadoActual.items.map(item => item.nombre).join(', ');
        if (estadoActual.personalizaciones.length > 0) {
            itemSummary += ` con ${estadoActual.personalizaciones.map(c => c.name).join(' y ')}.`;
        }
        
        const totalFormat = estadoActual.total.toFixed(2);
        mensaje += `${itemSummary}. El total es de $${totalFormat}. ¿Es correcto?`;
        
        const estadoActualizado = { ...estadoActual, stage: 'CONFIRMATION' };
        
        return { mensaje, estadoActualizado };
    }

    /**
     * Calcula el total de la orden.
     */
    calcularTotal(items, personalizaciones) {
        const totalItems = items.reduce((sum, item) => sum + parseFloat(item.precio ?? 0), 0);
        const totalCustoms = personalizaciones.reduce((sum, custom) => sum + parseFloat(custom.precio ?? 0), 0);
        return totalItems + totalCustoms;
    }
}

module.exports = AsistenteIA;

