/**
 * Server
 */

import fastify from 'fastify'

// ++ consts
const LOGGER_ENV = {

	development: {

		level: 'debug',
		transport: {

			target: 'pino-pretty', options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname', colorize: true, singleLine: true }
		}
	},
	production : {

		level: 'info'
	}
}

// ++ props
let app = null

/**
 * Create Server
 * @param {string} basePath - The base path for static assets setup
 * @returns {object}
 */
async function create(basePath) {

	// new server instance
	app = fastify({

		logger                : LOGGER_ENV[process.env.NODE_ENV],
		disableRequestLogging : true,
		trustProxy            : true, // AWS ALB
		ignoreTrailingSlash   : true,
		ignoreDuplicateSlashes: true,
	})

	// health check route
	const healthCheck = (req, res) => res.send('OK')

	app.get(`/health`, healthCheck)
	// public health check
	if (basePath != '/') app.get(`${basePath}health`, healthCheck)

	// return instance
	return app
}

/**
 * Set CORS headers
 * @param {object} res - The response object
 * @returns {undefined}
 */
function setCorsHeaders(res) {

	res.header('Access-Control-Allow-Origin', '*')
	res.header('Access-Control-Allow-Methods', 'OPTIONS, HEAD, GET, POST')
	res.header('Access-Control-Allow-Headers', 'Content-Type, Origin, Referer, X-Requested-With, Authorization')
}

/**
 * Server Shutdown
 * @returns {undefined}
 */
async function shutdown() {

	if (!app) return

	app.log.info(`Server (shutdown) -> shutting down server ...`)

	// close server
	await app.close()
}

/**
 * Export
 */
export {

	app,
	create,
	setCorsHeaders,
	shutdown,
}
