"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const events_1 = require("events");
const buffer_1 = require("buffer");
class Socket extends events_1.EventEmitter {
    constructor() {
        super();
        this.client = require("dgram").createSocket('udp4');
        this.stun = require('vs-stun');
        this.stream_on;
        this.audioPayload = 0; //RFC3551//PCMU,
        this.wavDataOffset = 58;
        this.RtpPacket = require('./rtppacket').RtpPacket;
        this.g711 = new (require('./G711').G711)();
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
        let rtp_data = (pkt) => {
            return {
                type: (pkt[1] & 0x7F),
                seq: (pkt[2] << 8 | pkt[3]),
                time: (pkt[4] << 24 | pkt[5] << 16 | pkt[6] << 8 | pkt[7]),
                source: pkt.slice(12, pkt.length)
            };
        };
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
                this.emit('dtmf', data.source);
            }
            else {
                if (data.type == this.audioPayload) {
                    if (params.media_stream) {
                        process.send({
                            action: 'mediaStream',
                            params: {
                                data: Array.from(new Uint8Array(data.source)) // for webkit - data.source
                            }
                        });
                    }
                    if (params.rec && params.file) {
                        this.emit('writeDataIn', data.source);
                    }
                    let payload = buf2array(data.source);
                    this.emit('stt', payload);
                    this.emit('payload', payload);
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
        this.client.send(buffer, 0, buffer.length, this.client.params.out.port, this.client.params.out.ip, (err) => {
            if (err) {
                process.send(err);
            }
        });
    }
    // ******************** Установка параметров ********************
    rec(params) {
        for (var key in params) {
            this.client.params.in[key] = params[key];
        }
    }
}
exports.Socket = Socket;