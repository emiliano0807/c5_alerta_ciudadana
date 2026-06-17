#include <WiFi.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>
#include <TinyGPSPlus.h>
#include <HardwareSerial.h>
#include <time.h>

// ==========================================
// CONFIGURACIÓN DE RED Y MQTT
// ==========================================
const char* ssid = "SpaceX";
const char* password = "Isic2026??$";
const char* mqtt_server = "192.168.2.118"; 
const int mqtt_port = 1883;
const char* mqtt_topic = "c5/alertas";
const char* ntpServer = "pool.ntp.org";
const long  gmtOffset_sec = -21600; // Desfase de -6 horas (UTC-6) en segundos
const int   daylightOffset_sec = 0; // Sin horario de verano

// ==========================================
// CONFIGURACIÓN DE HARDWARE Y GPS
// ==========================================
const int BUTTON_PIN = 4;
bool lastButtonState = HIGH;
unsigned long lastDebounceTime = 0;
unsigned long debounceDelay = 50; // Reducido para detectar clics rápidos

// Variables para la regla de negocio de Prioridad
int pressCount = 0;
unsigned long firstPressTime = 0;
const unsigned long PRESS_WINDOW = 2000; // 2 segundos para agrupar clics

// Pines para UART2 del ESP32 conectados al GPS NEO-6M
static const int RXPin = 16, TXPin = 17;
static const uint32_t GPSBaud = 9600; 

TinyGPSPlus gps;
HardwareSerial gpsSerial(2); 

WiFiClient espClient;
PubSubClient client(espClient);

void setup_wifi() {
  delay(10);
  Serial.println();
  Serial.print("Conectando a ");
  Serial.println(ssid);
  WiFi.begin(ssid, password);
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println("");
  Serial.println("WiFi conectado. IP: ");
  Serial.println(WiFi.localIP());
}

void reconnect() {
  while (!client.connected()) {
    Serial.print("Intentando conexion MQTT...");
    String clientId = "ESP32Client-";
    clientId += String(random(0xffff), HEX);
    if (client.connect(clientId.c_str())) {
      Serial.println("conectado al broker");
    } else {
      Serial.print("fallo, rc=");
      Serial.print(client.state());
      Serial.println(" intentando de nuevo en 5 segundos");
      delay(5000);
    }
  }
}

void sincronizarRelojNTP() {
  Serial.print("Sincronizando reloj por NTP");
  configTime(gmtOffset_sec, daylightOffset_sec, ntpServer);
  
  struct tm timeinfo;
  int intentos = 0;
  
  // Intentar obtener la hora hasta 15 veces
  while (!getLocalTime(&timeinfo) && intentos < 15) {
    Serial.print(".");
    delay(1000);
    intentos++;
  }
  
  Serial.println();
  if (intentos < 15) {
    Serial.println("Reloj sincronizado exitosamente.");
  } else {
    Serial.println("ADVERTENCIA: Fallo al sincronizar el servidor NTP.");
  }
}

String obtenerTimestamp() {
  struct tm timeinfo;
  if (!getLocalTime(&timeinfo)) {
    return "1970-01-01T00:00:00Z"; // Fallback por si pierde sincronizacion
  }
  
  char timeStringBuff[30];
  // Formatea la fecha al estandar ISO 8601 que espera tu backend en Node.js
  strftime(timeStringBuff, sizeof(timeStringBuff), "%Y-%m-%dT%H:%M:%SZ", &timeinfo);
  
  return String(timeStringBuff);
}

void sendAlert(int count) {
  StaticJsonDocument<256> doc;
  
  doc["device_id"] = "ESP32-001";
  
  // Arreglo de caracteres para almacenar la fecha y hora formateada
  char timestamp[25];
  
  doc["timestamp"] = obtenerTimestamp(); 
  
  JsonObject coords = doc.createNestedObject("coordinates");
  
  if (gps.location.isValid()) {
    coords["lat"] = gps.location.lat();
    coords["lon"] = gps.location.lng();
    Serial.println("Coordenadas reales obtenidas del satelite.");
  } else {
    Serial.println("ADVERTENCIA: Sin fix satelital aun. Enviando coordenadas definidas");
    coords["lat"] = 19.916568972719457;
    coords["lon"] = -99.58105226618602;
  }
  
  doc["emergency_type"] = "desconocida";
  doc["press_count"] = count;

  char jsonBuffer[256];
  serializeJson(doc, jsonBuffer);

  Serial.print("Publicando alerta completa: ");
  Serial.println(jsonBuffer);
  
  client.publish(mqtt_topic, jsonBuffer);
}

void setup() {
  Serial.begin(115200);
  gpsSerial.begin(GPSBaud, SERIAL_8N1, RXPin, TXPin);
  pinMode(BUTTON_PIN, INPUT_PULLUP);
  
  setup_wifi();
  sincronizarRelojNTP();
  client.setServer(mqtt_server, mqtt_port);
}

void loop() {
  if (!client.connected()) {
    reconnect();
  }
  client.loop();

  // Alimentar continuamente el objeto GPS
  while (gpsSerial.available() > 0) {
    gps.encode(gpsSerial.read());
  }

  // Logica de agrupacion de clics
  int reading = digitalRead(BUTTON_PIN);
  if (reading == LOW && lastButtonState == HIGH && (millis() - lastDebounceTime) > debounceDelay) {
    if (pressCount == 0) {
      firstPressTime = millis(); 
    }
    pressCount++;
    Serial.print("Clic detectado. Total en esta rafaga: ");
    Serial.println(pressCount);
    lastDebounceTime = millis();
  }
  lastButtonState = reading;

  // Evaluar si la ventana de tiempo termino para hacer el envio
  if (pressCount > 0 && (millis() - firstPressTime > PRESS_WINDOW)) {
    Serial.println("Evaluacion terminada. Despachando a Recepcion...");
    sendAlert(pressCount);
    pressCount = 0; 
  }
}