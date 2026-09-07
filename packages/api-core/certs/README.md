# UIDAI offline e-KYC signing certificate

Aadhaar Paperless Offline e-KYC files are signed by UIDAI. To verify them the
API needs UIDAI's public certificate in this folder as:

    uidai_offline_publickey.cer

Download the current `uidai_offline_publickey_*.cer` from the UIDAI website
(Developer section, Aadhaar Paperless Offline e-KYC) and save it under that
name. DER or PEM both work. UIDAI rotates the certificate every few years;
when signature checks start failing on fresh downloads, fetch the new one.

Until the file exists the Aadhaar option is hidden in the app. A different
path can be given with UIDAI_OFFLINE_CERT_PATH.
