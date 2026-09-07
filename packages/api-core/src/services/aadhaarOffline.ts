/**
 * Aadhaar Paperless Offline e-KYC verification.
 *
 * The user downloads a zip from myAadhaar protected by a 4-digit share code
 * they choose. Inside is one XML document signed by UIDAI. Nothing here talks
 * to UIDAI: we check UIDAI's signature with their published certificate, read
 * the few fields we need, and hand them back. The caller decides what to keep.
 *
 * What is returned: name, date of birth, gender, the JPEG photo, and a stable
 * hash for "one Aadhaar, one account". The Aadhaar number is never present in
 * the file (only the last four digits inside referenceId) and is never stored.
 *
 * Certificate: UIDAI rotates it every few years. Drop the current
 * `uidai_offline_publickey_*.cer` from the UIDAI website into
 * packages/api-core/certs/uidai_offline_publickey.cer (DER or PEM), or point
 * UIDAI_OFFLINE_CERT_PATH at it. Without the file the feature reports itself
 * as unavailable and the app hides the option.
 */
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import AdmZip from 'adm-zip';
import { DOMParser, type Document, type Node } from '@xmldom/xmldom';
import { SignedXml } from 'xml-crypto';

const DEFAULT_CERT_PATH = path.resolve(__dirname, '..', '..', 'certs', 'uidai_offline_publickey.cer');
const CERT_PATH = process.env.UIDAI_OFFLINE_CERT_PATH || DEFAULT_CERT_PATH;
const XMLDSIG_NS = 'http://www.w3.org/2000/09/xmldsig#';
const C14N = 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315';

export type AadhaarOfflineErrorCode =
  | 'NOT_CONFIGURED'
  | 'INVALID_ZIP'
  | 'WRONG_SHARE_CODE'
  | 'MALFORMED_XML'
  | 'INVALID_SIGNATURE';

export class AadhaarOfflineError extends Error {
  constructor(public code: AadhaarOfflineErrorCode, message: string) {
    super(message);
  }
}

export interface AadhaarOfflineResult {
  name: string;
  /** ISO date YYYY-MM-DD */
  dateOfBirth: string;
  gender: string;
  /** Base64 JPEG from the <Pht> element, or null if the file had none */
  photoBase64: string | null;
  /** sha256 over normalised name, dob, gender and the last four digits. */
  identityHash: string;
}

let cachedCertPem: string | null | undefined;

function loadCertPem(): string | null {
  if (cachedCertPem !== undefined) return cachedCertPem;
  try {
    const raw = fs.readFileSync(CERT_PATH);
    const text = raw.toString('utf8');
    if (text.includes('-----BEGIN CERTIFICATE-----')) {
      cachedCertPem = text;
    } else {
      // DER: wrap as PEM
      const b64 = raw.toString('base64').replace(/(.{64})/g, '$1\n');
      cachedCertPem = `-----BEGIN CERTIFICATE-----\n${b64}\n-----END CERTIFICATE-----\n`;
    }
  } catch {
    cachedCertPem = null;
  }
  return cachedCertPem;
}

export function isAadhaarOfflineConfigured(): boolean {
  return loadCertPem() !== null;
}

function extractXml(zipBuffer: Buffer, shareCode: string): string {
  let zip: AdmZip;
  try {
    zip = new AdmZip(zipBuffer);
  } catch {
    throw new AadhaarOfflineError('INVALID_ZIP', 'That file is not a valid Aadhaar offline e-KYC zip.');
  }
  const entry = zip.getEntries().find((e) => !e.isDirectory && e.entryName.toLowerCase().endsWith('.xml'));
  if (!entry) {
    throw new AadhaarOfflineError('INVALID_ZIP', 'No XML document found inside the zip.');
  }
  let data: Buffer | undefined;
  try {
    // @types/adm-zip omits the password overload that adm-zip 0.5 supports.
    data = (entry as any).getData(shareCode) as Buffer | undefined;
  } catch {
    data = undefined;
  }
  if (!data || data.length === 0) {
    throw new AadhaarOfflineError('WRONG_SHARE_CODE', 'The share code does not open this file.');
  }
  const xml = data.toString('utf8');
  if (!xml.includes('OfflinePaperlessKyc')) {
    throw new AadhaarOfflineError('WRONG_SHARE_CODE', 'The share code does not open this file.');
  }
  return xml;
}

function verifySignature(xml: string, doc: Document, certPem: string): void {
  const sigNodes = doc.getElementsByTagNameNS(XMLDSIG_NS, 'Signature');
  if (sigNodes.length !== 1) {
    throw new AadhaarOfflineError('INVALID_SIGNATURE', 'The document is not signed.');
  }
  let ok = false;
  try {
    const sig = new SignedXml({
      publicCert: certPem,
      // UIDAI signs with Java's XML DSig: the Reference carries only the
      // enveloped-signature transform and canonicalisation is implied.
      // xml-crypto needs that implied step spelled out or every real file
      // fails its digest check.
      implicitTransforms: [C14N],
    });
    sig.loadSignature(sigNodes[0] as Node);
    ok = sig.checkSignature(xml);
  } catch (err: any) {
    // Left in the log on purpose: a sudden run of these after years of quiet
    // almost always means UIDAI rotated the certificate.
    console.warn(`[aadhaar] signature check error: ${err?.message || err}`);
    ok = false;
  }
  if (!ok) {
    throw new AadhaarOfflineError(
      'INVALID_SIGNATURE',
      'UIDAI signature check failed. Download a fresh file from myAadhaar and try again.',
    );
  }
}

function toIsoDate(dob: string): string | null {
  // UIDAI writes DD-MM-YYYY; older files used DD/MM/YYYY; some carry YYYY-MM-DD.
  let m = dob.match(/^(\d{2})[-/](\d{2})[-/](\d{4})$/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  m = dob.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return dob;
  return null;
}

export function ageOn(isoDate: string, today = new Date()): number {
  const [y, mo, d] = isoDate.split('-').map(Number);
  let age = today.getUTCFullYear() - y;
  const birthdayPassed =
    today.getUTCMonth() + 1 > mo || (today.getUTCMonth() + 1 === mo && today.getUTCDate() >= d);
  if (!birthdayPassed) age -= 1;
  return age;
}

export function verifyOfflineEkyc(zipBuffer: Buffer, shareCode: string): AadhaarOfflineResult {
  const certPem = loadCertPem();
  if (!certPem) {
    throw new AadhaarOfflineError('NOT_CONFIGURED', 'Aadhaar verification is not set up on this server.');
  }
  if (!/^\d{4}$/.test(shareCode)) {
    throw new AadhaarOfflineError('WRONG_SHARE_CODE', 'The share code is the 4 digits you chose on myAadhaar.');
  }

  const xml = extractXml(zipBuffer, shareCode);

  let doc: Document;
  try {
    doc = new DOMParser({ onError: () => { throw new Error('parse'); } }).parseFromString(xml, 'text/xml');
  } catch {
    throw new AadhaarOfflineError('MALFORMED_XML', 'The document inside the zip could not be read.');
  }

  const root = doc.documentElement;
  if (!root || root.nodeName !== 'OfflinePaperlessKyc') {
    throw new AadhaarOfflineError('MALFORMED_XML', 'This is not an Aadhaar offline e-KYC document.');
  }

  // Signature first: nothing below is trusted until this passes.
  verifySignature(xml, doc, certPem);

  const referenceId = root.getAttribute('referenceId') || '';
  const poi = doc.getElementsByTagName('Poi')[0];
  const pht = doc.getElementsByTagName('Pht')[0];
  const name = (poi?.getAttribute('name') || '').trim();
  const dobRaw = (poi?.getAttribute('dob') || '').trim();
  const gender = (poi?.getAttribute('gender') || '').trim();
  const dateOfBirth = toIsoDate(dobRaw);
  if (!name || !dateOfBirth) {
    throw new AadhaarOfflineError('MALFORMED_XML', 'The document is missing name or date of birth.');
  }

  const photoBase64 = pht?.textContent ? pht.textContent.replace(/\s+/g, '') : null;

  // referenceId is "<last 4 digits><download timestamp>", so it changes on
  // every download. The stable part is the last four digits; combine with the
  // signed demographic fields for a per-person key.
  const lastFour = referenceId.slice(0, 4);
  const identityHash = crypto
    .createHash('sha256')
    .update([name.toLowerCase().replace(/\s+/g, ' '), dateOfBirth, gender.toUpperCase(), lastFour].join('|'))
    .digest('hex');

  return { name, dateOfBirth, gender, photoBase64, identityHash };
}
