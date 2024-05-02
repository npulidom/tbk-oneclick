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
import { baseUrl, isValidEmail, encrypt, decrypt } from './utils.js'

// ++ consts
const COLLECTION = {

	inscriptions: 'tbkOneClickIns',
	transactions: 'tbkOneClickTrx',
}
// integration test code
const TEST_COMMERCE_CODE = '597055555542'
// env
const IS_ENV_PROD = !!process.env.TBK_CODE && !!process.env.TBK_KEY

/**
 * Setup
 * @returns {undefined}
 */
async function setup() {

	// check redirect URLs
	if (!process.env.BASE_URL) throw 'INVALID_BASE_URL'
	if (!process.env.TBK_SUCCESS_URL) throw 'INVALID_TBK_SUCCESS_URL'
	if (!process.env.TBK_FAILED_URL) throw 'INVALID_TBK_FAILED_URL'

	// testing
	if (!IS_ENV_PROD)
		return Oneclick.configureOneclickMallForTesting()

	// production credentials
	console.log(`Transbank (setup) -> production mode, code: ${process.env.TBK_CODE}, tbk-key: ${process.env.TBK_KEY.substring(0, 3)} ...`)
	Oneclick.configureForProduction(process.env.TBK_CODE, process.env.TBK_KEY)
}

/**
 * Create Inscription
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
		if (!ObjectId.isValid(userId)) throw 'INVALID_USER_ID_(OBJECT_ID)'
		if (!isValidEmail(email))  throw 'INVALID_USER_EMAIL'

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
				os: os.name || null,
				uaRaw: req.headers['user-agent'],
				ip: req.headers['x-forwarded-for'] || req.ip,
			}
		})

		const hash      = encrypt(insertedId.toString())
		const finishUrl = baseUrl(`inscription/finish/${hash}`)

		// transbank API call
		const ins = new Oneclick.MallInscription(Oneclick.options)
		const { token, url_webpay: url } = await ins.start(userId, email, finishUrl)

		if (!token || !url) throw 'UNEXPECTED_TBK_RESPONSE'

		req.log.debug(`Transbank (createInscription) -> response received, token: ${token}`)
		req.log.info(`Transbank (createInscription) -> 'pending' inscription ${insertedId.toString()} created!`)

		return { status: 'ok', url, token }
	}
	catch (e) {

		req.log.error(`Transbank (createInscription) -> exception ${e.toString()}`)
		return { status: 'error', error: e.toString().replace(/\n/g, '. ') }
	}
}

/**
 * Finish Inscription
 * @param {object} req - The request object
 * @param {object} res - The response object
 * @returns {undefined}
 */
async function finishInscription(req, res) {

	let inscriptionId = 0

	try {

		const { hash = '' } = req.params
		const { TBK_TOKEN = '' } = req.query

		if (!TBK_TOKEN) throw 'INVALID_TBK_TOKEN'

		// decrypt inscription id
		inscriptionId = decrypt(hash)

		req.log.debug(`Transbank (finishInscription) -> params: inscription[${inscriptionId}] tbk-token[${TBK_TOKEN}]`)

		if (!ObjectId.isValid(inscriptionId)) throw 'INVALID_HASH'

		const inscription = await mongo.findOne(COLLECTION.inscriptions, { _id: new ObjectId(inscriptionId), status: 'pending' })
		if (!inscription) throw 'PENDING_INSCRIPTION_NOT_FOUND'

		// transbank API call
		const ins = new Oneclick.MallInscription(Oneclick.options)
		const response = await ins.finish(TBK_TOKEN)

		req.log.info(`Transbank (finishInscription) -> response code: ${response.response_code || 'n/a'}`)

		if (response.response_code !== 0) throw `UNEXPECTED_TBK_RESPONSE_${response.response_code || 'NAN'}`

		const update = {

			status    : 'success',
			token     : response.tbk_user,
			authCode  : response.authorization_code,
			cardType  : response.card_type,
			cardDigits: response.card_number.substring(response.card_number.length - 4) // last 4 digits
		}

		// update inscription
		await mongo.updateOne(COLLECTION.inscriptions, { _id: new ObjectId(inscriptionId) }, { $set: update })

		req.log.info(`Transbank (finishInscription) -> inscription[${inscriptionId}] finished successfully`)

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
 * Delete Inscription
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

		if (!ObjectId.isValid(inscriptionId)) throw 'INVALID_INSCRIPTION_ID_(OBJECT_ID)'
		if (!ObjectId.isValid(userId)) throw 'INVALID_USER_ID_(OBJECT_ID)'

		const inscription = await mongo.findOne(COLLECTION.inscriptions, { _id: new ObjectId(inscriptionId), userId: new ObjectId(userId), status: 'success' })
		if (!inscription) throw 'ACTIVE_INSCRIPTION_NOT_FOUND'

		const { token } = inscription

		req.log.info(`Transbank (deleteInscription) -> new request, token: ****${token.substring(token.length - 6)}, userId: ${userId}`)

		// transbank API call
		const ins = new Oneclick.MallInscription(Oneclick.options)
		const response = await ins.delete(token, userId)

		req.log.info(`Transbank (deleteInscription) -> inscription[${inscriptionId}], response: ${JSON.stringify(response)}`)

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
 * Charge
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

		if (!ObjectId.isValid(userId)) throw 'INVALID_USER_ID_(OBJECT_ID)'
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

		// check if payment has not processed yet
		if (await mongo.count(COLLECTION.transactions, { buyOrder })) throw 'BUY_ORDER_ALREADY_PROCESSED'

		req.log.info(`Transbank (charge) -> authorizing: buyOrder[${buyOrder}] inscription[${inscription._id}] cc[${commerceCode}] amount[${amount}] shares[${shares}]`)

		// set TBK transaction (child buyOrder same as parent)
		const details = [new TransactionDetail(amount, commerceCode, buyOrder, shares)]
		// transbank API call
		const mtrx     = new Oneclick.MallTransaction(Oneclick.options)
		const response = await mtrx.authorize(

			inscription.userId.toString(),
			inscription.token,
			buyOrder,
			details
		)

		if (!response.details?.length) throw `UNEXPECTED_TBK_RESPONSE`
		if (response.details[0].response_code !== 0) throw `UNEXPECTED_TBK_RESPONSE_${response.details[0].response_code || 'NAN'}`

		req.log.info(`Transbank (charge) -> buyOrder ${buyOrder} authorized successfully!`)

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
 * Refund
 * @param {object} req - The request object
 * @param {object} res - The response object
 * @returns {undefined}
 */
async function refund(req, res) {

	let {

		userId       = '', // ObjectId as string
		commerceCode = '', // child commerce code
		buyOrder     = '', // saved buyOrder
		amount       = '', // amount to refund
	} = req.body

	try {

		// sanitize inputs
		buyOrder     = xss(buyOrder).trim()
		commerceCode = xss(commerceCode).trim()
		amount       = parseInt(amount) || 0

		if (!ObjectId.isValid(userId)) throw 'INVALID_USER_ID'
		if (!buyOrder) throw 'INVALID_BUY_ORDER'
		if (!amount) throw 'INVALID_AMOUNT'

		// default commerce code (integration)
		if (!commerceCode) commerceCode = TEST_COMMERCE_CODE

		// check if payment has not processed yet
		if (!await mongo.count(COLLECTION.transactions, { buyOrder, userId: new ObjectId(userId) })) throw 'BUY_ORDER_NOT_FOUND'

		req.log.info(`Transbank (refund) -> refunding buyOrder ${buyOrder} ...`)

		// transbank API call
		const mtrx     = new Oneclick.MallTransaction(Oneclick.options)
		const response = await mtrx.refund(buyOrder, commerceCode, buyOrder, amount)

		req.log.info(`Transbank (refund) -> order ${buyOrder}, response type: ${response.type || 'n/a'}`)

		if (response.type != 'REVERSED') throw `UNEXPECTED_TBK_RESPONSE_${response.type || 'NAN'}`

		req.log.info(`Transbank (refund) -> buyOrder ${buyOrder} refunded successfully!`)

		return { status: 'ok' }
	}
	catch (e) {

		req.log.warn(`Transbank (refund) -> exception: ${e.toString()}`)

		if (e.toString().match(/NULLIFIED/)) return { status: 'ok', message: 'transaction partially refunded' }

		// possible already refunded
		if (e.toString().match(/422/)) return { status: 'ok', message: 'transaction already refunded or business logic inconsistency' }

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
