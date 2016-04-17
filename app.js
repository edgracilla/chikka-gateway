'use strict';

const SEND_URL = 'https://post.chikka.com/smsapi/request';

var domain            = require('domain'),
	request           = require('request'),
	isEmpty           = require('lodash.isempty'),
	platform          = require('./platform'),
	authorizedDevices = {},
	server, shortCode, clientId, secretKey;

/**
 * Emitted when a message or command is received from the platform.
 * @param {object} message The message metadata
 */
platform.on('message', function (message) {
	request.post({
		url: SEND_URL,
		body: `message_type=SEND&mobile_number=${message.device}&shortcode=${shortCode}&message_id=${message.messageId}&message=${message.message}&client_id=${clientId}&secret_key=${secretKey}`,
		headers: {
			'Content-Type': 'text/plain'
		}
	}, (error, response, body) => {
		if (error)
			return platform.sendMessageResponse(message.messageId, `Error sending message. Error: ${error.message}`);
		else if (response.statusCode !== 200)
			return platform.sendMessageResponse(message.messageId, `Error sending message. Status: ${response.statusCode}.`);
		else {
			let d = domain.create();

			d.once('error', function (error) {
				platform.handleException(error);
				d.exit();
			});

			d.run(function () {
				body = JSON.parse(body);

				if (body.status === 200 || body.status === '200')
					platform.sendMessageResponse(message.messageId, 'Message Sent Successfully');
				else
					platform.sendMessageResponse(message.messageId, `Error sending message. Status: ${body.status}.`);

				d.exit();
			});
		}
	});
});

/**
 * Emitted when a new device is registered on the platform.
 * Lets the gateway know that a new registered device is added. Can be used to authorize device connections.
 * @param {object} device The details of the device registered on the platform represented as JSON Object.
 */
platform.on('adddevice', function (device) {
	if (!isEmpty(device) && !isEmpty(device._id)) {
		authorizedDevices[device._id] = device;
		platform.log(`Successfully added ${device._id} to the pool of authorized devices.`);
	}
	else
		platform.handleException(new Error(`Device data invalid. Device not added. ${device}`));
});

/**
 * Emitted when a device is removed or deleted from the platform. Can be used to authorize device connections.
 * @param {object} device The details of the device removed from the platform represented as JSON Object.
 */
platform.on('removedevice', function (device) {
	if (!isEmpty(device) && !isEmpty(device._id)) {
		delete authorizedDevices[device._id];
		platform.log(`Successfully added ${device._id} from the pool of authorized devices.`);
	}
	else
		platform.handleException(new Error(`Device data invalid. Device not removed. ${device}`));
});

/**
 * Emitted when the platform shuts down the plugin. The Gateway should perform cleanup of the resources on this event.
 */
platform.once('close', function () {
	let d = domain.create();

	d.once('error', function (error) {
		console.error(error);
		platform.handleException(error);
		platform.notifyClose();
		d.exit();
	});

	d.run(function () {
		server.close(() => {
			d.exit();
		});
	});
});

/**
 * Emitted when the platform bootstraps the plugin. The plugin should listen once and execute its init process.
 * Afterwards, platform.notifyReady() should be called to notify the platform that the init process is done.
 * @param {object} options The parameters or options. Specified through config.json. Gateways will always have port as option.
 * @param {array} registeredDevices Collection of device objects registered on the platform.
 */
platform.once('ready', function (options, registeredDevices) {
	let hpp        = require('hpp'),
		async      = require('async'),
		keyBy      = require('lodash.keyby'),
		chance     = new require('chance')(),
		helmet     = require('helmet'),
		config     = require('./config.json'),
		express    = require('express'),
		bodyParser = require('body-parser');

	if (!isEmpty(registeredDevices))
		authorizedDevices = keyBy(registeredDevices, '_id');

	if (isEmpty(options.url))
		options.url = config.url.default;
	else
		options.url = (options.url.startsWith('/')) ? options.url : `/${options.url}`;

	shortCode = options.shortcode;
	clientId = options.client_id;
	secretKey = options.secret_key;

	var app = express();

	app.use(bodyParser.text({
		type: '*/*',
		limit: '500kb'
	}));

	app.use(bodyParser.urlencoded({
		extended: true
	}));

	// For security
	app.disable('x-powered-by');
	app.use(helmet.xssFilter({setOnOldIE: true}));
	app.use(helmet.frameguard('deny'));
	app.use(helmet.ieNoOpen());
	app.use(helmet.noSniff());
	app.use(hpp());

	app.post(options.url, (req, res) => {
		platform.log(JSON.stringify({
			title: 'Chikka Gateway - Raw Data Captured',
			data: req.body
		}));

		if (isEmpty(req.body)) return res.status(400).send('Error parsing data.');

		let reqData = req.body.split('&'),
			reqObj  = {
				mobile_number: '',
				shortcode: '',
				request_id: '',
				message: ''
			};

		async.each(reqData, (data, cb) => {
			if (/^mobile_number=/.test(data))
				reqObj.mobile_number = data.substr(data.lastIndexOf('=') + 1);
			else if (/^shortcode=/.test(data))
				reqObj.shortcode = data.substr(data.lastIndexOf('=') + 1);
			else if (/^request_id=/.test(data))
				reqObj.request_id = data.substr(data.lastIndexOf('=') + 1);
			else if (/^message=/.test(data))
				reqObj.message = data.substr(data.lastIndexOf('=') + 1);

			cb();
		}, (error) => {
			if (error) {
				console.error(error);
				platform.handleException(error);

				return res.status(400).send('Error parsing data.');
			}

			if (reqObj.shortcode !== shortCode) {
				platform.handleException(new Error(`Message shortcode ${reqObj.shortcode} does not match the configured shortcode ${shortCode}`));

				return res.status(400).send(`Message shortcode ${reqObj.shortcode} does not match the configured shortcode ${shortCode}`);
			}

			if (isEmpty(reqObj.mobile_number)) {
				platform.handleException(new Error('Invalid data sent. Data should have a "mobile_number" field which corresponds to a registered Device ID.'));

				return res.status(400).send('Invalid data sent. Data should have a "mobile_number" field which corresponds to a registered Device ID.');
			}

			if (isEmpty(authorizedDevices[reqObj.mobile_number])) {
				platform.log(JSON.stringify({
					title: 'Chikka Gateway - Access Denied. Unauthorized Device',
					device: reqObj.mobile_number
				}));

				return res.status(401).send('Access Denied. Unauthorized device.');
			}

			res.status(200).send('Accepted');

			platform.processData(reqObj.mobile_number, JSON.stringify(reqObj), (processingError) => {
				if (processingError) {
					platform.handleException(processingError);
					return res.status(500).send('Error sending data.');
				}

				request.post({
					url: SEND_URL,
					body: `message_type=REPLY&mobile_number=${reqObj.mobile_number}&shortcode=${shortCode}&request_id=${reqObj.request_id}&message_id=${chance.string({
						length: 32,
						pool: 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
					})}&message=Data+Processed&request_cost=FREE&client_id=${clientId}&secret_key=${secretKey}`,
					headers: {
						'Content-Type': 'text/plain'
					}
				}, (error) => {
					if (error) {
						console.error(error);
						platform.handleException(processingError);
					}
				});
			});

			platform.log(JSON.stringify({
				title: 'Chikka Gateway - Data Received',
				mobile_number: reqObj.mobile_number,
				shortcode: reqObj.shortcode,
				request_id: reqObj.request_id,
				message: reqObj.message
			}));
		});
	});

	server = require('http').Server(app);

	server.once('close', () => {
		console.log(`Chikka Gateway closed on port ${options.port}`);
		platform.notifyClose();
	});

	server.listen(options.port);

	platform.notifyReady();
	platform.log(`Chikka Gateway has been initialized on port ${options.port}`);
});