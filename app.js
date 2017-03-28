'use strict'

const reekoh = require('reekoh')
const plugin = new reekoh.plugins.Gateway()

const domain = require('domain')
const request = require('request')
const isEmpty = require('lodash.isempty')

let server = null
let shortCode = null
let clientId = null
let secretKey = null

plugin.once('ready', () => {
  let hpp = require('hpp')
  let async = require('async')
  let chance = new require('chance')()
  let helmet = require('helmet')
  let config = require('./config.json')
  let express = require('express')
  let bodyParser = require('body-parser')

  let app = express()
  let options = plugin.config

  if (isEmpty(options.url))		{
    options.url = config.url.default
  } else		{
    options.url = (options.url.startsWith('/')) ? options.url : `/${options.url}`
  }

  shortCode = options.shortcode
  clientId = options.client_id
  secretKey = options.secret_key

  app.use(bodyParser.urlencoded({
    extended: true
  }))

	// For security
  app.disable('x-powered-by')
  app.use(helmet.xssFilter({setOnOldIE: true}))
  app.use(helmet.frameguard('deny'))
  app.use(helmet.ieNoOpen())
  app.use(helmet.noSniff())
  app.use(hpp())

  app.post((options.url.startsWith('/')) ? options.url : `/${options.url}`, (req, res) => {
    let reqObj = req.body

    if (isEmpty(reqObj)) return res.status(400).send('Error parsing data.')

    if (reqObj.topic && reqObj.topic === 'command') {

      return plugin.relayCommand(reqObj.command, reqObj.mobile_number, '').then(() => {
        res.status(200).send(`Command Received. Device ID: ${reqObj.mobile_number}. Data: ${JSON.stringify(reqObj)}\n`)
        return plugin.log(JSON.stringify({
          title: 'Message Sent.',
          device: reqObj.mobile_number,
          command: reqObj.command
        }))
      }).catch((err) => {
        console.error(err)
        plugin.logException(err)
      })
    }

    res.set('Content-Type', 'text/plain')

    if (reqObj.shortcode !== shortCode)			{
      return plugin.logException(new Error(`Message shortcode ${reqObj.shortcode} does not match the configured shortcode ${shortCode}`))
    }

    if (isEmpty(reqObj.mobile_number))			{
      return plugin.logException(new Error('Invalid data sent. Data should have a "mobile_number" field which corresponds to a registered Device ID.'))
    }

    request.post({
      url: options.sendUrl,
      body: `message_type=REPLY&mobile_number=${reqObj.mobile_number}&shortcode=${shortCode}&request_id=${reqObj.request_id}&message_id=${chance.string({
        length: 32,
        pool: 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
      })}&message=Data+Processed&request_cost=FREE&client_id=${clientId}&secret_key=${secretKey}`,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    }, (error) => {
      if (error) console.error(error)

      plugin.requestDeviceInfo(reqObj.mobile_number).then((deviceInfo) => {
        if (isEmpty(deviceInfo)) {
          return plugin.log(JSON.stringify({
            title: 'Chikka Gateway - Access Denied. Unauthorized Device',
            device: reqObj.mobile_number
          }))
        }

        return plugin.pipe(reqObj).then(() => {
          res.status(200).send(`Data Received. Device ID: ${reqObj.mobile_number}. Data: ${JSON.stringify(reqObj)}\n`)
          return plugin.log(JSON.stringify({
            title: 'Chikka Gateway - Data Received',
            data: reqObj
          }))
        })

      }).catch((err) => {
        console.error(err)
        plugin.logException(err)
      })
    })
  })

  app.use((error, req, res, next) => {
    plugin.logException(error)

    res.status(500).send('An unexpected error has occurred. Please contact support.\n')
  })

  app.use((req, res) => {
    res.status(404).send(`Invalid Path. ${req.originalUrl} Not Found\n`)
  })

  server = require('http').Server(app)

  server.once('error', function (error) {
    console.error('Chikka Gateway Error', error)
    plugin.logException(error)

    setTimeout(() => {
      server.close(() => {
        server.removeAllListeners()
        process.exit()
      })
    }, 5000)
  })

  server.once('close', () => {
    plugin.log(`Chikka Gateway closed on port ${options.port}`)
  })

  server.listen(options.port, () => {
    plugin.log(`Chikka Gateway has been initialized on port ${options.port}`)
    plugin.emit('init')
  })
})

plugin.on('command', (message) => {
  console.log(message)
	request.post({
		url: plugin.config.sendUrl,
		body: `message_type=SEND&mobile_number=${message.device}&shortcode=${shortCode}&message_id=${message.commandId}&message=${message.command}&client_id=${clientId}&secret_key=${secretKey}`,
		headers: {'Content-Type': 'application/x-www-form-urlencoded'}
	}, (error, response, body) => {

    plugin.emit('response.ok', message.device)

		if (error) {
      return plugin.sendCommandResponse(message.commandId, `Error sending message. Error: ${error.message}`)
    } else if (response.statusCode !== 200) {
      return plugin.sendCommandResponse(message.commandId, `Error sending message. Status: ${response.statusCode}.`)
    } else {
			let d = domain.create()

			d.once('error', function (error) {
				plugin.logException(error)
				d.exit()
			})

			d.run(function () {
				body = JSON.parse(body)

				if (body.status === 200 || body.status === '200')
					plugin.sendCommandResponse(message.commandId, 'Message Sent Successfully')
				else
					plugin.sendCommandResponse(message.commandId, `Error sending message. Status: ${body.status}.`)
				d.exit()
			})
		}
	})
})

module.exports = plugin
