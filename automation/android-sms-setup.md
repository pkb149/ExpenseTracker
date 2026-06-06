# Android SMS → Expense Tracker (UPI / Bank SMS)

Catches UPI debit SMS from HDFC, ICICI, Axis, SBI, PhonePe, GPay, Paytm etc.

## Option A: MacroDroid (easier, no coding)

1. Install MacroDroid from Play Store (free)
2. New Macro → Trigger: "SMS Received"
3. Constraint: SMS body contains "debited" OR "INR" OR "UPI"
   - Also add: does NOT contain "credited" (to skip incoming money)
4. Action: "HTTP Request (POST)"
   - URL: https://expense-tracker.prashantkumarbharadwaj.workers.dev/api/ingest
   - Method: POST
   - Headers: Authorization: Bearer YOUR_INGEST_TOKEN
             Content-Type: application/json
   - Body: {"text": "{sms_body}", "source": "sms-android", "paid_by": "Prashant"}
5. Save macro. Test by sending yourself a test SMS.

## Option B: Tasker + AutoTools (more control)

Profile: Event → Phone → Received SMS
  - Sender: (leave blank for all, or add bank short codes like HDFCBK, ICICIB, AXISBK)

Task:
  1. Variable Set: %sms_json = {"text":"%SMSRB","source":"sms-tasker","paid_by":"Prashant"}
  2. HTTP Request:
     - Method: POST
     - URL: https://expense-tracker.prashantkumarbharadwaj.workers.dev/api/ingest
     - Header: Authorization: Bearer YOUR_INGEST_TOKEN
     - Header: Content-Type: application/json
     - Body: %sms_json

## Option C: IFTTT (easiest, least reliable)

IFTTT Free → "Android SMS" trigger → "Webhooks" action
- URL: https://expense-tracker.prashantkumarbharadwaj.workers.dev/api/ingest
- Method: POST
- Content-Type: application/json
- Body: {"text":"{{Text}}","source":"ifttt-sms","paid_by":"Prashant"}
Note: IFTTT has ~15 min delay and limited free triggers.

## Getting INGEST_TOKEN

Run: wrangler secret put INGEST_TOKEN
Enter any strong random string (e.g. generate at https://randomkeygen.com)
Use the same string in all automation configs above.
