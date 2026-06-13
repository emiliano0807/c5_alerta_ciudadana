const express = require('express');
const { createClient } = require('redis');
const { v4: uuidv4 } = require('uuid');

// ==========================================
// CONFIGURACIÓN DE ENTORNO
// ==========================================
const PORT = process.env.PORT || 3000;
const REDIS_URL = process.env.REDIS_URL || 'redis://c5_redis:6379';
const REDIS_QUEUE_NAME = 'alertas_pendientes';

const app = express();
app.use(express.json());

// ==========================================
// CONEXIÓN A REDIS
// ==========================================
const redisClient = createClient({ url: REDIS_URL });

redisClient.on('error', (err) => console.error('[Redis Error]', err));
redisClient.on('connect', () => console.log('[Redis] Conectado exitosamente al broker de caché'));

// ==========================================
// MOTOR DE REGLAS DE PRIORIDAD
// ==========================================
function calcularPrioridad(emergencyType) {
    // Aunque para el examen basta con reglas condicionales estáticas, la arquitectura 
    // de esta función queda lista para que en el futuro la reemplaces por una inferencia 
    // con un modelo predictivo utilizando XGBoost u otro algoritmo de clasificación.
    const tipo = emergencyType.toLowerCase();

    const criticas = ['incendio', 'sismo', 'arma de fuego', 'explosion'];
    const altas = ['robo', 'accidente vehicular', 'urgencia medica'];

    if (criticas.includes(tipo)) return 'crítico';
    if (altas.includes(tipo)) return 'alto';

    return 'medio';
}

// ==========================================
// ENDPOINT REST PARA RECIBIR LA ALERTA
// ==========================================
app.post('/api/prioridad', async (req, res) => {
    try {
        const alertaEnriquecida = req.body;

        console.log(`\n[Prioridad] Procesando alerta del dispositivo: ${alertaEnriquecida.device_id}`);

        // 1. Generar identificador único y asignar prioridad
        const alertaFinal = {
            alert_id: uuidv4(),
            ...alertaEnriquecida,
            priority_level: calcularPrioridad(alertaEnriquecida.emergency_type),
            status: 'procesada'
        };

        console.log(`[Prioridad] Nivel asignado: ${alertaFinal.priority_level.toUpperCase()}`);

        // 2. Encolar en Redis (Garantiza tolerancia a fallos para el MS de Notificaciones)
        // Usamos lPush para meter el elemento en una lista (cola)
        await redisClient.lPush(REDIS_QUEUE_NAME, JSON.stringify(alertaFinal));
        console.log(`[Redis] Alerta ${alertaFinal.alert_id} encolada de forma segura.`);

        // NOTA: Aquí también se haría la petición HTTP POST hacia el MS de Historial 
        // para guardar el registro en PostgreSQL.

        // 3. Responder al Gateway
        res.status(200).json({
            success: true,
            message: "Alerta clasificada y encolada correctamente",
            alert_id: alertaFinal.alert_id
        });

    } catch (error) {
        console.error('[Prioridad Error] Fallo al procesar la alerta:', error);
        res.status(500).json({ success: false, error: 'Error interno del servidor' });
    }
});

// ==========================================
// INICIALIZACIÓN
// ==========================================
async function startServer() {
    await redisClient.connect();
    app.listen(PORT, () => {
        console.log(`[Prioridad] Servidor REST escuchando en el puerto ${PORT}`);
    });
}

startServer();