// Archivo: Database.js
// Clase para manejar la conexión y las operaciones de PostgreSQL.

const { Pool } = require('pg');
// const { v4: uuidv4 } = require('uuid'); // Eliminada importación de uuid, ya que no se usa.

class Database {
    constructor() {
        const connectionString = process.env.DATABASE_URL;
        
        // --- 🔴 CORRECCIÓN FINAL PARA SSL/TLS REQUIRED ---
        // Aplicamos la configuración de SSL (rejectUnauthorized: false) 
        // de forma incondicional si se usa una URL (conexión remota), 
        // ya que la mayoría de los proveedores cloud lo requieren.
        
        let poolConfig = {
            connectionString: connectionString,
        };

        // Si la variable DATABASE_URL está definida, asumimos que es una conexión remota
        // y que necesita SSL, a menos que se especifique lo contrario.
        if (connectionString) {
             poolConfig.ssl = {
                // Esto es crucial para aceptar certificados de Render/servicios en la nube.
                rejectUnauthorized: false
            };
        } 
        
        // Si usas localhost, la URL típicamente comienza con 'postgres://localhost...'
        // y no incluirá 'sslmode=require', por lo que esta configuración seguirá siendo segura.
        // Si la usaras localmente, simplemente cambiarías 'sslmode=require' a 'sslmode=disable' en tu .env.

        this.pool = new Pool(poolConfig);
        
        // Llamada a la inicialización al crear la instancia
        console.log('Verificando/creando tablas de la base de datos...');
        this.inicializarTablas().catch(err => {
            console.error('Error al inicializar tablas:', err);
        });
    }

    // --- MÉTODOS DE INICIALIZACIÓN ---

    async inicializarTablas() {
        const client = await this.pool.connect();
        try {
            await client.query('BEGIN'); // Inicia una transacción

            // 1. Tabla de Productos (Menú)
            await client.query(`
                CREATE TABLE IF NOT EXISTS productos (
                    id SERIAL PRIMARY KEY,
                    nombre VARCHAR(100) NOT NULL UNIQUE,
                    area_preparacion VARCHAR(50) NOT NULL -- 'barra' o 'cocina'
                );
            `);

            // 2. Tabla de Órdenes
            await client.query(`
                CREATE TABLE IF NOT EXISTS ordenes (
                    id SERIAL PRIMARY KEY,
                    telefono VARCHAR(50) NOT NULL,
                    transcripcion TEXT,
                    estado VARCHAR(50) NOT NULL DEFAULT 'recibida', -- 'recibida', 'en_preparacion', 'lista_para_servir', 'completada'
                    fecha TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW()
                );
            `);

            // 3. Tabla de Items de la Orden (Relación M:M)
            await client.query(`
                CREATE TABLE IF NOT EXISTS orden_items (
                    id SERIAL PRIMARY KEY,
                    orden_id INTEGER REFERENCES ordenes(id) ON DELETE CASCADE,
                    producto_id INTEGER REFERENCES productos(id) ON DELETE RESTRICT,
                    cantidad INTEGER NOT NULL DEFAULT 1
                );
            `);

            // 4. Poblar el menú si está vacío
            const res = await client.query('SELECT COUNT(*) FROM productos');
            if (parseInt(res.rows[0].count) === 0) {
                console.log('Poblando el menú inicial...');
                const menu = [
                    { nombre: 'Capuchino', area_preparacion: 'barra' },
                    { nombre: 'Latte', area_preparacion: 'barra' },
                    { nombre: 'Café Americano', area_preparacion: 'barra' },
                    { nombre: 'Sándwich de pavo', area_preparacion: 'cocina' },
                    { nombre: 'Ensalada César', area_preparacion: 'cocina' },
                    { nombre: 'Brownie', area_preparacion: 'barra' }
                ];
                
                for (const item of menu) {
                    await client.query(
                        'INSERT INTO productos (nombre, area_preparacion) VALUES ($1, $2)',
                        [item.nombre, item.area_preparacion]
                    );
                }
            }

            await client.query('COMMIT'); // Confirma la transacción
            console.log('Tablas verificadas exitosamente.');

        } catch (error) {
            await client.query('ROLLBACK'); // Deshace la transacción en caso de error
            throw error;
        } finally {
            client.release();
        }
    }

    // --- MÉTODOS CRUD DE LA APLICACIÓN ---

    async obtenerMenu() {
        const res = await this.pool.query('SELECT * FROM productos ORDER BY area_preparacion, nombre');
        return res.rows;
    }
    
    // Obtiene las órdenes que NO están 'completada'
    async obtenerOrdenesActivas() {
        const res = await this.pool.query(`
            SELECT 
                o.id, 
                o.telefono, 
                o.transcripcion, 
                o.estado, 
                o.fecha,
                json_agg(json_build_object(
                    'nombre', p.nombre,
                    'cantidad', oi.cantidad,
                    'area_preparacion', p.area_preparacion
                )) as items
            FROM ordenes o
            JOIN orden_items oi ON o.id = oi.orden_id
            JOIN productos p ON oi.producto_id = p.id
            WHERE o.estado != 'completada'
            GROUP BY o.id
            ORDER BY o.fecha DESC
        `);
        return res.rows;
    }

    async agregarOrden(items, telefono, transcripcion) {
        const client = await this.pool.connect();
        let nuevaOrden;
        
        try {
            await client.query('BEGIN');
            
            // 1. Insertar la nueva orden principal
            const ordenRes = await client.query(
                'INSERT INTO ordenes (telefono, transcripcion) VALUES ($1, $2) RETURNING id, estado',
                [telefono, transcripcion]
            );
            const ordenId = ordenRes.rows[0].id;
            nuevaOrden = { id: ordenId, telefono, transcripcion, items: [], estado: ordenRes.rows[0].estado };

            // 2. Insertar los items de la orden
            for (const item of items) {
                // Obtener el ID del producto y su área de preparación
                const prodRes = await client.query(
                    'SELECT id, area_preparacion FROM productos WHERE nombre = $1',
                    [item.nombre]
                );
                
                if (prodRes.rows.length > 0) {
                    const productoId = prodRes.rows[0].id;
                    const areaPreparacion = prodRes.rows[0].area_preparacion;
                    
                    await client.query(
                        'INSERT INTO orden_items (orden_id, producto_id, cantidad) VALUES ($1, $2, $3)',
                        [ordenId, productoId, item.cantidad]
                    );
                    
                    // Agregar detalles completos al objeto de retorno
                    nuevaOrden.items.push({ 
                        nombre: item.nombre, 
                        cantidad: item.cantidad,
                        area_preparacion: areaPreparacion 
                    });
                }
            }

            await client.query('COMMIT');
            
            // Retorna la orden con todos los detalles necesarios para notificación
            return nuevaOrden; 

        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }
    
    async actualizarEstadoOrden(ordenId, nuevoEstado) {
        const res = await this.pool.query(
            'UPDATE ordenes SET estado = $1 WHERE id = $2 RETURNING *',
            [nuevoEstado, ordenId]
        );
        if (res.rowCount === 0) {
            throw new Error(`Orden con ID ${ordenId} no encontrada.`);
        }
        return res.rows[0];
    }
    
    async reiniciarOrdenes() {
        // Borra todas las órdenes y resetea el contador de ID
        const resOrdenItems = await this.pool.query('TRUNCATE orden_items RESTART IDENTITY CASCADE;');
        const resOrdenes = await this.pool.query('TRUNCATE ordenes RESTART IDENTITY CASCADE;');
        return { 
            message: 'Órdenes reiniciadas exitosamente. Las tablas de menú (productos) se mantuvieron.',
            results: { itemsDeleted: resOrdenItems.rowCount, ordersDeleted: resOrdenes.rowCount }
        };
    }
}

module.exports = Database;
