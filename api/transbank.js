/**
 * Transbank
 */

import { ObjectId } from 'mongodb'
import UA from 'ua-parser-js'
import xss from 'xss'

import tbk from 'transbank-sdk'
// common-js lib restriction
const { Oneclick, TransactionDetail } = tbk

import * as mongo from './mongo.js'
import * as server from './server.js'

import { isValidEmail, encrypt, decrypt } from './utils.js'

/**
 * Collection
 * @constant {object} COLLECTION - The collection names
 */
const COLLECTION = {

	inscriptions: 'tbkOneClickIns',
	transactions: 'tbkOneClickTrx',
}

/**
 * Production Environment
 * @constant {boolean} IS_ENV_PROD - Flag for production environment
 */
const IS_ENV_PROD = !!process.env.TBK_CODE && !!process.env.TBK_KEY

/**
 * Test Commerce Code
 * @constant {string} TEST_COMMERCE_CODE - The test commerce code
 */
const TEST_COMMERCE_CODE = '597055555542'

/**
 * Setup
 * @returns {undefined}
 */
async function setup() {

	// logger
	const { log } = server.app

	// check redirect URLs
	if (!process.env.BASE_URL) throw 'INVALID_BASE_URL'
	if (!process.env.TBK_SUCCESS_URL) throw 'INVALID_TBK_SUCCESS_URL'
	if (!process.env.TBK_FAILED_URL) throw 'INVALID_TBK_FAILED_URL'

	// testing
	if (!IS_ENV_PROD)
		return Oneclick.configureOneclickMallForTesting()

	// production credentials
	log.info(`Transbank (setup) -> production mode, code=${process.env.TBK_CODE} tbk-key=${process.env.TBK_KEY.substring(0, 3)}****`)

	Oneclick.configureForProduction(process.env.TBK_CODE, process.env.TBK_KEY)
}

/**
 * Action - Create Inscription
 * @param {object} req - The request object
 * @param {object} res - The response object
 * @returns {undefined}
 */
async function createInscription(req, res) {

	let {

		userId = '', // ObjectId as string
		email  = '',
	} = req.body

	try {

		// parse user data
		userId = xss(userId).trim()
		email  = xss(email).toLowerCase().trim()

		if (!req.headers['user-agent']) throw 'MISSING_UA'
		if (!ObjectId.isValid(userId)) throw 'INVALID_USER_ID'
		if (!isValidEmail(email)) throw 'INVALID_USER_EMAIL'

		// parse user-agent
		const { os, browser } = UA(req.headers['user-agent'])

		// check if inscription already exists
		if (await mongo.count(COLLECTION.inscriptions, { userId: new ObjectId(userId), status: 'success' })) throw 'ACTIVE_INSCRIPTION_EXISTS'

		// save pending inscription
		const { insertedId } = await mongo.insertOne(COLLECTION.inscriptions, {

			userId   : new ObjectId(userId),
			status   : 'pending',
			createdAt: new Date(),
			client   : {

				...browser,
				os   : os.name || null,
				uaRaw: req.headers['user-agent'],
				ip   : req.headers['x-forwarded-for'] || req.ip,
			}
		})

		const hash      = encrypt(insertedId.toString())
		const finishUrl = server.getBaseUrl(`inscription/finish/${hash}`)

		// transbank API call
		const $tbk = new Oneclick.MallInscription(Oneclick.options)
		const { token, url_webpay: url } = await $tbk.start(userId, email, finishUrl)
		// check response
		if (!token || !url) throw 'UNEXPECTED_TBK_RESPONSE'

		req.log.info(`Transbank (createInscription) -> response received, token=${token.substring(0, 3)}****`)
		req.log.info(`Transbank (createInscription) -> created 'pending' inscription, id=${insertedId.toString()}`)

		return { status: 'ok', url, token }
	}
	catch (e) {

		req.log.error(`Transbank (createInscription) -> exception: ${e.toString()}`)
		return { status: 'error', error: e.toString().replace(/\n/g, '. ') }
	}
}

/**
 * Action - Finish Inscription
 * @param {object} req - The request object
 * @param {object} res - The response object
 * @returns {undefined}
 */
async function finishInscription(req, res) {

	let inscriptionId = 0

	try {

		const { hash = '' } = req.params
		const { TBK_TOKEN = '' } = req.query
		// validate params
		if (!TBK_TOKEN) throw 'INVALID_TBK_TOKEN'

		// decrypt inscription id
		inscriptionId = decrypt(hash)

		req.log.debug(`Transbank (finishInscription) -> params, inscription=${inscriptionId} tbk-token=${TBK_TOKEN}`)

		if (!ObjectId.isValid(inscriptionId)) throw 'INVALID_HASH'

		const inscription = await mongo.findOne(COLLECTION.inscriptions, { _id: new ObjectId(inscriptionId), status: 'pending' })
		if (!inscription) throw 'PENDING_INSCRIPTION_NOT_FOUND'

		// transbank API call
		const $tbk = new Oneclick.MallInscription(Oneclick.options)
		const response = await $tbk.finish(TBK_TOKEN)

		req.log.info(`Transbank (finishInscription) -> response code=${response.response_code}`)

		if (response.response_code !== 0) throw `UNEXPECTED_TBK_RESPONSE:${response.response_code}`

		const cardNumber = response.card_number // last 4 digits (remove xx/** from card number)

		const update = {

			status    : 'success',
			token     : response.tbk_user,
			authCode  : response.authorization_code,
			cardType  : response.card_type,
			cardDigits: cardNumber.substring(cardNumber.length - 4),
		}

		// update inscription
		await mongo.updateOne(COLLECTION.inscriptions, { _id: new ObjectId(inscriptionId) }, { $set: update })

		req.log.info(`Transbank (finishInscription) -> inscription finished successfully, id=${inscriptionId}`)

		res.redirect(`${process.env.TBK_SUCCESS_URL}?inscriptionId=${inscriptionId}`)
	}
	catch (e) {

		// update status
		if (inscriptionId)
			await mongo.updateOne(COLLECTION.inscriptions, { _id: new ObjectId(inscriptionId) }, { $set: { status: 'failed' } })

		req.log.error(`Transbank (finishInscription) -> exception: ${e.toString()}`)
		res.redirect(`${process.env.TBK_FAILED_URL}?inscriptionId=${inscriptionId}`)
	}
}

/**
 * Action - Delete Inscription
 * @param {object} req - The request object
 * @param {object} res - The response object
 * @returns {undefined}
 */
async function deleteInscription(req, res) {

	const {

		inscriptionId = '', // ObjectId as string
		userId        = '', // ObjectId as string
	} = req.body

	try {

		if (!ObjectId.isValid(inscriptionId)) throw 'INVALID_INSCRIPTION_ID'
		if (!ObjectId.isValid(userId)) throw 'INVALID_USER_ID'

		const inscription = await mongo.findOne(COLLECTION.inscriptions, { _id: new ObjectId(inscriptionId), userId: new ObjectId(userId), status: 'success' })
		if (!inscription) throw 'ACTIVE_INSCRIPTION_NOT_FOUND'

		const { token } = inscription
		if (!token) throw 'MISSING_INSCRIPTION_TOKEN_PROP'

		req.log.info(`Transbank (deleteInscription) -> new request, token=${token.substring(0, 3)}**** userId=${userId}`)

		// transbank API call
		const $tbk = new Oneclick.MallInscription(Oneclick.options)
		const response = await $tbk.delete(token, userId)

		req.log.info(`Transbank (deleteInscription) -> response: ${JSON.stringify(response)}, inscription=${inscriptionId}`)

		// update status
		if (response)
			await mongo.updateOne(COLLECTION.inscriptions, { _id: new ObjectId(inscriptionId) }, { $set: { status: 'removed', removedAt: new Date() } })

		return { status: 'ok' }
	}
	catch (e) {

		// not found special case
		if (e.toString().match(/404/)) {

			// update status
			if (inscriptionId)
				await mongo.updateOne(COLLECTION.inscriptions, { _id: new ObjectId(inscriptionId) }, { $set: { status: 'removed', removedAt: new Date() } })

			return { status: 'ok', message: 'inscription no longer exists in Transbank' }
		}

		req.log.error(`Transbank (deleteInscription) -> exception: ${e.toString()}`)
		return { status: 'error', error: e.toString().replace(/\n/g, '. ') }
	}
}

/**
 * Action - Inscription Charge
 * @param {object} req - The request object
 * @param {object} res - The response object
 * @returns {undefined}
 */
async function charge(req, res) {

	let {

		inscriptionId = '', // ObjectId as string (optional)
		userId        = '', // ObjectId as string
		commerceCode  = '', // child commerce code
		buyOrder      = '',
		amount        = 0,
		shares        = 1,
	} = req.body

	try {

		// sanitize inputs
		buyOrder     = xss(buyOrder).trim()
		commerceCode = xss(commerceCode).trim()
		amount       = parseInt(amount) || 0
		shares       = parseInt(shares) || 1

		if (!ObjectId.isValid(userId)) throw 'INVALID_USER_ID'
		if (!buyOrder) throw 'INVALID_BUY_ORDER'
		if (!amount) throw 'INVALID_AMOUNT'

		// default commerce code (integration)
		if (!commerceCode) commerceCode = TEST_COMMERCE_CODE

		let inscription
		// get input inscription by ID or first found
		if (inscriptionId && ObjectId.isValid(inscriptionId))
			inscription = await mongo.findOne(COLLECTION.inscriptions, { _id: new ObjectId(inscriptionId), userId: new ObjectId(userId), status: 'success' })
		else
			inscription = await mongo.findOne(COLLECTION.inscriptions, { userId: new ObjectId(userId), status: 'success' })

		// check inscription object
		if (!inscription) throw 'ACTIVE_INSCRIPTION_NOT_FOUND'
		if (!inscription.token) throw 'MISSING_INSCRIPTION_TOKEN_PROP'

		// check if payment has not processed yet
		if (await mongo.count(COLLECTION.transactions, { buyOrder })) throw 'BUY_ORDER_ALREADY_PROCESSED'

		req.log.info(`Transbank (charge) -> authorizing transaction, buyOrder=${buyOrder} inscriptionId=${inscription._id} ` +
						`cc=${commerceCode} amount=${amount} shares=${shares}`)

		// set TBK transaction (child buyOrder same as parent)
		const details = [new TransactionDetail(amount, commerceCode, buyOrder, shares)]
		// transbank API call
		const $tbk = new Oneclick.MallTransaction(Oneclick.options)
		const response = await $tbk.authorize(

			inscription.userId.toString(),
			inscription.token,
			buyOrder,
			details
		)

		// check response
		if (response.details?.[0]?.response_code !== 0)
			throw `UNEXPECTED_TBK_RESPONSE:${response.details?.[0]?.response_code}`

		req.log.info(`Transbank (charge) -> transaction authorized successfully! buyOrder=${buyOrder}`)

		// save pending inscription
		const { insertedId } = await mongo.insertOne(COLLECTION.transactions, {

			buyOrder,
			commerceCode,
			inscriptionId: inscription._id,
			userId       : inscription.userId,
			cardDigits   : response.card_detail.card_number,
			authCode     : response.details[0].authorization_code,
			responseCode : response.details[0].response_code,
			paymentType  : response.details[0].payment_type_code,
			status       : response.details[0].status,
			shares       : parseInt(response.details[0].installments_number),
			amount,
			createdAt    : new Date(),
		})

		// get inserted trx
		const trx = await mongo.findOne(COLLECTION.transactions, { _id: insertedId })

		return { status: 'ok', trx }
	}
	catch (e) {

		req.log.error(`Transbank (charge) -> exception: ${e.toString()}`)
		return { status: 'error', error: e.toString().replace(/\n/g, '. ') }
	}
}

/**
 * Action - Refund transaction
 * @param {object} req - The request object
 * @param {object} res - The response object
 * @returns {undefined}
 */
async function refund(req, res) {

	let {

		commerceCode = '', // child commerce code
		buyOrder     = '', // saved buyOrder
		authCode     = '', // saved authCode
		amount       = '', // amount to refund
	} = req.body

	try {

		// sanitize inputs
		commerceCode = xss(commerceCode).trim()
		buyOrder     = xss(buyOrder).trim()
		authCode     = xss(authCode).trim()
		amount       = parseInt(amount) || 0

		if (!buyOrder) throw 'INVALID_BUY_ORDER'
		if (!authCode) throw 'INVALID_AUTH_CODE'
		if (!amount) throw 'INVALID_AMOUNT'

		// default commerce code (integration)
		if (!commerceCode) commerceCode = TEST_COMMERCE_CODE

		// check if payment has not processed yet
		if (!await mongo.count(COLLECTION.transactions, { buyOrder, authCode }))
			throw 'BUY_ORDER_WITH_AUTH_CODE_NOT_FOUND'

		req.log.info(`Transbank (refund) -> refunding transaction, buyOrder=${buyOrder}`)

		// transbank API call
		const $tbk = new Oneclick.MallTransaction(Oneclick.options)
		const response = await $tbk.refund(buyOrder, commerceCode, buyOrder, amount)

		req.log.info(`Transbank (refund) -> response ok: ${JSON.stringify(response)}, buyOrder=${buyOrder}`)

		if (!/REVERSED|NULLIFIED/.test(response.type))
			throw `UNEXPECTED_TBK_RESPONSE_${response.type || 'NAN'}`

		req.log.info(`Transbank (refund) -> transaction refunded successfully! buyOrder=${buyOrder}`)

		return { status: 'ok', response }
	}
	catch (e) {

		req.log.warn(`Transbank (refund) -> exception: ${e.toString()}`)

		return { status: 'error', error: e.toString().replace(/\n/g, '. ') }
	}
}

/**
 * Export
 */
export {

	setup,
	createInscription,
	finishInscription,
	deleteInscription,
	charge,
	refund,
}
