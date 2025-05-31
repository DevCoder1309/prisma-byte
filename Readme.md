# Identify API - Prisma Byte Project

This project exposes an endpoint `/identify` to identify and resolve contact details based on the provided email or phone number using **Prisma ORM** and **PostgreSQL**.

---

## Endpoint

**POST**  
`https://prisma-byte.onrender.com/identify`

---

## Request Body

Send the data as **raw JSON** in the request body:

```json
{
  "email": "abc@gmail.com",
  "phoneNumber": "1112222"
}
