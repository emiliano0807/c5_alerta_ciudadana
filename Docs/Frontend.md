# Documentación de Arquitectura y Código: Dashboard Web C5

Este directorio contiene la interfaz de control operativa (Mesa de Mando) del Sistema de Alerta Ciudadana C5. Está desarrollada utilizando React.js bajo una arquitectura de flujo de datos unidireccional y reactividad en tiempo real a través de WebSockets, diseñada para procesar alertas críticas concurrentes de dispositivos IoT ESP32 sin degradar el rendimiento del navegador.

1. Mapa Completo del Directorio (frontend/)
A continuación se detalla la función de cada elemento dentro del espacio de trabajo del Frontend:

Plaintext
frontend/
├── public/                  # Recursos estáticos servidos directamente (sin compilar)
│   └── assets/
│       └── sounds/
│           └── alerta_c5.mp3 # Archivo de audio para notificaciones sonoras
├── src/                     # Código fuente de la aplicación React
│   ├── components/          # Componentes de UI modulares y reutilizables
│   │   ├── dashboard/       # Elementos específicos del tablero de control
│   │   │   ├── AlertaCard.jsx
│   │   │   └── AlertaList.jsx
│   │   └── map/             # Componentes cartográficos y de georreferenciación
│   │       └── MapViewer.jsx
│   ├── context/             # Gestión del estado global distribuido
│   │   └── AlertaContext.jsx
│   ├── hooks/               # Custom hooks para modularizar efectos de red
│   │   └── useSocket.js
│   ├── views/               # Contenedores de páginas completas (Layouts)
│   │   └── DashboardView.jsx
│   ├── App.jsx              # Enrutador y punto de inyección de contextos
│   └── main.jsx             # Punto de entrada de renderizado en el DOM de Vite
├── .env.example             # Plantilla pública de variables de entorno
├── Dockerfile               # Configuración de despliegue en contenedor
├── package.json             # Manifiesto de dependencias del proyecto
└── tailwind.config.js       # Configuración del motor de estilos CSS

2. Descripción y Código de cada Componente y Archivo
📁 src/context/ (Gestor de Estado Global)
AlertaContext.jsx: Actúa como un almacén de datos (Store) centralizado en memoria. Permite que la lista de alertas y el mapa interactivo consuman y muten exactamente el mismo flujo de datos en tiempo real, evitando el acoplamiento de componentes (Prop Drilling).

JavaScript
// src/context/AlertaContext.jsx
import React, { createContext, useState, useContext } from 'react';

const AlertaContext = createContext();

export const AlertaProvider = ({ children }) => {
  const [alertas, setAlertas] = useState([]);
  const [alertaSeleccionada, setAlertaSeleccionada] = useState(null);

  // Inserta la alerta al inicio del array para un orden cronológico descendente
  const agregarAlerta = (nuevaAlerta) => {
    setAlertas((prev) => [nuevaAlerta, ...prev]);
  };

  // Remueve la alerta de la cola de atención cuando el operador despacha la unidad
  const atenderAlerta = (id) => {
    setAlertas((prev) => prev.filter((alerta) => alerta.id !== id));
    if (alertaSeleccionada?.id === id) setAlertaSeleccionada(null);
  };

  return (
    <AlertaContext.Provider value={{ alertas, alertaSeleccionada, setAlertaSeleccionada, agregarAlerta, atenderAlerta }}>
      {children}
    </AlertaContext.Provider>
  );
};

export const useAlertas = () => useContext(AlertaContext);
📁 src/hooks/ (Lógica de Conexión de Red)
useSocket.js: Hook personalizado encargado del ciclo de vida de la conexión WebSockets. Escucha el canal de transmisión de eventos del backend, parsea las tramas del ESP32 y dispara notificaciones acústicas nativas en el navegador.

JavaScript
// src/hooks/useSocket.js
import { useEffect } from 'react';
import { io } from 'socket.io-client';
import { useAlertas } from '../context/AlertaContext';

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || 'http://localhost:5002';

export const useSocket = () => {
  const { agregarAlerta } = useAlertas();

  useEffect(() => {
    const socket = io(SOCKET_URL, {
      transports: ['websocket'],
      reconnectionAttempts: 5
    });

    socket.on('connect', () => {
      console.log('📡 Conexión WebSocket establecida con la central de notificaciones.');
    });

    socket.on('emergencia_entrante', (data) => {
      // Reproducción del audio de alerta C5
      const audio = new Audio('/assets/sounds/alerta_c5.mp3');
      audio.play().catch(() => console.warn('Audio bloqueado: requiere interacción previa del usuario.'));
      
      // Normalización del objeto según los requerimientos de la rúbrica
      agregarAlerta({
        id: data.alerta_id || Math.random().toString(36).substr(2, 9),
        dispositivo_id: data.dispositivo_id,
        latitud: parseFloat(data.latitud),
        longitud: parseFloat(data.longitud),
        tipo_emergencia: data.tipo_emergencia,
        timestamp: data.timestamp || new Date().toISOString()
      });
    });

    return () => {
      socket.disconnect();
    };
  }, [agregarAlerta]);
};
📁 src/components/dashboard/ (Mesa de Control de UI)
AlertaCard.jsx: Tarjeta reactiva para cada incidente. Cambia dinámicamente sus bordes y fondos mediante clases de Tailwind de acuerdo al tipo de emergencia (Pánico, Gas, Intrusión, Médica).

JavaScript
// src/components/dashboard/AlertaCard.jsx
import React from 'react';
import { useAlertas } from '../../context/AlertaContext';

export const AlertaCard = ({ alerta }) => {
  const { setAlertaSeleccionada, alertaSeleccionada, atenderAlerta } = useAlertas();

  const getEstiloEmergencia = (tipo) => {
    switch (tipo?.toLowerCase()) {
      case 'panico': return 'bg-red-500/10 border-red-500 text-red-400';
      case 'gas': return 'bg-orange-500/10 border-orange-500 text-orange-400';
      case 'intrusion': return 'bg-yellow-500/10 border-yellow-500 text-yellow-400';
      default: return 'bg-blue-500/10 border-blue-500 text-blue-400';
    }
  };

  const esActiva = alertaSeleccionada?.id === alerta.id;

  return (
    <div 
      className={`p-4 mb-3 rounded-lg border transition-all cursor-pointer ${getEstiloEmergencia(alerta.tipo_emergencia)} ${
        esActiva ? 'ring-2 ring-white scale-[1.01]' : 'hover:bg-slate-800/50'
      }`}
      onClick={() => setAlertaSeleccionada(alerta)}
    >
      <div className="flex justify-between items-start">
        <div>
          <span className="text-[10px] font-black uppercase tracking-widest px-2 py-0.5 rounded bg-slate-900/60">
            {alerta.tipo_emergencia}
          </span>
          <h4 className="text-sm font-bold text-slate-100 mt-2">ESP32_ID: {alerta.dispositivo_id}</h4>
        </div>
        <span className="text-[11px] font-mono text-slate-400">
          {new Date(alerta.timestamp).toLocaleTimeString()}
        </span>
      </div>
      
      <div className="mt-3 flex justify-end">
        <button 
          onClick={(e) => {
            e.stopPropagation();
            atenderAlerta(alerta.id);
          }}
          className="px-3 py-1.5 bg-slate-900 hover:bg-black text-slate-200 text-xs font-semibold rounded border border-slate-700/60 transition-colors"
        >
          Despachar Unidad
        </button>
      </div>
    </div>
  );
};
AlertaList.jsx: Contenedor de la barra lateral izquierda. Muestra un estado vacío estilizado si no hay emergencias encoladas en el sistema.

JavaScript
// src/components/dashboard/AlertaList.jsx
import React from 'react';
import { useAlertas } from '../../context/AlertaContext';
import { AlertaCard } from './AlertaCard';

export const AlertaList = () => {
  const { alertas } = useAlertas();

  if (alertas.length === 0) {
    return (
      <div className="h-64 flex flex-col items-center justify-center text-slate-500 border border-dashed border-slate-800 rounded-xl p-4 text-center">
        <div className="w-2 h-2 bg-slate-700 rounded-full animate-ping mb-2" />
        <p className="text-xs font-medium">Mesa de control despejada</p>
        <span className="text-[10px] text-slate-600 mt-1">Escuchando señales de emergencia distribuidas...</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-[calc(100vh-250px)] overflow-y-auto pr-2 custom-scrollbar">
      {alertas.map((alerta) => (
        <AlertaCard key={alerta.id} alerta={alerta} />
      ))}
    </div>
  );
};
📁 src/components/map/ (Módulo de Geolocalización)
MapViewer.jsx: Utiliza React-Leaflet sobre capas oscuras avanzadas de CartoDB. Integra un subcomponente (FlyToIncident) que manipula el API del mapa para re-centrar la vista con una animación de deslizamiento fluido cuando el operador interactúa con una alerta de la lista.

JavaScript
// src/components/map/MapViewer.jsx
import React, { useEffect } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import { useAlertas } from '../../context/AlertaContext';
import 'leaflet/dist/leaflet.css';

const FlyToIncident = ({ centro }) => {
  const map = useMap();
  useEffect(() => {
    if (centro) {
      map.setView(centro, 16, { animate: true, duration: 1.2 });
    }
  }, [centro, map]);
  return null;
};

export const MapViewer = () => {
  const { alertas, alertaSeleccionada } = useAlertas();
  const centroEdomex = [19.4326, -99.1332]; // Georreferencia por defecto del Estado de México

  return (
    <div className="w-full h-full min-h-[500px] rounded-xl overflow-hidden border border-slate-800 shadow-2xl relative">
      <MapContainer 
        center={centroEdomex} 
        zoom={10} 
        style={{ height: '100%', width: '100%', background: '#0f172a' }}
      >
        {/* Capa base en modo oscuro para pantallas de centros de comando */}
        <TileLayer
          url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
          attribution='&copy; <a href="https://osm.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/">CARTO</a>'
        />
        
        {alertas.map((alerta) => (
          <Marker 
            key={alerta.id} 
            position={[alerta.latitud, alerta.longitud]}
          >
            <Popup>
              <div className="text-slate-900 p-1 font-sans">
                <span className="font-extrabold text-red-600 text-xs uppercase block">{alerta.tipo_emergencia}</span>
                <span className="text-[11px] font-mono text-gray-700 block mt-1">Dispositivo: {alerta.dispositivo_id}</span>
                <span className="text-[10px] text-gray-400 block mt-0.5">Lat: {alerta.latitud} | Lon: {alerta.longitud}</span>
              </div>
            </Popup>
          </Marker>
        ))}

        {alertaSeleccionada && (
          <FlyToIncident centro={[alertaSeleccionada.latitud, alertaSeleccionada.longitud]} />
        )}
      </MapContainer>
    </div>
  );
};
📁 src/views/ (Vistas Estructurales)
DashboardView.jsx: Layout principal estructurado a tres columnas/paneles mediante CSS Grid. Contiene la lógica del Navbar, contadores rápidos de estado en el header y los contenedores de los submódulos.

JavaScript
// src/views/DashboardView.jsx
import React from 'react';
import { useSocket } from '../hooks/useSocket';
import { AlertaList } from '../components/dashboard/AlertaList';
import { MapViewer } from '../components/map/MapViewer';
import { useAlertas } from '../context/AlertaContext';

export const DashboardView = () => {
  useSocket(); // Inicializa el hilo de eventos síncronos WebSocket
  const { alertas } = useAlertas();

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 flex flex-col antialiased selection:bg-red-500 selection:text-white">
      
      {/* Encabezado Principal de Control */}
      <header className="bg-slate-950 border-b border-slate-800/80 px-6 py-4 flex flex-col sm:flex-row justify-between items-center gap-4 shadow-lg">
        <div className="flex items-center gap-3">
          <div className="relative flex h-3 w-3">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500"></span>
          </div>
          <h1 className="text-md font-black tracking-widest text-slate-200 font-mono">C5 ALERTA CIUDADANA • INCIDENTES DISTRIBUIDOS</h1>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-mono text-slate-400 bg-slate-900 border border-slate-800 px-3 py-1 rounded">
            ESTADO DE MÉXICO
          </span>
        </div>
      </header>

      {/* Panel Superior de Métricas Operativas */}
      <section className="p-4 grid grid-cols-1 md:grid-cols-3 gap-4 bg-slate-900">
        <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 flex justify-between items-center">
          <span className="text-xs font-bold uppercase text-slate-400 tracking-wider">Alertas No Resueltas</span>
          <span className={`text-2xl font-black ${alertas.length > 0 ? 'text-red-500 animate-pulse' : 'text-slate-500'}`}>
            {alertas.length}
          </span>
        </div>
        <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 flex justify-between items-center">
          <span className="text-xs font-bold uppercase text-slate-400 tracking-wider">Canal Notificaciones</span>
          <span className="text-xs font-mono font-bold text-emerald-400 uppercase">WebSocket Conectado</span>
        </div>
        <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 flex justify-between items-center">
          <span className="text-xs font-bold uppercase text-slate-400 tracking-wider">Infraestructura</span>
          <span className="text-xs font-bold text-slate-400 font-mono">Docker Cluster v1.0</span>
        </div>
      </section>

      {/* Mapeo del Grid de Trabajo */}
      <main className="flex-1 grid grid-cols-1 xl:grid-cols-4 p-4 gap-4 items-stretch h-[calc(100vh-160px)]">
        {/* Panel Lateral de Eventos */}
        <div className="xl:col-span-1 bg-slate-950 rounded-xl p-4 border border-slate-800 flex flex-col shadow-inner">
          <h3 className="text-xs font-black tracking-widest text-slate-400 uppercase mb-4 pb-2 border-b border-slate-900">
            Cola de Incidentes
          </h3>
          <AlertaList />
        </div>

        {/* Panel Central del Mapa Geoespacial */}
        <div className="xl:col-span-3 bg-slate-950 rounded-xl p-2 border border-slate-800">
          <MapViewer />
        </div>
      </main>
    </div>
  );
};
📄 Archivos de Configuración Estructurales (Raíz)
Archivo: src/App.jsx
Raíz de la aplicación que se encarga de envolver las vistas con el proveedor de estado global del contexto.

JavaScript
// src/App.jsx
import React from 'react';
import { AlertaProvider } from './context/AlertaContext';
import { DashboardView } from './views/DashboardView';

function App() {
  return (
    <AlertaProvider>
      <DashboardView />
    </AlertaProvider>
  );
}

export default App;
Archivo: src/main.jsx
Punto de anclaje que compila e inyecta toda la aplicación reactiva dentro del nodo <div id="root"></div> del HTML estático.

JavaScript
// src/main.jsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import './index.css'; // Contiene las directivas de importación de Tailwind CSS

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
Archivo: .env.example
Muestra las variables de red requeridas para conectar la interfaz web con los servidores en contenedores.

Ini, TOML
# Endpoint del Servidor de Sockets (Microservicio de Notificaciones)
VITE_SOCKET_URL=http://localhost:5002
3. Guía de Instalación Rápida
Instala los paquetes requeridos desde la terminal en la raíz del frontend:

Bash
npm install react-leaflet leaflet socket.io-client
Corre el servidor de desarrollo de Vite:

Bash
npm run dev