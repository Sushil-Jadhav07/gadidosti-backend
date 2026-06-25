const { OAuth2Client } = require('google-auth-library');

if (!process.env.GOOGLE_CLIENT_ID) {
  throw new Error('GOOGLE_CLIENT_ID is not set in environment variables. Get it from Google Cloud Console → Credentials.');
}

const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

async function verifyGoogleIdToken(idToken) {
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
