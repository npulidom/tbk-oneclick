/**
 * Utils
 */

import crypto from 'crypto'

// ++ consts
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || crypto.randomBytes(16).toString('hex')

/**
 * Base URL
 * @param {string} path - An input path
 * @returns {string}
 */
function baseUrl(path) {

	let baseUrl = process.env.BASE_URL

	// remove ending slash
	if (baseUrl.endsWith('/')) baseUrl = baseUrl.substring(0, baseUrl.length - 1)

	if (path) baseUrl += `/${path}`

	// append ending slash
	if (!baseUrl.endsWith('/')) baseUrl += '/'

	return baseUrl
}

/**
 * Base path
 * @returns {string}
 */
function basePath() {

	let { pathname } = new URL(process.env.BASE_URL)

	// append ending slash
	if (!pathname.endsWith('/')) pathname += '/'

	return pathname
}

/**
 * Email Validator
 * @param {string} email - An input email
 * @returns {string}
 */
function isValidEmail(email) {

	return /\S+@\S+\.\S+/.test(email)
}

/**
 * Encrypt a string
 * @link https://gist.github.com/vlucas/2bd40f62d20c1d49237a109d491974eb
 * @param {string} text - The input text
 * @returns {string}
 */
function encrypt(text) {

	const iv     = crypto.randomBytes(16) // IV-length, use 16 for AES
	const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(ENCRYPTION_KEY), iv)

	let encrypted = cipher.update(text)
	encrypted = Buffer.concat([encrypted, cipher.final()])

	return `${iv.toString('hex')}-${encrypted.toString('hex')}`
}

/**
 * Decrypt a hash
 * @param {string} text - The input encrypted text
 * @returns {string}
 */
function decrypt(text) {

	const textParts     = text.split('-')
	const iv            = Buffer.from(textParts.shift(), 'hex')
	const encryptedText = Buffer.from(textParts.join('-'), 'hex')
	const decipher      = crypto.createDecipheriv('aes-256-cbc', Buffer.from(ENCRYPTION_KEY), iv)

	let decrypted = decipher.update(encryptedText)
	decrypted = Buffer.concat([decrypted, decipher.final()])

	return decrypted.toString()
}

/**
 * Export
 */
export {

	baseUrl,
	basePath,
	isValidEmail,
	encrypt,
	decrypt,
}
