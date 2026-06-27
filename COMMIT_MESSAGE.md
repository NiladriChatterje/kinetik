feat: implement KYC document upload with device file picker

- Added expo-document-picker for PDF/JPG/PNG selection from device storage
- Rewrote KYCScreen with actual document picking, file info display, upload
  progress, success/error feedback, and skip option
- Created backend /api/v1/kyc/documents route with multipart upload, MinIO
  storage under kyc/{userId}/ prefix, kyc_documents DB insert, and user
  kyc_status update to 'pending'
- Added /api/v1/kyc/status endpoint to retrieve KYC status
- Added submitKycDocument() and getKycStatus() methods to mobile API client
- Registered kycRoutes in api-core index.ts
