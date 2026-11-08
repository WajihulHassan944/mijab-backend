const cloudinary = require("cloudinary").v2;

let configured = false;

function isConfigured() {
  return Boolean(process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET);
}

function ensureConfigured() {
  if (configured) return;
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
    secure: true,
  });
  configured = true;
}

/** Uploads an in-memory buffer (from multer's memoryStorage) to Cloudinary
 * and returns the resulting secure URL. */
function uploadBuffer(buffer, { folder, publicId }) {
  if (!isConfigured()) throw new Error("Cloudinary is not configured");
  ensureConfigured();
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder, public_id: publicId, resource_type: "image", overwrite: true },
      (err, result) => (err ? reject(err) : resolve(result)),
    );
    stream.end(buffer);
  });
}

module.exports = { isConfigured, uploadBuffer };
