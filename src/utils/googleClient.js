const { OAuth2Client } = require('google-auth-library');

async function verifyGoogleIdToken(idToken) {
  if (!process.env.GOOGLE_CLIENT_ID) {
    throw new Error('Google Sign-In is not configured on this server.');
  }
  const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
  const ticket = await client.verifyIdToken({
    idToken,
    audience: process.env.GOOGLE_CLIENT_ID,
  });
  const payload = ticket.getPayload();
  return {
    googleId: payload.sub,
    email: payload.email,
    emailVerified: payload.email_verified,
    name: payload.name,
    picture: payload.picture,
  };
}

module.exports = { verifyGoogleIdToken };
