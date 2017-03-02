/* global describe, it, after, before */
'use strict'


const async = require('async')
const amqp = require('amqplib')
const should = require('should')
const request = require('request')
const isEmpty = require('lodash.isempty')

const Broker = require('../node_modules/reekoh/lib/broker.lib')

const SHORT_CODE = '29290733564'
const CLIENT_ID = '3aeb250f33d2995be86b0464d4f29f245cf9c9a13c88492184a67c301bbd0973'
const SECRET_KEY = '2330e364a2c2abfa4a70c1b6ba1c54b1879b820d4d965640298be8949be67998'
const SEND_URL = 'https://post.chikka.com/smsapi/request'

const PORT = 8182
const PLUGIN_ID = 'demo.gateway'
const BROKER = 'amqp://guest:guest@127.0.0.1/'
const OUTPUT_PIPES = 'demo.outpipe1,demo.outpipe2'
const COMMAND_RELAYS = 'demo.relay1,demo.relay2'

let conf = {
  port: PORT,
  shortcode: SHORT_CODE,
  client_id: CLIENT_ID,
  secret_key: SECRET_KEY,
  sendUrl: SEND_URL,
  url: '/messages'
}

let _app = null
let _conn = null
let _broker = null
let _channel = null

describe('Chikka Gateway', () => {
  before('init', function () {
    process.env.BROKER = BROKER
    process.env.PLUGIN_ID = PLUGIN_ID
    process.env.OUTPUT_PIPES = OUTPUT_PIPES
    process.env.COMMAND_RELAYS = COMMAND_RELAYS
    process.env.CONFIG = JSON.stringify(conf)

    _broker = new Broker()

    amqp.connect(BROKER).then((conn) => {
      _conn = conn
      return conn.createChannel()
    }).then((channel) => {
      _channel = channel
    }).catch((err) => {
      console.log(err)
    })
  })

  after('terminate', function () {
    _conn.close()
  })

  describe('#start', function () {
    it('should start the app', function (done) {
      this.timeout(10000)
      _app = require('../app')
      _app.once('init', done)
    })
  })

  describe('#test RPC preparation', () => {
    it('should connect to broker', (done) => {
      _broker.connect(BROKER).then(() => {
        return done() || null
      }).catch((err) => {
        done(err)
      })
    })

    it('should spawn temporary RPC server', (done) => {
      // if request arrives this proc will be called
      let sampleServerProcedure = (msg) => {
        // console.log(msg.content.toString('utf8'))
        return new Promise((resolve, reject) => {
          async.waterfall([
            async.constant(msg.content.toString('utf8')),
            async.asyncify(JSON.parse)
          ], (err, parsed) => {
            if (err) return reject(err)
            parsed.foo = 'bar'
            resolve(JSON.stringify(parsed))
          })
        })
      }

      _broker.createRPC('server', 'deviceinfo').then((queue) => {
        return queue.serverConsume(sampleServerProcedure)
      }).then(() => {
        // Awaiting RPC requests
        done()
      }).catch((err) => {
        done(err)
      })
    })
  })

  describe('#data', function () {
    it('should process the data', function (done) {
      this.timeout(10000)

      request.post({
        url: `http://localhost:${PORT}/messages`,
        headers: {'Content-Type': 'application/x-www-form-urlencoded'},
        body: `message_type=incoming&mobile_number=639178888888&shortcode=${SHORT_CODE}&request_id=5048303030534D415254303030303032393230303032303030303030303133323030303036333933393932333934303030303030313331313035303735383137&message=This+is+a+test+message&timestamp=1383609498.44`,
        gzip: true
      }, (error, response, body) => {
        should.ifError(error)
        should.equal(response.statusCode, 200, `Response Status should be 200. Status: ${response.statusCode}`)
        should.ok(body.startsWith('Data Received'))
        done()
      })
    })
  })

  describe('#command', function () {
    it('should create commandRelay listener', function (done) {
      this.timeout(10000)

      let cmdRelays = `${COMMAND_RELAYS || ''}`.split(',').filter(Boolean)

      async.each(cmdRelays, (cmdRelay, cb) => {
        _channel.consume(cmdRelay, (msg) => {
          if (!isEmpty(msg)) {
            async.waterfall([
              async.constant(msg.content.toString('utf8') || '{}'),
              async.asyncify(JSON.parse)
            ], (err, obj) => {
              if (err) return console.log('parse json err. supplied invalid data')

              let devices = []

              if (Array.isArray(obj.devices)) {
                devices = obj.devices
              } else {
                devices.push(obj.devices)
              }

              if (obj.deviceGroup) {
                // get devices from platform agent
                // then push to devices[]
              }

              async.each(devices, (device, cb) => {
                _channel.publish('amq.topic', `${cmdRelay}.topic`, new Buffer(JSON.stringify({
                  sequenceId: obj.sequenceId,
                  commandId: new Date().getTime().toString(), // uniq
                  command: obj.command,
                  device: device
                })))
                cb()
              }, (err) => {
                should.ifError(err)
              })
            })
          }
          _channel.ack(msg)
        }).then(() => {
          return cb()
        }).catch((err) => {
          should.ifError(err)
        })
      }, done)
    })

    it('should be able to send command to device', function (done) {
      this.timeout(10000)

      request.post({
        url: `http://localhost:${PORT}/messages`,
        headers: {'Content-Type': 'application/x-www-form-urlencoded'},
        body: `message_type=incoming&mobile_number=639178888888&shortcode=${SHORT_CODE}&request_id=5048303030534D415254303030303032393230303032303030303030303133323030303036333933393932333934303030303030313331313035303735383137&message=This+is+a+test+message&timestamp=1383609498.44&topic=command&command=test`,
        gzip: true
      }, (error, response, body) => {
        should.ifError(error)
        should.equal(response.statusCode, 200, `Response Status should be 200. Status: ${response.statusCode}`)
        should.ok(body.startsWith('Command Received'))
        done()
      })
    })

    it('should be able to recieve command response', function (done) {
      this.timeout(5000)
      _app.once('response.ok', done)
    })
  })
})
