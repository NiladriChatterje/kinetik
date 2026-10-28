/**
 * Reply chips for the chat, from the shape of the partner's latest message.
 *
 * No model and nothing downloaded: a few word lists read what kind of
 * message just arrived (a greeting, "how are you", a when / where question,
 * a yes-or-no question, thanks, good night, a photo) and offer two or three
 * short answers in the same language and script they wrote in: English,
 * romanised Hindi or Bengali, Devanagari or Bengali script. When the latest
 * message is the viewer's own, or nothing is recognised, there are no chips
 * at all. Every chip only fills the input, so the sender can edit it.
 */

export interface SuggestionMessage {
  senderId: string;
  content: string;
  mediaType?: 'image' | 'video' | 'audio' | 'file';
}

type Lang = 'en' | 'hi' | 'bn' | 'hi_deva' | 'bn_beng';
type Intent = 'greeting' | 'howAreYou' | 'yesNo' | 'when' | 'where' | 'thanks' | 'goodnight' | 'photo';

// The latin lists are romanised Hindi / Bengali; the script ones are the
// same intents written natively. "TIME" stands for the greeting of the hour.
const REPLIES: Record<Lang, Record<Intent, string[]>> = {
  en: {
    greeting: ['Hey! 👋', 'TIME', "How's it going?"],
    howAreYou: ["I'm good, you?", 'All good here!', 'A bit tired 😅'],
    yesNo: ['Yes!', 'Not really', 'Maybe 😄'],
    when: ['Tonight?', 'This weekend?', 'Let me check'],
    where: ['Not far from you 😄', 'You tell me first', "Let's decide together"],
    thanks: ['Anytime 😊', "Don't mention it!"],
    goodnight: ['Good night 🌙', 'Sweet dreams', 'Talk tomorrow!'],
    photo: ['Love it! 😍', 'Where is this?', 'Looking great!'],
  },
  hi: {
    greeting: ['Hii! 👋', 'TIME', 'Kaise ho?'],
    howAreYou: ['Main theek, tum?', 'Sab badhiya!', 'Bas thoda tired 😅'],
    yesNo: ['Haan!', 'Nahi yaar', 'Shayad 😄'],
    when: ['Aaj raat?', 'Is weekend?', 'Thoda check kar loon?'],
    where: ['Tumhare paas hi 😄', 'Pehle tum batao', 'Saath mein decide karte hain'],
    thanks: ['Koi baat nahi 😊', 'Arre, isme kya!'],
    goodnight: ['Good night 🌙', 'Sweet dreams', 'Kal baat karte hain!'],
    photo: ['Wah! 😍', 'Ye kahan hai?', 'Bahut badhiya!'],
  },
  bn: {
    greeting: ['Hii! 👋', 'TIME', 'Kemon acho?'],
    howAreYou: ['Bhalo achi, tumi?', 'Sob bhalo!', 'Ektu tired 😅'],
    yesNo: ['Hyan!', 'Na re', 'Hoyto 😄'],
    when: ['Aaj raate?', 'Ei weekend e?', 'Ektu dekhe boli?'],
    where: ['Tomar kachei 😄', 'Tumi age bolo', 'Eksathe thik kori'],
    thanks: ['Kichu na 😊', 'Are, e ar emon ki!'],
    goodnight: ['Good night 🌙', 'Bhalo ghumao', 'Kal kotha hobe!'],
    photo: ['Bah! 😍', 'Eta kothay?', 'Darun!'],
  },
  hi_deva: {
    greeting: ['हाय! 👋', 'TIME', 'कैसे हो?'],
    howAreYou: ['मैं ठीक हूँ, तुम?', 'सब बढ़िया!', 'बस थोड़ा थका हुआ 😅'],
    yesNo: ['हाँ!', 'नहीं यार', 'शायद 😄'],
    when: ['आज रात?', 'इस वीकेंड?', 'थोड़ा चेक कर लूँ?'],
    where: ['तुम्हारे पास ही 😄', 'पहले तुम बताओ', 'साथ में तय करते हैं'],
    thanks: ['कोई बात नहीं 😊', 'अरे, इसमें क्या!'],
    goodnight: ['शुभ रात्रि 🌙', 'अच्छे सपने', 'कल बात करते हैं!'],
    photo: ['वाह! 😍', 'ये कहाँ है?', 'बहुत बढ़िया!'],
  },
  bn_beng: {
    greeting: ['হাই! 👋', 'TIME', 'কেমন আছো?'],
    howAreYou: ['ভালো আছি, তুমি?', 'সব ভালো!', 'একটু ক্লান্ত 😅'],
    yesNo: ['হ্যাঁ!', 'না রে', 'হয়তো 😄'],
    when: ['আজ রাতে?', 'এই উইকেন্ডে?', 'একটু দেখে বলি?'],
    where: ['তোমার কাছেই 😄', 'তুমি আগে বলো', 'একসাথে ঠিক করি'],
    thanks: ['কিছু না 😊', 'আরে, এ আর এমন কী!'],
    goodnight: ['শুভ রাত্রি 🌙', 'ভালো ঘুমাও', 'কাল কথা হবে!'],
    photo: ['বাহ! 😍', 'এটা কোথায়?', 'দারুণ!'],
  },
};

// Greeting of the hour; null late at night (then the chip is left out)
const TIME_GREETING: Record<Lang, [string, string, string] | null> = {
  en: ['Good morning!', 'Good afternoon!', 'Good evening!'],
  hi: ['Good morning!', 'Good afternoon!', 'Good evening!'],
  bn: ['Good morning!', 'Good afternoon!', 'Good evening!'],
  hi_deva: ['सुप्रभात!', 'शुभ दोपहर!', 'शुभ संध्या!'],
  bn_beng: ['সুপ্রভাত!', 'শুভ দুপুর!', 'শুভ সন্ধ্যা!'],
};

// ─── Language ────────────────────────────────────────────

const BENGALI_SCRIPT = /[ঀ-৿]/;
const DEVANAGARI_SCRIPT = /[ऀ-ॿ]/;
// Common romanised words; whichever language has more of them wins
const HINDI_WORDS =
  /\b(kya|kaise|kaisi|kab|kahan|kaha|kidhar|kyun|kyu|hai|hain|ho|haan|nahi|nahin|theek|thik|kaun|tum|tumhe|tumhara|tumhari|aap|acha|achha|accha|yaar|batao|karo|raha|rahi|rahe|mujhe|mera|meri|kuch|bahut|bhi|toh|matlab|namaste|namaskar|ji|shukriya|dhanyavad|dhanyawad|shubh)\b/g;
const BENGALI_WORDS =
  /\b(kemon|kobe|kokhon|kothay|kothai|keno|achho|acho|aso|achi|bhalo|tumi|tomar|apni|ache|achhe|hoy|hobe|korbo|korcho|korchho|korchi|dekho|khub|ektu|amar|ami|ekhon|kichu|bolo|naki|darun|nomoskar|nomoshkar|dhonnobad|dhonyobad|ghumao)\b/g;

function detectLang(text: string): Lang {
  if (BENGALI_SCRIPT.test(text)) return 'bn_beng';
  if (DEVANAGARI_SCRIPT.test(text)) return 'hi_deva';
  const hi = (text.match(HINDI_WORDS) || []).length;
  const bn = (text.match(BENGALI_WORDS) || []).length;
  if (hi === 0 && bn === 0) return 'en';
  return bn > hi ? 'bn' : 'hi';
}

// ─── Intent ──────────────────────────────────────────────

const GOODNIGHT =
  /\b(good ?night|gn|gnight|sweet dreams|shubh ratri|so jao|so ja|ghumao|ghumiye poro|ghumate jai|sone ja raha|sone ja rahi)\b|शुभ रात्रि|सो जाओ|गुड नाइट|सोने जा|শুভ রাত্রি|ঘুমাও|গুড নাইট|ঘুমাতে যাই/;
const THANKS =
  /\b(thank you|thanks|thanx|thnx|thx|ty|tysm|shukriya|dhanyavad|dhanyawad|dhonnobad|dhonyobad)\b|धन्यवाद|शुक्रिया|थैंक्स|थैंक यू|ধন্যবাদ|থ্যাংকস|থ্যাঙ্ক ইউ|থ্যাংক ইউ/;
const HOW_ARE_YOU =
  /\b(how are you|how r u|how are u|how r you|hru|how'?s it going|how is it going|how have you been|how'?s everything|what'?s up|whats up|wassup|wsp|sup|kaise ho|kaisi ho|kaise hain|kaise hai|kya haal|kya chal raha|sab theek|sab thik|kemon acho|kemon achho|kemon aso|kemon achen|ki khobor|ki khbr|ki obostha|kemon cholche|sob bhalo)\b|कैसे हो|कैसी हो|कैसे हैं|क्या हाल|क्या चल रहा|सब ठीक|কেমন আছো|কেমন আছ|কেমন আছেন|কি খবর|কী খবর|কেমন চলছে|সব ভালো তো/;
const WHEN = /\b(when|what time|kab|kitne baje|kobe|kokhon|koto ?ta|kota baje)\b|कब|कितने बजे|কবে|কখন|কটায়|কটা বাজে/;
const WHERE = /\b(where|kahan|kaha|kidhar|kothay|kothai|kon jaygay)\b|कहाँ|कहां|किधर|কোথায়|কোথা|কই/;
// A yes-or-no question: an English auxiliary opens it, or a tag closes it
// ("na?", "right?", "naki?", Bengali's sentence-final "ki?")
const YES_NO_OPENER = /^(do|does|did|are|is|am|can|could|will|would|shall|should|have|has|had|were|was|wanna|r u|u)\b/;
const YES_NO_TAG = /\b(na|right|naki|ki|toh|to|hai na|hain na|tai na|tai to)\s*\?$|(ना|है ना|क्या|तो)\s*\?$|(কি|না|নাকি|তাই না|তাই তো)\s*\?$/;
const GREETING =
  /^(hi+|hii+|hey+|heyy+|hello+|helo|hlo|hola|yo|namaste|namaskar|nomoskar|nomoshkar|good (morning|afternoon|evening)|gm|morning|नमस्ते|नमस्कार|हैलो|हेलो|हाय|सुप्रभात|शुभ प्रभात|गुड मॉर्निंग|নমস্কার|হ্যালো|হাই|সুপ্রভাত|শুভ সকাল|শুভ সন্ধ্যা|গুড মর্নিং)( (there|dear|ji|bhai|re|everyone|jaan|ভাই|জি|जी|भाई))?$/;

// Punctuation and emoji, so "Hiii!! 😊" reads as a greeting
const DECORATION = /[!?.,…~'"`*_()[\]\-–—]|[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}]/gu;

function detectIntent(raw: string): Intent | null {
  const text = raw.toLowerCase().replace(/\s+/g, ' ').trim();
  if (!text) return null;
  const bare = text.replace(DECORATION, ' ').replace(/\s+/g, ' ').trim();
  const words = bare ? bare.split(' ').length : 0;
  // A when / where word counts as a question with a "?" or in a short
  // message ("tum kab free ho"), not inside a longer statement
  const asksSomething = text.includes('?') || words <= 4;

  if (GOODNIGHT.test(text)) return 'goodnight';
  if (THANKS.test(text)) return 'thanks';
  if (HOW_ARE_YOU.test(text)) return 'howAreYou';
  if (words <= 4 && GREETING.test(bare)) return 'greeting';
  if (asksSomething && WHEN.test(text)) return 'when';
  if (asksSomething && WHERE.test(text)) return 'where';
  if (text.endsWith('?') && (YES_NO_OPENER.test(text) || YES_NO_TAG.test(text))) return 'yesNo';
  return null;
}

// ─── Chips ───────────────────────────────────────────────

function chips(lang: Lang, intent: Intent, now: Date): string[] {
  const hour = now.getHours();
  const slot = hour >= 5 && hour < 12 ? 0 : hour >= 12 && hour < 17 ? 1 : hour >= 17 && hour < 22 ? 2 : null;
  const greetings = TIME_GREETING[lang];
  const timeGreeting = slot !== null && greetings ? greetings[slot] : null;
  const out: string[] = [];
  for (const chip of REPLIES[lang][intent]) {
    if (chip !== 'TIME') out.push(chip);
    else if (timeGreeting) out.push(timeGreeting);
  }
  return out;
}

/**
 * Chips for the chat's input, or none. `messages` is the chat in order,
 * oldest first; `myId` is the viewer.
 */
export function suggestReplies(messages: SuggestionMessage[], myId: string | undefined, now = new Date()): string[] {
  const last = messages[messages.length - 1];
  if (!last || !myId || last.senderId === myId) return [];

  if (last.mediaType === 'image' || last.mediaType === 'video') {
    // Match the language of their most recent words
    let lang: Lang = 'en';
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m.senderId !== myId && !m.mediaType && m.content.trim()) {
        lang = detectLang(m.content.toLowerCase());
        break;
      }
    }
    return chips(lang, 'photo', now);
  }
  if (last.mediaType) return [];

  const intent = detectIntent(last.content);
  if (!intent) return [];
  return chips(detectLang(last.content.toLowerCase()), intent, now);
}
