function init() {
    let bus = require('./system/bus'),
        config = bus.config,
        connections = {},
        b24lib = require('b24_bot_api'),
        b24botApi = new b24lib.B24botApi(),
        request = require('request'),
        lastAuth;

    // ******************** manage accounts ******************** //
    function deleteAllB24accounts() {
        for (let key in connections) {
           delete connections[key];
        }
    }

    // проверяем изменился ли список аккаунтов в конфиге
    function isChangeB24accounts() {
        try {
            if (!lastAuth) { 
                lastAuth = JSON.stringify(config.get("b24accounts"));
                return true;
            }

            lastAuth = JSON.parse(lastAuth);

            var b24accountsData = JSON.stringify(config.get("b24accounts")); // Преобразуем в строку что бы получить копию вместо ссылки
            b24accountsData = JSON.parse(b24accountsData);

            b24accountsData = JSON.stringify(b24accountsData);
            lastAuth = JSON.stringify(lastAuth);

            var isChange = (b24accountsData !== lastAuth);
            lastAuth = b24accountsData;

            bus.emit('message', { type: 'info', msg: 'isChangeB24accounts ' + isChange});

            return isChange;
        } catch (err) {
            bus.emit('message', { type: 'error', msg: 'isChangeb24accounts: ' + err });
            return true;
        }
    }

    function refreshB24accounts() {
        if (!isChangeB24accounts()) return false;

        deleteAllB24accounts();

        let b24accounts = config.get("b24accounts");

        for (let key in b24accounts) {
            connections[key] = {};
            connections[key].auth = b24accounts[key];
            connections[key].auth.id = key;

            bus.emit('setB24accounts', JSON.stringify(connections));
        }
    };

    // ******************** обработка входящих сообщений от b24 по rest ******************** //

    function saveB24accounts() {
        let accounts = {};

        for(let key in connections) {
            accounts[key] = connections[key].auth;
        }

        bus.emit('updateData', { source: 'config', data: { 'b24accounts': accounts } });
    }

    bus.on('b24.message.incoming', (req) => {
        if (!(req instanceof Object)) {
            return console.error('B24 Error: Request is not a Object');
        }
        if (!req.id) {
            return console.error('B24 Error: Not found key id');
        }
        if (!connections[req.id]) {
            return console.error('B24 Error: Not found b24 connections id: ', req.id);
        }
        if ( (connections[req.id].auth) && (connections[req.id].auth.disable) )
            return console.log(`B24 account ${req.id} disable`);

        req.type = 'b24';

        if (('headers' in req) && ('host' in req.headers) && ('path' in req) && ('protocol' in req)) {
            req.url = connections[req.id].auth.portalLink;

            if ( ('query' in req) && ('code' in req.query) ) {
                req.clientId     = connections[req.id].auth.clientId     || '';
                req.clientSecret = connections[req.id].auth.clientSecret || '';

                b24botApi.onOAuth(req, function(err, data) {
                    if (err) {
                        return console.log(`Callback onOAuth err: ${err}`);
                    }

                    if (req.id && connections[req.id] && connections[req.id].auth && connections[req.id].auth) {
                        connections[req.id].auth.b24 = data;
                    }

                    saveB24accounts();
                });
            }
        }

        if (("body" in req) && ("event" in req.body)) {
            switch (req.body["event"]) {
                case "ONAPPINSTALL":
                    b24botApi.onAppInstall(req);
                    break;
                case "ONIMBOTJOINCHAT":
                    b24botApi.onImbotJoinChat(req);
                    break;
                case "ONIMBOTMESSAGEADD":
                    req.message = req.body["data"]["PARAMS"]["MESSAGE"];

                    bus.request('onEvent', { id: `on_call[${req.id}]` }, (err, data) => {
                        req.nameScript = data;
                        bus.emit('on_message_add', req);
                    });
                    // b24botApi.onImbotMessageAdd(req);
                    break;
                case "ONIMBOTDELETE":
                    b24botApi.onImbotDelete(req);
                    break;
                case "ONAPPUPDATE":
                    b24botApi.onAppUpdate(req);
                    break;
                case "ONIMCOMMANDADD":
                    b24botApi.onImCommandAdd(req);
                    break;
                default:
                    console.log("default: " + req.body["event"]);
                    break;
            }
        }
    });

    bus.onRequest('on_b24_request', function(req, cb) {
        b24botApi.onB24request(req, cb);
    });

    bus.on('on_answer_message', (req) => {
        if (req && req.type && req.type == 'b24')
            b24botApi.onImbotMessageAdd(req);
    });

    bus.on('refresh', function(type) {
        if (type === 'configData')
            refreshB24accounts();
    });
};
module.exports = init();