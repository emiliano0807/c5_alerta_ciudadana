# Documentación del Microservicio de Geolocalización

Este microservicio forma parte del **Sistema de Alerta Ciudadana Distribuido tipo C5**. Su propósito principal es recibir las coordenadas geográficas de los incidentes reportados, realizar la geocodificación inversa consultando satélites de mapas públicos (OpenStreetMap) y enriquecer la alerta original con detalles de ubicación legibles (Zona y Sector) antes de ser procesada por el motor de priorización. La comunicación con este servicio se realiza síncronamente mediante gRPC de alto rendimiento.

---

## 1. Arquitectura General y Flujo de Datos

El microservicio de geolocalización opera como un servidor gRPC que expone métodos de consulta interna para los servicios de recepción de alertas:

1. **Recepción de Petición:** El microservicio de recepción de alertas recibe una llamada y delega la geolocalización al servidor gRPC enviando las coordenadas (latitud y longitud).
2. **Geocodificación Inversa:** El servicio consulta la API pública de Nominatim (OpenStreetMap) para traducir las coordenadas en una dirección real legible.
3. **Respuesta Enriquecida:** Retorna los detalles geográficos estructurados (`zone` y `sector`) al emisor en un payload binario optimizado.



---

## 2. Resiliencia y Tolerancia a Fallos

El servicio implementa mecanismos específicos de control de errores para asegurar que la disponibilidad general del sistema C5 no se vea comprometida por factores externos:

### A. Fallback en Caídas de Conexión de Mapas
El servicio depende de la API pública externa de OpenStreetMap (Nominatim). En caso de que:
* La API experimente caídas o latencias excesivas.
* Se rechace la conexión por políticas de límite de peticiones (Rate Limiting).
* El servidor pierda el acceso a internet.

El flujo está protegido por una estructura `try-catch` en [geocoding.service.js](file:///home/maxxow/Repos/c5_alerta_ciudadana/services/geolocalizacion/services/geocoding.service.js). En lugar de propagar un fallo crítico que detenga la cadena de procesamiento de la alerta, el servicio captura la excepción, genera una advertencia en consola y retorna valores por defecto seguros:
* **Zona predeterminada:** `"Ubicacion desconocida"`
* **Sector predeterminado:** `"Sin clasificar"`

### B. Comunicación de Alto Rendimiento y Baja Latencia
Para cumplir con el SLA de respuesta de extremo a extremo menor a 2 segundos:
* Implementa comunicación gRPC sobre HTTP/2, lo que reduce drásticamente la latencia mediante serialización binaria y multiplexación de conexiones.

---

## 3. Configuración y Variables de Entorno

El servicio expone un puerto gRPC configurable que puede ser parametrizado mediante variables de entorno del sistema operativo:

| Variable | Descripción | Valor por Defecto |
| :--- | :--- | :--- |
| `GRPC_PORT` | Puerto TCP en el que escucha el servidor gRPC de geolocalización. | `50051` |

* **Host de Escucha:** El servidor gRPC se enlaza a la interfaz de red `0.0.0.0` para permitir conexiones de otros contenedores dentro de la red del puente virtual de Docker.
* **Archivo de Definición Proto:** La ubicación del contrato del buffer está parametrizada internamente hacia [geolocation.proto](file:///home/maxxow/Repos/c5_alerta_ciudadana/services/geolocalizacion/proto/geolocation.proto).

---

## 4. Contrato de Comunicación (gRPC / Protocol Buffers)



### Servicio y Métodos
* **Servicio:** `GeolocationService`
* **Método RPC:** `EnrichAlertData`

### Mensajes de Datos

#### Petición (`AlertRequest`)
```protobuf
message Coordinates {
  double lat = 1;
  double lon = 2;
}

message AlertRequest {
  string device_id = 1;
  Coordinates coordinates = 2;
  string timestamp = 3;
  string emergency_type = 4;
  int32 press_count = 5;
}
```

#### Respuesta Enriquecida (`EnrichedAlertResponse`)
```protobuf
message EnrichedAlertResponse {
  bool success = 1;
  string message = 2;
  string device_id = 3;
  Coordinates coordinates = 4;
  string timestamp = 5;
  string emergency_type = 6;
  string location_details = 7; // Objeto JSON serializado como string: { "zone": "...", "sector": "..." }
  int32 press_count = 8;
}
```

---

## 5. Configuración de Despliegue (Docker Compose)

El microservicio se ejecuta de forma contenerizada en el archivo principal. Utiliza una imagen base ligera de Node.js e instala las dependencias al inicializarse:

```yaml
  geolocalizacion:
    image: node:20-alpine
    container_name: c5_geolocalizacion
    working_dir: /app
    volumes:
      - ./services/geolocalizacion:/app
      - /app/node_modules
    command: sh -c "npm install && node index.js"
    networks:
      - c5_network
    ports:
      - "50051:50051"
```

---

## 6. Dependencias del Proyecto

Las dependencias instaladas para su funcionamiento son:

* `@grpc/grpc-js` (`^1.9.x`): Implementación pura de gRPC en JavaScript para Node.js.
* `@grpc/proto-loader` (`^0.7.x`): Herramienta para cargar dinámicamente definiciones de Protocol Buffers (`.proto`).
* `mqtt` (`^5.3.x`): Cliente MQTT para Node.js (declarado en el módulo).
