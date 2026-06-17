# Microservice Historial

> **Propósito**: Gestionar los registros históricos de alertas ciudadanas.

---

## Tabla de contenidos

- [Visión general](#overview)
- [Arquitectura](#architecture)
- [Instalación y ejecución local](#installation--running-locally)
- [Variables de entorno](#environment-variables)
- [Endpoints de la API](#api-endpoints)
- [Base de datos](#database)
- [Estructura del código](#code-structure)
- [Pruebas](#testing)
- [Observabilidad y logging](#observability--logging)
- [Despliegue](#deployment)

---

## Visión general

El microservicio **Historial** almacena una pista de auditoría inmutable de las acciones realizadas sobre las alertas (creación, cambios de estado, asignaciones, etc.). Expone una API REST para operaciones CRUD y está construido con **Node.js (v20)** y **Express.js**.

---

## Arquitectura

- **Punto de entrada**: `index.js` – Configura Express, CORS, parseo de JSON y monta las rutas.
- **Configuración**: `config/env.js` (variables de entorno) y `config/database.js` (pools de PostgreSQL – primario para escrituras, réplica para lecturas).
- **Rutas**: `routes/historial.routes.js` – Declara los endpoints HTTP.
- **Controladores**: `controllers/historial.controller.js` – Gestionan las peticiones y delegan al servicio.
- **Capa de servicio**: `services/historial.service.js` – Contiene la lógica de negocio y consultas a la base de datos.
- **Base de datos**: Tabla PostgreSQL `incidentes` (creada al iniciar el servicio).

---

## Instalación y ejecución local

```bash
# Clonar el repositorio (si aún no lo tienes)
git clone <repo-url>
cd c5_alerta_ciudadana/services/historial

# Instalar dependencias (con npm o pnpm)
npm ci   # o pnpm install

# Crear archivo .env (copiar de .env.example si existe)
cp .env.example .env
# Editar .env con las cadenas de conexión a PostgreSQL y el puerto deseado

# Iniciar el servicio
npm start   # ejecuta index.js
```

El servicio escuchará en el puerto definido por `PORT` (por defecto **4000**).

---

## Variables de entorno

| Variable | Descripción | Valor por defecto |
|----------|-------------|-------------------|
| `PORT` | Puerto HTTP del servicio. | `4000` |
| `DB_PRIMARY_URL` | Cadena de conexión al nodo primario (escritura). | `postgres://c5_admin:c5_secret@postgres-primary:5432/c5_alertas` |
| `DB_REPLICA_URL` | Cadena de conexión al nodo réplica (lectura). | `postgres://c5_admin:c5_secret@postgres-replica:5432/c5_alertas` |

---

## Endpoints de la API

Todas las rutas llevan el prefijo **`/api/historial`**.

| Método | Ruta | Descripción | Cuerpo de la solicitud | Respuesta |
|--------|------|-------------|------------------------|-----------|
| **POST** | `/incidentes` | Persistir un nuevo incidente (escritura en primario). | `IncidenteCreateDto` | `201 Created` – `{ success: true, message: 'Incidente persistido correctamente.' }` |
| **GET** | `/incidentes` | Consultar incidentes en la réplica con filtros opcionales (`start_date`, `end_date`, `zone`, `priority_level`). | – | `200 OK` – `{ success: true, data: [...] }` |
| **PUT** | `/incidentes/:id/status` | Actualizar el estado de un incidente (escritura en primario). | `{ status: 'string' }` | `200 OK` – `{ success: true, message: 'Estado actualizado correctamente.' }` |

### DTOs (objetos JavaScript)

```json
// IncidenteCreateDto (enviado en POST /incidentes)
{
  "alert_id": "uuid",
  "device_id": "string",
  "lat": 0.0,
  "lon": 0.0,
  "zone": "string",
  "sector": "string",
  "emergency_type": "string",
  "priority_level": "string",
  "status": "string",
  "timestamp": "ISO8601"
}
```

---

## Base de datos

El servicio usa una única tabla **`incidentes`**:

```sql
CREATE TABLE IF NOT EXISTS incidentes (
    alert_id UUID PRIMARY KEY,
    device_id VARCHAR(50) NOT NULL,
    lat DOUBLE PRECISION NOT NULL,
    lon DOUBLE PRECISION NOT NULL,
    zone VARCHAR(100),
    sector VARCHAR(100),
    emergency_type VARCHAR(50) NOT NULL,
    priority_level VARCHAR(20) NOT NULL,
    status VARCHAR(20) NOT NULL,
    timestamp TIMESTAMP NOT NULL
);
```

La tabla se crea al iniciar el servicio mediante `config/database.js`.

---

## Estructura del código

```
services/historial/
├─ config/
│   ├─ env.js          # variables de entorno
│   └─ database.js      # pools de BD y función init
├─ controllers/
│   └─ historial.controller.js  # manejo de peticiones
├─ routes/
│   └─ historial.routes.js      # definición de rutas Express
├─ services/
│   └─ historial.service.js     # lógica de negocio y consultas DB
├─ index.js          # bootstrap de la app Express
└─ README.md         # (este archivo)
```

Cada capa sigue el principio de **Separación de Responsabilidades**: rutas → controladores → servicios → base de datos.

---

## Observabilidad & Logging

- **Endpoint de salud**: `GET /healthz` (agregar manualmente) debe validar la conectividad a ambas bases (primario y réplica).
- **Métricas**: exponer métricas de Prometheus mediante `/metrics` (aún no implementado).

---

## Despliegue

El microservicio se puede contenedorarizar con el siguiente docker‑compose:

```yaml
  historial:l
    image: node:20-alpine
    container_name: c5_historial
    working_dir: /app
    volumes:
      - ./services/historial:/app
      - /app/node_modules
    command: sh -c "npm install && node index.js"
    networks:
      - c5_network
    ports:
      - "4000:4000"
    environment:
      - DB_PRIMARY_URL=postgres://c5_admin:c5_secret@postgres-primary:5432/c5_alertas
      - DB_REPLICA_URL=postgres://c5_admin:c5_secret@postgres-replica:5432/c5_alertas
    depends_on:
      - postgres-primary
      - postgres-replica

```

Utiliza el **docker‑compose.yml** del repositorio raíz para levantar todo el stack, o despliega la imagen en Kubernetes con el chart Helm proporcionado.

---
