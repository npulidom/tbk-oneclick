/**
 * Init
 */

import * as mongo     from './api/mongo.js'
import * as server    from './api/server.js'
import * as api       from './api/api.js'
import * as transbank from './api/transbank.js'
import * as utils     from './api/utils.js'

// ++ Globals
const basePath = utils.basePath()
const version  = process.env.BUILD_ID

/**
 * Init App
 */
async function init() {

	/**
	 * Setup
	 */
	const app = await server.create(basePath)
	// mongo
	await mongo.connect()
	// transbank
	await transbank.setup()

	/**
	 * Hooks
	 */
	app.addHook('onRequest', async (req, res) => {

		// * OPTIONS preflight CORS
		if (req.method == 'OPTIONS') {

			server.setCorsHeaders(res)
			return res.send()
		}

		// * POST method CORS
		if (req.method == 'POST') {

			server.setCorsHeaders(res)
			return
		}
	})

	/**
	 * Extend app routes
	 */
	api.setRoutes(app, basePath)

	/**
	 * Handler - Not Found
	 */
	app.setNotFoundHandler((req, res) => res.code(404).send({ error: 'not found' }) )

	/**
	 * Handler - Internal Error
	 */
	app.setErrorHandler((error, req, res) => {

		// log error
		app.log.error(error)
		// response
		res.code(500).send({ error })
	})

	// start server
	await app.listen({ port: 80, host: '0.0.0.0' })
	app.log.info(`Init -> server is up since ${new Date().toString()}, base-path: ${basePath}, version: ${version}`)
}

/**
 * Gracefull exit
 */
async function exitGracefully(signal) {

	console.log(`Init (exitGracefully) -> ${signal} signal event`)

	await server.shutdown()
	process.exit(0)
}

// process signal events
process.on('SIGINT', exitGracefully)
process.on('SIGTERM', exitGracefully)

// start app
try       { await init() }
catch (e) { console.error('Init -> main exception', e) }
