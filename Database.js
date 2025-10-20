// Archivo: Database.js
// Clase que maneja la conexión y todas las operaciones CRUD con PostgreSQL.
// Utiliza pg para simular una implementación real de base de datos.

const { Pool } = require('pg');

class Database {
    constructor() {
        // Inicializa un pool de conexión usando la variable de entorno DATABASE_URL
        // (Debe estar definida en tu archivo .env)
        this.pool = new Pool({
            connectionString: process.env.DATABASE_URL,
            // Configuración SSL para entornos de hosting como Render
            ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
        });
        console.log("Database: Pool de conexión PostgreSQL inicializado.");
    }

    /**
     * Verifica y crea las tablas 'menu' y 'ordenes' si no existen.
     * Si la tabla 'ordenes' existe pero le falta la columna 'items' (error común), la añade.
     */
    async verificarTablas() {
        console.log("Verificando/creando tablas de la base de datos...");
        
        try {
            // 1. Tabla de Menú (Productos)
            const createMenuTable = `
                CREATE TABLE IF NOT EXISTS menu (
                    id SERIAL PRIMARY KEY,
                    nombre VARCHAR(100) NOT NULL,
                    precio NUMERIC(10, 2) NOT NULL,
                    area_preparacion VARCHAR(50) NOT NULL 
                );
            `;
            
            // 2. Tabla de Órdenes
            const createOrdersTable = `
                CREATE TABLE IF NOT EXISTS ordenes (
                    id SERIAL PRIMARY KEY,
                    fecha TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                    telefono VARCHAR(50) NOT NULL,
                    transcripcion TEXT,
                    estado VARCHAR(50) NOT NULL DEFAULT 'recibida',
                    items JSONB 
                );
            `;
            
            await this.pool.query(createMenuTable);
            await this.pool.query(createOrdersTable);

            // CORRECCIÓN PERMANENTE: Si la tabla ya existía sin la columna 'items', la añadimos.
            const addItemsColumn = `
                DO $$
                BEGIN
                    IF NOT EXISTS (
                        SELECT 1 
                        FROM information_schema.columns 
                        WHERE table_name='ordenes' AND column_name='items'
                    ) THEN
                        ALTER TABLE ordenes ADD COLUMN items JSONB;
                    END IF;
                END
                $$;
            `;
            await this.pool.query(addItemsColumn);
            
            // Insertar datos de menú si la tabla está vacía
            const { rowCount } = await this.pool.query('SELECT 1 FROM menu LIMIT 1');
            if (rowCount === 0) {
                console.log("Insertando datos iniciales en la tabla de menú...");
                const initialMenu = [
                    ["Café Americano", 2.50, "barra"],
                    ["Latte de Vainilla", 3.75, "barra"],
                    ["Muffin de Arándanos", 2.00, "cocina"],
                    ["Sándwich de Pavo", 6.50, "cocina"]
                ];
                
                for (const [nombre, precio, area] of initialMenu) {
                    await this.pool.query(
                        'INSERT INTO menu (nombre, precio, area_preparacion) VALUES ($1, $2, $3)',
                        [nombre, precio, area]
                    );
                }
            }

            console.log("Tablas y datos iniciales listos.");
        } catch (error) {
            console.error("Error al verificar o crear tablas:", error);
            throw error;
        }
    }
    
    // Método temporal para forzar la eliminación y recreación de tablas
    async eliminarYRecrearTablas() {
        console.log("--- ATENCIÓN: Eliminando y recreando tablas para corregir la estructura. ---");
        try {
            await this.pool.query('DROP TABLE IF EXISTS ordenes CASCADE;');
            await this.pool.query('DROP TABLE IF EXISTS menu CASCADE;');
            await this.verificarTablas();
            console.log("--- Estructura de tablas corregida. ---");
        } catch (error) {
            console.error("Error al eliminar y recrear tablas:", error);
            throw error;
        }
    }

    /**
     * Obtiene todos los productos del menú.
     */
    async obtenerMenu() {
        const res = await this.pool.query('SELECT * FROM menu ORDER BY id');
        return res.rows;
    }

    /**
     * Agrega una nueva orden a la tabla 'ordenes'.
     */
    async agregarOrden(items, telefono, transcripcion) {
        // Aseguramos que items se serialice como string JSON antes de insertarlo en el campo JSONB
        const itemsJson = JSON.stringify(items); 
        const res = await this.pool.query(
            'INSERT INTO ordenes (items, telefono, transcripcion) VALUES ($1, $2, $3) RETURNING *',
            [itemsJson, telefono, transcripcion]
        );
        
        // El campo 'items' se devuelve como objeto/array JSON, lo parseamos antes de devolver
        const order = res.rows[0];
        
        // Modificamos el item devuelto para que 'server.js' pueda procesar las notificaciones.
        const menu = await this.obtenerMenu();
        
        // Adjuntar el área de preparación a los items de la orden
        order.items = order.items.map(item => {
            const menuMatch = menu.find(m => m.nombre === item.nombre);
            return {
                ...item,
                area_preparacion: menuMatch ? menuMatch.area_preparacion : 'general'
            };
        });

        return order;
    }
    
    /**
     * Obtiene todas las órdenes que no están 'completada'.
     */
    async obtenerOrdenesActivas() {
        const res = await this.pool.query("SELECT * FROM ordenes WHERE estado != 'completada' ORDER BY fecha DESC");
        return res.rows;
    }

    /**
     * Actualiza el estado de una orden.
     */
    async actualizarEstadoOrden(id, estado) {
        const res = await this.pool.query(
            'UPDATE ordenes SET estado = $1 WHERE id = $2 RETURNING *',
            [estado, id]
        );
        return res.rows[0];
    }
    
    /**
     * Elimina todas las órdenes y reinicia la secuencia de IDs.
     */
    async reiniciarOrdenes() {
        await this.pool.query('TRUNCATE TABLE ordenes RESTART IDENTITY');
        return { message: "Todas las órdenes han sido eliminadas." };
    }
}

module.exports = Database;
