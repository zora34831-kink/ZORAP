
const admin = require("firebase-admin");

function initializeFirebase() {
  if (admin.apps.length) return;

  const serviceAccount = JSON.parse(
    process.env.FIREBASE_SERVICE_ACCOUNT
  );

  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
}

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    initializeFirebase();

    const token = req.headers.authorization?.replace(/^Bearer\s+/i, "");
    if (!token) {
      return res.status(401).json({ error: "Token tidak ditemukan" });
    }

    const decoded = await admin.auth().verifyIdToken(token);

    if (!process.env.ZORAP_OWNER_UID ||
        decoded.uid !== process.env.ZORAP_OWNER_UID) {
      return res.status(403).json({ error: "Hanya owner yang diizinkan" });
    }

    const targetUid = req.body?.uid;

    if (typeof targetUid !== "string" || !targetUid.trim()) {
      return res.status(400).json({ error: "UID target tidak valid" });
    }

    const target = await admin.auth().getUser(targetUid);
    const claims = target.customClaims || {};

    await admin.auth().setCustomUserClaims(targetUid, {
      ...claims,
      verified: true
    });

    return res.status(200).json({
      success: true,
      message: "Custom claim berhasil diberikan"
    });

  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Gagal memberikan claim" });
  }
};
