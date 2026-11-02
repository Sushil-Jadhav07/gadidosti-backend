const admin = require('firebase-admin');

// Shared Firebase Admin app — the Admin SDK only allows one default app per process, so this
// is the single place it's initialized. Previously only FirebasePushProvider.js did this (for
// sending push notifications); auth.controller.js's Firebase phone-login verification
// (admin.auth().verifyIdToken) now needs the exact same app, not a second one.
// Same FIREBASE_PROJECT_ID/FIREBASE_CLIENT_EMAIL/FIREBASE_PRIVATE_KEY env vars already live in
// production for push — no new credentials needed for phone-auth verification.
let app = null;
const getFirebaseAdminApp = () => {
  if (app) return app;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');
  app = admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey,
    }),
  });
  return app;
};

module.exports = { getFirebaseAdminApp };
