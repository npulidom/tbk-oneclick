/**
 * API
 */

import bearerAuthPlugin from '@fastify/bearer-auth'

import * as transbank from './transbank.js'

/**
 * Extend Routes
 * @param {object} app - The application server object
 * @param {string} basePath - The base path
 * @returns {undefined}
 */
function setRoutes(app, basePath) {

	// bearer auth required routes
	app.register(async (instance, opts) => {

		// bearer auth plugin
		await instance.register(bearerAuthPlugin, { keys: new Set([process.env.API_KEY]) })

		// routes

		await instance.post(`${basePath}inscription/create`, (req, res) => transbank.createInscription(req, res))

		await instance.post(`${basePath}inscription/finish/:hash`, (req, res) => transbank.finishInscription(req, res))

		await instance.post(`${basePath}inscription/delete`, (req, res) => transbank.deleteInscription(req, res))

		await instance.post(`${basePath}inscription/charge`, (req, res) => transbank.charge(req, res))

		await instance.post(`${basePath}inscription/refund`, (req, res) => transbank.refund(req, res))
	})

	// no bearer auth required
	app.get(`${basePath}inscription/finish/:hash`, (req, res) => transbank.finishInscription(req, res))

	return app
}

/**
 * Export
 */
export {

	setRoutes,
}
