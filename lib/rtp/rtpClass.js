"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const events_1 = require("events");
const FileStream = require("fs");
const buffer_1 = require("buffer");
class Rtp extends events_1.EventEmitter {
    constructor(sessionID) {
        super();
        this.client = require("dgram").createSocket('udp4');
        this.fs = FileStream;
        this.stun = require('vs-stun');
        this.stt;
        this.stream_on;
        this.rec_start;
        this.sessionID = sessionID;
        this.audioPayload = 0; //RFC3551//PCMU,
        this.fileCodec;
        this.wavDataOffset = 58;
        this.RtpPacket = require('./rtppacket').RtpPacket;
        this.g711 = new (require('./G711').G711)();
        this.wav = require('wav');
        this.lastSttOpt;
        this.on('addBuffer', (buffer) => {
            this.send(buffer);
        });
    }
    // ******************** Поднять Rtp поток на порту ********************
    rtpInPort(params) {
        if (params && params.audioCodec === 'PCMA')
            this.audioPayload = 8;
        this.client.bind(0, () => {
            var rtpIn = { port: this.client.address().port };
            if (params && params.publicIP && params.stunServer) {
                rtpIn.host = params.publicIP;
                this.stun.resolve(this.client, params.stunServer, (err, value) => {
                    if (value && value.public) {
                        rtpIn = value.public;
                    }
                    process.send({ action: 'rtpInPort', params: rtpIn });
                }, { count: 1, timeout: 100 });
            }
            else {
                process.send({ action: 'rtpInPort', params: rtpIn });
            }
        });
        return;
    }
    // ******************** Инициализация ********************
    init(params, cb) {
        let buf2array = (buf) => {
            var data = [];
            for (var i = 0; i < buf.length; i++) {
                if (this.audioPayload)
                    data.push(this.g711.alaw2linear(buf.readInt8(i)));
                else
                    data.push(this.g711.ulaw2linear(buf.readInt8(i)));
            }
            return data;
        };
        let dtmf_data = (pkt) => {
            var keys = {
                10: '*',
                11: '#',
                12: 'A',
                13: 'B',
                14: 'C',
                15: 'D'
            };
            var key = pkt[0];
            if (keys[key])
                key = keys[key];
            return {
                event: key,
                volume: (pkt[1] >>> 2),
                duration: (pkt[2] << 8 | pkt[3])
            };
        };
        let rtp_data = (pkt) => {
            return {
                type: (pkt[1] & 0x7F),
                seq: (pkt[2] << 8 | pkt[3]),
                time: (pkt[4] << 24 | pkt[5] << 16 | pkt[6] << 8 | pkt[7]),
                source: pkt.slice(12, pkt.length)
            };
        };
        var dtmf_decoder = require('./dtmf'), dtmf_mode, prev_dtmf_dur = 0, change_flag;
        this.stt = require('./stt');
        this.client.params = params;
        let clientParams = '';
        for (let key in this.client.params.in) {
            clientParams += '\r\n' + key + ' = ' + this.client.params.in[key];
        }
        this.client.on("message", (msg, rinfo) => {
            if (!this.stream_on) {
                process.send({
                    action: 'stream_on',
                    params: {
                        port: this.client.address().port,
                        rinfo: rinfo
                    }
                });
                this.stream_on = true;
            }
            var params = this.client.params.in;
            if (!params.dtmf_detect && !params.stt_detect && !params.file && !params.media_stream)
                return;
            var data = rtp_data(msg);
            if (data.type == params.dtmf_payload_type) {
                if (params.dtmf_detect) {
                    if (dtmf_mode === 'inband') {
                        change_flag = true;
                    }
                    if (!dtmf_mode || change_flag) {
                        dtmf_mode = 'rfc2833';
                        process.send({
                            action: 'set_dtmf_mode',
                            params: dtmf_mode
                        });
                    }
                    var dtmf = dtmf_data(data.source);
                    if (dtmf.duration < prev_dtmf_dur || prev_dtmf_dur == 0) {
                        if (!change_flag) {
                            process.send({
                                action: 'dtmf_key',
                                params: {
                                    key: dtmf.event
                                }
                            });
                        }
                        change_flag = false;
                    }
                    prev_dtmf_dur = dtmf.duration;
                }
            }
            else {
                if (data.type == this.audioPayload) {
                    if (params.media_stream) {
                        if (!payload)
                            payload = buf2array(data.source);
                        process.send({
                            action: 'mediaStream',
                            params: {
                                sessionID: this.sessionID,
                                data: Array.from(new Uint8Array(data.source)) // for webkit - data.source
                            }
                        });
                    }
                    if (params.rec && params.file) {
                        this.emit('writeDataIn', data.source);
                    }
                    var payload;
                    if (params.stt_detect) {
                        var options = params.options && params.options.options;
                        if (options) {
                            if (!this.stt.isReady()) {
                                if (!this.stt.isConnecting()) {
                                    process.send({ action: 'start_stt', params: options });
                                    this.stt.init(options, (error, params) => {
                                        var res = {
                                            action: 'sttInit'
                                        };
                                        if (error)
                                            res.error = error;
                                        else {
                                            res.params = params;
                                        }
                                        process.send(res);
                                    });
                                }
                            }
                            else {
                                payload = buf2array(data.source);
                                this.stt.send(payload);
                            }
                        }
                    }
                    ;
                    if (params.dtmf_detect) {
                        if (dtmf_mode !== 'rfc2833') {
                            if (!payload)
                                payload = buf2array(data.source);
                            dtmf_decoder.filter(payload, (c) => {
                                if (!dtmf_mode) {
                                    dtmf_mode = 'inband';
                                    process.send({
                                        action: 'set_dtmf_mode',
                                        params: dtmf_mode
                                    });
                                }
                                if (c.key !== undefined) {
                                    process.send({
                                        action: 'dtmf_key',
                                        params: {
                                            key: c.key
                                        }
                                    });
                                    let last_key = c.key;
                                }
                                ;
                                if (c.seq !== undefined)
                                    process.send({
                                        action: 'dtmf_seq',
                                        params: {
                                            key: c.seq
                                        }
                                    });
                            });
                        }
                    }
                }
            }
        });
        this.client.on('close', () => {
            this.emit('socketClose');
        });
        this.sendFreePacket();
    }
    // ******************** Отправка пустого пакета ********************    
    sendFreePacket() {
        let rtpPacket = new this.RtpPacket(new buffer_1.Buffer(1)); //send empty packet
        rtpPacket.time += 1;
        rtpPacket.seq++;
        this.client.send(rtpPacket.packet, 0, rtpPacket.packet.length, this.client.params.out.port, this.client.params.out.ip);
    }
    // ******************** Закрыть сокет ********************    
    close() {
        this.client.close();
    }
    // ******************** Отправить буфер ********************
    send(buffer) {
        // (process as any).send('Send Buffer: ' + buffer);
        this.client.send(buffer, 0, buffer.length, this.client.params.out.port, this.client.params.out.ip);
    }
    // ******************** Установка параметров ********************
    rec(params) {
        for (var key in params)
            this.client.params.in[key] = params[key];
        if (params.stt_detect) {
            if (JSON.stringify(params) != JSON.stringify(this.lastSttOpt) &&
                this.stt && this.stt.isReady())
                this.stt.stop();
            this.lastSttOpt = params;
        }
    }
}
exports.Rtp = Rtp;