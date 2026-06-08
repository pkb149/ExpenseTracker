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

// Statement PDF config
const STATEMENT_LABEL = 'expense-tracker-statement-processed';
// paid_by per bank — update to match who owns each card/account
const STATEMENT_PAID_BY = {
  'HDFC':    'Prashant',
  'ICICI':   'Prayashi',
  'Axis':    'Prashant',
  'SBI':     'Prashant',
  'Kotak':   'Prashant',
  'IDFC':    'Prashant',
  'IndusInd':'Prashant',
  'Yes Bank':'Prashant',
};

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
  'refund-confirm@sheinindia.in',
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
  // Create labels
  if (!GmailApp.getUserLabelByName(LABEL_NAME)) GmailApp.createLabel(LABEL_NAME);
  if (!GmailApp.getUserLabelByName(STATEMENT_LABEL)) GmailApp.createLabel(STATEMENT_LABEL);

  // Delete old triggers for both functions
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'pollGmail' || t.getHandlerFunction() === 'pollStatements')
    .forEach(t => ScriptApp.deleteTrigger(t));

  // Hourly: expense emails
  ScriptApp.newTrigger('pollGmail').timeBased().everyHours(1).create();
  // Daily: bank statement PDFs
  ScriptApp.newTrigger('pollStatements').timeBased().everyDays(1).atHour(8).create();
  Logger.log('Setup complete. pollGmail runs hourly, pollStatements runs daily at 8am.');
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
    let threadQueued = 0;
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
        if (result.queued) {
          saved++;
          threadQueued++;
          Logger.log('Queued: ' + subject + ' (id=' + result.id + ')');
        } else {
          skipped++;
          Logger.log('Skipped: ' + subject + (result.reason ? ' — ' + result.reason : (result.error ? ' — ' + result.error : '')));
        }
      } catch (e) {
        Logger.log('Error processing "' + subject + '": ' + e);
      }
    });

    if (threadQueued > 0) thread.addLabel(label);
  });

  Logger.log('Done. Saved: ' + saved + ', Skipped: ' + skipped);
}

// Backfill — run manually to import last 37 days in batches of 40
// Run multiple times — already-processed threads are labelled and skipped automatically
const BACKFILL_BATCH = 40;

function backfill() {
  const label = GmailApp.getUserLabelByName(LABEL_NAME) || GmailApp.createLabel(LABEL_NAME);
  const senderQuery = WATCHED_SENDERS.map(s => 'from:' + s).join(' OR ');
  const keywordQuery = 'subject:(order OR invoice OR payment OR refund OR "order confirmed" OR "order placed" OR "amount debited" OR "amount credited" OR "successfully paid") -label:' + LABEL_NAME + ' newer_than:37d';
  const seen = new Set();
  const allThreads = [
    ...GmailApp.search('(' + senderQuery + ') -label:' + LABEL_NAME + ' newer_than:37d'),
    ...GmailApp.search(keywordQuery),
  ].filter(function(t) { if (seen.has(t.getId())) return false; seen.add(t.getId()); return true; });

  Logger.log('Found ' + allThreads.length + ' unprocessed threads.');

  let saved = 0, skipped = 0, processed = 0;

  for (var i = 0; i < allThreads.length; i++) {
    if (processed >= BACKFILL_BATCH) {
      Logger.log('Batch limit reached (' + BACKFILL_BATCH + '). Run backfill() again for the next batch.');
      break;
    }
    var thread = allThreads[i];
    var threadQueued = 0;
    thread.getMessages().forEach(function(msg) {
      if (processed >= BACKFILL_BATCH) return;
      var body = msg.getPlainBody() || msg.getBody().replace(/<[^>]+>/g, ' ');
      var receivedDate = Utilities.formatDate(msg.getDate(), 'Asia/Kolkata', 'yyyy-MM-dd');
      var text = 'From: ' + msg.getFrom() + '\nSubject: ' + msg.getSubject() + '\nEmail received: ' + receivedDate + '\n\n' + body;
      try {
        var res = UrlFetchApp.fetch(WORKER_URL + '/api/ingest', {
          method: 'post', contentType: 'application/json',
          headers: { Authorization: 'Bearer ' + INGEST_TOKEN },
          payload: JSON.stringify({ text: text, source: 'gmail-backfill', paid_by: PAID_BY_DEFAULT, received_date: receivedDate }),
          muteHttpExceptions: true,
        });
        var r = JSON.parse(res.getContentText());
        if (r.queued) { saved++; threadQueued++; Logger.log('Queued: ' + msg.getSubject() + ' (id=' + r.id + ')'); }
        else { skipped++; Logger.log('Skipped: ' + msg.getSubject() + (r.reason ? ' — ' + r.reason : (r.error ? ' — ' + r.error : ''))); }
        processed++;
      } catch(e) { Logger.log('Error: ' + e); }
    });
    if (threadQueued > 0) thread.addLabel(label);
  }

  Logger.log('Batch done. Queued: ' + saved + ', Skipped: ' + skipped + '. Run again if more remain.');
}

// Statement PDF reconciliation — runs daily, finds bank statement emails, forwards PDFs to backend
function pollStatements() {
  const label = GmailApp.getUserLabelByName(STATEMENT_LABEL) || GmailApp.createLabel(STATEMENT_LABEL);

  // Search for statement PDFs not yet processed — look back 37 days to catch monthly statements
  const query = 'has:attachment filename:pdf -label:' + STATEMENT_LABEL + ' newer_than:2d ' +
    '(subject:statement OR subject:e-statement OR subject:estatement OR subject:"monthly statement" OR subject:"account statement" OR subject:"card statement")';

  const threads = GmailApp.search(query, 0, 20);
  Logger.log('pollStatements: found ' + threads.length + ' threads');

  let uploaded = 0, errored = 0;

  threads.forEach(function(thread) {
    var threadPdfs = 0, threadUploaded = 0, threadErrored = 0;
    thread.getMessages().forEach(function(msg) {
      const subject = msg.getSubject();
      const from = msg.getFrom();
      const bank = detectStatementBank(subject, from);

      const attachments = msg.getAttachments({ includeInlineImages: false, includeAttachments: true });
      attachments.forEach(function(att) {
        if (att.getContentType() !== 'application/pdf' && !att.getName().toLowerCase().endsWith('.pdf')) return;

        const pdfBytes = att.getBytes();
        const pdf_base64 = Utilities.base64Encode(pdfBytes);
        const paid_by = STATEMENT_PAID_BY[bank] || PAID_BY_DEFAULT;
        threadPdfs++;

        Logger.log('Uploading: ' + att.getName() + ' (' + Math.round(pdfBytes.length / 1024) + ' KB) bank=' + bank + ' paid_by=' + paid_by);

        try {
          const resp = UrlFetchApp.fetch(WORKER_URL + '/api/statement-upload', {
            method: 'post',
            contentType: 'application/json',
            headers: { Authorization: 'Bearer ' + INGEST_TOKEN },
            payload: JSON.stringify({ bank: bank, pdf_base64: pdf_base64, paid_by: paid_by, filename: att.getName() }),
            muteHttpExceptions: true,
          });

          var code = resp.getResponseCode();
          var body = resp.getContentText();
          try {
            var result = JSON.parse(body);
            if (code === 200) {
              if (result.password_required) {
                Logger.log(att.getName() + ': needs password (saved for UI unlock, id=' + result.id + ')');
                uploaded++; threadUploaded++;
              } else {
                Logger.log(att.getName() + ': total=' + result.total + ' matched=' + result.matched + ' new_pending=' + result.new_pending);
                uploaded++; threadUploaded++;
              }
            } else {
              Logger.log(att.getName() + ': HTTP ' + code + ' - ' + (result.error || body.slice(0, 200)));
              errored++; threadErrored++;
            }
          } catch(jsonErr) {
            Logger.log(att.getName() + ': HTTP ' + code + ' - ' + body.slice(0, 300));
            errored++; threadErrored++;
          }
        } catch (e) {
          Logger.log('Upload failed for "' + att.getName() + '": ' + e);
          errored++; threadErrored++;
        }
      });
    });

    // Label only when all PDFs in thread were accepted (no errors)
    if (threadPdfs > 0 && threadErrored === 0) thread.addLabel(label);
  });

  Logger.log('pollStatements done. Uploaded: ' + uploaded + ', Errored: ' + errored);
}

function detectStatementBank(subject, sender) {
  var combined = (subject + ' ' + sender).toLowerCase();
  if (combined.indexOf('hdfc') !== -1) return 'HDFC';
  if (combined.indexOf('icici') !== -1) return 'ICICI';
  if (combined.indexOf('axis') !== -1) return 'Axis';
  if (combined.indexOf('sbi') !== -1 || combined.indexOf('state bank') !== -1) return 'SBI';
  if (combined.indexOf('kotak') !== -1) return 'Kotak';
  if (combined.indexOf('idfc') !== -1) return 'IDFC';
  if (combined.indexOf('indusind') !== -1) return 'IndusInd';
  if (combined.indexOf('yes bank') !== -1 || combined.indexOf('yesbank') !== -1) return 'Yes Bank';
  return 'Unknown';
}

// Backfill statements — run manually to process last 90 days of statement PDFs
function backfillStatements() {
  const label = GmailApp.getUserLabelByName(STATEMENT_LABEL) || GmailApp.createLabel(STATEMENT_LABEL);
  const query = 'has:attachment filename:pdf -label:' + STATEMENT_LABEL + ' newer_than:90d ' +
    '(subject:statement OR subject:e-statement OR subject:estatement OR subject:"monthly statement" OR subject:"account statement" OR subject:"card statement")';

  const threads = GmailApp.search(query, 0, 50);
  Logger.log('backfillStatements: found ' + threads.length + ' threads');

  // Reuse pollStatements logic but with a larger lookback — just run pollStatements after query change
  // For simplicity, mark as processed then call pollStatements scope inline
  let uploaded = 0, errored = 0;
  threads.forEach(function(thread) {
    var threadPdfs = 0, threadUploaded = 0, threadErrored = 0;
    thread.getMessages().forEach(function(msg) {
      const bank = detectStatementBank(msg.getSubject(), msg.getFrom());
      const attachments = msg.getAttachments({ includeInlineImages: false });
      attachments.forEach(function(att) {
        if (!att.getName().toLowerCase().endsWith('.pdf')) return;
        const pdfBytes = att.getBytes();
        const paid_by = STATEMENT_PAID_BY[bank] || PAID_BY_DEFAULT;
        threadPdfs++;
        Logger.log('Uploading: ' + att.getName() + ' (' + Math.round(pdfBytes.length / 1024) + ' KB) bank=' + bank);
        try {
          const resp = UrlFetchApp.fetch(WORKER_URL + '/api/statement-upload', {
            method: 'post', contentType: 'application/json',
            headers: { Authorization: 'Bearer ' + INGEST_TOKEN },
            payload: JSON.stringify({ bank: bank, pdf_base64: Utilities.base64Encode(pdfBytes), paid_by: paid_by, filename: att.getName() }),
            muteHttpExceptions: true,
          });
          var code = resp.getResponseCode();
          var body = resp.getContentText();
          try { var r = JSON.parse(body); Logger.log(att.getName() + ': ' + JSON.stringify(r)); } catch(je) { Logger.log(att.getName() + ': HTTP ' + code + ' - ' + body.slice(0, 300)); }
          if (code === 200) { uploaded++; threadUploaded++; } else { errored++; threadErrored++; }
        } catch(e) { Logger.log('Error: ' + e); errored++; threadErrored++; }
      });
    });
    if (threadPdfs > 0 && threadErrored === 0) thread.addLabel(label);
  });
  Logger.log('backfillStatements done. Uploaded: ' + uploaded + ', Errored: ' + errored);
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
