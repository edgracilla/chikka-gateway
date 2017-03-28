/* global describe, it, after, before */
'use strict'


const async = require('async')
const should = require('should')
const request = require('request')

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

describe('Chikka Gateway', () => {
  before('init', function () {
    process.env.BROKER = BROKER
    process.env.PLUGIN_ID = PLUGIN_ID
    process.env.OUTPUT_PIPES = OUTPUT_PIPES
    process.env.COMMAND_RELAYS = COMMAND_RELAYS
    process.env.CONFIG = JSON.stringify(conf)
  })

  after('terminate', function () {

  })

  describe('#start', function () {
    it('should start the app', function (done) {
      this.timeout(10000)
      _app = require('../app')
      _app.once('init', done)
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
      _app.on('response.ok', (device) => {
        if (device === '639178888888') done()
      })
    })
  })
})
