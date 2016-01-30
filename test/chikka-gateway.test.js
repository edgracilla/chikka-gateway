'use strict';

const PORT       = 8080,
	  SHORT_CODE = '29290733564',
	  CLIENT_ID  = '3aeb250f33d2995be86b0464d4f29f245cf9c9a13c88492184a67c301bbd0973',
	  SECRET_KEY = '2330e364a2c2abfa4a70c1b6ba1c54b1879b820d4d965640298be8949be67998',
	  CLIENT_ID1 = '639178888888',
	  CLIENT_ID2 = '639179999999';

var cp     = require('child_process'),
	assert = require('assert'),
	gateway;

describe('Gateway', function () {
	this.slow(5000);

	after('terminate child process', function (done) {
		this.timeout(6000);

		setTimeout(function () {
			gateway.kill('SIGKILL');
			done();
		}, 3000);
	});

	describe('#spawn', function () {
		it('should spawn a child process', function () {
			assert.ok(gateway = cp.fork(process.cwd()), 'Child process not spawned.');
		});
	});

	describe('#handShake', function () {
		it('should notify the parent process when ready within 5 seconds', function (done) {
			this.timeout(5000);

			gateway.on('message', function (message) {
				if (message.type === 'ready')
					done();
			});

			gateway.send({
				type: 'ready',
				data: {
					options: {
						port: PORT,
						shortcode: SHORT_CODE,
						client_id: CLIENT_ID,
						secret_key: SECRET_KEY
					},
					devices: [{_id: CLIENT_ID1}, {_id: CLIENT_ID2}]
				}
			}, function (error) {
				assert.ifError(error);
			});
		});
	});

	describe('#data', function () {
		it('should process the data', function (done) {
			this.timeout(5000);

			let request = require('request');

			request.post({
				url: `http://localhost:${PORT}/messages`,
				headers: {
					'Content-Type': 'text/plain'
				},
				body: `message_type=incoming&mobile_number=${CLIENT_ID1}&shortcode=${SHORT_CODE}&request_id=5048303030534D415254303030303032393230303032303030303030303133323030303036333933393932333934303030303030313331313035303735383137&message=This+is+a+test+message&timestamp=1383609498.44`,
				gzip: true
			}, (error, response, body) => {
				console.error('Error', error);
				console.log('Status Code', response.statusCode);
				console.log('Body', body);
				done();
			});
		});
	});
});