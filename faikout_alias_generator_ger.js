// ================================================================
// v0.4 (16.10.2026)    https://codeberg.org/RaW07/faikout-projects
// Entwickelt und getestet auf ioBroker JavaScript-Adapter v9.0.18
// Faikout Alias-Generator für ioBroker
// Dieses Script einmalig im JavaScript-Adapter ausführen.
// Es erkennt das Faikout automatisch und legt alle Alias-Datenpunkte an.
// Die Aliases werden auf Basis der am Gerät aktiv geschalteten Funktionen
// erstellt – deaktivierte Features werden überwiegend nicht angelegt.
// Hinweis: Bei Änderungen an den Faikout-Einstellungen (z.B. Humidifier
// aktivieren/deaktivieren) müsste das Script erneut ausgeführt werden.
//
// VORAUSSETZUNGEN:
//   1. Das Faikout muss bereits per MQTT mit ioBroker verbunden sein
//      und unter Admin → Objekte als
//        mqtt-client.0.state.GERAETE_ID.status  (mqtt-client-Adapter)
//      oder
//        mqtt.0.state.GERAETE_ID.status          (mqtt-Adapter)
//      erscheinen und Daten liefern.
//   2. Im JavaScript-Adapter muss "Objekte anlegen erlauben" aktiviert sein:
//      Admin → Instanzen → javascript.X
//      "Kommando "setObject" erlauben" = EIN
//      (Das Script prüft dies automatisch beim Start.)
//
// KONFIGURATION – nur diese Werte anpassen:
// ================================================================
const FAIKOUT_IP    = '192.168.x.x';   // IP-Adresse des Faikout
const MQTT_INSTANCE = 'mqtt-client.0';  // MQTT-Adapter Instanz
const ALIAS_NAME    = 'MeineKlima';     // Ordnername in alias.0.*

// ---- Optional: Faikout Konfigurationsparameter per MQTT ----
// CREATE_CONFIG_ALIASES = true: legt einen Unterordner mit schreibbaren
// Aliases für Faikout-Einstellungen an.
// WICHTIG: Diese Aliases sind NUR SCHREIBBAR. Konfigurationsparameter
// sind NICHT in der Faikout MQTT-Statusmeldung enthalten, daher kann
// ioBroker den aktuellen Wert nicht auslesen. Der Datenpunkt zeigt immer
// den zuletzt von ioBroker geschriebenen Wert – wenn du eine Einstellung
// über die Faikout-Weboberfläche änderst, ist der Datenpunkt nicht mehr
// aktuell.
// Die Faikout-Weboberfläche ist die maßgebliche Quelle für aktuelle Werte.
// Script nach Änderung eines Toggles erneut ausführen.
const CREATE_CONFIG_ALIASES = false;
const CONFIG_ALIAS_NAME     = 'Config'; // Unterordner: alias.0.ALIAS_NAME.Config

const CONFIG_FIELDS_ENABLE = {
    heatback:   true,   // Heat pull-back (°C)
    heatover:   true,   // Heat push-over (°C)
    coolback:   true,   // Cool pull-back (°C)
    coolover:   true,   // Cool push-over (°C)
    tcontrol:   true,   // Control-Timeout (s)
    thermref:   false,  // Inlet/Home-Blend (%)
    tmin:       false,  // Min-Temperatur (°C)
    tmax:       false,  // Max-Temperatur (°C)
    tcoolmin:   false,  // Min-Temperatur Kühlen (°C)
    theatmax:   false,  // Max-Temperatur Heizen (°C)
    frosttemp:  false,  // Frostschutz (°C)
    minoutside: false,  // Min-Außentemperatur (°C)
    switchtemp: false,  // Schaltpunkt-Offset (°C)
    pushtemp:   false,  // Push-Offset (°C)
    reporting:  false,  // Report-Intervall (s)
    lockmode:   false,  // Heiz-/Kühlmodus sperren
};
// ================================================================

'use strict';
const http = require('http');

// Adapter-Typ automatisch erkennen
const IS_MQTT_CLIENT = MQTT_INSTANCE.startsWith('mqtt-client.');
// IS_MQTT_CLIENT = true  → iobroker.mqtt-client (braucht custom-Block)
// IS_MQTT_CLIENT = false → iobroker.mqtt        (plain State genügt)

// ----------------------------------------------------------------
// Felddefinitionen
//   writeTopic: 'control'       → command.ID.control  als JSON-Objekt
//               'mode','fan'... → command.ID.<topic>   direkt
//               'setting:autot' → setting.ID.autot     direkt
//               fehlt           → read-only
// ----------------------------------------------------------------
const FIELDS = {
    power:      { label: 'Ein/Aus',                   type: 'boolean', writeTopic: 'control',        writeConv: 'JSON.stringify({power:val})',   readConv: 'val?JSON.parse(val).power===true:false' },
    swingv:     { label: 'Vertikales Schwingen',       type: 'boolean', writeTopic: 'control',        writeConv: 'JSON.stringify({swingv:val})',  readConv: 'val?JSON.parse(val).swingv===true:false' },
    swingh:     { label: 'Horizontales Schwingen',     type: 'boolean', writeTopic: 'control',        writeConv: 'JSON.stringify({swingh:val})',  readConv: 'val?JSON.parse(val).swingh===true:false' },
    mode:       { label: 'Betriebsmodus (H/C/F/D/A)', type: 'mixed',   writeTopic: 'mode',           writeConv: null,                           readConv: 'val?JSON.parse(val).mode:null' },
    fan:        { label: 'Lüftermodus (z.B. 1-5/A/Q)',      type: 'mixed',   writeTopic: 'fan',            writeConv: null,                           readConv: 'val?JSON.parse(val).fan:null' },
    econo:      { label: 'Eco-Modus',                  type: 'boolean', writeTopic: 'econo',          writeConv: 'val?1:0',                      readConv: 'val?JSON.parse(val).econo===true:false' },
    powerful:   { label: 'Powerful-Modus',             type: 'boolean', writeTopic: 'powerful',       writeConv: 'val?1:0',                      readConv: 'val?JSON.parse(val).powerful===true:false' },
    demand:     { label: 'Bedarf/Kompressorleistung',         type: 'number',  writeTopic: 'demand',         writeConv: null,           unit: '%',       readConv: 'val?parseInt(JSON.parse(val).demand):null' },
    autot:      { label: 'Solltemperatur (Faikout)',   type: 'number',  writeTopic: 'setting:autot',  writeConv: null,           unit: '°C',      readConv: 'val?parseFloat(JSON.parse(val).autot):null' },
    autor:      { label: 'Hysterese (Faikout)',        type: 'number',  writeTopic: 'setting:autor',  writeConv: null,           unit: '°C',      readConv: 'val?parseFloat(JSON.parse(val).autor):null' },
    outside:    { label: 'Außentemperatur',            type: 'number',  unit: '°C',    readConv: 'val?parseFloat(JSON.parse(val).outside):null' },
    home:       { label: 'Innentemperatur',            type: 'number',  unit: '°C',    readConv: 'val?parseFloat(JSON.parse(val).home):null' },
    liquid:     { label: 'Kältemitteltemperatur',      type: 'number',  unit: '°C',    readConv: 'val?parseFloat(JSON.parse(val).liquid):null' },
    inlet:      { label: 'Ansaugtemperatur',           type: 'number',  unit: '°C',    readConv: 'val?parseFloat(JSON.parse(val).inlet):null' },
    temp:       { label: 'Sollwert (Daikin intern)',   type: 'number',  unit: '°C',    readConv: 'val?parseFloat(JSON.parse(val).temp):null' },
    comp:       { label: 'Kompressordrehzahl',         type: 'number',  unit: 'Hz',    readConv: 'val?parseFloat(JSON.parse(val).comp):null' },
    fanrpm:     { label: 'Lüfterdrehzahl',             type: 'number',  unit: 'RPM',   readConv: 'val?parseFloat(JSON.parse(val).fanrpm):null' },
    consumption:{ label: 'Leistungsaufnahme',          type: 'number',  unit: 'W',     readConv: 'val?parseFloat(JSON.parse(val).consumption):null' },
    Whheating:  { label: 'Heizenergie (kumuliert)',    type: 'number',  unit: 'Wh',    readConv: 'val?parseInt(JSON.parse(val).Whheating):null' },
    Whcooling:  { label: 'Kühlenergie (kumuliert)',   type: 'number',  unit: 'Wh',    readConv: 'val?parseInt(JSON.parse(val).Whcooling):null' },
    Whoutside:  { label: 'Außengerät Energiezähler',  type: 'number',  unit: 'Wh',    readConv: 'val?parseInt(JSON.parse(val).Whoutside):null' },
    hum:        { label: 'Luftfeuchtigkeit',           type: 'number',  unit: '%',     readConv: 'val?parseFloat(JSON.parse(val).hum):null' },
    anglev:     { label: 'Vertikaler Luftwinkel',      type: 'number',  unit: '°',     readConv: 'val?JSON.parse(val).anglev:null' },
    angleh:     { label: 'Horizontaler Luftwinkel',    type: 'number',  unit: '°',     readConv: 'val?JSON.parse(val).angleh:null' },
    comfort:    { label: 'Comfort-Modus',              type: 'boolean', writeTopic: 'comfort',   writeConv: 'val?1:0', readConv: 'val?JSON.parse(val).comfort===true:false' },
    streamer:   { label: 'Luftreiniger (Streamer)',    type: 'boolean', writeTopic: 'streamer',  writeConv: 'val?1:0', readConv: 'val?JSON.parse(val).streamer===true:false' },
    led:        { label: 'LED',                        type: 'boolean', writeTopic: 'led',       writeConv: 'val?1:0', readConv: 'val?JSON.parse(val).led===true:false' },
    quiet:      { label: 'Quiet (Außengerät leise)',   type: 'boolean', writeTopic: 'quiet',     writeConv: 'val?1:0', readConv: 'val?JSON.parse(val).quiet===true:false' },
    humidify:   { label: 'Befeuchter (z.B. X/L/S/H/C)', type: 'mixed', writeTopic: 'humidify', writeConv: null,      readConv: 'val?JSON.parse(val).humidify:null' },
    autoe:      { label: 'Auto-Funktion aktiv',        type: 'boolean', writeTopic: 'autoe',    writeConv: 'val?1:0', readConv: 'val?JSON.parse(val).autoe===true:false' },
    autop:      { label: 'Auto Ein/Aus aktiv',         type: 'boolean', writeTopic: 'autop',    writeConv: 'val?1:0', readConv: 'val?JSON.parse(val).autop===true:false' },
    auto0:      { label: 'Timer Ausschaltzeit',        type: 'mixed',   writeTopic: 'setting',  writeConv: 'JSON.stringify({auto0:String(val).replace(":","")})',  readConv: 'val?JSON.parse(val).auto0:null' },
    auto1:      { label: 'Timer Einschaltzeit',        type: 'mixed',   writeTopic: 'setting',  writeConv: 'JSON.stringify({auto1:String(val).replace(":","")})',  readConv: 'val?JSON.parse(val).auto1:null' },
    autob:      { label: 'BLE-Referenzgerät (MAC)',    type: 'mixed',   readConv: 'val?JSON.parse(val).autob:null', bleKey: true },
    antifreeze: { label: 'Frostschutz aktiv',          type: 'boolean', readConv: 'val?JSON.parse(val).antifreeze===true:false' },
    env:        { label: 'Raumtemperatur',                     type: 'number', unit: '°C', readConv: 'val?parseFloat(JSON.parse(val).env):null' },
    // env_set: Raumtemperatur an Faikout senden (Regelreferenz).
    // WICHTIG: Muss zyklisch gesendet werden – der Faikout verwirft den Wert
    // nach Ablauf von tcontrol Sekunden (Faikout-Einstellung "Control messages timeout",
    // Standard 600 s). Empfehlung: alle 30–60 s senden, damit der Wert nie abläuft.
    env_set:    { label: 'Raumtemperatur (Regelreferenz senden)', type: 'number', unit: '°C', writeTopic: 'control', writeConv: 'JSON.stringify({env:val})', writeOnly: true },
    restart:    { label: 'Gerät neu starten',                    type: 'boolean',             writeTopic: 'restart',  writeConv: 'val?1:0',                  writeOnly: true },
    // BLE-Sensor (optional, nur wenn Gerät BLE-Sensor meldet)
    'ble_temp': { label: 'BLE Temperatur',             type: 'number',  unit: '°C',    readConv: 'val&&JSON.parse(val).ble?parseFloat(JSON.parse(val).ble.temp):null', bleKey: true },
    'ble_hum':  { label: 'BLE Luftfeuchtigkeit',       type: 'number',  unit: '%',     readConv: 'val&&JSON.parse(val).ble?parseFloat(JSON.parse(val).ble.hum):null',  bleKey: true },
    'ble_bat':  { label: 'BLE Batteriestand',          type: 'number',  unit: '%',     readConv: 'val&&JSON.parse(val).ble?parseFloat(JSON.parse(val).ble.bat):null',   bleKey: true },
    'ble_volt': { label: 'BLE Batteriespannung',       type: 'number',  unit: 'V',     readConv: 'val&&JSON.parse(val).ble?parseFloat(JSON.parse(val).ble.volt):null',  bleKey: true },
};

// ----------------------------------------------------------------
// Konfigurationsparameter-Definitionen (alle write-only – nicht im Status-JSON)
// ----------------------------------------------------------------
const CONFIG_FIELDS_DEF = {
    heatback:   { label: 'Heat pull-back',                  type: 'number',  unit: '°C', writeConv: null },
    heatover:   { label: 'Heat push-over',                  type: 'number',  unit: '°C', writeConv: null },
    coolback:   { label: 'Cool pull-back',                  type: 'number',  unit: '°C', writeConv: null },
    coolover:   { label: 'Cool push-over',                  type: 'number',  unit: '°C', writeConv: null },
    tcontrol:   { label: 'Control-Timeout',                 type: 'number',  unit: 's',  writeConv: null },
    thermref:   { label: 'Inlet/Home-Blend-Verhältnis',     type: 'number',  unit: '%',  writeConv: null },
    tmin:       { label: 'Min-Temperaturgrenze',            type: 'number',  unit: '°C', writeConv: null },
    tmax:       { label: 'Max-Temperaturgrenze',            type: 'number',  unit: '°C', writeConv: null },
    tcoolmin:   { label: 'Min-Temperaturgrenze Kühlen',     type: 'number',  unit: '°C', writeConv: null },
    theatmax:   { label: 'Max-Temperaturgrenze Heizen',     type: 'number',  unit: '°C', writeConv: null },
    frosttemp:  { label: 'Frostschutztemperatur',           type: 'number',  unit: '°C', writeConv: null },
    minoutside: { label: 'Min-Außentemperatur',             type: 'number',  unit: '°C', writeConv: null },
    switchtemp: { label: 'Schaltpunkt-Offset',              type: 'number',  unit: '°C', writeConv: null },
    pushtemp:   { label: 'Push-Offset',                     type: 'number',  unit: '°C', writeConv: null },
    reporting:  { label: 'Status-Reportintervall',          type: 'number',  unit: 's',  writeConv: null },
    lockmode:   { label: 'Heiz-/Kühlmodus sperren',         type: 'boolean',             writeConv: 'val?1:0' },
};

// Felder die immer angelegt werden, auch wenn nicht in o.xyz erkannt
// (kommen aus dem MQTT-JSON oder sind synthetische Schreib-Datenpunkte)
const FIELD_WHITELIST = new Set(['comp', 'anglev', 'angleh', 'env_set', 'restart']);

// ----------------------------------------------------------------
// Schritt 1: HTTP GET → Felder aus dem WebSocket-Handler extrahieren
//            + Extras-Seite prüfen ob optionale Features aktiv sind
// ----------------------------------------------------------------
function fetchDeviceFields(ip) {
    const fetchPage = (url) => new Promise((resolve, reject) => {
        const req = http.get(url, (res) => {
            let html = '';
            res.on('data', chunk => html += chunk);
            res.on('end', () => resolve(html));
        });
        req.setTimeout(6000, () => { req.destroy(); reject(new Error('Timeout: ' + url)); });
        req.on('error', reject);
    });

    return Promise.all([
        fetchPage(`http://${ip}/`),
        fetchPage(`http://${ip}/revk-settings?_page=-2`),
    ]).then(([mainHtml, extrasHtml]) => {
        const matches = mainHtml.match(/\bo\.([a-zA-Z]\w*)\b/g) || [];
        const found = new Set(matches.map(m => m.slice(2).toLowerCase()));

        // BLE: nur anlegen wenn bleenable aktiv ist
        const bleEnabled = /id="bleenable"[^>]*checked/.test(extrasHtml);
        if (bleEnabled && found.has('ble')) {
            found.add('ble_temp');
            found.add('ble_hum');
            found.add('ble_bat');
        } else {
            found.delete('ble');
        }

        // Optionale Features: deaktivierte Felder aus found entfernen
        for (const key of Object.keys(FIELDS)) {
            const disabled = new RegExp(`id="no${key}"[^>]*checked`).test(extrasHtml);
            if (disabled) found.delete(key);
        }

        // Whitelist-Felder immer hinzufügen
        for (const f of FIELD_WHITELIST) found.add(f);

        log(`Gerät ${ip} erreichbar – erkannte Felder: ${[...found].join(', ')}`);
        return found;
    });
}

// ----------------------------------------------------------------
// Schritt 2: GERAETE_ID direkt vom Gerät per HTTP holen (Settings-Seite)
// ----------------------------------------------------------------
// Schritt 2b: xgpio-Konfiguration lesen (OLA-GPIO-Mod, Seite 1)
//             Gibt Array mit 5 Objekten zurück (Index 0–4 für GPIO 1–5):
//             { set, out, pwm, adc, name }
//             Löst mit alles-false-Konfig auf wenn Mod nicht vorhanden.
// ----------------------------------------------------------------
function fetchGeraeteId(ip) {
    return new Promise((resolve, reject) => {
        const req = http.get(`http://${ip}/revk-settings?_page=0`, (res) => {
            let html = '';
            res.on('data', chunk => html += chunk);
            res.on('end', () => {
                // Settings-Seite: <h1>GERAETE_ID <b id=_msg ...>Status</b>
                // AppName in <address>...<a...>Home</a> AppName<small>-Variant</small>
                const match = html.match(/<h1>([^\s<]+)/);
                if (!match) {
                    reject(new Error('GERAETE_ID nicht in Settings-Seite gefunden'));
                    return;
                }
                const geraeteId  = match[1];
                const appMatch   = html.match(/Home<\/a>\s+([^\s<]+)<small>/);
                const appName    = appMatch ? appMatch[1] : '';
                log(`GERAETE_ID erkannt: ${geraeteId}  App: ${appName}`);
                resolve({ geraeteId, appName });
            });
        });
        req.setTimeout(6000, () => { req.destroy(); reject(new Error('Timeout beim Lesen der Settings: ' + ip)); });
        req.on('error', reject);
    });
}

function fetchXgpioConfig(ip) {
    const empty = () => Array.from({length: 5}, () => ({ set: false, out: false, pwm: false, adc: false, name: '' }));
    return new Promise((resolve) => {
        const req = http.get(`http://${ip}/revk-settings?_page=1`, (res) => {
            let html = '';
            res.on('data', chunk => html += chunk);
            res.on('end', () => {
                const config = [];
                for (let n = 1; n <= 5; n++) {
                    const valM = html.match(new RegExp('id="xgpio' + n + '"[^>]*value="([^"]*)"')) ||
                                 html.match(new RegExp('value="([^"]*)"[^>]*id="xgpio' + n + '"'));
                    const gpioVal = valM ? valM[1].trim() : '';
                    const set = gpioVal !== '' && gpioVal !== '0';
                    const out = new RegExp('id="xgpio' + n + 'out"[^>]*checked').test(html);
                    const pwm = new RegExp('id="xgpio' + n + 'pwm"[^>]*checked').test(html);
                    const adc = new RegExp('id="xgpio' + n + 'adc"[^>]*checked').test(html);
                    const nameM = html.match(new RegExp('id="xgpio' + n + 'name"[^>]*value="([^"]*)"')) ||
                                  html.match(new RegExp('value="([^"]*)"[^>]*id="xgpio' + n + 'name"'));
                    const name = nameM ? nameM[1].trim() : '';
                    config.push({ set, out, pwm, adc, name });
                }
                const active = config
                    .map((c, i) => c.set ? `GPIO${i+1}(${c.pwm?'PWM':c.adc?'ADC':c.out?'OUT':'IN'})` : null)
                    .filter(Boolean);
                if (active.length) log(`OLA-GPIO-Mod erkannt: ${active.join(', ')}`);
                resolve(config);
            });
        });
        req.setTimeout(6000, () => { req.destroy(); resolve(empty()); });
        req.on('error', () => resolve(empty()));
    });
}

// ----------------------------------------------------------------
// Schritt 2c: MQTT-Topic-Konfiguration vom Gerät lesen (Seite -3)
//             Gibt Defaults zurück wenn Seite nicht erreichbar.
// ----------------------------------------------------------------
function fetchTopicConfig(ip) {
    const defaults = { topiccommand: 'command', topicsetting: 'setting', topicstate: 'state', prefixapp: false, prefixhost: false };
    return new Promise((resolve) => {
        const req = http.get(`http://${ip}/revk-settings?_page=-3`, (res) => {
            let html = '';
            res.on('data', chunk => html += chunk);
            res.on('end', () => {
                function val(id) {
                    const m = html.match(new RegExp('id="' + id + '"[^>]*value="([^"]*)"')) ||
                              html.match(new RegExp('value="([^"]*)"[^>]*id="' + id + '"'));
                    return m ? m[1].trim() : null;
                }
                const topiccommand = val('topiccommand') || defaults.topiccommand;
                const topicsetting = val('topicsetting') || defaults.topicsetting;
                const topicstate   = val('topicstate')   || defaults.topicstate;
                const prefixapp    = new RegExp('id="prefixapp"[^>]*checked').test(html);
                const prefixhost   = new RegExp('id="prefixhost"[^>]*checked').test(html);
                const cfg = { topiccommand, topicsetting, topicstate, prefixapp, prefixhost };
                const nonDefault = topiccommand !== 'command' || topicsetting !== 'setting' ||
                                   topicstate !== 'state' || prefixapp || prefixhost;
                if (nonDefault) log(`⚠ Abweichende MQTT-Topics erkannt: ${JSON.stringify(cfg)}`);
                resolve(cfg);
            });
        });
        req.setTimeout(6000, () => { req.destroy(); resolve(defaults); });
        req.on('error', () => resolve(defaults));
    });
}

// ----------------------------------------------------------------
// MQTT-Topic-Strings und ioBroker-Objekt-IDs berechnen
// gemäß RevK-Topic-Logik (revk.c revk_topic)
// ----------------------------------------------------------------
function buildTopicPaths(geraeteId, appName, topicConfig) {
    const { topiccommand, topicsetting, topicstate, prefixapp, prefixhost } = topicConfig;

    function makeTopic(name, suffix) {
        const parts = [];
        if (prefixhost) {
            if (prefixapp && appName) parts.push(appName);
            parts.push(geraeteId);
            if (name) parts.push(name);
        } else {
            if (name) parts.push(name);
            if (prefixapp && appName) parts.push(appName);
            parts.push(geraeteId);
        }
        if (suffix) parts.push(suffix);
        return parts.join('/');
    }

    function toId(topic) { return `${MQTT_INSTANCE}.${topic.replace(/\//g, '.')}`; }

    return {
        statusTopic:      makeTopic(topicstate,   'status'),
        statusId:         toId(makeTopic(topicstate,   'status')),
        xgpioId:          toId(makeTopic(topicstate,   'xgpio')),
        commandId:        (f) => toId(makeTopic(topiccommand, f)),
        commandTopic:     (f) =>     makeTopic(topiccommand, f),
        settingId:        (f) => toId(makeTopic(topicsetting, f)),
        settingTopic:     (f) =>     makeTopic(topicsetting, f),
        settingJsonId:         toId(makeTopic(topicsetting, null)),
        settingJsonTopic:          makeTopic(topicsetting, null),
    };
}

// ----------------------------------------------------------------
// mqtt-client Publish-Objekt erzeugen (command / setting Topic)
// ----------------------------------------------------------------
async function ensureMqttPublishObject(stateId, mqttTopic, valueType) {
    const common = {
        name:  mqttTopic,
        type:  valueType,
        read:  true,
        write: true,
    };

    if (IS_MQTT_CLIENT) {
        // mqtt-client braucht expliziten custom-Block mit publish:true
        common.custom = {
            [MQTT_INSTANCE]: {
                enabled:        true,
                topic:          mqttTopic,
                publish:        true,
                pubChangesOnly: false,
                pubAsObject:    false,
                qos:            0,
                retain:         false,
                subscribe:      false,
                subChangesOnly: false,
                subAsObject:    false,
                subQos:         0,
                setAck:         true,
            }
        };
    }
    // Standard mqtt-Adapter published alle State-Änderungen automatisch –
    // kein custom-Block nötig, native.topic reicht als Referenz

    await setObjectAsync(stateId, {
        type: 'state',
        common,
        native: { topic: mqttTopic }
    });
}

// ----------------------------------------------------------------
// Schritt 3: Alias-Objekte in ioBroker anlegen
// ----------------------------------------------------------------
async function buildAliases(geraeteId, deviceFields, xgpioConfig, topicConfig, appName) {
    const topics   = buildTopicPaths(geraeteId, appName, topicConfig);
    const readBase = topics.statusId;
    const prefix   = `alias.0.${ALIAS_NAME}`;

    // Kanal (Ordner) anlegen
    await setObjectAsync(prefix, {
        type: 'channel',
        common: { name: `Faikout – ${ALIAS_NAME}` },
        native: {}
    });
    log(`Kanal angelegt: ${prefix}`);

    // Alle benötigten mqtt-client Publish-Objekte sammeln und anlegen
    const publishTargets = new Map(); // stateId → { mqttTopic, valueType }
    for (const [key, def] of Object.entries(FIELDS)) {
        if (!def.writeTopic) continue;
        if (!deviceFields.has(key) && !def.bleKey) continue;
        if (def.bleKey && !deviceFields.has('ble')) continue;
        let stateId, mqttTopic, valueType;
        if (def.writeTopic.startsWith('setting:')) {
            const field = def.writeTopic.split(':')[1];
            stateId   = topics.settingId(field);
            mqttTopic = topics.settingTopic(field);
            valueType = def.type;
        } else if (def.writeTopic === 'setting') {
            // Basis-Setting-Topic: setting/ID  (JSON-Payload, kein Feldsuffix)
            stateId   = topics.settingJsonId;
            mqttTopic = topics.settingJsonTopic;
            valueType = 'string';
        } else {
            stateId   = topics.commandId(def.writeTopic);
            mqttTopic = topics.commandTopic(def.writeTopic);
            valueType = def.writeTopic === 'control' ? 'string' : def.type;
        }
        publishTargets.set(stateId, { mqttTopic, valueType });
    }
    for (const [stateId, { mqttTopic, valueType }] of publishTargets) {
        await ensureMqttPublishObject(stateId, mqttTopic, valueType);
        log(`  ⬆ ${stateId}`);
    }

    let count = 0;
    const createdKeys = new Set();

    for (const [key, def] of Object.entries(FIELDS)) {
        // Feld nur anlegen wenn Gerät es meldet, BLE-fähig ist, oder es auf der Whitelist steht
        if (!deviceFields.has(key) && !def.bleKey) continue;
        if (def.bleKey && !deviceFields.has('ble')) continue;

        const writable = !!def.writeTopic;

        // Write-Ziel-ID bestimmen
        let writeId;
        if (writable) {
            if (def.writeTopic.startsWith('setting:')) {
                writeId = topics.settingId(def.writeTopic.split(':')[1]);
            } else if (def.writeTopic === 'setting') {
                writeId = topics.settingJsonId;
            } else {
                writeId = topics.commandId(def.writeTopic);
            }
        }

        const writeOnly = writable && !!def.writeOnly;
        const common = {
            name:  def.label,
            type:  def.type,
            read:  !writeOnly,
            write: writable,
            alias: {
                id:   writeOnly ? writeId : (writable ? { read: readBase, write: writeId } : readBase),
            }
        };
        if (!writeOnly)                  common.alias.read    = def.readConv;
        if (def.unit)                    common.unit          = def.unit;
        if (writable && def.writeConv)   common.alias.write   = def.writeConv;

        await setObjectAsync(`${prefix}.${key}`, {
            type: 'state',
            common,
            native: {}
        });
        log(`  ✓ ${prefix}.${key}  (${def.label})`);
        createdKeys.add(key);
        count++;
    }

    // Veraltete Datenpunkte entfernen – nur bekannte FIELDS-Keys, keine manuell ergänzten
    let removed = 0;
    for (const key of Object.keys(FIELDS)) {
        if (!createdKeys.has(key)) {
            try {
                await deleteObjectAsync(`${prefix}.${key}`);
                log(`  🗑 ${prefix}.${key} entfernt`);
                removed++;
            } catch (e) {
                // Objekt existiert nicht – kein Problem
            }
        }
    }

    // ---- OLA-GPIO-Mod: xgpio-Aliase ----
    const xgpioPrefix   = `${prefix}.xgpio`;
    const xgpioReadBase = topics.xgpioId;
    const createdXgpioKeys = new Set();

    if (xgpioConfig.some(c => c.set)) {
        await setObjectAsync(xgpioPrefix, {
            type: 'channel',
            common: { name: 'Zusätzliche GPIOs (OLA-Mod)' },
            native: {}
        });
        log(`Kanal angelegt: ${xgpioPrefix}`);

        for (let n = 1; n <= 5; n++) {
            const c = xgpioConfig[n - 1];
            if (!c.set) continue;
            const key      = `xgpio${n}`;
            const label    = c.name || `GPIO ${n}`;
            const writable = c.out || c.pwm;
            const type     = (c.pwm || c.adc) ? 'number' : 'boolean';
            const writeId  = writable ? topics.commandId(key) : undefined;

            if (writable) {
                await ensureMqttPublishObject(writeId, topics.commandTopic(key), type);
                log(`  ⬆ ${writeId}`);
            }

            const common = {
                name:  label,
                type,
                read:  true,
                write: writable,
                alias: {
                    id:   writable ? { read: xgpioReadBase, write: writeId } : xgpioReadBase,
                    read: `val?JSON.parse(val).${key}:null`,
                }
            };
            if (c.pwm || c.adc) common.unit = '%';
            if (writable && !c.pwm) common.alias.write = 'val?1:0';

            await setObjectAsync(`${xgpioPrefix}.${key}`, {
                type: 'state',
                common,
                native: {}
            });
            log(`  ✓ ${xgpioPrefix}.${key}  (${label})`);
            createdXgpioKeys.add(key);
            count++;
        }
    }

    // Veraltete xgpio-Aliase entfernen
    for (let n = 1; n <= 5; n++) {
        const key = `xgpio${n}`;
        if (!createdXgpioKeys.has(key)) {
            try { await deleteObjectAsync(`${xgpioPrefix}.${key}`); log(`  🗑 ${xgpioPrefix}.${key} entfernt`); removed++; }
            catch (e) { /* existiert nicht */ }
        }
    }
    if (createdXgpioKeys.size === 0) {
        try { await deleteObjectAsync(xgpioPrefix); }
        catch (e) { /* existiert nicht */ }
    }

    // ---- Config-Aliase (optional) ----
    const configPrefix = `${prefix}.${CONFIG_ALIAS_NAME}`;
    const createdConfigKeys = new Set();

    if (CREATE_CONFIG_ALIASES) {
        await setObjectAsync(configPrefix, {
            type: 'channel',
            common: { name: `Faikout Konfig – ${ALIAS_NAME}` },
            native: {}
        });
        log(`Kanal angelegt: ${configPrefix}`);

        for (const [key, def] of Object.entries(CONFIG_FIELDS_DEF)) {
            if (!CONFIG_FIELDS_ENABLE[key]) continue;
            const writeId = topics.settingId(key);
            await ensureMqttPublishObject(writeId, topics.settingTopic(key), def.type === 'boolean' ? 'number' : def.type);
            log(`  ⬆ ${writeId}`);

            const common = {
                name:  def.label,
                type:  def.type,
                read:  false,
                write: true,
                alias: { id: writeId }
            };
            if (def.unit)      common.unit        = def.unit;
            if (def.writeConv) common.alias.write  = def.writeConv;

            await setObjectAsync(`${configPrefix}.${key}`, {
                type: 'state',
                common,
                native: {}
            });
            log(`  ✓ ${configPrefix}.${key}  (${def.label})`);
            createdConfigKeys.add(key);
            count++;
        }
    }

    // Veraltete Config-Aliase entfernen
    for (const key of Object.keys(CONFIG_FIELDS_DEF)) {
        if (!createdConfigKeys.has(key)) {
            try { await deleteObjectAsync(`${configPrefix}.${key}`); log(`  🗑 ${configPrefix}.${key} entfernt`); removed++; }
            catch (e) { /* existiert nicht */ }
        }
    }
    if (createdConfigKeys.size === 0) {
        try { await deleteObjectAsync(configPrefix); }
        catch (e) { /* existiert nicht */ }
    }

    log('');
    log(`✅ Fertig: ${count} Datenpunkte angelegt, ${removed} entfernt – alias.0.${ALIAS_NAME}`);
    log(`   Gerät:      http://${FAIKOUT_IP}/`);
    log(`   GERAETE_ID: ${geraeteId}`);
    log(`   Lese-Topic: ${topics.statusTopic}`);
}

// ----------------------------------------------------------------
// Hauptprogramm
// ----------------------------------------------------------------
(async function main() {
    log('═══════════════════════════════════════════');
    log('Faikout Alias-Generator');
    log(`  Gerät:  http://${FAIKOUT_IP}/`);
    log(`  MQTT:   ${MQTT_INSTANCE}`);
    log(`  Alias:  alias.0.${ALIAS_NAME}`);
    log('═══════════════════════════════════════════');

    try {
        // Prüfen ob setObject im JavaScript-Adapter aktiviert ist
        const jsObj = await getObjectAsync(`system.adapter.javascript.${instance}`);
        if (!jsObj || !jsObj.native || !jsObj.native.enableSetObject) {
            log('❌ Voraussetzung nicht erfüllt: "Objekte anlegen" ist im JavaScript-Adapter deaktiviert.', 'error');
            log('   Admin → Instanzen → javascript.' + instance + ' → "Kommando setObject erlauben" = EIN', 'error');
            return;
        }

        // Felder, GERAETE_ID, xgpio-Konfiguration und Topic-Konfiguration direkt vom Gerät per HTTP
        const [deviceFields, { geraeteId, appName }, xgpioConfig, topicConfig] = await Promise.all([
            fetchDeviceFields(FAIKOUT_IP),
            fetchGeraeteId(FAIKOUT_IP),
            fetchXgpioConfig(FAIKOUT_IP),
            fetchTopicConfig(FAIKOUT_IP),
        ]);

        // Energiezähler per MQTT-Status prüfen – nur anlegen wenn Gerät sie tatsächlich liefert
        const topics      = buildTopicPaths(geraeteId, appName, topicConfig);
        const statusState = await getStateAsync(topics.statusId);
        if (statusState && statusState.val) {
            try {
                const json = JSON.parse(statusState.val);
                for (const key of ['Whoutside', 'Whheating', 'Whcooling']) {
                    if (json[key] !== undefined) deviceFields.add(key);
                }
            } catch (e) { /* JSON-Fehler ignorieren */ }
        }

        await buildAliases(geraeteId, deviceFields, xgpioConfig, topicConfig, appName);

    } catch (err) {
        log('❌ ' + err.message, 'error');
    }
})();
