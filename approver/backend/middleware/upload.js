const multer = require('multer');
const storage = multer.memoryStorage();

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
