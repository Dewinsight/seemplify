const multer = require('multer');
const path = require('path');
const fs = require('fs');

const uploadsDir = path.join(__dirname, '..', 'uploads', 'logos');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadsDir),
    filename: (req, file, cb) => {
        const ext = (path.extname(file.originalname) || '.png').toLowerCase();
        const safeExt = ['.png', '.jpg', '.jpeg', '.gif', '.webp'].includes(ext) ? ext : '.png';
        const filename = `${req.organization}-${Date.now()}${safeExt}`;
        cb(null, filename);
    }
});

const fileFilter = (req, file, cb) => {
    const allowed = /\.(png|jpg|jpeg|gif|webp)$/i;
    if (allowed.test(file.originalname) || file.mimetype?.startsWith('image/')) {
        cb(null, true);
    } else {
        cb(new Error('Only image files (PNG, JPG, GIF, WebP) are allowed'));
    }
};

const upload = multer({
    storage,
    fileFilter,
    limits: { fileSize: 2 * 1024 * 1024 } // 2MB
});

module.exports = upload;
