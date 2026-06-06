// Expense Tracker — Gmail Auto-Fetch
// Deploy at: https://script.google.com/home → New Project → paste this → Save → Run setup() once
//
// Setup:
// 1. Replace INGEST_TOKEN with your token (same as wrangler secret INGEST_TOKEN)
// 2. Run setup() once manually to create the Gmail label and time trigger
// 3. Done — runs every hour automatically

const WORKER_URL = 'https://expense-tracker-4er.pages.dev';
const INGEST_TOKEN = 'a055b07a57ccbc1c071e0b358cd45a27d389bc34f7a55035cc10216c4c1cb417';
const LABEL_NAME = 'expense-tracker-processed';
const PAID_BY_DEFAULT = 'Prashant'; // change to 'Prayashi' if Prayashi's Gmail

// Email senders to watch — add more as needed
const WATCHED_SENDERS = [
  'order-update@amazon.in',
  'auto-confirm@amazon.in',
  'shipment-tracking@amazon.in',
  'no-reply@swiggy.com',
  'noreply@swiggy.in',
  'noreply@zomato.com',
  'orders@zomato.com',
  'receipts@uber.com',
  'order-confirm@sheinindia.in',
  'ship-confirm@sheinindia.in',
  'refund-confirm@sheinindia.in'
  'email@uber.com',
  'noreply@myntra.com',
  'refunds@myntra.com',
  'noreply@instamart.in',
  'no-reply@bigbasket.com',
  'orders@bigbasket.com',
  'noreply@savana.in',
  'update@savana.in',
  'alerts@hdfcbank.com',
  'alerts@icicibank.com',
  'alerts@axisbank.com',
  'alerts@sbi.co.in',
  'noreply@paytm.com',
  'no-reply@phonepe.com',
];

function setup() {
  // Create processed label
  const existing = GmailApp.getUserLabelByName(LABEL_NAME);
  if (!existing) GmailApp.createLabel(LABEL_NAME);

  // Delete old triggers
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'pollGmail')
    .forEach(t => ScriptApp.deleteTrigger(t));

  // Create hourly trigger
  ScriptApp.newTrigger('pollGmail').timeBased().everyHours(1).create();
  Logger.log('Setup complete. pollGmail will run every hour.');
}

function pollGmail() {
  const label = GmailApp.getUserLabelByName(LABEL_NAME) || GmailApp.createLabel(LABEL_NAME);
  const senderQuery = WATCHED_SENDERS.map(s => 'from:' + s).join(' OR ');
  const keywordQuery = 'subject:(order OR invoice OR payment OR refund OR "order confirmed" OR "order placed" OR "amount debited" OR "amount credited" OR "successfully paid") -label:' + LABEL_NAME + ' newer_than:2h';
  const seen = new Set();
  const allThreads = [
    ...GmailApp.search('(' + senderQuery + ') -label:' + LABEL_NAME + ' newer_than:2h'),
    ...GmailApp.search(keywordQuery),
  ].filter(t => { if(seen.has(t.getId()))return false; seen.add(t.getId()); return true; });
  const threads = allThreads;

  let saved = 0;
  let skipped = 0;

  threads.forEach(thread => {
    thread.getMessages().forEach(msg => {
      const body = msg.getPlainBody() || msg.getBody().replace(/<[^>]+>/g, ' ');
      const subject = msg.getSubject();
      const from = msg.getFrom();
      const receivedDate = Utilities.formatDate(msg.getDate(), 'Asia/Kolkata', 'yyyy-MM-dd');
      const text = 'From: ' + from + '\nSubject: ' + subject + '\nEmail received: ' + receivedDate + '\n\n' + body;

      try {
        const response = UrlFetchApp.fetch(WORKER_URL + '/api/ingest', {
          method: 'post',
          contentType: 'application/json',
          headers: { Authorization: 'Bearer ' + INGEST_TOKEN },
          payload: JSON.stringify({ text, source: 'gmail', paid_by: PAID_BY_DEFAULT, received_date: receivedDate }),
          muteHttpExceptions: true,
        });

        const result = JSON.parse(response.getContentText());
        if (result.pending) {
          saved++;
          Logger.log('Queued: ' + JSON.stringify(result.expense));
        } else {
          skipped++;
          Logger.log('Skipped: ' + subject);
        }
      } catch (e) {
        Logger.log('Error processing "' + subject + '": ' + e);
      }
    });

    thread.addLabel(label);
  });

  Logger.log('Done. Saved: ' + saved + ', Skipped: ' + skipped);
}

// Manual test — run this to test a single thread
function testLatest() {
  const query = WATCHED_SENDERS.map(s => 'from:' + s).join(' OR ');
  const threads = GmailApp.search(query + ' newer_than:37d', 0, 1);
  if (!threads.length) { Logger.log('No matching emails found'); return; }

  const msg = threads[0].getMessages()[0];
  const receivedDate = Utilities.formatDate(msg.getDate(), 'Asia/Kolkata', 'yyyy-MM-dd');
  const text = 'From: ' + msg.getFrom() + '\nSubject: ' + msg.getSubject() + '\nEmail received: ' + receivedDate + '\n\n' + msg.getPlainBody();
  Logger.log('Testing with: ' + msg.getSubject());

  const response = UrlFetchApp.fetch(WORKER_URL + '/api/ingest', {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + INGEST_TOKEN },
    payload: JSON.stringify({ text, source: 'gmail-test', paid_by: PAID_BY_DEFAULT }),
    muteHttpExceptions: true,
  });
  Logger.log('Result: ' + response.getContentText());
}
