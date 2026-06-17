# Documentación del Microservicio de Prioridad

Este microservicio forma parte del **Sistema de Alerta Ciudadana Distribuido tipo C5**. Su propósito principal es recibir las alertas de emergencia ya enriquecidas con datos geográficos, clasificarlas aplicando un motor de reglas basado en la cantidad de pulsaciones del botón físico, generar un identificador único (UUID), encolarlas en Redis (actuando como productor del buffer) y enviarlas asíncronamente al servicio de persistencia histórica.

---

## 1. Arquitectura General y Flujo de Datos

El microservicio de prioridad actúa en el núcleo del procesamiento lógico transaccional del backend. Se comunica mediante REST HTTP:

1. **Ingreso (POST):** Recibe la alerta con detalles geográficos desde la instancia receptora (Gateway).
2. **Clasificación Automática:** Ejecuta el motor de reglas interno que reescribe el tipo de emergencia y determina el nivel de prioridad.
3. **Persistencia y Encolamiento:**
   * Inserta la alerta en la cola de Redis (`alertas_pendientes`) de forma atómica para su consumo posterior.
   * Envía una copia asíncrona al microservicio de historial para su guardado definitivo en la base de datos PostgreSQL.
4. **Respuesta:** Devuelve la confirmación inmediata y el `alert_id` generado.



---

## 2. Clasificación y Motor de Reglas

El servicio evalúa la alerta entrante inspeccionando el campo `press_count` (pulsaciones registradas en el dispositivo hardware) aplicando las siguientes reglas de negocio.
| Clics / Pulsaciones | Tipo de Emergencia Asignado | Nivel de Prioridad |
| :---: | :--- | :---: |
| **1** | solicitar un policia | medio |
| **2** | incendio | alto |
| **3** | paramedicos | alto |
| **4** | accidentes graves | crítico |
| **5 o más** | desastres naturales | crítico |

---

## 3. Resiliencia y Tolerancia a Fallos

Para garantizar la estabilidad general y blindar el sistema C5 contra cuellos de botella e interrupciones, el microservicio implementa:

### A. Desacoplamiento de Escrituras Pesadas
El envío de la alerta al microservicio de Historial (para inserción en PostgreSQL) se realiza mediante una promesa no bloqueante (`fetch.catch`). De esta forma, si el servicio de historial experimenta latencia o se encuentra caído, la respuesta al gateway no se bloquea y la alerta sigue su curso hacia el operador en tiempo real.

### B. Producción Confiable en Redis
Al encolar el objeto serializado con `redisClient.lPush(env.REDIS_QUEUE_NAME, ...)`, se garantiza la retención del mensaje. Si el microservicio de notificaciones o el frontend sufren caídas críticas, el búfer de Redis actúa como bóveda de seguridad.

---

## 4. Configuración y Variables de Entorno

El microservicio expone variables de entorno configurables

| Variable | Descripción | Valor por Defecto |
| :--- | :--- | :--- |
| `PORT` | Puerto de escucha para el servidor HTTP del microservicio. | `3000` |
| `REDIS_URL` | URI de conexión al servidor broker de Redis. | `redis://c5_redis:6379` |
| `HISTORIAL_URL` | Dirección HTTP del endpoint de persistencia del historial. | `http://historial:4000/api/historial` |

* **Nombre de la Cola Utilizada:** `alertas_pendientes` (donde realiza la operación `lPush`).

---

## 5. Contrato de Comunicación (REST API)

El microservicio expone una interfaz REST HTTP.

### Endpoint: Clasificar Alerta
* **Ruta:** `POST /api/prioridad`
* **Cuerpo de la Petición (JSON):**
  ```json
  {
    "device_id": "ESP32_PANIC_01",
    "coordinates": { "lat": 19.432607, "lon": -99.133209 },
    "timestamp": "2026-06-17T16:05:00.000Z",
    "emergency_type": "emergencia",
    "press_count": 3,
    "location_details": {
      "zone": "Zona Centro",
      "sector": "Sector A"
    }
  }
  ```
* **Respuesta Exitosa (HTTP 200 OK):**
  ```json
  {
    "success": true,
    "message": "Alerta clasificada y encolada correctamente",
    "alert_id": "8b0821de-718a-4933-bf46-f9f257a075fa"
  }
  ```

---

## 6. Configuración de Despliegue (Docker Compose)

El contenedor se declara sin exposición de puertos externos, operando de forma interna dentro del puente virtual del clúster:

```yaml
  prioridad:
    image: node:20-alpine
    container_name: c5_prioridad
    working_dir: /app
    volumes:
      - ./services/prioridad:/app
      - /app/node_modules
    command: sh -c "npm install && node index.js"
    networks:
      - c5_network
    environment:
      - REDIS_URL=redis://redis:6379
    depends_on:
      - redis
```

---

## 7. Dependencias del Proyecto

Las dependencias integradas son:

* `express` (`^5.2.1`): Framework web HTTP.
* `redis` (`^6.0.0`): Cliente oficial para conexiones y operaciones asíncronas con Redis.
* `uuid` (`^14.0.0`): Librería para la generación de identificadores únicos universales.
