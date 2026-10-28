/**
 * Reply chips for the chat, from the shape of the partner's latest message.
 *
 * No model and nothing downloaded: a few word lists read what kind of
 * message just arrived (a greeting, "how are you", a when / where question,
 * a yes-or-no question, thanks, good night, a photo, and so on) and offer
 * two or three short answers in the same language and script they wrote
 * in: English, romanised Hindi or Bengali, Devanagari or Bengali script.
 * When the latest message is the viewer's own, or nothing is recognised,
 * there are no chips at all. Every chip only fills the input, so the
 * sender can edit it.
 */

export interface SuggestionMessage {
  senderId: string;
  content: string;
  mediaType?: 'image' | 'video' | 'audio' | 'file';
}

type Lang = 'en' | 'hi' | 'bn' | 'hi_deva' | 'bn_beng';
type Intent =
  | 'greeting' | 'howAreYou' | 'whatDoing' | 'eaten' | 'free' | 'meet'
  | 'yesNo' | 'when' | 'where'
  | 'thanks' | 'sorry' | 'compliment' | 'missYou' | 'laugh'
  | 'goodnight' | 'bye' | 'photo';

// The latin lists are romanised Hindi / Bengali; the script ones are the
// same intents written natively. "TIME" stands for the greeting of the hour.
// Hindi and Bengali chips avoid gendered verb forms (the sender may be anyone).
const REPLIES: Record<Lang, Record<Intent, string[]>> = {
  en: {
    greeting: ['Hey! 👋', 'TIME', "How's it going?"],
    howAreYou: ["I'm good, you?", 'All good here!', 'A bit tired 😅'],
    whatDoing: ['Nothing much, you?', 'Just relaxing', 'Talking to you 😄'],
    eaten: ['Just did! You?', 'Not yet 😅', 'About to'],
    free: ['Yes, free now!', 'A bit busy, later?', 'Free in a while'],
    meet: ["I'd love to!", 'Sounds good, when?', "Let's plan it 😊"],
    yesNo: ['Yes!', 'Not really', 'Maybe 😄'],
    when: ['Tonight?', 'This weekend?', 'Let me check'],
    where: ['Not far from you 😄', 'You tell me first', "Let's decide together"],
    thanks: ['Anytime 😊', "Don't mention it!"],
    sorry: ['No worries 😊', "It's okay!", 'All good'],
    compliment: ['Aww, thank you 😊', 'You made my day!', 'Says you 😄'],
    missYou: ['Miss you too 🥺', 'Aww 🥹', 'Same here'],
    laugh: ['😂😂', 'I know, right!', 'Glad you laughed 😄'],
    goodnight: ['Good night 🌙', 'Sweet dreams', 'Talk tomorrow!'],
    bye: ['Bye! 👋', 'Talk soon!', 'Take care'],
    photo: ['Love it! 😍', 'Where is this?', 'Looking great!'],
  },
  hi: {
    greeting: ['Hii! 👋', 'TIME', 'Kaise ho?'],
    howAreYou: ['Main theek, tum?', 'Sab badhiya!', 'Bas thoda tired 😅'],
    whatDoing: ['Kuch khaas nahi, tum?', 'Bas aise hi', 'Tumse baat 😄'],
    eaten: ['Abhi khaya! Tumne?', 'Abhi nahi 😅', 'Thodi der mein'],
    free: ['Haan, free hoon!', 'Thoda busy, baad mein?', 'Thodi der mein free'],
    meet: ['Zaroor!', 'Sahi hai, kab?', 'Plan karte hain 😊'],
    yesNo: ['Haan!', 'Nahi yaar', 'Shayad 😄'],
    when: ['Aaj raat?', 'Is weekend?', 'Thoda check kar loon?'],
    where: ['Tumhare paas hi 😄', 'Pehle tum batao', 'Saath mein decide karte hain'],
    thanks: ['Koi baat nahi 😊', 'Arre, isme kya!'],
    sorry: ['Koi baat nahi 😊', 'Arre, theek hai!', 'Sab theek hai'],
    compliment: ['Aww, thank you 😊', 'Din bana diya!', 'Tum bhi 😄'],
    missYou: ['Mujhe bhi 🥺', 'Aww 🥹', 'Same here'],
    laugh: ['😂😂', 'Haina!', 'Hasa diya na 😄'],
    goodnight: ['Good night 🌙', 'Sweet dreams', 'Kal baat karte hain!'],
    bye: ['Bye! 👋', 'Phir baat karte hain!', 'Apna khayal rakhna'],
    photo: ['Wah! 😍', 'Ye kahan hai?', 'Bahut badhiya!'],
  },
  bn: {
    greeting: ['Hii! 👋', 'TIME', 'Kemon acho?'],
    howAreYou: ['Bhalo achi, tumi?', 'Sob bhalo!', 'Ektu tired 😅'],
    whatDoing: ['Temon kichu na, tumi?', 'Emni boshe achi', 'Tomar sathe kotha 😄'],
    eaten: ['Ekhuni khelam! Tumi?', 'Ekhono na 😅', 'Ektu pore khabo'],
    free: ['Hyan, free achi!', 'Ektu busy, pore?', 'Ektu pore free'],
    meet: ['Obosshoi!', 'Darun, kobe?', 'Plan kori 😊'],
    yesNo: ['Hyan!', 'Na re', 'Hoyto 😄'],
    when: ['Aaj raate?', 'Ei weekend e?', 'Ektu dekhe boli?'],
    where: ['Tomar kachei 😄', 'Tumi age bolo', 'Eksathe thik kori'],
    thanks: ['Kichu na 😊', 'Are, e ar emon ki!'],
    sorry: ['Kichu na 😊', 'Are, thik ache!', 'Sob thik ache'],
    compliment: ['Aww, thank you 😊', 'Din ta bhalo kore dile!', 'Tumi o 😄'],
    missYou: ['Amaro 🥺', 'Aww 🥹', 'Ekhane o tai'],
    laugh: ['😂😂', 'Tai na!', 'Hasiye dilam 😄'],
    goodnight: ['Good night 🌙', 'Bhalo ghumao', 'Kal kotha hobe!'],
    bye: ['Bye! 👋', 'Pore kotha hobe!', 'Bhalo theko'],
    photo: ['Bah! 😍', 'Eta kothay?', 'Darun!'],
  },
  hi_deva: {
    greeting: ['हाय! 👋', 'TIME', 'कैसे हो?'],
    howAreYou: ['मैं ठीक हूँ, तुम?', 'सब बढ़िया!', 'बस थोड़ा थका हुआ 😅'],
    whatDoing: ['कुछ ख़ास नहीं, तुम?', 'बस ऐसे ही', 'तुमसे बात 😄'],
    eaten: ['अभी खाया! तुमने?', 'अभी नहीं 😅', 'थोड़ी देर में'],
    free: ['हाँ, फ्री हूँ!', 'थोड़ा बिज़ी, बाद में?', 'थोड़ी देर में फ्री'],
    meet: ['ज़रूर!', 'सही है, कब?', 'प्लान करते हैं 😊'],
    yesNo: ['हाँ!', 'नहीं यार', 'शायद 😄'],
    when: ['आज रात?', 'इस वीकेंड?', 'थोड़ा चेक कर लूँ?'],
    where: ['तुम्हारे पास ही 😄', 'पहले तुम बताओ', 'साथ में तय करते हैं'],
    thanks: ['कोई बात नहीं 😊', 'अरे, इसमें क्या!'],
    sorry: ['कोई बात नहीं 😊', 'अरे, ठीक है!', 'सब ठीक है'],
    compliment: ['अरे, थैंक यू 😊', 'दिन बना दिया!', 'तुम भी 😄'],
    missYou: ['मुझे भी 🥺', 'अरे 🥹', 'यहाँ भी वही'],
    laugh: ['😂😂', 'है ना!', 'हँसा दिया ना 😄'],
    goodnight: ['शुभ रात्रि 🌙', 'अच्छे सपने', 'कल बात करते हैं!'],
    bye: ['बाय! 👋', 'फिर बात करते हैं!', 'अपना ख़याल रखना'],
    photo: ['वाह! 😍', 'ये कहाँ है?', 'बहुत बढ़िया!'],
  },
  bn_beng: {
    greeting: ['হাই! 👋', 'TIME', 'কেমন আছো?'],
    howAreYou: ['ভালো আছি, তুমি?', 'সব ভালো!', 'একটু ক্লান্ত 😅'],
    whatDoing: ['তেমন কিছু না, তুমি?', 'এমনি বসে আছি', 'তোমার সাথে কথা 😄'],
    eaten: ['এইমাত্র খেলাম! তুমি?', 'এখনো না 😅', 'একটু পরে খাবো'],
    free: ['হ্যাঁ, ফ্রি আছি!', 'একটু ব্যস্ত, পরে?', 'একটু পরে ফ্রি'],
    meet: ['অবশ্যই!', 'দারুণ, কবে?', 'প্ল্যান করি 😊'],
    yesNo: ['হ্যাঁ!', 'না রে', 'হয়তো 😄'],
    when: ['আজ রাতে?', 'এই উইকেন্ডে?', 'একটু দেখে বলি?'],
    where: ['তোমার কাছেই 😄', 'তুমি আগে বলো', 'একসাথে ঠিক করি'],
    thanks: ['কিছু না 😊', 'আরে, এ আর এমন কী!'],
    sorry: ['কিছু না 😊', 'আরে, ঠিক আছে!', 'সব ঠিক আছে'],
    compliment: ['আরে, থ্যাংক ইউ 😊', 'দিনটা ভালো করে দিলে!', 'তুমিও 😄'],
    missYou: ['আমারও 🥺', 'আরে 🥹', 'এখানেও তাই'],
    laugh: ['😂😂', 'তাই না!', 'হাসিয়ে দিলাম 😄'],
    goodnight: ['শুভ রাত্রি 🌙', 'ভালো ঘুমাও', 'কাল কথা হবে!'],
    bye: ['বাই! 👋', 'পরে কথা হবে!', 'ভালো থেকো'],
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
  /\b(kya|kaise|kaisi|kab|kahan|kaha|kidhar|kyun|kyu|hai|hain|ho|hoon|haan|nahi|nahin|theek|thik|kaun|tum|tumhe|tumhara|tumhari|tumne|aap|acha|achha|accha|yaar|batao|karo|raha|rahi|rahe|rha|rhi|mujhe|mera|meri|kuch|bahut|bohot|bhi|toh|matlab|namaste|namaskar|ji|shukriya|dhanyavad|dhanyawad|shubh|maaf|maf|yaad|pyari|pyare|sundar|khubsurat|khana|khaya|milte|milna|miloge|milogi|chalo|chalta|chalti|khayal)\b/g;
const BENGALI_WORDS =
  /\b(kemon|kobe|kokhon|kothay|kothai|keno|achho|acho|aso|achi|bhalo|tumi|tomar|apni|ache|achhe|hoy|hobe|korbo|korcho|korchho|korchi|dekho|khub|ektu|amar|ami|ekhon|kichu|bolo|naki|darun|nomoskar|nomoshkar|dhonnobad|dhonyobad|ghumao|dukkhito|dukhito|mone|porche|porchhe|misti|sundor|kheyecho|kheyechho|khawa|dekha|kori|cholo|theko|ashi|asi|tahole|tomake|amake|byasto|emni)\b/g;

function detectLang(text: string): Lang {
  if (BENGALI_SCRIPT.test(text)) return 'bn_beng';
  if (DEVANAGARI_SCRIPT.test(text)) return 'hi_deva';
  const hi = (text.match(HINDI_WORDS) || []).length;
  const bn = (text.match(BENGALI_WORDS) || []).length;
  if (hi === 0 && bn === 0) return 'en';
  return bn > hi ? 'bn' : 'hi';
}

// ─── Intent ──────────────────────────────────────────────

const WHEN = /\b(when|what time|kab|kitne baje|kobe|kokhon|koto ?ta|kota baje)\b|कब|कितने बजे|কবে|কখন|কটায়|কটা বাজে/;
const WHERE = /\b(where|kahan|kaha|kidhar|kothay|kothai|kon jaygay)\b|कहाँ|कहां|किधर|কোথায়|কোথা|কই/;
const GOODNIGHT =
  /\b(good ?night|gn|gnight|sweet dreams|shubh ratri|so jao|so ja|ghumao|ghumiye poro|ghumate jai|sone ja raha|sone ja rahi)\b|शुभ रात्रि|सो जाओ|गुड नाइट|सोने जा|শুভ রাত্রি|ঘুমাও|গুড নাইট|ঘুমাতে যাই/;
const BYE =
  /\b(bye+|bbye|byee+|tata|ttyl|talk (to you )?later|gtg|got to go|gotta go|chalta hoon|chalti hoon|chalta hu|chalti hu|phir milte hain|phir baat karte hain|baad mein baat|pore kotha hobe|pore kotha hocche|ashi|asi re|asi tahole|gelam)\b|बाय|फिर मिलते हैं|फिर बात करते|चलता हूँ|चलती हूँ|বাই|পরে কথা হবে|আসি|টাটা/;
const THANKS =
  /\b(thank you|thanks|thanx|thnx|thx|ty|tysm|shukriya|dhanyavad|dhanyawad|dhonnobad|dhonyobad)\b|धन्यवाद|शुक्रिया|थैंक्स|थैंक यू|ধন্যবাদ|থ্যাংকস|থ্যাঙ্ক ইউ|থ্যাংক ইউ/;
const SORRY =
  /\b(sorry|sry|srry|my bad|apologies|maaf|maf|maafi|galti ho gayi|dukkhito|dukhito|khoma)\b|सॉरी|माफ़|माफ|क्षमा|गलती हो गई|সরি|দুঃখিত|ক্ষমা|মাফ/;
const HOW_ARE_YOU =
  /\b(how are you|how r u|how are u|how r you|hru|how'?s it going|how is it going|how have you been|how'?s everything|what'?s up|whats up|wassup|wsp|sup|kaise ho|kaisi ho|kaise hain|kaise hai|kya haal|kya chal raha|sab theek|sab thik|kemon acho|kemon achho|kemon aso|kemon achen|ki khobor|ki khbr|ki obostha|kemon cholche|sob bhalo)\b|कैसे हो|कैसी हो|कैसे हैं|क्या हाल|क्या चल रहा|सब ठीक|কেমন আছো|কেমন আছ|কেমন আছেন|কি খবর|কী খবর|কেমন চলছে|সব ভালো তো/;
const WHAT_DOING =
  /\b(what are you doing|what r u doing|what are u doing|what you doing|whatcha doing|wyd|what are you up to|what r u up to|what you up to|kya kar rahe|kya kar rahi|kya kar rha|kya kar rhi|kya kr rhe|kya kr rhi|ki korcho|ki korchho|ki korchis|ki koro|ki korchen)\b|क्या कर रहे|क्या कर रही|কি করছো|কী করছো|কি করছ|কী করছ|কি করছেন|কি করো/;
const EATEN =
  /\b(have you eaten|had (your |ur )?(lunch|dinner|breakfast|food)|did you eat|(lunch|dinner|breakfast) (done|kiya|ho gaya|hua|korecho|hoyeche|hoye geche)|khana khaya|khana kha liya|kha liya|khaya kya|khaya|kheyecho|kheyechho|kheyechis|khawa hoyeche|khawa holo|kheye niyecho)\b|खाना खाया|खा लिया|खाया क्या|खाया|খেয়েছো|খেয়েছ|খেয়েছিস|খাওয়া হয়েছে|খেয়ে নিয়েছো/;
const FREE =
  /\b(are you free|r u free|you free|u free|free ho|free hai|free ho kya|busy ho|busy hai|busy ho kya|are you busy|r u busy|you busy|u busy|free acho|free achho|busy acho|busy achho|byasto)\b|फ्री हो|बिज़ी हो|व्यस्त हो|खाली हो|ফ্রি আছো|ফ্রি আছ|বিজি আছো|ব্যস্ত/;
const MEET =
  /\b(let'?s meet|lets meet|wanna meet|want to meet|meet up|meet for|meet sometime|grab (a )?(coffee|drink|dinner|lunch)|go out|hang ?out|catch up|coffee|date|milte hain|milna hai|milna chahte|milna chahti|milogi|miloge|milein|coffee pe|dekha kori|dekha korbo|dekha korbe|dekha korte|ghurte jabe|ghumne chalein|ghumne chale)\b|मिलते हैं|मिलना है|मिलोगी|मिलोगे|मिलें|कॉफ़ी|कॉफी|घूमने चलें|দেখা করি|দেখা করবে|দেখা করবো|ঘুরতে যাবে|কফি/;
const LETS = /\b(let'?s|lets|chalo|chalein|cholo|chol)\b|चलो|चलें|চলো|চল/;
const MISS_YOU =
  /\b(miss you|missing you|miss u|missed you|yaad aa rahi|yaad aa raha|yaad aati|yaad aate|mone porche|mone porchhe|mone pore|miss korchi)\b|याद आ रह|याद आती|याद आते|মনে পড়ছে|মিস করছি/;
const LAUGH = /\b(ha(ha)+|he(he)+|lo+l|lmao|rofl)\b|😂|🤣|😆|हाहा|হাহা/;
// A compliment about them, not about a place or a thing: "you look / you're
// + adjective", an adjective about a pic, smile or eyes, or the usual Hindi
// / Bengali forms. A lone adjective counts too (see detectIntent).
const ADJ = '(cute|pretty|beautiful|gorgeous|handsome|stunning|lovely|adorable|hot|sweet|charming|sundar|pyari|pyare|khubsurat|sundor|misti)';
const COMPLIMENT = new RegExp(
  `\\b(you|u|ur|you'?re|youre|u r|you are|you look|u look|looking|lagti|lagte|lagta|lagti ho|lag rahi|lag rahe|lagcho|lagchho|lagche)( so| very| really| too| sooo+| bahut| bohot| khub| kitni| kitne| ki)? ${ADJ}\\b` +
    `|\\b(nice|lovely|cute|pretty|beautiful|gorgeous|stunning|killer) (pic|photo|dp|smile|eyes|look)\\b` +
    `|\\b(kitni|kitne|bahut|bohot|khub|ki) ${ADJ}\\b` +
    '|बहुत (सुंदर|प्यारी|प्यारे|खूबसूरत|क्यूट)|कितनी (प्यारी|सुंदर|क्यूट)|कितने (प्यारे|हैंडसम|क्यूट)|खूबसूरत लग|सुंदर लग|प्यारी लग' +
    '|খুব (সুন্দর|মিষ্টি|কিউট)|কি (মিষ্টি|সুন্দর|কিউট)|কী (মিষ্টি|সুন্দর|কিউট)|দারুণ (লাগছো|লাগছ|দেখাচ্ছে)|সুন্দর (লাগছো|লাগছ|দেখাচ্ছে)',
);
const LONE_ADJ = new RegExp(`^(so |very |really |too |sooo+ |bahut |bohot |khub |kitni |kitne |ki )?${ADJ}$`);
const GREETING =
  /^(hi+|hii+|hey+|heyy+|hello+|helo|hlo|hola|yo|namaste|namaskar|nomoskar|nomoshkar|good (morning|afternoon|evening)|gm|morning|नमस्ते|नमस्कार|हैलो|हेलो|हाय|सुप्रभात|शुभ प्रभात|गुड मॉर्निंग|নমস্কার|হ্যালো|হাই|সুপ্রভাত|শুভ সকাল|শুভ সন্ধ্যা|গুড মর্নিং)( (there|dear|ji|bhai|re|everyone|jaan|ভাই|জি|जी|भाई))?$/;
// A yes-or-no question: an English auxiliary opens it, or a tag closes it
// ("na?", "right?", "naki?", Bengali's sentence-final "ki?")
const YES_NO_OPENER = /^(do|does|did|are|is|am|can|could|will|would|shall|should|have|has|had|were|was|wanna|r u|u)\b/;
const YES_NO_TAG = /\b(na|right|naki|ki|toh|to|hai na|hain na|tai na|tai to)\s*\?$|(ना|है ना|क्या|तो)\s*\?$|(কি|না|নাকি|তাই না|তাই তো)\s*\?$/;

// Punctuation and emoji, so "Hiii!! 😊" reads as a greeting
const DECORATION = /[!?.,…~'"`*_()[\]\-–—]|[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}]/gu;

function detectIntent(raw: string): Intent | null {
  const text = raw.toLowerCase().replace(/\s+/g, ' ').trim();
  if (!text) return null;
  const bare = text.replace(DECORATION, ' ').replace(/\s+/g, ' ').trim();
  const words = bare ? bare.split(' ').length : 0;
  // A question word counts as a question with a "?" or in a short message
  // ("tum kab free ho"), not inside a longer statement
  const asksSomething = text.includes('?') || words <= 4;

  // Partings and thanks first, then the questions they might be asking,
  // then reactions (a laugh or a sorry alongside a question yields to it)
  if (GOODNIGHT.test(text)) return 'goodnight';
  if (BYE.test(text)) return 'bye';
  if (THANKS.test(text)) return 'thanks';
  if (HOW_ARE_YOU.test(text)) return 'howAreYou';
  if (WHAT_DOING.test(text)) return 'whatDoing';
  if (asksSomething && EATEN.test(text)) return 'eaten';
  if (MISS_YOU.test(text)) return 'missYou';
  if (COMPLIMENT.test(text) || (words <= 3 && LONE_ADJ.test(bare))) return 'compliment';
  if (words <= 4 && GREETING.test(bare)) return 'greeting';
  if (asksSomething && WHEN.test(text)) return 'when';
  if (asksSomething && WHERE.test(text)) return 'where';
  if ((asksSomething || LETS.test(text)) && MEET.test(text)) return 'meet';
  if (asksSomething && FREE.test(text)) return 'free';
  if (text.endsWith('?') && (YES_NO_OPENER.test(text) || YES_NO_TAG.test(text))) return 'yesNo';
  if (SORRY.test(text)) return 'sorry';
  if (LAUGH.test(text)) return 'laugh';
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
