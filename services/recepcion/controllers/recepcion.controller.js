const env = require('../config/env');
const recepcionService = require('../services/recepcion.service');

// ==========================================
// ENDPOINTS HTTP (BALANCEADOS POR NGINX)
// ==========================================
function getStatus(req, res) {
    res.status(200).send(`Instancia de Recepcion [${env.INSTANCE_ID}] operativa.`);
}

function processHttpAlert(req, res) {
    console.log(`\n======================================================`);
    console.log(`[BALANCEADOR NGINX -> INSTANCIA: ${env.INSTANCE_ID}]`);
    console.log(`[Algoritmo] least_conn aplico correctamente via HTTP.`);
    console.log(`======================================================\n`);

    try {
        const alertData = req.body;
        if (!recepcionService.validateAlertFormat(alertData)) {
            console.error(`[Instancia-${env.INSTANCE_ID}] Formato invalido rechazado.`);
            return res.status(400).json({ error: "El formato de la alerta es invalido." });
        }

        // Enviamos la alerta al flujo normal del sistema
        recepcionService.sendToGeolocationService(alertData);

        res.status(200).json({
            success: true,
            message: "Alerta procesada",
            procesado_por: `Contenedor-${env.INSTANCE_ID}`
        });
    } catch (error) {
        console.error(`[Instancia-${env.INSTANCE_ID}] Error interno:`, error.message);
        res.status(500).json({ error: "Fallo interno en el gateway" });
    }
}

module.exports = {
    getStatus,
    processHttpAlert
};