# Transbank OneClick

Container service for Transbank OneClick API using MongoDB as database storage.

- MongoDB v4+ required
- For security reasons, prevent exposing this API directly at client-side applications.

## Env vars

```yml
MONGO_URL: MongoDB URL, required (i.e. mongodb://mongo/app)
BASE_URL: Base URL for cloud setup, a path in URL is supported (i.e. https://myservices.com/tbk-oneclick/)
API_KEY: Service API Key (required)
ENCRYPTION_KEY: Key for URL encrypt/decrypt (optional, max. 32 chars)
TBK_CODE: OneClick Mall Store Code for production (a.k.a código comercio)
TBK_KEY: OneClick Mall API Key for production
TBK_SUCCESS_URL: OneClick Inscription success URL
TBK_FAILED_URL: OneClick Inscription failed URL
DEBUG_LOGS: Enable debug logs in production environment
```

## API Endpoints

### Headers

- `Content-Type: application/json`
- `Authorization: Bearer {token}` (optional)

### GET /health

Endpoint for service health checks.

```bash
curl -i https://{host}/health
```

### POST /inscription/create

Body Params

- userId `ObjectId.string`
- email `string`

```bash
curl -iX POST -H 'Content-Type: application/json' -H 'Authorization: Bearer {API-KEY}' -d '{ "userId": "6517213dd708e471d4f1cc46", "email": "john@doe.com" }' {BASE_URL}/inscription/create
```

### POST /inscription/delete

Body Params

- inscriptionId `ObjectId.string`
- userId `ObjectId.string`

```bash
curl -iX POST -H 'Content-Type: application/json' -H 'Authorization: Bearer {API-KEY}' -d '{ "userId": "6517213dd708e471d4f1cc46", "inscriptionId": "651749a3ab79729b9f5effad" }' {BASE_URL}/inscription/delete
```

### POST /inscription/charge

Body Params

- userId `ObjectId.string`
- inscriptionId `ObjectId.string` (optional, use first inscription found for given userId)
- commerceCode `string`
- buyOrder `string`
- amount `number`
- shares `number`

```bash
curl -iX POST -H 'Content-Type: application/json' -H 'Authorization: Bearer {API-KEY}' -d '{ "userId": "6517213dd708e471d4f1cc46", "inscriptionId": "651749a3ab79729b9f5effad", "commerceCode": "597055555542", "buyOrder": "12345678", "amount": 1000, "shares": 0 }' {BASE_URL}/inscription/charge
```

### POST /inscription/refund

Body Params

- userId `ObjectId.string`
- commerceCode `string`
- buyOrder `string`
- amount `number`

```bash
curl -iX POST -H 'Content-Type: application/json' -H 'Authorization: Bearer {API-KEY}' -d '{ "userId": "6517213dd708e471d4f1cc46", "commerceCode": "597055555542", "buyOrder": "12345678", "amount": 800 }' {BASE_URL}/inscription/refund
```

### Response Format

```javascript
// output response ok
{
    "status": "ok",
    ...payload
}

// output response error
{
    "status": "error",
    "error": "SOME_ERROR"
}
```

## Test Data

```text
# Credit Card
4051885600446623 (success)
5186059559590568 (fail)

# Debit Card
4051884239937763 (success)
5186008541233829 (fail)

# Commerce Codes (OneClick Mall)
597055555541 (Mall)
597055555542 (Store 1)
597055555543 (Store 2)

# Certification Login
user: 11111111-1
pass: 123
```

## Reference

- [Transbank OneClick Docs](https://www.transbankdevelopers.cl/documentacion/oneclick)
