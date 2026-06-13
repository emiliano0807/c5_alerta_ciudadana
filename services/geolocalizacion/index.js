const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');
const path = require('path');

// ==========================================
// CONFIGURACIÓN DE ENTORNO
// ==========================================
// Escucha en todas las interfaces de red del contenedor (0.0.0.0)
const GRPC_HOST = '0.0.0.0';
const GRPC_PORT = process.env.GRPC_PORT || 50051;

// ==========================================
// CONFIGURACIÓN SERVIDOR gRPC
// ==========================================
const PROTO_PATH = path.join(__dirname, 'proto', 'geolocation.proto');
const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
    keepCase: true,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true
});
const geoProto = grpc.loadPackageDefinition(packageDefinition).geolocation;

// ==========================================
// LÓGICA DE NEGOCIO: ENRIQUECIMIENTO
// ==========================================
function enrichAlertData(call, callback) {
    const alertRequest = call.request;
    console.log(`\n[Geolocalización] Petición recibida para dispositivo: ${alertRequest.device_id}`);

    const lat = alertRequest.coordinates.lat;
    const lon = alertRequest.coordinates.lon;

    let zone = "Desconocida";
    let sector = "No asignado";

    // Lógica para el examen: Diferenciar zonas basadas en coordenadas simples
    // Si recuerdas, al ESP32 #2 le pusimos lat: 19.33 y lon: -99.23
    if (lat > 19.4 && lon > -99.2) {
        zone = "Centro Histórico";
        sector = "Sector Cuauhtémoc";
    } else if (lat <= 19.4) {
        zone = "Zona Sur";
        sector = "Sector Coyoacán";
    }

    const locationDetails = {
        zone: zone,
        sector: sector
    };

    // Construir la respuesta respetando el contrato EnrichedAlertResponse
    const enrichedResponse = {
        success: true,
        message: "Geolocalización calculada exitosamente",
        device_id: alertRequest.device_id,
        coordinates: alertRequest.coordinates,
        timestamp: alertRequest.timestamp,
        emergency_type: alertRequest.emergency_type,
        location_details: JSON.stringify(locationDetails) // El proto lo define como string
    };

    console.log(`[Geolocalización] Asignado a: ${zone} - ${sector}`);

    // Enviar respuesta de vuelta al cliente (Gateway de Recepción)
    callback(null, enrichedResponse);
}

// ==========================================
// INICIALIZACIÓN DEL SERVIDOR
// ==========================================
function main() {
    const server = new grpc.Server();

    // Registrar el servicio y sus funciones
    server.addService(geoProto.GeolocationService.service, { EnrichAlertData: enrichAlertData });

    // Iniciar el servidor
    server.bindAsync(`${GRPC_HOST}:${GRPC_PORT}`, grpc.ServerCredentials.createInsecure(), (error, port) => {
        if (error) {
            console.error('[Geolocalización] Error al arrancar el servidor:', error);
            return;
        }
        console.log(`[Geolocalización] Servidor gRPC escuchando en el puerto ${port}`);
    });
}

main();