/**
 * Saham Pro — Telegram RSS news scanner (free MVP)
 * Google Apps Script > New project > paste this file.
 * Set Script Properties:
 * TELEGRAM_BOT_TOKEN = token from @BotFather
 * TELEGRAM_CHAT_ID = your chat/group ID
 * RSS_FEEDS = comma-separated RSS URLs from sources you trust
 *
 * This scanner sends RSS headlines, not verified stock signals.
 * Use only feeds you are permitted to access. Feed latency/coverage varies.
 */
function setupTrigger() {
  // Avoid duplicate triggers for this handler.
  ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === 'runNewsScan')
    .forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('runNewsScan').timeBased().everyMinutes(15).create();
}

function runNewsScan() {
  const props = PropertiesService.getScriptProperties();
  const token = props.getProperty('TELEGRAM_BOT_TOKEN');
  const chatId = props.getProperty('TELEGRAM_CHAT_ID');
  const feedsRaw = props.getProperty('RSS_FEEDS') || '';
  if (!token || !chatId || !feedsRaw) throw new Error('Set TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, RSS_FEEDS in Script Properties.');
  const feeds = feedsRaw.split(',').map(s => s.trim()).filter(Boolean);
  const cache = CacheService.getScriptCache();
  let sent = 0;
  feeds.forEach(url => {
    try {
      const response = UrlFetchApp.fetch(url, {muteHttpExceptions:true, followRedirects:true});
      if (response.getResponseCode() < 200 || response.getResponseCode() >= 300) return;
      const xml = XmlService.parse(response.getContentText());
      const root = xml.getRootElement();
      const channel = root.getChild('channel');
      let items = [];
      if (channel) {
        items = channel.getChildren('item').slice(0, 10).map(item => ({
          title: childText_(item, 'title'), link: childText_(item, 'link'),
          date: childText_(item, 'pubDate'), description: childText_(item, 'description')
        }));
      } else {
        const ns = root.getNamespace();
        const entries = root.getChildren('entry', ns);
        items = entries.slice(0, 10).map(entry => {
          const linkEl = entry.getChildren('link', ns).find(x => x.getAttribute('href'));
          return {title: childTextNs_(entry,'title',ns), link: linkEl ? linkEl.getAttribute('href').getValue() : '',
            date: childTextNs_(entry,'updated',ns) || childTextNs_(entry,'published',ns),
            description: childTextNs_(entry,'summary',ns)};
        });
      }
      items.forEach(item => {
        if (!item.title) return;
        const key = 'sp_' + Utilities.base64EncodeWebSafe((item.link || item.title).slice(0, 400)).slice(0, 180);
        if (cache.get(key)) return;
        const msg = '📰 SAHAM PRO — HEADLINE BARU\n' + item.title + '\n' +
          (item.date ? 'Tanggal: ' + item.date + '\n' : '') +
          (item.link ? item.link : '') + '\n\nCatatan: headline otomatis dari RSS; verifikasi sumber dan keterbukaan informasi sebelum mengambil keputusan.';
        const result = UrlFetchApp.fetch('https://api.telegram.org/bot' + token + '/sendMessage', {
          method:'post', contentType:'application/json',
          payload:JSON.stringify({chat_id:chatId, text:msg, disable_web_page_preview:false}),
          muteHttpExceptions:true
        });
        if (result.getResponseCode() >= 200 && result.getResponseCode() < 300) {
          cache.put(key, '1', 21600); sent++;
        } else {
          console.warn('Telegram API error: ' + result.getContentText());
        }
      });
    } catch (err) {
      console.warn('Feed error (' + url + '): ' + err.message);
    }
  });
  console.log('Saham Pro scanner finished. New headlines sent: ' + sent);
}

function childText_(el, name) {
  const child = el.getChild(name);
  return child ? child.getText() : '';
}
function childTextNs_(el, name, ns) {
  const child = el.getChild(name, ns);
  return child ? child.getText() : '';
}
