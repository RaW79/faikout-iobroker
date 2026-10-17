// ================================================================
// v0.4 (16.10.2026)    https://codeberg.org/RaW07/faikout-projects
// Developed and tested on ioBroker JavaScript adapter v9.0.18
// Faikout Alias Generator for ioBroker
// Run this script once in the JavaScript adapter.
// It auto-detects the Faikout and creates all alias data points.
// Aliases are created based on the features active on the device –
// disabled features are largely skipped.
// Note: If Faikout settings change (e.g. humidifier enabled/disabled)
// re-run the script to update the alias data points.
//
// PREREQUISITES:
//   1. The Faikout must already be connected to ioBroker via MQTT
//      and appear under Admin → Objects as
//        mqtt-client.0.state.DEVICE_ID.status  (mqtt-client adapter)
//      or
//        mqtt.0.state.DEVICE_ID.status          (mqtt adapter)
//      and be delivering data.
//   2. In the JavaScript adapter, "Allow object creation" must be enabled:
//      Admin → Instances → javascript.X
//      "Allow setObject command" = ON
//      (The script checks this automatically on start.)
//
// CONFIGURATION – adjust these values only:
// ================================================================
const FAIKOUT_IP    = '192.168.x.x';   // IP address of the Faikout
const MQTT_INSTANCE = 'mqtt-client.0';  // MQTT adapter instance
const ALIAS_NAME    = 'MyAirCon';       // Folder name under alias.0.*

// ---- Optional: Faikout configuration parameters via MQTT ----
// Set CREATE_CONFIG_ALIASES = true to create a sub-folder with
// writable aliases for Faikout settings.
// IMPORTANT: These aliases are WRITE-ONLY. Configuration parameters
// are not included in the Faikout MQTT status message, so ioBroker
// cannot read back the current value. The data point always shows
// the last value written by ioBroker – if you change a setting via
// the Faikout web UI, the data point will be out of sync.
// Use the Faikout web UI as the authoritative source for current values.
// Re-run the script after changing any toggle below.
const CREATE_CONFIG_ALIASES = false;
const CONFIG_ALIAS_NAME     = 'Config'; // Sub-folder: alias.0.ALIAS_NAME.Config

const CONFIG_FIELDS_ENABLE = {
    heatback:   true,   // Heat pull-back (°C)
    heatover:   true,   // Heat push-over (°C)
    coolback:   true,   // Cool pull-back (°C)
    coolover:   true,   // Cool push-over (°C)
    tcontrol:   true,   // Control timeout (s)
    thermref:   true,   // Inlet/home blend (%)
    tmin:       true,   // Min temperature (°C)
    tmax:       true,   // Max temperature (°C)
    tcoolmin:   true,   // Min temperature cooling (°C)
    theatmax:   true,   // Max temperature heating (°C)
    frosttemp:  true,   // Frost protection (°C)
    minoutside: true,   // Min outdoor temperature (°C)
    switchtemp: true,   // Switch-point offset (°C)
    pushtemp:   true,   // Push-point offset (°C)
    reporting:  true,   // Report interval (s)
    lockmode:   true,   // Lock heat/cool mode
};
// ================================================================

'use strict';
const http = require('http');

// Auto-detect adapter type
const IS_MQTT_CLIENT = MQTT_INSTANCE.startsWith('mqtt-client.');
// IS_MQTT_CLIENT = true  → iobroker.mqtt-client (requires custom block)
// IS_MQTT_CLIENT = false → iobroker.mqtt        (plain state is sufficient)

// ----------------------------------------------------------------
// Field definitions
//   writeTopic: 'control'       → command.ID.control  as JSON object
//               'mode','fan'... → command.ID.<topic>   directly
//               'setting:autot' → setting.ID.autot     directly
//               missing         → read-only
// ----------------------------------------------------------------
const FIELDS = {
    power:      { label: 'Power on/off',                  type: 'boolean', writeTopic: 'control',        writeConv: 'JSON.stringify({power:val})',   readConv: 'val?JSON.parse(val).power===true:false' },
    swingv:     { label: 'Vertical swing',                type: 'boolean', writeTopic: 'control',        writeConv: 'JSON.stringify({swingv:val})',  readConv: 'val?JSON.parse(val).swingv===true:false' },
    swingh:     { label: 'Horizontal swing',              type: 'boolean', writeTopic: 'control',        writeConv: 'JSON.stringify({swingh:val})',  readConv: 'val?JSON.parse(val).swingh===true:false' },
    mode:       { label: 'Operating mode (H/C/F/D/A)',    type: 'mixed',   writeTopic: 'mode',           writeConv: null,                           readConv: 'val?JSON.parse(val).mode:null' },
    fan:        { label: 'Fan mode (e.g. 1-5/A/Q)',       type: 'mixed',   writeTopic: 'fan',            writeConv: null,                           readConv: 'val?JSON.parse(val).fan:null' },
    econo:      { label: 'Economy mode',                  type: 'boolean', writeTopic: 'econo',          writeConv: 'val?1:0',                      readConv: 'val?JSON.parse(val).econo===true:false' },
    powerful:   { label: 'Powerful mode',                 type: 'boolean', writeTopic: 'powerful',       writeConv: 'val?1:0',                      readConv: 'val?JSON.parse(val).powerful===true:false' },
    demand:     { label: 'Demand/compressor load',        type: 'number',  writeTopic: 'demand',         writeConv: null,           unit: '%',       readConv: 'val?parseInt(JSON.parse(val).demand):null' },
    autot:      { label: 'Target temperature (Faikout)',  type: 'number',  writeTopic: 'setting:autot',  writeConv: null,           unit: '°C',      readConv: 'val?parseFloat(JSON.parse(val).autot):null' },
    autor:      { label: 'Hysteresis (Faikout)',          type: 'number',  writeTopic: 'setting:autor',  writeConv: null,           unit: '°C',      readConv: 'val?parseFloat(JSON.parse(val).autor):null' },
    outside:    { label: 'Outdoor temperature',           type: 'number',  unit: '°C',    readConv: 'val?parseFloat(JSON.parse(val).outside):null' },
    home:       { label: 'Indoor temperature',            type: 'number',  unit: '°C',    readConv: 'val?parseFloat(JSON.parse(val).home):null' },
    liquid:     { label: 'Refrigerant temperature',       type: 'number',  unit: '°C',    readConv: 'val?parseFloat(JSON.parse(val).liquid):null' },
    inlet:      { label: 'Inlet temperature',             type: 'number',  unit: '°C',    readConv: 'val?parseFloat(JSON.parse(val).inlet):null' },
    temp:       { label: 'Setpoint (Daikin internal)',    type: 'number',  unit: '°C',    readConv: 'val?parseFloat(JSON.parse(val).temp):null' },
    comp:       { label: 'Compressor speed',              type: 'number',  unit: 'Hz',    readConv: 'val?parseFloat(JSON.parse(val).comp):null' },
    fanrpm:     { label: 'Fan speed',                     type: 'number',  unit: 'RPM',   readConv: 'val?parseFloat(JSON.parse(val).fanrpm):null' },
    consumption:{ label: 'Power consumption',             type: 'number',  unit: 'W',     readConv: 'val?parseFloat(JSON.parse(val).consumption):null' },
    Whheating:  { label: 'Heating energy (cumulative)',   type: 'number',  unit: 'Wh',    readConv: 'val?parseInt(JSON.parse(val).Whheating):null' },
    Whcooling:  { label: 'Cooling energy (cumulative)',   type: 'number',  unit: 'Wh',    readConv: 'val?parseInt(JSON.parse(val).Whcooling):null' },
    Whoutside:  { label: 'Outdoor unit energy meter',     type: 'number',  unit: 'Wh',    readConv: 'val?parseInt(JSON.parse(val).Whoutside):null' },
    hum:        { label: 'Humidity',                      type: 'number',  unit: '%',     readConv: 'val?parseFloat(JSON.parse(val).hum):null' },
    anglev:     { label: 'Vertical vane angle',           type: 'number',  unit: '°',     readConv: 'val?JSON.parse(val).anglev:null' },
    angleh:     { label: 'Horizontal vane angle',         type: 'number',  unit: '°',     readConv: 'val?JSON.parse(val).angleh:null' },
    comfort:    { label: 'Comfort mode',                  type: 'boolean', writeTopic: 'comfort',   writeConv: 'val?1:0', readConv: 'val?JSON.parse(val).comfort===true:false' },
    streamer:   { label: 'Air purifier (streamer)',       type: 'boolean', writeTopic: 'streamer',  writeConv: 'val?1:0', readConv: 'val?JSON.parse(val).streamer===true:false' },
    led:        { label: 'LED',                           type: 'boolean', writeTopic: 'led',       writeConv: 'val?1:0', readConv: 'val?JSON.parse(val).led===true:false' },
    quiet:      { label: 'Quiet mode (outdoor unit)',     type: 'boolean', writeTopic: 'quiet',     writeConv: 'val?1:0', readConv: 'val?JSON.parse(val).quiet===true:false' },
    humidify:   { label: 'Humidifier (e.g. X/L/S/H/C)',  type: 'mixed',   writeTopic: 'humidify',  writeConv: null,      readConv: 'val?JSON.parse(val).humidify:null' },
    autoe:      { label: 'Auto mode active',              type: 'boolean', writeTopic: 'autoe',    writeConv: 'val?1:0', readConv: 'val?JSON.parse(val).autoe===true:false' },
    autop:      { label: 'Auto power on/off active',      type: 'boolean', writeTopic: 'autop',    writeConv: 'val?1:0', readConv: 'val?JSON.parse(val).autop===true:false' },
    auto0:      { label: 'Timer off time',                type: 'mixed',   writeTopic: 'setting',  writeConv: 'JSON.stringify({auto0:String(val).replace(":","")})',  readConv: 'val?JSON.parse(val).auto0:null' },
    auto1:      { label: 'Timer on time',                 type: 'mixed',   writeTopic: 'setting',  writeConv: 'JSON.stringify({auto1:String(val).replace(":","")})',  readConv: 'val?JSON.parse(val).auto1:null' },
    autob:      { label: 'BLE reference device (MAC)',    type: 'mixed',   readConv: 'val?JSON.parse(val).autob:null', bleKey: true },
    antifreeze: { label: 'Anti-freeze active',            type: 'boolean', readConv: 'val?JSON.parse(val).antifreeze===true:false' },
    env:        { label: 'Room temperature',              type: 'number',  unit: '°C',    readConv: 'val?parseFloat(JSON.parse(val).env):null' },
    // env_set: Send room temperature to Faikout (control reference).
    // IMPORTANT: Must be sent cyclically – the Faikout discards the value
    // after tcontrol seconds (Faikout setting "Control messages timeout",
    // default 600 s). Recommendation: send every 30–60 s so the value never expires.
    env_set:    { label: 'Room temperature (send control reference)', type: 'number', unit: '°C', writeTopic: 'control', writeConv: 'JSON.stringify({env:val})', writeOnly: true },
    restart:    { label: 'Restart device',                          type: 'boolean',             writeTopic: 'restart',  writeConv: 'val?1:0',                  writeOnly: true },
    // BLE sensor (optional, only if device reports a BLE sensor)
    'ble_temp': { label: 'BLE temperature',               type: 'number',  unit: '°C',    readConv: 'val&&JSON.parse(val).ble?parseFloat(JSON.parse(val).ble.temp):null', bleKey: true },
    'ble_hum':  { label: 'BLE humidity',                  type: 'number',  unit: '%',     readConv: 'val&&JSON.parse(val).ble?parseFloat(JSON.parse(val).ble.hum):null',  bleKey: true },
    'ble_bat':  { label: 'BLE battery level',             type: 'number',  unit: '%',     readConv: 'val&&JSON.parse(val).ble?parseFloat(JSON.parse(val).ble.bat):null',   bleKey: true },
    'ble_volt': { label: 'BLE battery voltage',           type: 'number',  unit: 'V',     readConv: 'val&&JSON.parse(val).ble?parseFloat(JSON.parse(val).ble.volt):null',  bleKey: true },
};

// ----------------------------------------------------------------
// Configuration parameter definitions (all write-only – not in status JSON)
// ----------------------------------------------------------------
const CONFIG_FIELDS_DEF = {
    heatback:   { label: 'Heat pull-back',              type: 'number',  unit: '°C', writeConv: null },
    heatover:   { label: 'Heat push-over',              type: 'number',  unit: '°C', writeConv: null },
    coolback:   { label: 'Cool pull-back',              type: 'number',  unit: '°C', writeConv: null },
    coolover:   { label: 'Cool push-over',              type: 'number',  unit: '°C', writeConv: null },
    tcontrol:   { label: 'Control message timeout',     type: 'number',  unit: 's',  writeConv: null },
    thermref:   { label: 'Inlet/home blend ratio',      type: 'number',  unit: '%',  writeConv: null },
    tmin:       { label: 'Min temperature limit',       type: 'number',  unit: '°C', writeConv: null },
    tmax:       { label: 'Max temperature limit',       type: 'number',  unit: '°C', writeConv: null },
    tcoolmin:   { label: 'Min temp limit (cooling)',    type: 'number',  unit: '°C', writeConv: null },
    theatmax:   { label: 'Max temp limit (heating)',    type: 'number',  unit: '°C', writeConv: null },
    frosttemp:  { label: 'Frost protection',            type: 'number',  unit: '°C', writeConv: null },
    minoutside: { label: 'Min outdoor temperature',     type: 'number',  unit: '°C', writeConv: null },
    switchtemp: { label: 'Switch-point offset',         type: 'number',  unit: '°C', writeConv: null },
    pushtemp:   { label: 'Push-point offset',           type: 'number',  unit: '°C', writeConv: null },
    reporting:  { label: 'Status report interval',      type: 'number',  unit: 's',  writeConv: null },
    lockmode:   { label: 'Lock heating/cooling mode',   type: 'boolean',             writeConv: 'val?1:0' },
};

// Fields that are always created even if not detected via o.xyz
// (sourced directly from the MQTT JSON or synthetic write-only data points)
const FIELD_WHITELIST = new Set(['comp', 'anglev', 'angleh', 'env_set', 'restart']);

// ----------------------------------------------------------------
// Step 1: HTTP GET → extract fields from the WebSocket handler
//         + check extras page for active optional features
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

        // BLE: only create if bleenable is active
        const bleEnabled = /id="bleenable"[^>]*checked/.test(extrasHtml);
        if (bleEnabled && found.has('ble')) {
            found.add('ble_temp');
            found.add('ble_hum');
            found.add('ble_bat');
        } else {
            found.delete('ble');
        }

        // Optional features: remove disabled fields from found
        for (const key of Object.keys(FIELDS)) {
            const disabled = new RegExp(`id="no${key}"[^>]*checked`).test(extrasHtml);
            if (disabled) found.delete(key);
        }

        // Always add whitelist fields
        for (const f of FIELD_WHITELIST) found.add(f);

        log(`Device ${ip} reachable – detected fields: ${[...found].join(', ')}`);
        return found;
    });
}

// ----------------------------------------------------------------
// Step 2: Fetch device ID directly from the device via HTTP (settings page)
// ----------------------------------------------------------------
// Step 2b: Fetch xgpio configuration (OLA GPIO mod, page 1)
//          Returns array of 5 objects (index 0–4 for GPIO 1–5):
//          { set, out, pwm, adc, name }
//          Resolves with all-false config if mod is absent or unreachable.
// ----------------------------------------------------------------
function fetchDeviceId(ip) {
    return new Promise((resolve, reject) => {
        const req = http.get(`http://${ip}/revk-settings?_page=0`, (res) => {
            let html = '';
            res.on('data', chunk => html += chunk);
            res.on('end', () => {
                // Settings page: <h1>DEVICE_ID <b id=_msg ...>Status</b>
                // AppName in <address>...<a...>Home</a> AppName<small>-Variant</small>
                const match = html.match(/<h1>([^\s<]+)/);
                if (!match) {
                    reject(new Error('Device ID not found on settings page'));
                    return;
                }
                const deviceId = match[1];
                const appMatch = html.match(/Home<\/a>\s+([^\s<]+)<small>/);
                const appName  = appMatch ? appMatch[1] : '';
                log(`Device ID detected: ${deviceId}  App: ${appName}`);
                resolve({ deviceId, appName });
            });
        });
        req.setTimeout(6000, () => { req.destroy(); reject(new Error('Timeout reading settings: ' + ip)); });
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
                if (active.length) log(`OLA GPIO mod detected: ${active.join(', ')}`);
                resolve(config);
            });
        });
        req.setTimeout(6000, () => { req.destroy(); resolve(empty()); });
        req.on('error', () => resolve(empty()));
    });
}

// ----------------------------------------------------------------
// Step 2c: Fetch MQTT topic configuration from the device (page -3)
//          Returns defaults if page is unreachable.
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
                if (nonDefault) log(`⚠ Non-default MQTT topics detected: ${JSON.stringify(cfg)}`);
                resolve(cfg);
            });
        });
        req.setTimeout(6000, () => { req.destroy(); resolve(defaults); });
        req.on('error', () => resolve(defaults));
    });
}

// ----------------------------------------------------------------
// Build MQTT topic strings and ioBroker object IDs
// based on RevK topic configuration (revk.c revk_topic logic)
// ----------------------------------------------------------------
function buildTopicPaths(deviceId, appName, topicConfig) {
    const { topiccommand, topicsetting, topicstate, prefixapp, prefixhost } = topicConfig;

    function makeTopic(name, suffix) {
        const parts = [];
        if (prefixhost) {
            if (prefixapp && appName) parts.push(appName);
            parts.push(deviceId);
            if (name) parts.push(name);
        } else {
            if (name) parts.push(name);
            if (prefixapp && appName) parts.push(appName);
            parts.push(deviceId);
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
// mqtt-client: create publish object (command / setting topic)
// ----------------------------------------------------------------
async function ensureMqttPublishObject(stateId, mqttTopic, valueType) {
    const common = {
        name:  mqttTopic,
        type:  valueType,
        read:  true,
        write: true,
    };

    if (IS_MQTT_CLIENT) {
        // mqtt-client requires an explicit custom block with publish:true
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
    // Standard mqtt adapter publishes all state changes automatically –
    // no custom block needed, native.topic is sufficient as reference

    await setObjectAsync(stateId, {
        type: 'state',
        common,
        native: { topic: mqttTopic }
    });
}

// ----------------------------------------------------------------
// Step 3: Create alias objects in ioBroker
// ----------------------------------------------------------------
async function buildAliases(deviceId, deviceFields, xgpioConfig, topicConfig, appName) {
    const topics   = buildTopicPaths(deviceId, appName, topicConfig);
    const readBase = topics.statusId;
    const prefix   = `alias.0.${ALIAS_NAME}`;

    // Create channel (folder)
    await setObjectAsync(prefix, {
        type: 'channel',
        common: { name: `Faikout – ${ALIAS_NAME}` },
        native: {}
    });
    log(`Channel created: ${prefix}`);

    // Collect and create all required mqtt-client publish objects
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
            // Base setting topic: setting/ID  (JSON payload, no field suffix)
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
        // Only create field if device reports it, BLE is active, or it is whitelisted
        if (!deviceFields.has(key) && !def.bleKey) continue;
        if (def.bleKey && !deviceFields.has('ble')) continue;

        const writable = !!def.writeTopic;

        // Determine write target ID
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

    // Remove stale data points – only known FIELDS keys, not manually added ones
    let removed = 0;
    for (const key of Object.keys(FIELDS)) {
        if (!createdKeys.has(key)) {
            try {
                await deleteObjectAsync(`${prefix}.${key}`);
                log(`  🗑 ${prefix}.${key} removed`);
                removed++;
            } catch (e) {
                // Object does not exist – no problem
            }
        }
    }

    // ---- OLA GPIO mod: xgpio aliases ----
    const xgpioPrefix   = `${prefix}.xgpio`;
    const xgpioReadBase = topics.xgpioId;
    const createdXgpioKeys = new Set();

    if (xgpioConfig.some(c => c.set)) {
        await setObjectAsync(xgpioPrefix, {
            type: 'channel',
            common: { name: 'Additional GPIOs (OLA mod)' },
            native: {}
        });
        log(`Channel created: ${xgpioPrefix}`);

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

    // Remove stale xgpio aliases
    for (let n = 1; n <= 5; n++) {
        const key = `xgpio${n}`;
        if (!createdXgpioKeys.has(key)) {
            try { await deleteObjectAsync(`${xgpioPrefix}.${key}`); log(`  🗑 ${xgpioPrefix}.${key} removed`); removed++; }
            catch (e) { /* does not exist */ }
        }
    }
    if (createdXgpioKeys.size === 0) {
        try { await deleteObjectAsync(xgpioPrefix); }
        catch (e) { /* does not exist */ }
    }

    // ---- Config aliases (optional) ----
    const configPrefix = `${prefix}.${CONFIG_ALIAS_NAME}`;
    const createdConfigKeys = new Set();

    if (CREATE_CONFIG_ALIASES) {
        await setObjectAsync(configPrefix, {
            type: 'channel',
            common: { name: `Faikout Config – ${ALIAS_NAME}` },
            native: {}
        });
        log(`Channel created: ${configPrefix}`);

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

    // Remove stale config aliases
    for (const key of Object.keys(CONFIG_FIELDS_DEF)) {
        if (!createdConfigKeys.has(key)) {
            try { await deleteObjectAsync(`${configPrefix}.${key}`); log(`  🗑 ${configPrefix}.${key} removed`); removed++; }
            catch (e) { /* does not exist */ }
        }
    }
    if (createdConfigKeys.size === 0) {
        try { await deleteObjectAsync(configPrefix); }
        catch (e) { /* does not exist */ }
    }

    log('');
    log(`✅ Done: ${count} data points created, ${removed} removed – alias.0.${ALIAS_NAME}`);
    log(`   Device:    http://${FAIKOUT_IP}/`);
    log(`   Device ID: ${deviceId}`);
    log(`   Read topic: ${topics.statusTopic}`);
}

// ----------------------------------------------------------------
// Main
// ----------------------------------------------------------------
(async function main() {
    log('═══════════════════════════════════════════');
    log('Faikout Alias Generator');
    log(`  Device: http://${FAIKOUT_IP}/`);
    log(`  MQTT:   ${MQTT_INSTANCE}`);
    log(`  Alias:  alias.0.${ALIAS_NAME}`);
    log('═══════════════════════════════════════════');

    try {
        // Check if setObject is enabled in the JavaScript adapter
        const jsObj = await getObjectAsync(`system.adapter.javascript.${instance}`);
        if (!jsObj || !jsObj.native || !jsObj.native.enableSetObject) {
            log('❌ Prerequisite not met: "Allow object creation" is disabled in the JavaScript adapter.', 'error');
            log('   Admin → Instances → javascript.' + instance + ' → "Allow setObject command" = ON', 'error');
            return;
        }

        // Fetch fields, device ID, xgpio config and topic config from the device via HTTP
        const [deviceFields, { deviceId, appName }, xgpioConfig, topicConfig] = await Promise.all([
            fetchDeviceFields(FAIKOUT_IP),
            fetchDeviceId(FAIKOUT_IP),
            fetchXgpioConfig(FAIKOUT_IP),
            fetchTopicConfig(FAIKOUT_IP),
        ]);

        // Check energy meters via MQTT status – only create if device actually reports them
        const topics      = buildTopicPaths(deviceId, appName, topicConfig);
        const statusState = await getStateAsync(topics.statusId);
        if (statusState && statusState.val) {
            try {
                const json = JSON.parse(statusState.val);
                for (const key of ['Whoutside', 'Whheating', 'Whcooling']) {
                    if (json[key] !== undefined) deviceFields.add(key);
                }
            } catch (e) { /* ignore JSON errors */ }
        }

        await buildAliases(deviceId, deviceFields, xgpioConfig, topicConfig, appName);

    } catch (err) {
        log('❌ ' + err.message, 'error');
    }
})();
