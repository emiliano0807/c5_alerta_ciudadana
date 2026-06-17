const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');
const env = require('./env');

// ==========================================
// CONFIGURACIÓN CLIENTE gRPC
// ==========================================
const packageDefinition = protoLoader.loadSync(env.PROTO_PATH, {
    keepCase: true,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true
});
const geoProto = grpc.loadPackageDefinition(packageDefinition).geolocation;

const geoClient = new geoProto.GeolocationService(
    env.GEOLOCATION_GRPC_URI,
    grpc.credentials.createInsecure()
);

module.exports = geoClient;